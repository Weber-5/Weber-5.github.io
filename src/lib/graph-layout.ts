/**
 * Force layout for the knowledge graph.
 *
 * The full map settles at build time and ships inside graph.json, because running
 * 320 simulation ticks in the browser blocks the main thread for hundreds of
 * milliseconds. The browser only needs this module for dragging a node and for the
 * small neighbourhood graph on note pages, and imports it on demand for those.
 */
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { hashString, nodeRadius, type NodeType } from './graph-shared';

const TAU = Math.PI * 2;
const SETTLE_TICKS = 320;

export interface LayoutNode extends SimulationNodeDatum {
  id: string;
  type: NodeType;
  domain: string;
  field?: string;
  r: number;
  /** Where this node's field sits on the map. */
  ax: number;
  ay: number;
}

export interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  source: LayoutNode;
  target: LayoutNode;
}

interface RawNode {
  id: string;
  type: NodeType;
  domain: string;
  field?: string;
  x?: number;
  y?: number;
  ax?: number;
  ay?: number;
}

/**
 * Continents first: the largest domain anchors the right, the others fan out to its
 * left. A triangle fills a screen far better than a row does, and the left side is
 * where the control panel leaves room. Fields then spread inside each continent
 * along a golden-angle spiral.
 */
function placeAnchors(nodes: LayoutNode[]) {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.domain, (counts.get(n.domain) ?? 0) + 1);
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
    const members = nodes.filter((n) => n.domain === id);
    const fields = [...new Set(members.map((n) => n.field ?? ''))].sort();
    fields.forEach((field, j) => {
      const spread = radius(id) * 0.92 * Math.sqrt((j + 0.5) / fields.length);
      const angle = j * 2.39996 + hashString(id) * TAU;
      const fx = center.x + (fields.length > 1 ? Math.cos(angle) * spread : 0);
      const fy = center.y + (fields.length > 1 ? Math.sin(angle) * spread : 0);
      for (const n of members) {
        if ((n.field ?? '') !== field) continue;
        n.ax = fx;
        n.ay = fy;
        // Start near home so the layout converges to the same map every time.
        n.x = fx + (hashString(n.id) - 0.5) * 60;
        n.y = fy + (hashString(`${n.id}y`) - 0.5) * 60;
      }
    });
  }
}

export function createSimulation<N extends LayoutNode, L extends LayoutLink>(nodes: N[], links: L[], local = false) {
  return forceSimulation<LayoutNode, LayoutLink>(nodes)
    .force(
      'link',
      forceLink<LayoutNode, LayoutLink>(links)
        .distance((l) => (local ? 46 : l.source.field === l.target.field ? 26 : 90))
        .strength((l) => {
          if (local) return 0.5;
          if (l.source.field === l.target.field) return 0.5;
          // Cross references are drawn, but must not drag the continents together.
          return l.source.domain === l.target.domain ? 0.02 : 0.002;
        }),
    )
    .force('charge', forceManyBody<LayoutNode>().strength(local ? -120 : -46).distanceMax(local ? 260 : 120))
    .force('collide', forceCollide<LayoutNode>((n) => n.r + (local ? 12 : 7)).iterations(2))
    .force('x', forceX<LayoutNode>((n) => n.ax).strength(local ? 0.05 : 0.24))
    .force('y', forceY<LayoutNode>((n) => n.ay).strength(local ? 0.05 : 0.24))
    .stop();
}

function prepare(raw: RawNode[], rawLinks: { source: string; target: string }[]) {
  const degree = new Map<string, number>();
  for (const l of rawLinks) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  const nodes: LayoutNode[] = raw.map((n) => ({
    id: n.id,
    type: n.type,
    domain: n.domain,
    field: n.field,
    r: nodeRadius(n.type, degree.get(n.id) ?? 0),
    ax: 0,
    ay: 0,
    x: 0,
    y: 0,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = rawLinks.flatMap((l) => {
    const source = byId.get(l.source);
    const target = byId.get(l.target);
    return source && target ? [{ source, target }] : [];
  });
  return { nodes, links, byId };
}

const round = (v: number | undefined) => Math.round((v ?? 0) * 10) / 10;

/** Settle the whole map and write positions onto the nodes. Runs at build time. */
export function settleGraph<T extends RawNode>(raw: T[], rawLinks: { source: string; target: string }[]) {
  const { nodes, links, byId } = prepare(raw, rawLinks);
  placeAnchors(nodes);
  createSimulation(nodes, links).tick(SETTLE_TICKS);
  return raw.map((n) => {
    const placed = byId.get(n.id)!;
    return { ...n, x: round(placed.x), y: round(placed.y), ax: round(placed.ax), ay: round(placed.ay) };
  });
}

/** A node's closest surroundings: a two-hop network, capped for legibility, settled. */
export function settleNeighbourhood<T extends RawNode>(
  raw: T[],
  rawLinks: { source: string; target: string }[],
  focus: string,
  cap = 26,
) {
  const adjacent = new Map<string, Set<string>>();
  for (const { source, target } of rawLinks) {
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

  const subset = raw.filter((n) => keep.has(n.id));
  const links = rawLinks.filter((l) => keep.has(l.source) && keep.has(l.target));
  const prepared = prepare(subset, links);
  prepared.nodes.forEach((n, i) => {
    const angle = (i / prepared.nodes.length) * TAU;
    n.x = Math.cos(angle) * 60;
    n.y = Math.sin(angle) * 60;
    if (n.id === focus) {
      n.fx = 0;
      n.fy = 0;
    }
  });
  createSimulation(prepared.nodes, prepared.links, true).tick(160);
  return {
    nodes: subset.map((n) => {
      const placed = prepared.byId.get(n.id)!;
      return { ...n, x: placed.x ?? 0, y: placed.y ?? 0, ax: 0, ay: 0 };
    }),
    links,
  };
}
