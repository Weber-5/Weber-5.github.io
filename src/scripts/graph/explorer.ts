/** The UI around the full graph: search, taxonomy filters, details, trace, growth. */
import { InkGraph, type GraphData, type NodeType, type SimNode } from './engine';

type Strings = Record<string, string>;
const $ = <T extends HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;

export async function initExplorer(root: HTMLElement) {
  const lang = root.dataset.lang as 'en' | 'zh';
  const s: Strings = JSON.parse(root.dataset.strings!);
  const prefix = lang === 'zh' ? '/zh' : '';
  const canvas = $<HTMLCanvasElement>(root, 'canvas');
  const panel = $(root, '[data-panel]');
  const detail = $(root, '[data-detail]');
  const dock = $(root, '[data-dock]');
  const live = $(root, '[data-live]');
  const traceCard = $(root, '[data-trace-card]');
  const detailBody = $(root, '[data-d-body]');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const data: GraphData = await (await fetch('/graph.json')).json();

  const wide = () => innerWidth > 900;
  const nameOf = (v: { en: string; zh: string }) => v[lang] || v.en;

  /* Trace mode claims node clicks until both ends are chosen. */
  const trace = { active: false, from: null as SimNode | null, to: null as SimNode | null };

  const graph = new InkGraph(canvas, data, {
    lang,
    mode: 'full',
    inset: () => ({
      left: wide() ? panel.offsetWidth + 28 : 0,
      right: 0,
      top: wide() ? 80 : panel.offsetTop + 52,
      bottom: dock.offsetHeight + 28 + (traceCard.hidden ? 0 : traceCard.offsetHeight + 12),
    }),
    onSelect: renderDetail,
    onOpen: (node) => {
      if (node.url) location.href = prefix + node.url;
    },
    onPick: (node) => {
      if (!trace.active) return false;
      pickTrace(node);
      return true;
    },
  });

  canvas.classList.add('is-ready');
  root.classList.add('is-ready');

  // The panel only folds on small screens; on desktop the title is just a title.
  $(root, '[data-panel] summary').addEventListener('click', (e) => {
    if (wide()) e.preventDefault();
  });

  /* --- Detail panel ---------------------------------------------------------- */

  function renderDetail(node: SimNode | null) {
    const switching = detail.classList.contains('is-open') && !!node;
    detail.classList.toggle('is-open', !!node);
    detail.setAttribute('aria-hidden', String(!node));
    history.replaceState(null, '', node ? `#node=${encodeURIComponent(node.id)}` : location.pathname);
    if (!node) return;

    const domain = graph.domains.find((d) => d.id === node.domain);
    const field = domain?.fields.find((f) => f.id === node.field);
    $(detail, '[data-d-crumb]').textContent = [domain && nameOf(domain.name), field && nameOf(field.name)]
      .filter(Boolean)
      .join(' / ');
    $(detail, '[data-d-title]').textContent = nameOf(node.title);
    $(detail, '[data-d-kind]').textContent = s[`type.${node.type}`];

    const summary = $(detail, '[data-d-summary]');
    summary.textContent = node.type === 'ghost' ? s.ghostHint : node.summary ? nameOf(node.summary) : '';

    const cta = $<HTMLAnchorElement>(detail, '[data-d-open]');
    cta.hidden = !node.url;
    if (node.url) {
      cta.href = prefix + node.url;
      $(cta, '[data-d-open-label]').textContent =
        node.type === 'paper' ? s.openPaper : node.type === 'project' ? s.openProject : s.open;
    }

    const list = $(detail, '[data-d-neighbors]');
    const neighbors = [...node.neighbors].sort((a, b) => b.degree - a.degree);
    $(detail, '[data-d-count]').textContent = String(neighbors.length);
    list.replaceChildren(
      ...neighbors.map((n) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.type = n.type;
        button.textContent = nameOf(n.title);
        button.addEventListener('click', () => graph.select(n));
        li.append(button);
        return li;
      }),
    );
    live.textContent = nameOf(node.title);

    // Moving between nodes, the new content settles in rather than swapping hard.
    if (switching && !still) {
      detailBody.animate([{ opacity: 0.25, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
        duration: 280,
        easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)',
      });
    }
  }

  $(detail, '[data-d-close]').addEventListener('click', () => graph.select(null, false));

  /* --- Search ---------------------------------------------------------------- */

  const search = $<HTMLInputElement>(root, '[data-search]');
  const results = $(root, '[data-results]');
  let hits: SimNode[] = [];
  let active = -1;

  function renderHits() {
    results.replaceChildren(
      ...hits.map((n, i) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = i === active ? 'is-active' : '';
        const title = document.createElement('span');
        title.textContent = nameOf(n.title);
        const kind = document.createElement('small');
        kind.textContent = s[`type.${n.type}`];
        button.append(title, kind);
        button.addEventListener('click', () => choose(n));
        li.append(button);
        return li;
      }),
    );
    results.hidden = !hits.length;
  }

  function choose(node: SimNode) {
    search.value = '';
    graph.search('');
    hits = [];
    active = -1;
    renderHits();
    graph.select(node);
  }

  search.addEventListener('input', () => {
    hits = graph.search(search.value);
    active = hits.length ? 0 : -1;
    renderHits();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hits.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      renderHits();
    } else if (e.key === 'Enter' && hits[active]) {
      choose(hits[active]);
    } else if (e.key === 'Escape') {
      search.value = '';
      hits = graph.search('');
      renderHits();
    }
  });

  /* --- Taxonomy filter: click a category, or narrow to any of its fields ------- */

  const domainButtons = root.querySelectorAll<HTMLButtonElement>('[data-domain]');
  const fieldButtons = root.querySelectorAll<HTMLButtonElement>('[data-field]');
  const chosenDomains = new Set<string>();
  const chosenFields = new Set<string>();

  function applyTaxonomy() {
    domainButtons.forEach((b) => b.setAttribute('aria-pressed', String(chosenDomains.has(b.dataset.domain!))));
    fieldButtons.forEach((b) => b.setAttribute('aria-pressed', String(chosenFields.has(b.dataset.field!))));
    root.querySelectorAll<HTMLElement>('[data-group]').forEach((g) => {
      const fields = g.querySelectorAll<HTMLElement>('[data-field]');
      const open = chosenDomains.has(g.dataset.group!) || [...fields].some((f) => chosenFields.has(f.dataset.field!));
      g.classList.toggle('is-open', open);
    });
    graph.setFilter({
      domains: chosenDomains.size ? chosenDomains : null,
      fields: chosenFields.size ? chosenFields : null,
    });
  }

  domainButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.domain!;
      if (chosenDomains.has(id)) {
        chosenDomains.delete(id);
        button.closest('[data-group]')?.querySelectorAll<HTMLElement>('[data-field]').forEach((f) => chosenFields.delete(f.dataset.field!));
      } else {
        chosenDomains.add(id);
      }
      applyTaxonomy();
    });
  });
  fieldButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.field!;
      if (chosenFields.has(id)) chosenFields.delete(id);
      else chosenFields.add(id);
      applyTaxonomy();
    });
  });

  const types = new Set<NodeType>(['note', 'ghost', 'paper', 'project']);
  root.querySelectorAll<HTMLButtonElement>('[data-type]').forEach((button) => {
    button.addEventListener('click', () => {
      const type = button.dataset.type as NodeType;
      if (types.has(type)) types.delete(type);
      else types.add(type);
      button.setAttribute('aria-pressed', String(types.has(type)));
      graph.setFilter({ types });
    });
  });

  /* --- Trace a path ---------------------------------------------------------- */

  const traceButton = $(root, '[data-trace]');
  const traceFrom = $(root, '[data-trace-from]');
  const traceTo = $(root, '[data-trace-to]');
  const traceResult = $(root, '[data-trace-result]');

  function resetTrace(open: boolean) {
    trace.active = open;
    trace.from = open ? graph.selected : null;
    trace.to = null;
    graph.clearTrace();
    traceButton.setAttribute('aria-pressed', String(open));
    traceCard.hidden = !open;
    traceResult.replaceChildren();
    renderTrace();
  }

  function renderTrace() {
    traceFrom.textContent = trace.from ? nameOf(trace.from.title) : s.tracePick;
    traceTo.textContent = trace.to ? nameOf(trace.to.title) : s.tracePick;
    traceFrom.classList.toggle('is-set', !!trace.from);
    traceTo.classList.toggle('is-set', !!trace.to);
  }

  function pickTrace(node: SimNode) {
    if (!trace.from || trace.to) {
      trace.from = node;
      trace.to = null;
      graph.clearTrace();
      traceResult.replaceChildren();
    } else if (node !== trace.from) {
      trace.to = node;
      const path = graph.trace(trace.from, node);
      if (!path) traceResult.textContent = s.traceNone;
      else {
        const steps = path.map((n) => {
          const span = document.createElement('span');
          span.textContent = nameOf(n.title);
          return span;
        });
        const hops = document.createElement('em');
        hops.textContent = `${path.length - 1} ${s.traceHops}`;
        traceResult.replaceChildren(hops, ...steps);
      }
    }
    renderTrace();
  }

  traceButton.addEventListener('click', () => resetTrace(!trace.active));
  $(root, '[data-trace-clear]').addEventListener('click', () => resetTrace(false));

  /* --- Wander ---------------------------------------------------------------- */

  const wanderButton = $(root, '[data-wander]');
  let wandering = false;
  const setWander = (on: boolean) => {
    wandering = on;
    wanderButton.setAttribute('aria-pressed', String(on));
  };
  graph.onWanderStop = () => setWander(false);
  wanderButton.addEventListener('click', () => {
    if (wandering) graph.stopWander();
    else {
      setWander(true);
      graph.wander();
    }
  });

  /* --- Growth replay --------------------------------------------------------- */

  const growButton = $(root, '[data-grow]');
  const growRange = $<HTMLInputElement>(root, '[data-grow-range]');
  const growDate = $(root, '[data-grow-date]');
  const { min, max } = graph.dateRange();
  const t0 = Date.parse(min);
  const t1 = Date.parse(max);
  const dateAt = (u: number) => new Date(t0 + (t1 - t0) * u).toISOString().slice(0, 10);
  let playing = 0;

  const showDate = (u: number) => {
    growRange.value = String(u * 1000);
    growDate.textContent = dateAt(u).slice(0, 7);
  };
  showDate(1);

  function stopGrow() {
    cancelAnimationFrame(playing);
    playing = 0;
    growButton.setAttribute('aria-pressed', 'false');
  }

  growRange.addEventListener('input', () => {
    stopGrow();
    const u = Number(growRange.value) / 1000;
    showDate(u);
    graph.setGrowth(u >= 1 ? null : dateAt(u));
  });

  growButton.addEventListener('click', () => {
    if (playing) return stopGrow();
    growButton.setAttribute('aria-pressed', 'true');
    graph.select(null, false);
    graph.fit();
    const start = performance.now();
    const duration = 9000;
    const step = (now: number) => {
      const u = Math.min(1, (now - start) / duration);
      showDate(u);
      graph.setGrowth(u >= 1 ? null : dateAt(u));
      if (u < 1) playing = requestAnimationFrame(step);
      else stopGrow();
    };
    playing = requestAnimationFrame(step);
  });

  /* --- View controls --------------------------------------------------------- */

  $(root, '[data-zoom-in]').addEventListener('click', () => graph.zoomBy(1.35));
  $(root, '[data-zoom-out]').addEventListener('click', () => graph.zoomBy(1 / 1.35));
  $(root, '[data-fit]').addEventListener('click', () => graph.fit());

  const listButton = $(root, '[data-list-toggle]');
  const listView = $(root, '[data-list]');
  listButton.addEventListener('click', () => {
    const showing = !listView.hidden;
    listView.hidden = showing;
    root.classList.toggle('is-list', !showing);
    listButton.setAttribute('aria-pressed', String(!showing));
  });

  /* --- Deep link: /graph/#node=<id> ------------------------------------------ */

  const openFromHash = () => {
    const id = decodeURIComponent(location.hash.match(/node=([^&]+)/)?.[1] ?? '');
    const node = graph.byId.get(id);
    if (node) graph.select(node);
  };
  openFromHash();
  addEventListener('hashchange', openFromHash);
}
