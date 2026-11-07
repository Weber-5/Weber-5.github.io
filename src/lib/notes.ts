/** Note page helpers: pick the right language file and localize rendered HTML. */
import { getCollection, type CollectionEntry } from 'astro:content';
import { getVault, type VaultNote } from './vault';
import type { Lang } from '../i18n';

export interface NotePage {
  note: VaultNote;
  entry: CollectionEntry<'notes'>;
  /** Language the shown text is actually written in. */
  bodyLang: Lang;
}

export async function getNotePages(lang: Lang): Promise<NotePage[]> {
  const entries = new Map((await getCollection('notes')).map((e) => [e.id, e]));
  const pages: NotePage[] = [];
  for (const note of getVault().notes) {
    const preferred = note.variants[lang];
    const id = preferred ?? note.variants.en ?? note.variants.zh;
    const entry = id ? entries.get(id) : undefined;
    if (!entry) continue;
    const isZhFile = id!.endsWith('.zh');
    pages.push({ note, entry, bodyLang: isZhFile || note.lang === 'zh' ? 'zh' : 'en' });
  }
  return pages;
}

export const noteTitle = (note: VaultNote, lang: Lang) =>
  lang === 'zh' ? (note.titleZh ?? note.title) : note.title;

export const noteSummary = (note: VaultNote, lang: Lang) =>
  lang === 'zh'
    ? (note.summaryZh ?? note.excerptZh ?? note.summary ?? note.excerpt)
    : (note.summary ?? note.excerpt);

export const readingMinutes = (note: VaultNote) => Math.max(1, Math.round(note.words / 220));

/**
 * Notes render once, but they appear under two locale prefixes. Internal links
 * are rewritten per locale, and a wikilink still showing its English title picks
 * up the Chinese title.
 */
export function localizeHtml(html: string, lang: Lang) {
  if (lang === 'en') return html;
  const vault = getVault();
  return html
    .replace(/href="\/notes\//g, 'href="/zh/notes/')
    .replace(/(<a [^>]*data-note="([^"]+)"[^>]*>)([^<]+)(<\/a>)/g, (all, open, slug, text, close) => {
      const note = vault.bySlug.get(slug);
      return note?.titleZh && text === note.title ? `${open}${note.titleZh}${close}` : all;
    });
}
