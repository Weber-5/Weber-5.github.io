/**
 * Assembles the knowledge graph from the vault, publications and projects.
 * Papers and projects join the same network as notes, so the graph doubles as a
 * map of the whole site.
 */
import { getCollection } from 'astro:content';
import { getVault, slugify } from './vault';
import { getDomains, getPublications } from './data';
import { tr } from '../i18n';
import type { Localized } from './data';

export type NodeType = 'note' | 'ghost' | 'paper' | 'project';
type Both = { en: string; zh: string };

export interface GraphNode {
  id: string;
  type: NodeType;
  title: Both;
  /** Category id. */
  domain: string;
  /** Field id within the category. */
  field?: string;
  /** Locale-less path; absent for ghost nodes. */
  url?: string;
  summary?: Both;
  tags?: string[];
  /** ISO date, drives the growth replay. */
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

const both = (v: Localized | undefined): Both => ({ en: tr(v, 'en'), zh: tr(v, 'zh') });

export async function buildGraph(): Promise<GraphData> {
  const vault = getVault();
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, { source: string; target: string }>();

  const connect = (a: string, b: string) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!edges.has(key)) edges.set(key, { source: a, target: b });
  };

  for (const note of vault.notes) {
    nodes.set(note.slug, {
      id: note.slug,
      type: 'note',
      title: { en: note.title, zh: note.titleZh ?? note.title },
      domain: note.domain,
      field: note.field,
      url: `/notes/${note.slug}/`,
      summary: {
        en: note.summary ?? note.excerpt,
        zh: note.summaryZh ?? note.excerptZh ?? note.excerpt,
      },
      tags: note.tags,
      date: note.created,
      status: note.status,
    });
  }

  for (const note of vault.notes) {
    for (const to of note.links) connect(note.slug, to);
    for (const raw of note.ghosts) {
      const id = `ghost:${slugify(raw)}`;
      const ghost = nodes.get(id);
      if (!ghost) {
        // An unwritten note settles beside the first note that points at it.
        nodes.set(id, {
          id,
          type: 'ghost',
          title: { en: raw, zh: raw },
          domain: note.domain,
          field: note.field,
          date: note.created,
        });
      } else if (note.created < ghost.date) {
        ghost.date = note.created;
      }
      connect(note.slug, id);
    }
  }

  const attach = (id: string, names: string[]) => {
    for (const name of names) {
      const hit = vault.resolve(name);
      if (hit) connect(id, hit.slug);
    }
  };
  // Papers and projects join the map through the notes they name. One that names
  // none has no place in the taxonomy, so it stays off the graph.
  const anchor = (names: string[]) => names.map((n) => vault.resolve(n)).find(Boolean);

  for (const paper of getPublications()) {
    const home = anchor(paper.notes);
    if (!home) continue;
    const id = `paper:${paper.id}`;
    nodes.set(id, {
      id,
      type: 'paper',
      title: both(paper.title),
      domain: home.domain,
      field: home.field,
      url: `/research/#${paper.id}`,
      summary: both(paper.venue),
      date: `${paper.year}-06-01`,
    });
    attach(id, paper.notes);
  }

  for (const project of await getCollection('projects')) {
    const home = anchor(project.data.notes);
    if (!home) continue;
    const id = `project:${project.id}`;
    const year = project.data.period?.match(/\d{4}/)?.[0];
    nodes.set(id, {
      id,
      type: 'project',
      title: both(project.data.title),
      domain: home.domain,
      field: home.field,
      url: `/projects/${project.id}/`,
      summary: both(project.data.summary),
      tags: project.data.tags,
      date: year ? `${year}-06-01` : new Date().toISOString().slice(0, 10),
    });
    attach(id, project.data.notes);
  }

  return { nodes: [...nodes.values()], links: [...edges.values()], domains: taxonomy(nodes) };
}

/** The declared taxonomy, plus any folder that exists but was not declared. */
function taxonomy(nodes: Map<string, GraphNode>): GraphDomain[] {
  const domains: GraphDomain[] = getDomains().map((d) => ({
    id: d.id,
    name: both(d.name),
    fields: d.fields.map((f) => ({ id: f.id, name: both(f.name) })),
  }));
  for (const node of nodes.values()) {
    let domain = domains.find((d) => d.id === node.domain);
    if (!domain) {
      domain = { id: node.domain, name: { en: node.domain, zh: node.domain }, fields: [] };
      domains.push(domain);
    }
    if (node.field && !domain.fields.some((f) => f.id === node.field)) {
      domain.fields.push({ id: node.field, name: { en: node.field, zh: node.field } });
    }
  }
  return domains;
}

export function graphStats(data: GraphData) {
  return {
    notes: data.nodes.filter((n) => n.type === 'note').length,
    links: data.links.length,
    domains: data.domains.length,
    fields: data.domains.reduce((sum, d) => sum + d.fields.length, 0),
  };
}
