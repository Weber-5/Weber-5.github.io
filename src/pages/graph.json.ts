import type { APIRoute } from 'astro';
import { buildGraph } from '../lib/graph';
import { settleGraph } from '../lib/graph-layout';

/** The graph ships already laid out, so browsers never run the simulation at load. */
export const GET: APIRoute = async () => {
  const graph = await buildGraph();
  return new Response(JSON.stringify({ ...graph, nodes: settleGraph(graph.nodes, graph.links) }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
