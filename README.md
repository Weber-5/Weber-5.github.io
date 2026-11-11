# Weber's academic site

Personal academic website: research, open-source projects, and a public knowledge base
of linked notes. Built with [Astro](https://astro.build), deployed to GitHub Pages.

**Live:** <https://weber-5.github.io/>

## Commands

| Command | What it does |
| :-- | :-- |
| `pnpm install` | Install dependencies |
| `pnpm dev` | Local preview with live reload |
| `pnpm build` | Production build into `dist/`, plus the CV PDFs and share image |
| `pnpm preview` | Serve the production build |
| `pnpm check` | Type-check the project |
| `pnpm note "Title" electrical/power-systems` | Create a dated note in the right folder |

Pushing to `main` builds and deploys automatically.

## Editing content

Everything you would normally change lives in [`content/`](content/). You should not
need to touch `src/`. Each file is validated at build time, so a typo stops the build
with a message pointing at the exact field instead of shipping a broken page.

| File | Controls |
| :-- | :-- |
| `content/profile.yaml` | Name, role, introduction, links, research interests, philosophy, portrait |
| `content/publications.yaml` | Papers. `selected: true` puts one on the home page |
| `content/research.yaml` | Research directions and experience |
| `content/cv.yaml` | Education, positions, awards, skills |
| `content/projects/*.md` | One file per project. `featured: true` puts it on the home page |
| `content/domains.yaml` | The knowledge taxonomy: categories and fields |
| `content/photos/` + `photos.yaml` | Photography: drop images in; the YAML adds titles and astro details |
| `content/notes/` | The notes vault |

Text fields take a plain string, or `{ en: ..., zh: ... }` for two languages.

Everything still unwritten carries `placeholder: true`, which shows a dashed
"Placeholder" chip. Delete that line once an entry is real.

**Portrait:** put a photo in `public/images/` and set `portrait: /images/portrait.jpg`
in `profile.yaml`. A 4:5 crop works best.

## Photography

Drop JPEG, PNG, WebP or AVIF files into `content/photos/` and push. The build reads
each photo's EXIF for camera, lens and exposure, renders responsive WebP sizes, and
samples a tone to show while it loads. The placeholders vanish with the first real photo.

Only the generated WebP files are published, and they carry no metadata: GPS
coordinates in an original never reach the site.

To say more than EXIF can, add an entry to `content/photos.yaml` with the same `file`
name: title, `category` (`astro`, `landscape`, ...), place, caption, `featured: true`
for the home page, and for astrophotography the target, telescope, mount, filters,
sub-exposures, total integration and Bortle class. The file has a full example.

## Notes and the knowledge graph

`content/notes/` is a plain [Obsidian](https://obsidian.md) vault. Open that folder in
Obsidian and write as usual. The folders are the taxonomy:

```text
content/notes/
├── math/         computation · optimization · control · theory
├── electrical/   circuits · digital-electronics · analog-electronics · microcontrollers
│                 electric-machines · power-systems · automatic-control
│                 electromagnetics · power-electronics · high-voltage
├── ml/           deep-learning · reinforcement-learning
└── _attachments/ images embedded with ![[file.png]]
```

A note needs no frontmatter: the file name becomes the title and the slug, and the
folders place it on the graph. Links become edges automatically, and a link to a note
you have not written yet appears as a hollow "ghost" node until you write it.

**Supported syntax:** `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]`, `![[image.png]]`,
`> [!note]` callouts (including folded `> [!tip]-`), `==highlight==`, `%%comments%%`,
`$math$`, `$$math$$`, footnotes, tables, task lists and fenced code.

**Optional frontmatter:**

```yaml
---
title: Kalman Filter
title_zh: 卡尔曼滤波      # Chinese title, shown on /zh/ and in the graph
aliases: [KF]             # other names that [[links]] can use
tags: [estimation]
status: seed              # seed, growing or evergreen
created: 2026-01-15       # drives the graph's growth replay
summary: One line for previews and search.
publish: false            # keeps the note off the site
---
```

**Two languages:** put `Kalman Filter.zh.md` next to `Kalman Filter.md`. It becomes the
Chinese version of the same note, and one node in the graph.

**Private notes:** `publish: false`, or any file or folder whose name starts with `_`
or `.`, stays off the site.

**Connecting papers and projects:** give them `notes: [Kalman Filter]` and they join
the graph next to those notes.

## How it fits together

- `src/lib/vault.ts` is the single index of the vault. The Markdown pipeline, backlinks
  and the graph all read from it.
- `src/scripts/graph/engine.ts` is the graph renderer: `d3-force` computes the layout
  once, then a custom canvas renderer repaints only while something moves. The same
  engine drives the full explorer, the home preview and each note's neighbourhood.
- Pages live in `src/pages/[...locale]/`: one file serves both `/` and `/zh/`.

**Language:** GitHub Pages has no server to read a visitor's location, and an IP lookup
would send every visitor to a third party. Instead, an inline script reads the device
time zone before first paint and sends visitors in mainland China, Hong Kong, Macau and
Taiwan to `/zh/`. An explicit choice in the language switch always wins.

**CV PDF:** printed from the `/cv/` page by headless Chrome after each build, so the PDF
can never drift from the page. To use a hand-made PDF instead, put it in `public/` and
set `pdf` in `cv.yaml`.
