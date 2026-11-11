/**
 * Structured content loaders. Each YAML file in `content/` is validated here, so a
 * typo fails the build with a readable message instead of shipping a broken page.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'astro/zod';

const localized = z.union([
  z.string(),
  z.object({ en: z.string().optional(), zh: z.string().optional() }),
]);
export type Localized = z.infer<typeof localized>;

const profileSchema = z.object({
  name: localized,
  role: localized,
  affiliation: localized,
  location: localized.optional(),
  coordinates: z.string().optional(),
  tagline: localized,
  intro: localized,
  /** Path under /public, e.g. /images/portrait.jpg. Empty shows the ink placeholder. */
  portrait: z.string().default(''),
  links: z
    .object({
      github: z.string().default(''),
      scholar: z.string().default(''),
      email: z.string().default(''),
      orcid: z.string().default(''),
      linkedin: z.string().default(''),
      px500: z.string().default(''),
      bilibili: z.string().default(''),
      zhihu: z.string().default(''),
    })
    .prefault({}),
  interests: z.array(z.object({ title: localized, note: localized.optional() })).default([]),
  philosophy: localized,
});

const publicationSchema = z.object({
  id: z.string(),
  title: localized,
  /** Prefix your own name with `*` to emphasise it. */
  authors: z.array(z.string()),
  venue: localized,
  year: z.number(),
  type: z.enum(['journal', 'conference', 'preprint', 'thesis', 'other']).default('conference'),
  /** Selected papers appear on the home page. */
  selected: z.boolean().default(false),
  note: localized.optional(),
  abstract: localized.optional(),
  bibtex: z.string().optional(),
  topics: z.array(z.string()).default([]),
  links: z.record(z.string(), z.string()).default({}),
  /** Note names; these become edges in the knowledge graph. */
  notes: z.array(z.string()).default([]),
  placeholder: z.boolean().default(false),
});

const timelineItem = z.object({
  title: localized,
  org: localized.optional(),
  place: localized.optional(),
  period: z.coerce.string().optional(),
  detail: localized.optional(),
  bullets: z.array(localized).default([]),
  placeholder: z.boolean().default(false),
});

const researchSchema = z.object({
  intro: localized,
  directions: z
    .array(
      z.object({
        title: localized,
        summary: localized,
        keywords: z.array(z.string()).default([]),
        placeholder: z.boolean().default(false),
      }),
    )
    .default([]),
  experience: z.array(timelineItem).default([]),
});

const cvSchema = z.object({
  summary: localized,
  /** Optional hand-made PDF under /public. Otherwise one is printed from /cv/ at build time. */
  pdf: z.string().default(''),
  education: z.array(timelineItem).default([]),
  experience: z.array(timelineItem).default([]),
  awards: z.array(timelineItem).default([]),
  skills: z.array(z.object({ group: localized, items: z.array(z.string()) })).default([]),
  background: localized.optional(),
});

const domainSchema = z.array(
  z.object({
    id: z.string(),
    name: localized,
    fields: z.array(z.object({ id: z.string(), name: localized })).default([]),
  }),
);

function load<T extends z.ZodType>(file: string, schema: T): z.infer<T> {
  const full = path.resolve('content', file);
  const parsed = schema.safeParse(YAML.parse(fs.readFileSync(full, 'utf8')));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid content in content/${file}:\n${issues}`);
  }
  return parsed.data;
}

export const getProfile = () => load('profile.yaml', profileSchema);
export const getResearch = () => load('research.yaml', researchSchema);
export const getCv = () => load('cv.yaml', cvSchema);
export const getDomains = () => load('domains.yaml', domainSchema);
export const getPublications = () =>
  load('publications.yaml', z.array(publicationSchema)).sort((a, b) => b.year - a.year);

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Author list as HTML, with your own `*`-marked name emphasised. */
export const authorsHtml = (authors: string[]) =>
  authors
    .map((a) => (a.startsWith('*') ? `<strong>${escapeHtml(a.slice(1))}</strong>` : escapeHtml(a)))
    .join(', ');

export type Profile = ReturnType<typeof getProfile>;
export type Publication = ReturnType<typeof getPublications>[number];
export type TimelineItem = z.infer<typeof timelineItem>;
