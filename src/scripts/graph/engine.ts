/**
 * InkGraph: the knowledge-graph renderer.
 *
 * d3-force computes the layout once, up front, so the map appears already settled.
 * After that the canvas repaints only while something is actually moving, which
 * means an idle graph costs nothing.
 *
 * Visual language:
 *   notes    ink dots, sized by how connected they are
 *   ghosts   hollow rings: unwritten notes that others already point at
 *   papers   blue diamonds    } the academic-blue dabs on the ink map
 *   projects blue squares     }
 *   domains  ink-wash continents, accumulated from a soft stain under every node
 *
 * One engine, three modes: `full` (the explorer), `preview` (home page, ambient),
 * `local` (a note's neighbourhood).
 */
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

export type NodeType = 'note' | 'ghost' | 'paper' | 'project';
type Both = { en: string; zh: string };

export interface GraphNode {
  id: string;
  type: NodeType;
  title: Both;
  domain: string;
  field?: string;
  url?: string;
  summary?: Both;
  tags?: string[];
  date: string;
  status?: string;
}

export interface GraphDomain {
  id: string;
  name: Both;
  fields: { id: string; name: Both }[];
}

export interface GraphData {
  nodes: GraphNode[];
  links: { source: string; target: string }[];
  domains: GraphDomain[];
}

export interface SimNode extends GraphNode, SimulationNodeDatum {
  x: number;
  y: number;
  degree: number;
  r: number;
  neighbors: Set<SimNode>;
  anchorX: number;
  anchorY: number;
  /** Eased display state. */
  alpha: number;
  hot: number;
  born: number;
  seed: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: SimNode;
  target: SimNode;
  bend: number;
  hot: number;
}

export interface Filter {
  domains?: Set<string> | null;
  fields?: Set<string> | null;
  types?: Set<NodeType> | null;
  query?: string;
}

export interface GraphOptions {
  lang: 'en' | 'zh';
  mode: 'full' | 'preview' | 'local';
  focus?: string;
  forceDark?: boolean;
  /** Space the UI covers, so fitting the view keeps the map in the free area. */
  inset?: () => { left: number; right: number; top: number; bottom: number };
  onSelect?: (node: SimNode | null) => void;
  onOpen?: (node: SimNode) => void;
  onPick?: (node: SimNode) => boolean;
}

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const FONT = `'Inter Variable', 'Noto Sans SC Variable', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif`;
const MONO = `'JetBrains Mono Variable', 'Noto Sans SC Variable', 'PingFang SC', 'Microsoft YaHei', monospace`;

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const PALETTES = {
  light: {
    ink: '26, 30, 37',
    ghost: '120, 128, 140',
    blue: '31, 79, 168',
    paper: '246, 247, 248',
    cloud: ['52, 60, 74', '28, 34, 46', '70, 76, 88'],
    cloudAlpha: 0.11,
    link: 0.15,
  },
  dark: {
    ink: '226, 230, 236',
    ghost: '132, 141, 153',
    blue: '141, 178, 242',
    paper: '12, 14, 17',
    cloud: ['120, 136, 165', '150, 170, 205', '110, 120, 140'],
    cloudAlpha: 0.1,
    link: 0.16,
  },
};

/** Keep a node's closest surroundings: a two-hop ego network, capped for legibility. */
function egoNetwork(data: GraphData, focus: string, cap = 26): GraphData {
  const adjacent = new Map<string, Set<string>>();
  for (const { source, target } of data.links) {
    if (!adjacent.has(source)) adjacent.set(source, new Set());
    if (!adjacent.has(target)) adjacent.set(target, new Set());
    adjacent.get(source)!.add(target);
    adjacent.get(target)!.add(source);
  }
  const keep = new Set([focus]);
  const first = [...(adjacent.get(focus) ?? [])];
  first.forEach((id) => keep.add(id));
  for (const id of first) {
    for (const next of adjacent.get(id) ?? []) {
      if (keep.size >= cap) break;
      keep.add(next);
    }
  }
  return {
    nodes: data.nodes.filter((n) => keep.has(n.id)),
    links: data.links.filter((l) => keep.has(l.source) && keep.has(l.target)),
    domains: data.domains,
  };
}

export class InkGraph {
  nodes: SimNode[] = [];
  links: SimLink[] = [];
  byId = new Map<string, SimNode>();
  domains: GraphDomain[];

  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private cam = { x: 0, y: 0, k: 1 };
  private camFrom: typeof this.cam | null = null;
  private camTo: typeof this.cam | null = null;
  private camStart = 0;
  private camDuration = 0;
  private userMoved = false;

  private sim: Simulation<SimNode, SimLink>;
  private dark: boolean;
  private raf = 0;
  private still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private cleanups: (() => void)[] = [];

  private hover: SimNode | null = null;
  selected: SimNode | null = null;
  private path: SimNode[] = [];
  private pathKeys = new Set<string>();
  private filter: Filter = {};
  private growth: string | null = null;
  private blooms: { node: SimNode; start: number }[] = [];

  private cloud = document.createElement('canvas');
  private cloudBox = { x: 0, y: 0, w: 0, h: 0 };
  private cloudDirty = true;
  private stains = new Map<string, HTMLCanvasElement>();
  private grain: HTMLCanvasElement | null = null;
  private regions: { name: string; x: number; y: number; level: 'domain' | 'field'; domain: string; field?: string }[] = [];

  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { node?: SimNode; lastX: number; lastY: number; moved: number } | null = null;
  private pinch: { dist: number; k: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    data: GraphData,
    private opts: GraphOptions,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.dark = opts.forceDark || document.documentElement.dataset.theme === 'dark';
    this.domains = data.domains;

    const source = opts.mode === 'local' && opts.focus ? egoNetwork(data, opts.focus) : data;
    this.buildNodes(source);
    this.sim = this.layout();
    this.collectRegions();

    this.resize();
    this.fit(false);
    this.bindEvents();
    if (opts.mode === 'local' && opts.focus) {
      this.selected = this.byId.get(opts.focus) ?? null;
    }
    document.fonts?.ready.then(() => this.kick());
    this.kick();
  }

  /* --- Setup --------------------------------------------------------------- */

  private buildNodes(data: GraphData) {
    this.nodes = data.nodes.map((n) => ({
      ...n,
      x: 0,
      y: 0,
      degree: 0,
      r: 3,
      neighbors: new Set(),
      anchorX: 0,
      anchorY: 0,
      alpha: 1,
      hot: 0,
      born: -1e9,
      seed: hashString(n.id),
    }));
    this.byId = new Map(this.nodes.map((n) => [n.id, n]));

    this.links = data.links.flatMap((l) => {
      const source = this.byId.get(l.source);
      const target = this.byId.get(l.target);
      if (!source || !target) return [];
      source.degree++;
      target.degree++;
      source.neighbors.add(target);
      target.neighbors.add(source);
      return [{ source, target, bend: (hashString(l.source + l.target) - 0.5) * 0.22, hot: 0 }];
    });

    for (const n of this.nodes) {
      n.r = n.type === 'ghost' ? 2.4 : 2.2 + Math.sqrt(n.degree) * 1.6;
      if (n.type === 'paper' || n.type === 'project') n.r += 1.2;
    }
  }

  /**
   * Continents first: the largest domain anchors the right, the others fan out to
   * its left. A triangle fills a screen far better than a row does, and the left
   * side is where the control panel leaves room. Fields then spread inside each
   * continent along a golden-angle spiral.
   */
  private assignAnchors() {
    const counts = new Map<string, number>();
    for (const n of this.nodes) counts.set(n.domain, (counts.get(n.domain) ?? 0) + 1);
    const order = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!);
    const radius = (id: string) => 33 * Math.sqrt(counts.get(id)!);

    const centers = new Map<string, { x: number; y: number }>();
    const main = order[0];
    if (main) centers.set(main, { x: 0, y: 0 });
    const others = order.slice(1);
    const fan = 0.22 * others.length;
    others.forEach((id, i) => {
      const u = others.length > 1 ? i / (others.length - 1) : 0.5;
      const angle = Math.PI + fan - 2 * fan * u;
      const dist = radius(main) + radius(id) + 70;
      centers.set(id, { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist });
    });

    for (const id of order) {
      const center = centers.get(id)!;
      const members = this.nodes.filter((n) => n.domain === id);
      const fields = [...new Set(members.map((n) => n.field ?? ''))].sort();
      fields.forEach((field, j) => {
        const spread = radius(id) * 0.92 * Math.sqrt((j + 0.5) / fields.length);
        const angle = j * 2.39996 + hashString(id) * TAU;
        const fx = center.x + (fields.length > 1 ? Math.cos(angle) * spread : 0);
        const fy = center.y + (fields.length > 1 ? Math.sin(angle) * spread : 0);
        for (const n of members) {
          if ((n.field ?? '') !== field) continue;
          n.anchorX = fx;
          n.anchorY = fy;
          // Start near home so the layout converges to the same map every time.
          n.x = fx + (n.seed - 0.5) * 60;
          n.y = fy + (hashString(`${n.id}y`) - 0.5) * 60;
        }
      });
    }
  }

  private layout() {
    const local = this.opts.mode === 'local';
    if (!local) this.assignAnchors();
    else {
      this.nodes.forEach((n, i) => {
        const a = (i / this.nodes.length) * TAU;
        n.x = Math.cos(a) * 60;
        n.y = Math.sin(a) * 60;
      });
      const focus = this.opts.focus ? this.byId.get(this.opts.focus) : undefined;
      if (focus) {
        focus.fx = 0;
        focus.fy = 0;
      }
    }

    const sim = forceSimulation<SimNode, SimLink>(this.nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(this.links)
          .distance((l) => (local ? 46 : l.source.field === l.target.field ? 26 : 90))
          .strength((l) => {
            if (local) return 0.5;
            if (l.source.field === l.target.field) return 0.5;
            // Cross references are drawn, but must not drag the continents together.
            return l.source.domain === l.target.domain ? 0.02 : 0.002;
          }),
      )
      .force('charge', forceManyBody<SimNode>().strength(local ? -120 : -46).distanceMax(120))
      .force('collide', forceCollide<SimNode>((n) => n.r + (local ? 12 : 7)).iterations(2))
      .force('x', forceX<SimNode>((n) => n.anchorX).strength(local ? 0.05 : 0.24))
      .force('y', forceY<SimNode>((n) => n.anchorY).strength(local ? 0.05 : 0.24))
      .stop();
    sim.tick(320);
    sim.on('tick', () => {
      this.cloudDirty = true;
      this.collectRegions();
      this.kick();
    });
    return sim;
  }

  /** Where the domain and field names sit: above each continent, at each field's heart. */
  private collectRegions() {
    if (this.opts.mode === 'local') return;
    const nameOf = (v: Both) => v[this.opts.lang] || v.en;
    this.regions = [];
    for (const domain of this.domains) {
      const members = this.nodes.filter((n) => n.domain === domain.id);
      if (!members.length) continue;
      const minY = Math.min(...members.map((n) => n.y));
      const cx = members.reduce((s, n) => s + n.x, 0) / members.length;
      this.regions.push({ name: nameOf(domain.name), x: cx, y: minY - 34, level: 'domain', domain: domain.id });
      for (const field of domain.fields) {
        const group = members.filter((n) => n.field === field.id);
        if (!group.length) continue;
        this.regions.push({
          name: nameOf(field.name),
          x: group.reduce((s, n) => s + n.x, 0) / group.length,
          y: Math.min(...group.map((n) => n.y)) - 15,
          level: 'field',
          domain: domain.id,
          field: field.id,
        });
      }
    }
  }

  /* --- Geometry ------------------------------------------------------------ */

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
  }

  private toWorld(sx: number, sy: number) {
    return { x: (sx - this.cam.x) / this.cam.k, y: (sy - this.cam.y) / this.cam.k };
  }

  /** The view that shows these nodes inside the area the UI leaves free. */
  private frameFor(nodes: SimNode[], pad = 1) {
    const inset = this.opts.inset?.() ?? { left: 0, right: 0, top: 0, bottom: 0 };
    const margin = this.opts.mode === 'full' ? 44 : 22;
    const availW = Math.max(120, this.w - inset.left - inset.right - margin * 2);
    const availH = Math.max(120, this.h - inset.top - inset.bottom - margin * 2);
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const room = this.opts.mode === 'local' ? 16 : 56;
    const x0 = Math.min(...xs) - room;
    const x1 = Math.max(...xs) + room;
    const y0 = Math.min(...ys) - (this.opts.mode === 'local' ? 8 : 40);
    const y1 = Math.max(...ys) + 16;
    const k = clamp(Math.min(availW / (x1 - x0 || 1), availH / (y1 - y0 || 1)) * pad, 0.22, 2.2);
    return {
      k,
      x: inset.left + margin + availW / 2 - ((x0 + x1) / 2) * k,
      y: inset.top + margin + availH / 2 - ((y0 + y1) / 2) * k,
    };
  }

  fit(animate = true) {
    if (!this.nodes.length) return;
    const target = this.frameFor(this.nodes);
    this.userMoved = false;
    if (animate) this.flyCam(target, 700);
    else this.cam = target;
    this.kick();
  }

  private flyCam(target: typeof this.cam, duration: number) {
    if (this.still) {
      this.cam = target;
      this.kick();
      return;
    }
    this.camFrom = { ...this.cam };
    this.camTo = target;
    this.camStart = performance.now();
    this.camDuration = duration;
    this.kick();
  }

  flyTo(node: SimNode, zoom?: number) {
    const inset = this.opts.inset?.() ?? { left: 0, right: 0, top: 0, bottom: 0 };
    const k = zoom ?? clamp(this.cam.k, 1.15, 1.9);
    const cx = inset.left + (this.w - inset.left - inset.right) / 2;
    const cy = inset.top + (this.h - inset.top - inset.bottom) / 2;
    this.flyCam({ k, x: cx - node.x * k, y: cy - node.y * k }, 780);
    this.userMoved = true;
  }

  zoomBy(factor: number, cx = this.w / 2, cy = this.h / 2, animate = true) {
    const k = clamp(this.cam.k * factor, 0.22, 4.5);
    const world = this.toWorld(cx, cy);
    const target = { k, x: cx - world.x * k, y: cy - world.y * k };
    this.userMoved = true;
    if (animate) this.flyCam(target, 260);
    else {
      this.cam = target;
      this.kick();
    }
  }

  /* --- State --------------------------------------------------------------- */

  private isVisible(n: SimNode) {
    return !this.growth || n.date <= this.growth;
  }

  private matches(n: SimNode) {
    const { domains, fields, types, query } = this.filter;
    if (types && !types.has(n.type)) return false;
    if (fields) {
      if (!n.field || !fields.has(n.field)) return false;
    } else if (domains && !domains.has(n.domain)) {
      return false;
    }
    if (query) {
      const hay = `${n.title.en} ${n.title.zh} ${n.tags?.join(' ') ?? ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  }

  setFilter(filter: Filter) {
    this.filter = { ...this.filter, ...filter };
    this.kick();
  }

  search(query: string, limit = 7) {
    const q = query.trim().toLowerCase();
    this.setFilter({ query: q });
    if (!q) return [];
    return this.nodes
      .filter((n) => `${n.title.en} ${n.title.zh}`.toLowerCase().includes(q))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, limit);
  }

  select(node: SimNode | null, fly = true) {
    this.selected = node;
    if (node) {
      if (!this.still) this.blooms.push({ node, start: performance.now() });
      if (fly) this.flyTo(node);
    }
    this.opts.onSelect?.(node);
    this.kick();
  }

  /** Breadth-first shortest path; returns the nodes along it. */
  trace(from: SimNode, to: SimNode) {
    const previous = new Map<SimNode, SimNode | null>([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const current = queue.shift()!;
      if (current === to) break;
      for (const next of current.neighbors) {
        if (!previous.has(next)) {
          previous.set(next, current);
          queue.push(next);
        }
      }
    }
    if (!previous.has(to)) {
      this.clearTrace();
      return null;
    }
    const path: SimNode[] = [];
    for (let n: SimNode | null | undefined = to; n; n = previous.get(n)) path.unshift(n);
    this.path = path;
    this.pathKeys = new Set(path.slice(1).map((n, i) => this.edgeKey(path[i], n)));
    this.flyCam(this.frameFor(path, 0.7), 900);
    this.userMoved = true;
    this.kick();
    return path;
  }

  clearTrace() {
    this.path = [];
    this.pathKeys.clear();
    this.kick();
  }

  private edgeKey = (a: SimNode, b: SimNode) => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);

  /** Show the map as it stood on a date; null shows everything. */
  setGrowth(date: string | null) {
    const now = performance.now();
    for (const n of this.nodes) {
      const was = !this.growth || n.date <= this.growth;
      const will = !date || n.date <= date;
      if (will && !was) n.born = now;
    }
    this.growth = date;
    this.cloudDirty = true;
    this.kick();
  }

  dateRange() {
    const dates = this.nodes.map((n) => n.date).sort();
    return { min: dates[0], max: dates.at(-1)! };
  }

  setTheme(theme: string) {
    if (this.opts.forceDark) return;
    this.dark = theme === 'dark';
    this.stains.clear();
    this.cloudDirty = true;
    this.kick();
  }

  /** Ambient highlight for the home page preview. */
  pulse(node: SimNode | null) {
    this.hover = node;
    if (node && !this.still) this.blooms.push({ node, start: performance.now() });
    this.kick();
  }

  /* --- Input --------------------------------------------------------------- */

  private nodeAt(sx: number, sy: number) {
    const world = this.toWorld(sx, sy);
    let best: SimNode | null = null;
    let bestDist = Infinity;
    for (const n of this.nodes) {
      if (!this.isVisible(n)) continue;
      const reach = n.r + 9 / this.cam.k;
      const d = Math.hypot(n.x - world.x, n.y - world.y);
      if (d < reach && d < bestDist) {
        best = n;
        bestDist = d;
      }
    }
    return best;
  }

  private bindEvents() {
    const c = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      c.addEventListener(type, fn, options);
      this.cleanups.push(() => c.removeEventListener(type, fn));
    };
    const local = (e: PointerEvent | WheelEvent) => {
      const rect = c.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const full = this.opts.mode === 'full';

    on('pointermove', (e) => {
      const p = local(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);

      if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const factor = (this.pinch.k * (dist / this.pinch.dist)) / this.cam.k;
        this.zoomBy(factor, (a.x + b.x) / 2, (a.y + b.y) / 2, false);
        return;
      }

      if (this.drag) {
        const dx = p.x - this.drag.lastX;
        const dy = p.y - this.drag.lastY;
        this.drag.moved += Math.abs(dx) + Math.abs(dy);
        this.drag.lastX = p.x;
        this.drag.lastY = p.y;
        if (this.drag.node && full) {
          const world = this.toWorld(p.x, p.y);
          this.drag.node.fx = world.x;
          this.drag.node.fy = world.y;
          this.sim.alphaTarget(0.18).restart();
        } else if (full) {
          this.camTo = null;
          this.cam.x += dx;
          this.cam.y += dy;
          this.userMoved = true;
          this.kick();
        }
        return;
      }

      const hit = this.nodeAt(p.x, p.y);
      if (hit !== this.hover) {
        this.hover = hit;
        c.style.cursor = hit ? 'pointer' : full ? 'grab' : 'default';
        this.kick();
      }
    });

    on('pointerleave', () => {
      if (this.opts.mode === 'preview' || !this.drag) {
        this.hover = null;
        this.kick();
      }
    });

    on('pointerdown', (e) => {
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: this.cam.k };
        this.drag = null;
        return;
      }
      this.stopWander();
      this.drag = { node: this.nodeAt(p.x, p.y) ?? undefined, lastX: p.x, lastY: p.y, moved: 0 };
      if (full) c.setPointerCapture(e.pointerId);
      if (full && !this.drag.node) c.style.cursor = 'grabbing';
    });

    const release = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      const drag = this.drag;
      this.drag = null;
      if (!drag) return;
      if (drag.node && full && drag.moved > 4) {
        drag.node.fx = null;
        drag.node.fy = null;
        this.sim.alphaTarget(0);
      }
      if (full) c.style.cursor = this.hover ? 'pointer' : 'grab';
      if (drag.moved > 6) return;

      if (drag.node) {
        if (this.opts.onPick?.(drag.node)) return;
        if (full) this.select(drag.node);
        else this.opts.onOpen?.(drag.node);
      } else if (full) {
        this.select(null, false);
      }
    };
    on('pointerup', release);
    on('pointercancel', (e) => {
      this.pointers.delete(e.pointerId);
      this.pinch = null;
      this.drag = null;
    });

    if (full) {
      on(
        'wheel',
        (e) => {
          e.preventDefault();
          const p = local(e);
          this.zoomBy(Math.exp(-e.deltaY * 0.0016), p.x, p.y, false);
        },
        { passive: false },
      );
      on('dblclick', (e) => {
        const p = local(e as unknown as PointerEvent);
        const hit = this.nodeAt(p.x, p.y);
        if (hit) this.opts.onOpen?.(hit);
      });
      on('keydown', (e) => this.onKey(e));
    }

    const ro = new ResizeObserver(() => {
      this.resize();
      if (!this.userMoved) this.fit(false);
      this.kick();
    });
    ro.observe(c);
    this.cleanups.push(() => ro.disconnect());

    const onTheme = ((e: CustomEvent<string>) => this.setTheme(e.detail)) as EventListener;
    addEventListener('themechange', onTheme);
    this.cleanups.push(() => removeEventListener('themechange', onTheme));
  }

  /** Arrow keys walk to the nearest node in that direction, preferring linked ones. */
  private onKey(e: KeyboardEvent) {
    const vectors: Record<string, [number, number]> = {
      ArrowRight: [1, 0],
      ArrowLeft: [-1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (e.key in vectors) {
      e.preventDefault();
      const from = this.selected ?? [...this.nodes].sort((a, b) => b.degree - a.degree)[0];
      if (!this.selected) return this.select(from);
      const [vx, vy] = vectors[e.key];
      let best: SimNode | null = null;
      let bestScore = Infinity;
      for (const n of this.nodes) {
        if (n === from || !this.isVisible(n)) continue;
        const dx = n.x - from.x;
        const dy = n.y - from.y;
        const dist = Math.hypot(dx, dy);
        const along = (dx * vx + dy * vy) / dist;
        if (along < 0.45) continue;
        const score = (dist / along) * (from.neighbors.has(n) ? 0.45 : 1);
        if (score < bestScore) {
          bestScore = score;
          best = n;
        }
      }
      if (best) this.select(best);
    } else if (e.key === 'Enter' && this.selected) {
      this.opts.onOpen?.(this.selected);
    } else if (e.key === 'Escape') {
      this.select(null, false);
    } else if (e.key === '+' || e.key === '=') {
      this.zoomBy(1.3);
    } else if (e.key === '-') {
      this.zoomBy(1 / 1.3);
    } else if (e.key === '0') {
      this.fit();
    }
  }

  /* --- Wander -------------------------------------------------------------- */

  private wanderTimer = 0;
  onWanderStop?: () => void;

  wander() {
    const step = () => {
      const from = this.selected ?? this.nodes[Math.floor(Math.random() * this.nodes.length)];
      const options = [...from.neighbors].filter((n) => n.type !== 'ghost');
      const next = options.length
        ? options[Math.floor(Math.random() * options.length)]
        : this.nodes[Math.floor(Math.random() * this.nodes.length)];
      this.select(next);
      this.wanderTimer = window.setTimeout(step, 3000);
    };
    step();
  }

  stopWander() {
    if (!this.wanderTimer) return;
    clearTimeout(this.wanderTimer);
    this.wanderTimer = 0;
    this.onWanderStop?.();
  }

  /* --- Render -------------------------------------------------------------- */

  private kick() {
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number) {
    this.raf = 0;
    let busy = this.updateCamera(now);

    const focus = this.hover ?? this.selected;
    const neighbours = focus?.neighbors;
    const onPath = new Set(this.path);
    const dimming = !!focus || this.path.length > 0;
    const ease = this.still ? 1 : 0.16;

    for (const n of this.nodes) {
      let alpha = 1;
      if (!this.isVisible(n)) alpha = 0;
      else if (!this.matches(n)) alpha = 0.1;
      else if (dimming && n !== focus && !neighbours?.has(n) && !onPath.has(n)) alpha = this.opts.mode === 'local' ? 0.5 : 0.2;
      const hot = n === focus || n === this.selected || onPath.has(n) ? 1 : neighbours?.has(n) ? 0.55 : 0;

      n.alpha += (alpha - n.alpha) * ease;
      n.hot += (hot - n.hot) * ease;
      if (Math.abs(alpha - n.alpha) > 0.004 || Math.abs(hot - n.hot) > 0.004) busy = true;
      if (now - n.born < 900) busy = true;
    }

    for (const l of this.links) {
      const inPath = this.pathKeys.has(this.edgeKey(l.source, l.target));
      const hot = inPath || (focus && (l.source === focus || l.target === focus)) ? 1 : 0;
      l.hot += (hot - l.hot) * ease;
      if (Math.abs(hot - l.hot) > 0.004) busy = true;
    }

    this.blooms = this.blooms.filter((b) => now - b.start < 1100);
    if (this.blooms.length) busy = true;
    // Signal pulses keep running along highlighted edges.
    if ((focus || this.path.length) && !this.still) busy = true;

    if (this.cloudDirty) this.paintClouds();
    this.draw(now, focus);
    if (busy) this.kick();
  }

  private updateCamera(now: number) {
    if (!this.camFrom || !this.camTo) return false;
    const u = clamp((now - this.camStart) / this.camDuration, 0, 1);
    const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
    this.cam = {
      k: this.camFrom.k + (this.camTo.k - this.camFrom.k) * e,
      x: this.camFrom.x + (this.camTo.x - this.camFrom.x) * e,
      y: this.camFrom.y + (this.camTo.y - this.camFrom.y) * e,
    };
    if (u >= 1) {
      this.camFrom = null;
      this.camTo = null;
      return false;
    }
    return true;
  }

  private get palette() {
    return PALETTES[this.dark ? 'dark' : 'light'];
  }

  private stain(tint: string) {
    let sprite = this.stains.get(tint);
    if (!sprite) {
      sprite = document.createElement('canvas');
      sprite.width = sprite.height = 128;
      const g = sprite.getContext('2d')!;
      const gradient = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, `rgba(${tint}, 1)`);
      gradient.addColorStop(0.45, `rgba(${tint}, 0.46)`);
      gradient.addColorStop(1, `rgba(${tint}, 0)`);
      g.fillStyle = gradient;
      g.fillRect(0, 0, 128, 128);
      this.stains.set(tint, sprite);
    }
    return sprite;
  }

  /** Low-frequency noise that breaks the wash into mottled, paper-like ink. */
  private grainTexture() {
    if (this.grain) return this.grain;
    const size = 256;
    const cells = 16;
    const lattice = Array.from({ length: cells * cells }, (_, i) => hashString(`g${i}`));
    const at = (x: number, y: number) => lattice[(y % cells) * cells + (x % cells)];
    const smooth = (t: number) => t * t * (3 - 2 * t);

    this.grain = document.createElement('canvas');
    this.grain.width = this.grain.height = size;
    const g = this.grain.getContext('2d')!;
    const image = g.createImageData(size, size);
    // Value noise on a wrapping lattice, so the tile repeats with no visible seam.
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const fx = (px / size) * cells;
        const fy = (py / size) * cells;
        const x = Math.floor(fx);
        const y = Math.floor(fy);
        const u = smooth(fx - x);
        const v = smooth(fy - y);
        const top = at(x, y) * (1 - u) + at(x + 1, y) * u;
        const bottom = at(x, y + 1) * (1 - u) + at(x + 1, y + 1) * u;
        image.data[(py * size + px) * 4 + 3] = (top * (1 - v) + bottom * v) * 255;
      }
    }
    g.putImageData(image, 0, 0);
    return this.grain;
  }

  /**
   * The ink-wash continents. Every node stains an offscreen canvas in world space;
   * where stains overlap the wash deepens, so each continent's outline comes from
   * the notes themselves. Mottling then removes the airbrushed look.
   */
  private paintClouds() {
    this.cloudDirty = false;
    if (this.opts.mode === 'local') return;
    const visible = this.nodes.filter((n) => this.isVisible(n));
    if (!visible.length) {
      this.cloudBox.w = 0;
      return;
    }
    const pad = 230;
    const x0 = Math.min(...visible.map((n) => n.x)) - pad;
    const y0 = Math.min(...visible.map((n) => n.y)) - pad;
    const x1 = Math.max(...visible.map((n) => n.x)) + pad;
    const y1 = Math.max(...visible.map((n) => n.y)) + pad;
    const scale = 0.5;
    this.cloudBox = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    this.cloud.width = Math.ceil((x1 - x0) * scale);
    this.cloud.height = Math.ceil((y1 - y0) * scale);

    const g = this.cloud.getContext('2d')!;
    const { cloud, cloudAlpha } = this.palette;
    const domainIndex = new Map(this.domains.map((d, i) => [d.id, i]));
    g.clearRect(0, 0, this.cloud.width, this.cloud.height);
    for (const domain of this.domains) {
      const members = visible.filter((n) => n.domain === domain.id);
      if (members.length < 2) continue;
      const cx = members.reduce((s, n) => s + n.x, 0) / members.length;
      const cy = members.reduce((s, n) => s + n.y, 0) / members.length;
      const reach = Math.max(...members.map((n) => Math.hypot(n.x - cx, n.y - cy))) * 1.45 * scale;
      const tint = cloud[(domainIndex.get(domain.id) ?? 0) % cloud.length];
      g.globalAlpha = cloudAlpha * 1.5;
      g.drawImage(this.stain(tint), (cx - x0) * scale - reach, (cy - y0) * scale - reach, reach * 2, reach * 2);
    }
    for (const n of visible) {
      const tint = cloud[(domainIndex.get(n.domain) ?? 0) % cloud.length];
      const radius = (70 + Math.min(n.degree, 10) * 7) * scale;
      const x = (n.x - x0) * scale;
      const y = (n.y - y0) * scale;
      g.globalAlpha = n.type === 'ghost' ? cloudAlpha * 0.5 : cloudAlpha;
      g.drawImage(this.stain(tint), x - radius, y - radius, radius * 2, radius * 2);
    }
    g.globalAlpha = 0.5;
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = g.createPattern(this.grainTexture(), 'repeat')!;
    g.fillRect(0, 0, this.cloud.width, this.cloud.height);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }

  private draw(now: number, focus: SimNode | null) {
    const { ctx: c, cam, w, h } = this;
    const p = this.palette;
    const dotScale = cam.k ** 0.62;

    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, w, h);

    if (this.cloudBox.w) {
      c.globalAlpha = 1;
      c.imageSmoothingQuality = 'high';
      c.drawImage(
        this.cloud,
        this.cloudBox.x * cam.k + cam.x,
        this.cloudBox.y * cam.k + cam.y,
        this.cloudBox.w * cam.k,
        this.cloudBox.h * cam.k,
      );
    }

    // Links: a slight bend gives the hand-drawn feel of a brush line.
    c.lineCap = 'round';
    for (const l of this.links) {
      const a = l.source;
      const b = l.target;
      const alpha = Math.min(a.alpha, b.alpha);
      if (alpha < 0.02) continue;
      const ax = a.x * cam.k + cam.x;
      const ay = a.y * cam.k + cam.y;
      const bx = b.x * cam.k + cam.x;
      const by = b.y * cam.k + cam.y;
      if (Math.max(ax, bx) < 0 || Math.min(ax, bx) > w || Math.max(ay, by) < 0 || Math.min(ay, by) > h) continue;
      const mx = (ax + bx) / 2 - (by - ay) * l.bend;
      const my = (ay + by) / 2 + (bx - ax) * l.bend;

      c.beginPath();
      c.moveTo(ax, ay);
      c.quadraticCurveTo(mx, my, bx, by);
      const ghostly = a.type === 'ghost' || b.type === 'ghost';
      c.setLineDash(ghostly ? [2, 4] : []);
      const distant = a.domain !== b.domain ? 0.4 : a.field !== b.field ? 0.7 : 1.5;
      c.strokeStyle = `rgba(${p.ink}, ${p.link * distant * alpha * (1 - l.hot)})`;
      c.lineWidth = 0.9;
      c.stroke();
      if (l.hot > 0.02) {
        c.strokeStyle = `rgba(${p.blue}, ${0.75 * l.hot * Math.max(alpha, 0.6)})`;
        c.lineWidth = 1 + 0.6 * l.hot;
        c.stroke();
      }
      c.setLineDash([]);

      // A signal travelling along the highlighted edge.
      if (l.hot > 0.5 && !this.still) {
        const u = (now / 1300 + a.seed + b.seed) % 1;
        const v = 1 - u;
        const px = v * v * ax + 2 * v * u * mx + u * u * bx;
        const py = v * v * ay + 2 * v * u * my + u * u * by;
        c.beginPath();
        c.arc(px, py, 1.9, 0, TAU);
        c.fillStyle = `rgba(${p.blue}, ${l.hot})`;
        c.fill();
      }
    }

    for (const { node, start } of this.blooms) {
      const u = clamp((now - start) / 1100, 0, 1);
      const r = node.r * dotScale + 4 + u * 42;
      const x = node.x * cam.k + cam.x;
      const y = node.y * cam.k + cam.y;
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.strokeStyle = `rgba(${p.blue}, ${(1 - u) ** 2 * 0.5})`;
      c.lineWidth = 1;
      c.stroke();
      c.beginPath();
      c.arc(x, y, r * 0.62, 0, TAU);
      c.fillStyle = `rgba(${p.blue}, ${(1 - u) ** 3 * 0.09})`;
      c.fill();
    }

    for (const n of this.nodes) {
      if (n.alpha < 0.02) continue;
      const x = n.x * cam.k + cam.x;
      const y = n.y * cam.k + cam.y;
      if (x < -30 || x > w + 30 || y < -30 || y > h + 30) continue;
      this.drawNode(n, x, y, now, dotScale);
    }

    this.drawLabels(this.drawRegions(focus), dotScale);
    c.globalAlpha = 1;
  }

  private drawNode(n: SimNode, x: number, y: number, now: number, dotScale: number) {
    const c = this.ctx;
    const p = this.palette;
    const age = Math.max(0, now - n.born) / 900;
    // A node arriving in the growth replay overshoots slightly, like a drop landing.
    const grow = age < 1 ? 1 + Math.sin(age * Math.PI) * 0.9 - (1 - age) ** 3 : 1;
    const r = Math.max(0.1, n.r * dotScale * grow * (1 + n.hot * 0.3));
    const a = n.alpha;

    if (n.hot > 0.02) {
      c.beginPath();
      c.arc(x, y, r + 5 + n.hot * 3, 0, TAU);
      c.fillStyle = `rgba(${p.blue}, ${0.13 * n.hot})`;
      c.fill();
    }

    if (n.type === 'ghost') {
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fillStyle = `rgba(${p.paper}, ${a})`;
      c.fill();
      c.strokeStyle = n.hot > 0.3 ? `rgba(${p.blue}, ${a})` : `rgba(${p.ghost}, ${a * 0.9})`;
      c.lineWidth = 1.1;
      c.stroke();
      return;
    }

    const fill = n.hot > 0.5 || n.type !== 'note' ? p.blue : p.ink;
    // A seed note is lighter ink; an evergreen note is the darkest.
    const tone = n.type === 'note' && n.status === 'seed' && n.hot < 0.5 ? 0.78 : 1;
    c.fillStyle = `rgba(${fill}, ${a * tone})`;
    c.beginPath();
    if (n.type === 'paper') {
      const s = r * 1.3;
      c.moveTo(x, y - s);
      c.lineTo(x + s, y);
      c.lineTo(x, y + s);
      c.lineTo(x - s, y);
      c.closePath();
    } else if (n.type === 'project') {
      const s = r * 1.05;
      c.roundRect(x - s, y - s, s * 2, s * 2, s * 0.35);
    } else {
      c.arc(x, y, r, 0, TAU);
    }
    c.fill();
  }

  /** Draws domain and field names, and returns the space they took. */
  private drawRegions(focus: SimNode | null) {
    const placed: [number, number, number, number][] = [];
    const { ctx: c, cam } = this;
    const p = this.palette;
    const { domains, fields } = this.filter;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const zh = this.opts.lang === 'zh';
    const domainFade = clamp((2.1 - cam.k) / 0.7, 0, 1);
    const fieldFade =
      this.opts.mode === 'preview' ? 0 : clamp((cam.k - 0.5) / 0.22, 0, 1) * clamp((2.6 - cam.k) / 0.6, 0, 1);

    for (const region of this.regions) {
      const x = region.x * cam.k + cam.x;
      const y = region.y * cam.k + cam.y;
      const inFocus =
        (focus && focus.domain === region.domain && (region.level === 'domain' || focus.field === region.field)) ||
        (region.level === 'field' ? fields?.has(region.field!) : domains?.has(region.domain));
      const base = region.level === 'domain' ? domainFade * 0.86 : fieldFade * 0.62;
      const alpha = focus || domains || fields ? base * (inFocus ? 1.3 : 0.35) : base;
      if (alpha < 0.02) continue;

      const domain = region.level === 'domain';
      const text = domain && !zh ? region.name.toUpperCase() : region.name;
      c.font = domain ? `600 ${zh ? 17 : 12.5}px ${MONO}` : `500 ${zh ? 12.5 : 10.5}px ${MONO}`;
      if ('letterSpacing' in c) c.letterSpacing = domain ? (zh ? '3px' : '2.4px') : '0.3px';

      const width = c.measureText(text).width;
      const box: [number, number, number, number] = [x - width / 2 - 4, y - 9, x + width / 2 + 4, y + 9];
      if (placed.some((b) => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])) {
        if ('letterSpacing' in c) c.letterSpacing = '0px';
        continue;
      }
      if (alpha > 0.15) placed.push(box);

      c.lineJoin = 'round';
      c.lineWidth = 4;
      c.strokeStyle = `rgba(${p.paper}, ${Math.min(alpha, 0.8)})`;
      c.strokeText(text, x, y);
      c.fillStyle = `rgba(${p.ink}, ${Math.min(alpha, 0.92)})`;
      c.fillText(text, x, y);
      if ('letterSpacing' in c) c.letterSpacing = '0px';
    }
    return placed;
  }

  /** Most important first; a label is skipped if it would collide with one already placed. */
  private drawLabels(placed: [number, number, number, number][], dotScale: number) {
    const { ctx: c, cam, w, h } = this;
    const p = this.palette;
    const lang = this.opts.lang;
    const local = this.opts.mode === 'local';
    const preview = this.opts.mode === 'preview';

    const rank = (n: SimNode) => n.hot * 100 + n.degree + (n.type === 'ghost' ? -5 : 0);
    const ordered = [...this.nodes].sort((a, b) => rank(b) - rank(a));
    c.textAlign = 'center';
    c.textBaseline = 'top';

    for (const n of ordered) {
      if (n.alpha < 0.3) continue;
      const hot = n.hot > 0.3;
      const threshold = preview ? 2.4 : clamp(2.05 - n.degree * 0.11, 1.05, 2);
      if (!hot && !local && cam.k < threshold) continue;
      if (preview && !hot && n.degree < 6) continue;

      const x = n.x * cam.k + cam.x;
      const y = n.y * cam.k + cam.y + n.r * dotScale + 5;
      if (x < 0 || x > w || y < 0 || y > h) continue;

      const text = n.title[lang] || n.title.en;
      const size = local ? 11 : hot ? 12.5 : 11;
      c.font = `${hot ? 600 : 500} ${size}px ${FONT}`;
      const width = c.measureText(text).width;
      const box: [number, number, number, number] = [x - width / 2 - 3, y - 1, x + width / 2 + 3, y + size + 2];
      if (placed.some((b) => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])) continue;
      placed.push(box);

      const alpha = n.alpha * (hot ? 1 : 0.74);
      c.lineJoin = 'round';
      c.lineWidth = 3.5;
      c.strokeStyle = `rgba(${p.paper}, ${alpha * 0.9})`;
      c.strokeText(text, x, y);
      c.fillStyle = n.hot > 0.7 ? `rgba(${p.blue}, ${alpha})` : `rgba(${p.ink}, ${alpha})`;
      c.fillText(text, x, y);
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.sim.stop();
    this.stopWander();
    this.cleanups.forEach((fn) => fn());
  }
}
