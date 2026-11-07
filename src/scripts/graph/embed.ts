/**
 * Small embedded graphs: the home-page preview and a note's neighbourhood.
 * The engine and its data load only when the canvas nears the viewport.
 */
import type { GraphData, SimNode } from './engine';

function whenNear(el: Element, run: () => void) {
  const io = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      run();
    },
    { rootMargin: '400px' },
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
    const copy = canvas.parentElement?.querySelector<HTMLElement>('[data-band-copy]');
    const graph = new InkGraph(canvas, data, {
      lang,
      mode: 'preview',
      forceDark: true,
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
}

export function initLocal(canvas: HTMLCanvasElement) {
  const lang = canvas.dataset.lang as 'en' | 'zh';
  const prefix = lang === 'zh' ? '/zh' : '';

  whenNear(canvas, async () => {
    const { InkGraph, data } = await load();
    new InkGraph(canvas, data, {
      lang,
      mode: 'local',
      focus: canvas.dataset.focus,
      onOpen: (node: SimNode) => {
        location.href = node.url ? prefix + node.url : `${prefix}/graph/#node=${encodeURIComponent(node.id)}`;
      },
    });
    canvas.classList.add('is-ready');
  });
}
