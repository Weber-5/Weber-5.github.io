/**
 * The vault index: the single source of truth for how notes relate.
 *
 * It reads `content/notes/` straight from disk and has no Astro imports, so the
 * same index serves the Markdown pipeline (wikilink resolution), the page routes
 * (backlinks) and the knowledge graph.
 *
 * Conventions, all Obsidian-native:
 *   - file name  -> note title and URL slug, so a bare .md works with no frontmatter
 *   - folders    -> taxonomy: `<category>/<field>/Note.md` (see content/domains.yaml)
 *   - `foo.zh.md` next to `foo.md` -> the Chinese version of the same note
 *   - `publish: false`, or a path segment starting with `_` or `.` -> stays private
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

export const VAULT_DIR = path.resolve('content/notes');
export const MEDIA_DIR = path.join(VAULT_DIR, '_attachments');
export const MEDIA_URL = '/notes-media';

export type NoteStatus = 'seed' | 'growing' | 'evergreen';

export interface VaultNote {
  slug: string;
  title: string;
  titleZh?: string;
  /** Top-level category, e.g. `electrical`. */
  domain: string;
  /** Field within the category, e.g. `power-systems`. */
  field?: string;
  tags: string[];
  aliases: string[];
  summary?: string;
  summaryZh?: string;
  status: NoteStatus;
  /** ISO date (YYYY-MM-DD). */
  created: string;
  updated?: string;
  /** Slugs of published notes this note links to. */
  links: string[];
  /** Link targets with no published note yet; rendered as ghost nodes. */
  ghosts: string[];
  /** Collection ids of the language files that exist for this note. */
  variants: { en?: string; zh?: string };
  /** Language the base file is written in. */
  lang: 'en' | 'zh';
  excerpt: string;
  excerptZh?: string;
  words: number;
}

export interface Vault {
  notes: VaultNote[];
  bySlug: Map<string, VaultNote>;
  /** Resolve a wikilink target (file name, title, or alias) to a published note. */
  resolve(target: string): VaultNote | undefined;
  backlinks(slug: string): VaultNote[];
}

export const slugify = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const isoDate = (v: unknown): string | undefined => {
  if (v instanceof Date && !Number.isNaN(+v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return undefined;
};

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [];

/** Blank out code, math and comments so they can't yield false links. */
const stripCode = (src: string) =>
  src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/%%[\s\S]*?%%/g, ' ');

const WIKILINK = /(!?)\[\[([^\]\n]+?)\]\]/g;

/** Split `Target#Heading|Alias` into its three parts. */
export function parseWikilink(raw: string) {
  const [left, ...rest] = raw.split('|');
  const [target, ...heading] = left.split('#');
  return {
    target: target.trim(),
    heading: heading.join('#').trim() || undefined,
    alias: rest.join('|').trim() || undefined,
  };
}

function excerptOf(body: string) {
  const text = stripCode(body)
    .replace(/^#{1,6}\s.*$/gm, '')
    .replace(/^>\s*\[![^\]]*\].*$/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(WIKILINK, (_, __, raw) => {
      const l = parseWikilink(raw);
      return l.alias ?? l.target;
    })
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_=~]{1,3}/g, '')
    .replace(/\$[^$\n]*\$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text;
}

function countWords(body: string) {
  const clean = stripCode(body);
  const cjk = (clean.match(/[㐀-鿿]/g) ?? []).length;
  const latin = (clean.replace(/[㐀-鿿]/g, ' ').match(/[\p{L}\p{N}]+/gu) ?? []).length;
  // A CJK character reads in roughly half the time of a Latin word.
  return latin + Math.round(cjk / 2);
}

function walk(dir: string, out: string[] = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

function build(): Vault {
  const notes = new Map<string, VaultNote>();
  const rawTargets = new Map<string, string[]>();

  // Base files first, so `foo.zh.md` always has its `foo.md` to attach to.
  const files = walk(VAULT_DIR).sort(
    (a, b) => Number(a.endsWith('.zh.md')) - Number(b.endsWith('.zh.md')),
  );

  for (const file of files) {
    const rel = path.relative(VAULT_DIR, file).split(path.sep);
    const stem = path.basename(file, path.extname(file));
    const isZh = stem.endsWith('.zh');
    const baseStem = isZh ? stem.slice(0, -3) : stem;
    const slug = slugify(baseStem);
    const { data, content } = matter(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
    if (data.publish === false || data.draft === true) continue;

    const targets = [...stripCode(content).matchAll(WIKILINK)]
      .filter((m) => !m[1])
      .map((m) => parseWikilink(m[2]).target)
      .filter(Boolean);

    const base = notes.get(slug);
    if (isZh && base) {
      base.variants.zh = `${slug}.zh`;
      base.titleZh ??= data.title;
      base.summaryZh ??= data.summary;
      base.excerptZh = excerptOf(content);
      rawTargets.get(slug)!.push(...targets);
      continue;
    }

    if (base) console.warn(`[vault] Duplicate note name "${baseStem}": ${rel.join('/')} replaces an earlier file.`);

    // A base note, or a Chinese note that has no English sibling.
    notes.set(slug, {
      slug,
      title: isZh ? (data.title_en ?? data.title ?? baseStem) : (data.title ?? baseStem),
      titleZh: isZh ? data.title : data.title_zh,
      domain: data.domain ?? (rel.length > 1 ? rel[0] : 'general'),
      field: data.field ?? (rel.length > 2 ? rel[1] : undefined),
      tags: asList(data.tags).map((t) => t.replace(/^#/, '').replace(/\//g, '-')),
      aliases: asList(data.aliases),
      summary: isZh ? data.summary_en : data.summary,
      summaryZh: isZh ? data.summary : data.summary_zh,
      status: (['seed', 'growing', 'evergreen'].includes(data.status) ? data.status : 'seed') as NoteStatus,
      created: isoDate(data.created) ?? fs.statSync(file).mtime.toISOString().slice(0, 10),
      updated: isoDate(data.updated),
      links: [],
      ghosts: [],
      variants: isZh ? { zh: `${slug}.zh` } : { en: slug },
      lang: isZh || data.lang === 'zh' ? 'zh' : 'en',
      excerpt: excerptOf(content),
      excerptZh: isZh ? excerptOf(content) : undefined,
      words: countWords(content),
    });
    rawTargets.set(slug, targets);
  }

  const lookup = new Map<string, VaultNote>();
  for (const note of notes.values()) {
    for (const key of [note.slug, note.title, note.titleZh, ...note.aliases]) {
      if (key) lookup.set(normalize(key), note);
    }
  }
  const resolve = (target: string) =>
    lookup.get(normalize(target)) ?? lookup.get(normalize(slugify(target)));

  const incoming = new Map<string, Set<string>>();
  for (const note of notes.values()) {
    const links = new Set<string>();
    const ghosts = new Set<string>();
    for (const target of rawTargets.get(note.slug) ?? []) {
      const hit = resolve(target);
      if (hit && hit.slug !== note.slug) links.add(hit.slug);
      else if (!hit) ghosts.add(target);
    }
    note.links = [...links];
    note.ghosts = [...ghosts];
    for (const to of links) {
      if (!incoming.has(to)) incoming.set(to, new Set());
      incoming.get(to)!.add(note.slug);
    }
  }

  return {
    notes: [...notes.values()].sort((a, b) => b.created.localeCompare(a.created)),
    bySlug: notes,
    resolve,
    backlinks: (slug) => [...(incoming.get(slug) ?? [])].map((s) => notes.get(s)!).filter(Boolean),
  };
}

// The Markdown pipeline asks for the vault once per file. A short-lived cache keeps
// builds linear while the dev server still sees edits immediately.
let cache: { at: number; vault: Vault } | undefined;
export function getVault(): Vault {
  const now = Date.now();
  if (!cache || now - cache.at > 1500) cache = { at: now, vault: build() };
  return cache.vault;
}
