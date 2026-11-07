import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getVault } from '../lib/vault';
import { getPublications } from '../lib/data';
import { tr } from '../i18n';

/** Flat index for the command palette. Titles carry both languages. */
export const GET: APIRoute = async () => {
  const items = [
    ...getVault().notes.map((n) => ({
      type: 'note',
      title: { en: n.title, zh: n.titleZh ?? n.title },
      detail: { en: n.summary ?? n.excerpt, zh: n.summaryZh ?? n.excerptZh ?? n.excerpt },
      keys: [...n.tags, ...n.aliases, n.domain].join(' '),
      url: `/notes/${n.slug}/`,
    })),
    ...getPublications().map((p) => ({
      type: 'paper',
      title: { en: tr(p.title, 'en'), zh: tr(p.title, 'zh') },
      detail: { en: tr(p.venue, 'en'), zh: tr(p.venue, 'zh') },
      keys: [...p.authors, ...p.topics, String(p.year)].join(' '),
      url: `/research/#${p.id}`,
    })),
    ...(await getCollection('projects')).map((p) => ({
      type: 'project',
      title: { en: tr(p.data.title, 'en'), zh: tr(p.data.title, 'zh') },
      detail: { en: tr(p.data.summary, 'en'), zh: tr(p.data.summary, 'zh') },
      keys: p.data.tags.join(' '),
      url: `/projects/${p.id}/`,
    })),
  ];
  return new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json' } });
};
