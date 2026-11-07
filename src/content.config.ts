import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import path from 'node:path';
import { slugify } from './lib/vault';

const stemOf = (entry: string) => path.basename(entry, path.extname(entry));

/** Obsidian vault. Every field is optional so an untouched note still builds. */
const notes = defineCollection({
  loader: glob({
    pattern: ['**/*.md', '!**/_*/**', '!**/.*/**', '!**/_*.md'],
    base: './content/notes',
    generateId: ({ entry }) => {
      const stem = stemOf(entry);
      return stem.endsWith('.zh') ? `${slugify(stem.slice(0, -3))}.zh` : slugify(stem);
    },
  }),
  schema: z.looseObject({
    title: z.string().optional(),
    publish: z.boolean().optional(),
    draft: z.boolean().optional(),
  }),
});

const localized = z.union([
  z.string(),
  z.object({ en: z.string().optional(), zh: z.string().optional() }),
]);

const projects = defineCollection({
  loader: glob({
    pattern: ['*.md', '!*.zh.md', '!_*.md'],
    base: './content/projects',
    generateId: ({ entry }) => slugify(stemOf(entry)),
  }),
  schema: z.object({
    title: localized,
    summary: localized,
    /** Path under /public. When omitted, a generative ink cover is drawn from the slug. */
    cover: z.string().optional(),
    tags: z.array(z.string()).default([]),
    role: localized.optional(),
    period: z.coerce.string().optional(),
    status: localized.optional(),
    links: z
      .object({
        github: z.string().optional(),
        demo: z.string().optional(),
        docs: z.string().optional(),
      })
      .default({}),
    /** Featured projects appear on the home page. */
    featured: z.boolean().default(false),
    order: z.number().default(100),
    /** Note names; these become edges in the knowledge graph. */
    notes: z.array(z.string()).default([]),
    placeholder: z.boolean().default(false),
  }),
});

/** Optional Chinese bodies: `foo.zh.md` next to `foo.md`, no frontmatter needed. */
const projectBodiesZh = defineCollection({
  loader: glob({
    pattern: ['*.zh.md'],
    base: './content/projects',
    generateId: ({ entry }) => slugify(stemOf(entry).slice(0, -3)),
  }),
  schema: z.looseObject({}),
});

export const collections = { notes, projects, projectBodiesZh };
