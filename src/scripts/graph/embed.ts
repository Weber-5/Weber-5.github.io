/**
 * Small embedded graphs: the home-page preview and a note's neighbourhood.
 * The engine and its data load only when the canvas nears the viewport, and the
 * setup waits for an idle moment so it never lands in the middle of a scroll.
 */
import type { GraphData, SimNode } from './engine';

const whenIdle = (run: () => void) => {
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 600 });
  else setTimeout(run, 60);
};

function whenNear(el: Element, run: () => void) {
  const io = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      run();
    },
    { rootMargin: '600px' },
  );
  io.observe(el);
}

async function load() {
  const [{ InkGraph }, data] = await Promise.all([
    import('./engine'),
    fetch('/graph.json').then((r) => r.json() as Promise<GraphData>),
  ]);
  return { InkGraph, data };
}

export function initPreview(canvas: HTMLCanvasElement) {
  const lang = canvas.dataset.lang as 'en' | 'zh';
  const prefix = lang === 'zh' ? '/zh' : '';

  whenNear(canvas, async () => {
    const { InkGraph, data } = await load();
    whenIdle(() => {
      const copy = canvas.parentElement?.querySelector<HTMLElement>('[data-band-copy]');
      const graph = new InkGraph(canvas, data, {
        lang,
        mode: 'preview',
        forceDark: true,
        maxScale: 1.5,
        // Keep the map clear of the copy: beside it when wide, below it when stacked.
        inset: () => {
          if (!copy) return { left: 0, right: 0, top: 0, bottom: 0 };
          return innerWidth > 820
            ? { left: copy.getBoundingClientRect().right, right: 0, top: 0, bottom: 0 }
            : { left: 0, right: 0, top: copy.offsetHeight - 250, bottom: 0 };
        },
        onOpen: (node: SimNode) => {
          location.href = `${prefix}/graph/#node=${encodeURIComponent(node.id)}`;
        },
      });
      canvas.classList.add('is-ready');

      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      // Light up well-connected notes in turn, so the map looks alive at rest.
      const hubs = graph.nodes.filter((n) => n.type === 'note' && n.degree >= 3);
      let visible = false;
      let hovering = false;
      canvas.addEventListener('pointerenter', () => (hovering = true));
      canvas.addEventListener('pointerleave', () => (hovering = false));
      new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (!visible) graph.pulse(null);
      }).observe(canvas);
      let i = 0;
      setInterval(() => {
        if (!visible || hovering || document.hidden || !hubs.length) return;
        i = (i + 7) % hubs.length;
        graph.pulse(hubs[i]);
      }, 2600);
    });
  });
}

export function initLocal(canvas: HTMLCanvasElement) {
  const lang = canvas.dataset.lang as 'en' | 'zh';
  const prefix = lang === 'zh' ? '/zh' : '';
  const focus = canvas.dataset.focus!;

  whenNear(canvas, async () => {
    const [{ InkGraph, data }, { settleNeighbourhood }] = await Promise.all([
      load(),
      import('../../lib/graph-layout'),
    ]);
    whenIdle(() => {
      const near = settleNeighbourhood(data.nodes, data.links, focus);
      new InkGraph(canvas, { ...data, ...near }, {
        lang,
        mode: 'local',
        focus,
        onOpen: (node: SimNode) => {
          location.href = node.url ? prefix + node.url : `${prefix}/graph/#node=${encodeURIComponent(node.id)}`;
        },
      });
      canvas.classList.add('is-ready');
    });
  });
}
