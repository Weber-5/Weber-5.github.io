import type { APIRoute } from 'astro';
import { buildGraph } from '../lib/graph';

export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await buildGraph()), {
    headers: { 'Content-Type': 'application/json' },
  });
