/**
 * InkGraph: the knowledge-graph renderer.
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
 *
 * Performance model, in order of what mattered most when measured:
 *   - The layout arrives precomputed, so nothing simulates at load.
 *   - The ink wash is its own small layer, placed with a CSS transform: zooming and
 *     panning move it on the compositor instead of re-blending a full-screen image.
 *   - Two stacked canvases. The scene (links, nodes, labels) repaints only when
 *     something in it changes. Continuous effects (signals, blooms) live on a thin
 *     overlay, so a highlighted node costs a few dots per frame, not a full repaint.
 *   - Labels are cached bitmaps: stroked text is the most expensive thing to draw.
 *   - Links are batched into a handful of paths by style.
 *   - Idle costs nothing: with no change pending, no frame is requested at all.
 */
import { hashString, nodeRadius, type NodeType } from '../../lib/graph-shared';
import type { LayoutLink, LayoutNode } from '../../lib/graph-layout';

export type { NodeType };
type Both = { en: string; zh: string };
type Box = [number, number, number, number];

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
  x?: number;
  y?: number;
  ax?: number;
  ay?: number;
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

export interface SimNode extends Omit<GraphNode, 'x' | 'y' | 'ax' | 'ay'>, LayoutNode {
  x: number;
  y: number;
  degree: number;
  neighbors: Set<SimNode>;
  /** Eased display state. */
  alpha: number;
  hot: number;
  born: number;
  seed: number;
}

interface SimLink extends LayoutLink {
  source: SimNode;
  target: SimNode;
  bend: number;
  hot: number;
}

interface Sprite {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
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
  /** Upper bound on the backing-store scale. */
  maxScale?: number;
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
/** Time constant of all eased state, so motion is identical at 60 Hz and 144 Hz. */
const EASE_MS = 95;
/** Rebuilding the ink wash is the one slow step; cap it during drags and replays. */
const CLOUD_INTERVAL_MS = 130;

const PALETTES = {
  light: {
    ink: '26, 30, 37',
    ghost: '120, 128, 140',
    blue: '46, 78, 126',
    paper: '246, 247, 248',
    cloud: ['52, 60, 74', '28, 34, 46', '70, 76, 88'],
    cloudAlpha: 0.11,
    link: 0.15,
  },
  dark: {
    ink: '226, 230, 236',
    ghost: '132, 141, 153',
    blue: '157, 180, 216',
    paper: '12, 14, 17',
    cloud: ['120, 136, 165', '150, 170, 205', '110, 120, 140'],
    cloudAlpha: 0.1,
    link: 0.16,
  },
};

export class InkGraph {
  nodes: SimNode[] = [];
  links: SimLink[] = [];
  byId = new Map<string, SimNode>();
  domains: GraphDomain[];
  selected: SimNode | null = null;
  onWanderStop?: () => void;

  private ctx: CanvasRenderingContext2D;
  private fx: HTMLCanvasElement;
  private fxCtx: CanvasRenderingContext2D;
  private fxUsed = false;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private cam = { x: 0, y: 0, k: 1 };
  private camFrom: typeof this.cam | null = null;
  private camTo: typeof this.cam | null = null;
  private camStart = 0;
  private camDuration = 0;
  private userMoved = false;

  private sim: ReturnType<typeof import('../../lib/graph-layout').createSimulation> | null = null;
  private simLoading = false;
  private dark: boolean;
  private raf = 0;
  private lastFrame = 0;
  private sceneDirty = true;
  private still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private cleanups: (() => void)[] = [];

  private hover: SimNode | null = null;
  private path: SimNode[] = [];
  private pathKeys = new Set<string>();
  private filter: Filter = {};
  private growth: string | null = null;
  private blooms: { node: SimNode; start: number }[] = [];

  private cloud = document.createElement('canvas');
  private cloudBox = { x: 0, y: 0, w: 0, h: 0 };
  private cloudDirty = true;
  private cloudAt = -1e9;
  private stains = new Map<string, HTMLCanvasElement>();
  private grain: HTMLCanvasElement | null = null;
  private regions: { name: string; x: number; y: number; level: 'domain' | 'field'; domain: string; field?: string }[] = [];

  private sprites = new Map<string, Sprite>();
  private labelOrder: SimNode[] = [];
  private labelKey = '';

  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { node?: SimNode; lastX: number; lastY: number; moved: number } | null = null;
  private pinch: { dist: number; k: number } | null = null;
  private wanderTimer = 0;
  private zoomGoal: { k: number; sx: number; sy: number; wx: number; wy: number } | null = null;
  private glide: { vx: number; vy: number } | null = null;
  private velocity = { x: 0, y: 0, t: 0 };

  constructor(
    private canvas: HTMLCanvasElement,
    data: GraphData,
    private opts: GraphOptions,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.fx = document.createElement('canvas');
    this.fx.setAttribute('aria-hidden', 'true');
    this.fx.style.cssText = 'position:absolute;pointer-events:none';
    this.fx.style.zIndex = getComputedStyle(canvas).zIndex;
    canvas.after(this.fx);
    this.fxCtx = this.fx.getContext('2d')!;

    // The wash sits beneath the scene as its own element; see placeClouds().
    const wash = this.cloud.style;
    wash.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;will-change:transform;opacity:0;transition:opacity 1.2s cubic-bezier(.22,.8,.24,1)';
    wash.zIndex = getComputedStyle(canvas).zIndex;
    this.cloud.setAttribute('aria-hidden', 'true');
    if (opts.mode !== 'local') canvas.before(this.cloud);

    this.dark = opts.forceDark || document.documentElement.dataset.theme === 'dark';
    this.domains = data.domains;

    this.buildNodes(data);
    this.collectRegions();
    this.resize();
    this.fit(false);
    this.bindEvents();
    if (opts.mode === 'local' && opts.focus) this.selected = this.byId.get(opts.focus) ?? null;
    this.invalidate();
  }

  /* --- Setup --------------------------------------------------------------- */

  private buildNodes(data: GraphData) {
    this.nodes = data.nodes.map((n) => ({
      ...n,
      x: n.x ?? 0,
      y: n.y ?? 0,
      ax: n.ax ?? 0,
      ay: n.ay ?? 0,
      degree: 0,
      r: 3,
      neighbors: new Set(),
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

    for (const n of this.nodes) n.r = nodeRadius(n.type, n.degree);
  }

  /** Dragging is the only thing that needs physics, so it loads on the first drag. */
  private async ensureSimulation() {
    if (this.sim || this.simLoading) return;
    this.simLoading = true;
    const { createSimulation } = await import('../../lib/graph-layout');
    this.sim = createSimulation(this.nodes, this.links);
    this.sim.on('tick', () => {
      this.cloudDirty = true;
      this.invalidate();
    });
  }

  /** Where the domain and field names sit: above each continent, and above each field. */
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
    const dpr = Math.min(devicePixelRatio || 1, this.opts.maxScale ?? 2);
    if (dpr !== this.dpr) this.sprites.clear();
    this.dpr = dpr;
    this.w = rect.width;
    this.h = rect.height;
    for (const c of [this.canvas, this.fx]) {
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
    }
    const s = this.fx.style;
    s.left = `${this.canvas.offsetLeft}px`;
    s.top = `${this.canvas.offsetTop}px`;
    s.width = `${rect.width}px`;
    s.height = `${rect.height}px`;
    this.fxUsed = false;
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
    else {
      this.cam = target;
      this.invalidate();
    }
  }

  private flyCam(target: typeof this.cam, duration: number) {
    this.zoomGoal = null;
    this.glide = null;
    if (this.still) {
      this.cam = target;
      this.invalidate();
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
    this.zoomGoal = null;
    this.glide = null;
    const k = clamp(this.cam.k * factor, 0.22, 4.5);
    const world = this.toWorld(cx, cy);
    const target = { k, x: cx - world.x * k, y: cy - world.y * k };
    this.userMoved = true;
    if (animate) this.flyCam(target, 260);
    else {
      this.camFrom = null;
      this.camTo = null;
      this.cam = target;
      this.invalidate();
    }
  }

  /** Wheel zoom eases toward its target around the pointer instead of jumping a notch. */
  private wheelZoom(delta: number, sx: number, sy: number) {
    this.camFrom = null;
    this.camTo = null;
    this.glide = null;
    const k = clamp((this.zoomGoal?.k ?? this.cam.k) * Math.exp(-delta * 0.0016), 0.22, 4.5);
    const world = this.toWorld(sx, sy);
    this.zoomGoal = { k, sx, sy, wx: world.x, wy: world.y };
    this.userMoved = true;
    this.invalidate();
  }

  /** Eased zoom and the glide after a flung pan. True while either still moves the camera. */
  private updateMotion(dt: number) {
    let moving = false;
    const goal = this.zoomGoal;
    if (goal) {
      let k = this.still ? goal.k : this.cam.k + (goal.k - this.cam.k) * (1 - Math.exp(-dt / 70));
      if (Math.abs(goal.k - k) < goal.k * 0.001) {
        k = goal.k;
        this.zoomGoal = null;
      } else {
        moving = true;
      }
      this.cam = { k, x: goal.sx - goal.wx * k, y: goal.sy - goal.wy * k };
      this.sceneDirty = true;
    }
    const glide = this.glide;
    if (glide) {
      this.cam = { ...this.cam, x: this.cam.x + glide.vx * dt, y: this.cam.y + glide.vy * dt };
      const decay = Math.exp(-dt / 300);
      glide.vx *= decay;
      glide.vy *= decay;
      if (Math.hypot(glide.vx, glide.vy) < 0.02) this.glide = null;
      else moving = true;
      this.sceneDirty = true;
    }
    return moving;
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
    this.invalidate();
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
    this.invalidate();
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
    this.invalidate();
    return path;
  }

  clearTrace() {
    this.path = [];
    this.pathKeys.clear();
    this.invalidate();
  }

  private edgeKey = (a: SimNode, b: SimNode) => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);

  /** Show the map as it stood on a date; null shows everything. */
  setGrowth(date: string | null) {
    const now = performance.now();
    let changed = false;
    for (const n of this.nodes) {
      const was = !this.growth || n.date <= this.growth;
      const will = !date || n.date <= date;
      if (was !== will) changed = true;
      if (will && !was) n.born = now;
    }
    this.growth = date;
    if (changed) {
      this.cloudDirty = true;
      this.invalidate();
    }
  }

  dateRange() {
    const dates = this.nodes.map((n) => n.date).sort();
    return { min: dates[0], max: dates.at(-1)! };
  }

  setTheme(theme: string) {
    if (this.opts.forceDark) return;
    this.dark = theme === 'dark';
    this.stains.clear();
    this.sprites.clear();
    this.cloudDirty = true;
    this.cloudAt = -1e9;
    this.sceneDirty = true;
    // Theme changes run inside a view transition callback, so paint synchronously:
    // the snapshot of the new state must already show the new colours.
    this.frame(performance.now());
  }

  /** Ambient highlight for the home page preview. */
  pulse(node: SimNode | null) {
    this.hover = node;
    if (node && !this.still) this.blooms.push({ node, start: performance.now() });
    this.invalidate();
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
          this.drag.node.x = world.x;
          this.drag.node.y = world.y;
          this.sim?.alphaTarget(0.18).restart();
          this.cloudDirty = true;
          this.invalidate();
        } else if (full) {
          const elapsed = Math.max(1, e.timeStamp - this.velocity.t);
          this.velocity = {
            x: this.velocity.x * 0.35 + (dx / elapsed) * 0.65,
            y: this.velocity.y * 0.35 + (dy / elapsed) * 0.65,
            t: e.timeStamp,
          };
          this.camTo = null;
          this.cam.x += dx;
          this.cam.y += dy;
          this.userMoved = true;
          this.invalidate();
        }
        return;
      }

      const hit = this.nodeAt(p.x, p.y);
      if (hit !== this.hover) {
        this.hover = hit;
        c.style.cursor = hit ? 'pointer' : full ? 'grab' : 'default';
        this.invalidate();
      }
    });

    on('pointerleave', () => {
      if (this.opts.mode === 'preview' || !this.drag) {
        this.hover = null;
        this.invalidate();
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
      this.glide = null;
      this.zoomGoal = null;
      this.velocity = { x: 0, y: 0, t: e.timeStamp };
      this.drag = { node: this.nodeAt(p.x, p.y) ?? undefined, lastX: p.x, lastY: p.y, moved: 0 };
      if (full) c.setPointerCapture(e.pointerId);
      if (full && !this.drag.node) c.style.cursor = 'grabbing';
      if (full && this.drag.node) void this.ensureSimulation();
    });

    const release = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      const drag = this.drag;
      this.drag = null;
      if (!drag) return;
      if (drag.node && full) {
        drag.node.fx = null;
        drag.node.fy = null;
        if (drag.moved > 4) this.sim?.alphaTarget(0);
      }
      if (full) c.style.cursor = this.hover ? 'pointer' : 'grab';

      // A flung map keeps gliding and slows to a stop, like paper sliding on a desk.
      const recent = e.timeStamp - this.velocity.t < 70;
      if (full && !drag.node && drag.moved > 6 && recent && !this.still) {
        const speed = Math.hypot(this.velocity.x, this.velocity.y);
        if (speed > 0.12) {
          const cap = Math.min(1, 3 / speed);
          this.glide = { vx: this.velocity.x * cap, vy: this.velocity.y * cap };
          this.kick();
        }
      }
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
    // A cancelled pointer is a scroll that took over, never a click.
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
          this.wheelZoom(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, p.x, p.y);
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
      this.invalidate();
    });
    ro.observe(c);
    this.cleanups.push(() => ro.disconnect());

    const onTheme = ((e: CustomEvent<string>) => this.setTheme(e.detail)) as EventListener;
    addEventListener('themechange', onTheme);
    this.cleanups.push(() => removeEventListener('themechange', onTheme));

    // Text is cached as bitmaps, so a webfont arriving late must refresh them.
    const onFonts = () => {
      this.sprites.clear();
      this.invalidate();
    };
    document.fonts?.addEventListener('loadingdone', onFonts);
    this.cleanups.push(() => document.fonts?.removeEventListener('loadingdone', onFonts));
    document.fonts?.ready.then(onFonts);
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

  /* --- Frame loop ---------------------------------------------------------- */

  private kick() {
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Mark the scene as changed and schedule a paint. */
  private invalidate() {
    this.sceneDirty = true;
    this.kick();
  }

  private frame(now: number) {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    const dt = clamp(now - this.lastFrame, 1, 80);
    this.lastFrame = now;
    const ease = this.still ? 1 : 1 - Math.exp(-dt / EASE_MS);

    let moving = this.updateCamera(now);
    if (this.updateMotion(dt)) moving = true;
    const focus = this.hover ?? this.selected;
    const neighbours = focus?.neighbors;
    const onPath = new Set(this.path);
    const dimming = !!focus || this.path.length > 0;
    const dimTo = this.opts.mode === 'local' ? 0.5 : 0.2;

    for (const n of this.nodes) {
      let alpha = 1;
      if (!this.isVisible(n)) alpha = 0;
      else if (!this.matches(n)) alpha = 0.1;
      else if (dimming && n !== focus && !neighbours?.has(n) && !onPath.has(n)) alpha = dimTo;
      const hot = n === focus || n === this.selected || onPath.has(n) ? 1 : neighbours?.has(n) ? 0.55 : 0;

      const da = alpha - n.alpha;
      const dh = hot - n.hot;
      n.alpha = Math.abs(da) < 0.004 ? alpha : n.alpha + da * ease;
      n.hot = Math.abs(dh) < 0.004 ? hot : n.hot + dh * ease;
      if (n.alpha !== alpha || n.hot !== hot || now - n.born < 900) moving = true;
    }

    for (const l of this.links) {
      const inPath = this.pathKeys.has(this.edgeKey(l.source, l.target));
      const hot = inPath || (focus && (l.source === focus || l.target === focus)) ? 1 : 0;
      const dh = hot - l.hot;
      l.hot = Math.abs(dh) < 0.004 ? hot : l.hot + dh * ease;
      if (l.hot !== hot) moving = true;
    }

    if (this.cloudDirty) {
      if (now - this.cloudAt >= CLOUD_INTERVAL_MS) {
        this.cloudAt = now;
        this.collectRegions();
        this.paintClouds();
        this.sceneDirty = true;
      } else {
        moving = true;
      }
    }

    if (moving || this.sceneDirty) {
      this.sceneDirty = false;
      this.paintScene(now, focus);
    }
    const effects = this.paintEffects(now, focus);
    if (moving || effects) this.kick();
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
      this.sceneDirty = true;
      return false;
    }
    return true;
  }

  private get palette() {
    return PALETTES[this.dark ? 'dark' : 'light'];
  }

  /* --- Ink wash ------------------------------------------------------------ */

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
    const size = 128;
    const cells = 8;
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
    // A blurred wash holds up well at low resolution, and small is fast to draw.
    const scale = 0.25;
    this.cloudBox = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    this.cloud.width = Math.ceil((x1 - x0) * scale);
    this.cloud.height = Math.ceil((y1 - y0) * scale);
    this.cloud.style.width = `${x1 - x0}px`;
    this.cloud.style.height = `${y1 - y0}px`;

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

  /* --- Scene --------------------------------------------------------------- */

  private paintScene(now: number, focus: SimNode | null) {
    const { ctx: c, cam, w, h } = this;
    const dotScale = cam.k ** 0.62;

    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    this.placeClouds();
    this.paintLinks();

    for (const n of this.nodes) {
      if (n.alpha < 0.02) continue;
      const x = n.x * cam.k + cam.x;
      const y = n.y * cam.k + cam.y;
      if (x < -30 || x > w + 30 || y < -30 || y > h + 30) continue;
      this.paintNode(n, x, y, now, dotScale);
    }

    this.paintLabels(this.paintRegions(focus), dotScale, focus);
    c.globalAlpha = 1;
  }

  /** Move the wash layer with the camera: a transform, so no pixels are redrawn. */
  private placeClouds() {
    if (this.opts.mode === 'local') return;
    const { cam, cloudBox: box } = this;
    const s = this.cloud.style;
    if (!box.w) {
      s.visibility = 'hidden';
      return;
    }
    s.visibility = '';
    s.transform = `translate(${(box.x * cam.k + cam.x).toFixed(2)}px, ${(box.y * cam.k + cam.y).toFixed(2)}px) scale(${cam.k.toFixed(5)})`;
    if (s.opacity !== '1') s.opacity = '1';
  }

  /** One path per style instead of one per link. A bend gives a brush-drawn feel. */
  private paintLinks() {
    const { ctx: c, cam, w, h } = this;
    const p = this.palette;
    const batches = new Map<number, { path: Path2D; dashed: boolean; alpha: number }>();
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
      const dashed = a.type === 'ghost' || b.type === 'ghost';

      if (l.hot < 1) {
        const distant = a.domain !== b.domain ? 0.4 : a.field !== b.field ? 0.7 : 1.5;
        const level = Math.round(p.link * distant * alpha * (1 - l.hot) * 50);
        if (level > 0) {
          const key = level * 2 + (dashed ? 1 : 0);
          let batch = batches.get(key);
          if (!batch) batches.set(key, (batch = { path: new Path2D(), dashed, alpha: level / 50 }));
          batch.path.moveTo(ax, ay);
          batch.path.quadraticCurveTo(mx, my, bx, by);
        }
      }

      if (l.hot > 0.02) {
        c.beginPath();
        c.moveTo(ax, ay);
        c.quadraticCurveTo(mx, my, bx, by);
        c.setLineDash(dashed ? [2, 4] : []);
        c.strokeStyle = `rgba(${p.blue}, ${0.75 * l.hot * Math.max(alpha, 0.6)})`;
        c.lineWidth = 1 + 0.6 * l.hot;
        c.stroke();
      }
    }

    c.lineWidth = 0.9;
    for (const { path, dashed, alpha } of batches.values()) {
      c.setLineDash(dashed ? [2, 4] : []);
      c.strokeStyle = `rgba(${p.ink}, ${alpha})`;
      c.stroke(path);
    }
    c.setLineDash([]);
  }

  private paintNode(n: SimNode, x: number, y: number, now: number, dotScale: number) {
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

  /** Text rendered once into a bitmap, halo included; drawing it is a single copy. */
  private sprite(text: string, font: string, size: number, rgb: string, spacing = '0px', halo = 3.5) {
    const key = `${font}|${rgb}|${spacing}|${text}`;
    let cached = this.sprites.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d')!;
    const setup = () => {
      g.font = font;
      if ('letterSpacing' in g) g.letterSpacing = spacing;
    };
    setup();
    const width = Math.ceil(g.measureText(text).width) + 10;
    const height = Math.ceil(size * 1.5) + 6;
    canvas.width = Math.ceil(width * this.dpr);
    canvas.height = Math.ceil(height * this.dpr);

    g.scale(this.dpr, this.dpr);
    setup();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = halo;
    g.strokeStyle = `rgba(${this.palette.paper}, 0.86)`;
    g.strokeText(text, width / 2, height / 2);
    g.fillStyle = `rgb(${rgb})`;
    g.fillText(text, width / 2, height / 2);

    cached = { canvas, width, height };
    this.sprites.set(key, cached);
    return cached;
  }

  private stamp(s: Sprite, x: number, y: number, alpha: number) {
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.drawImage(s.canvas, Math.round(x - s.width / 2), Math.round(y - s.height / 2), s.width, s.height);
  }

  /** Draws domain and field names, and returns the space they took. */
  private paintRegions(focus: SimNode | null) {
    const placed: Box[] = [];
    const { cam } = this;
    const p = this.palette;
    const { domains, fields } = this.filter;
    const zh = this.opts.lang === 'zh';
    const domainFade = clamp((2.1 - cam.k) / 0.7, 0, 1);
    const fieldFade =
      this.opts.mode === 'preview' ? 0 : clamp((cam.k - 0.5) / 0.22, 0, 1) * clamp((2.6 - cam.k) / 0.6, 0, 1);

    for (const region of this.regions) {
      const domain = region.level === 'domain';
      const base = domain ? domainFade * 0.86 : fieldFade * 0.62;
      if (base < 0.02) continue;
      const inFocus =
        (focus && focus.domain === region.domain && (domain || focus.field === region.field)) ||
        (domain ? domains?.has(region.domain) : fields?.has(region.field!));
      const alpha = Math.min(focus || domains || fields ? base * (inFocus ? 1.3 : 0.35) : base, 0.92);
      if (alpha < 0.02) continue;

      const size = domain ? (zh ? 17 : 12.5) : zh ? 12.5 : 10.5;
      const font = `${domain ? 600 : 500} ${size}px ${MONO}`;
      const spacing = domain ? (zh ? '3px' : '2.4px') : '0.3px';
      const text = domain && !zh ? region.name.toUpperCase() : region.name;
      const s = this.sprite(text, font, size, p.ink, spacing, 4);

      const x = region.x * cam.k + cam.x;
      const y = region.y * cam.k + cam.y;
      const box: Box = [x - s.width / 2, y - 9, x + s.width / 2, y + 9];
      if (placed.some((b) => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])) continue;
      if (alpha > 0.15) placed.push(box);
      this.stamp(s, x, y, alpha);
    }
    return placed;
  }

  /** Most important first; a label is skipped if it would collide with one already placed. */
  private paintLabels(placed: Box[], dotScale: number, focus: SimNode | null) {
    const { cam, w, h } = this;
    const p = this.palette;
    const lang = this.opts.lang;
    const local = this.opts.mode === 'local';
    const preview = this.opts.mode === 'preview';

    // The order only changes with the focus, so it is not re-sorted on every frame.
    const key = `${focus?.id ?? ''}|${this.path.length}`;
    if (key !== this.labelKey || this.labelOrder.length !== this.nodes.length) {
      this.labelKey = key;
      const onPath = new Set(this.path);
      const heat = (n: SimNode) => (n === focus || onPath.has(n) ? 100 : focus?.neighbors.has(n) ? 55 : 0);
      const rank = (n: SimNode) => heat(n) + n.degree + (n.type === 'ghost' ? -5 : 0);
      this.labelOrder = [...this.nodes].sort((a, b) => rank(b) - rank(a));
    }

    for (const n of this.labelOrder) {
      if (n.alpha < 0.3) continue;
      const hot = n.hot > 0.3;
      const threshold = preview ? 2.4 : clamp(2.05 - n.degree * 0.11, 1.05, 2);
      if (!hot && !local && cam.k < threshold) continue;
      if (preview && !hot && n.degree < 6) continue;

      const x = n.x * cam.k + cam.x;
      const y = n.y * cam.k + cam.y + n.r * dotScale + 11;
      if (x < 0 || x > w || y < 0 || y > h) continue;

      const size = local ? 11 : hot ? 12.5 : 11;
      const font = `${hot ? 600 : 500} ${size}px ${FONT}`;
      const s = this.sprite(n.title[lang] || n.title.en, font, size, n.hot > 0.7 ? p.blue : p.ink);
      const box: Box = [x - s.width / 2, y - size / 2 - 2, x + s.width / 2, y + size / 2 + 2];
      if (placed.some((b) => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])) continue;
      placed.push(box);
      this.stamp(s, x, y, n.alpha * (hot ? 1 : 0.74));
    }
  }

  /* --- Effects overlay ----------------------------------------------------- */

  /** Signals on highlighted edges and blooms on selection. True while any is running. */
  private paintEffects(now: number, focus: SimNode | null) {
    const { fxCtx: c, cam, w, h } = this;
    this.blooms = this.blooms.filter((b) => now - b.start < 1100);
    const signals = !this.still && (!!focus || this.path.length > 0);
    if (!signals && !this.blooms.length) {
      if (this.fxUsed) {
        c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        c.clearRect(0, 0, w, h);
        this.fxUsed = false;
      }
      return false;
    }

    const p = this.palette;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    this.fxUsed = true;

    if (signals) {
      c.fillStyle = `rgb(${p.blue})`;
      for (const l of this.links) {
        if (l.hot <= 0.5) continue;
        const a = l.source;
        const b = l.target;
        const ax = a.x * cam.k + cam.x;
        const ay = a.y * cam.k + cam.y;
        const bx = b.x * cam.k + cam.x;
        const by = b.y * cam.k + cam.y;
        const mx = (ax + bx) / 2 - (by - ay) * l.bend;
        const my = (ay + by) / 2 + (bx - ax) * l.bend;
        const u = (now / 1300 + a.seed + b.seed) % 1;
        const v = 1 - u;
        c.globalAlpha = l.hot;
        c.beginPath();
        c.arc(v * v * ax + 2 * v * u * mx + u * u * bx, v * v * ay + 2 * v * u * my + u * u * by, 1.9, 0, TAU);
        c.fill();
      }
      c.globalAlpha = 1;
    }

    const dotScale = cam.k ** 0.62;
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
    return true;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.sim?.stop();
    this.stopWander();
    this.cleanups.forEach((fn) => fn());
    this.fx.remove();
    this.cloud.remove();
  }
}
