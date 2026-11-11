/**
 * The photo collection.
 *
 * Drop an image into content/photos/ and it is on the site: the build reads its
 * EXIF for the camera settings, renders responsive WebP sizes, and samples a tone
 * to show while it loads. content/photos.yaml adds whatever EXIF cannot know:
 * titles, places, captions, astrophotography details.
 *
 * Privacy: only the generated WebP files are published, and they carry no
 * metadata, so GPS coordinates in an original never reach the site.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import sharp from 'sharp';
import exifr from 'exifr';
import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';
import { z } from 'astro/zod';
import { slugify } from './vault';

const DIR = path.resolve('content/photos');
const files = import.meta.glob<{ default: ImageMetadata }>(
  '/content/photos/*.{jpg,JPG,jpeg,JPEG,png,PNG,webp,WEBP,avif,AVIF}',
  { eager: true },
);

const localized = z.union([z.string(), z.object({ en: z.string().optional(), zh: z.string().optional() })]);
type Localized = z.infer<typeof localized>;

const entrySchema = z.object({
  /** File name inside content/photos/. */
  file: z.string().optional(),
  title: localized.optional(),
  /** astro, landscape, city, nature, people, or anything else. */
  category: z.string().default('photo'),
  date: z.coerce.string().optional(),
  location: localized.optional(),
  caption: localized.optional(),
  /** Featured photos appear on the home page. */
  featured: z.boolean().default(false),
  /** Overrides for anything EXIF got wrong or lacks, such as a manual lens. */
  gear: z
    .object({
      camera: z.string(),
      lens: z.string(),
      focal: z.coerce.string(),
      aperture: z.coerce.string(),
      shutter: z.coerce.string(),
      iso: z.coerce.string(),
    })
    .partial()
    .default({}),
  astro: z
    .object({
      target: localized,
      telescope: z.string(),
      camera: z.string(),
      mount: z.string(),
      filters: z.string(),
      /** Sub-exposures, e.g. "120 × 180 s". */
      exposure: z.string(),
      /** Total integration time, e.g. "6 h". */
      integration: z.string(),
      /** Bortle dark-sky class, 1 to 9. */
      bortle: z.coerce.string(),
    })
    .partial()
    .optional(),
  placeholder: z.boolean().default(false),
  /** Placeholder artwork only. */
  kind: z.enum(['milkyway', 'deepsky', 'trails', 'landscape']).optional(),
  aspect: z.number().optional(),
});
type Entry = z.infer<typeof entrySchema>;

export interface Photo {
  id: string;
  title: Localized;
  category: string;
  date?: string;
  location?: Localized;
  caption?: Localized;
  featured: boolean;
  gear: Entry['gear'];
  astro?: NonNullable<Entry['astro']>;
  aspect: number;
  /** Average colour, shown while the image loads. */
  tone: string;
  thumb?: { src: string; srcset: string; width: number; height: number };
  full?: string;
  placeholder: boolean;
  kind?: Entry['kind'];
}

function readEntries(): Entry[] {
  const file = path.resolve('content/photos.yaml');
  if (!fs.existsSync(file)) return [];
  const parsed = z.array(entrySchema).safeParse(YAML.parse(fs.readFileSync(file, 'utf8')) ?? []);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid content in content/photos.yaml:\n${issues}`);
  }
  return parsed.data;
}

const shutter = (s: number) => (s >= 1 ? `${+s.toFixed(1)} s` : `1/${Math.round(1 / s)} s`);

async function readExif(file: string): Promise<Entry['gear'] & { date?: string }> {
  try {
    const x = await exifr.parse(file, {
      pick: ['Make', 'Model', 'LensModel', 'FocalLength', 'FNumber', 'ExposureTime', 'ISO', 'DateTimeOriginal'],
    });
    if (!x) return {};
    const make = String(x.Make ?? '').trim();
    const model = String(x.Model ?? '').trim();
    return {
      camera: model ? (model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`.trim()) : undefined,
      lens: x.LensModel ? String(x.LensModel) : undefined,
      focal: x.FocalLength ? `${Math.round(x.FocalLength)} mm` : undefined,
      aperture: x.FNumber ? `f/${+Number(x.FNumber).toFixed(1)}` : undefined,
      shutter: x.ExposureTime ? shutter(Number(x.ExposureTime)) : undefined,
      iso: x.ISO ? `ISO ${x.ISO}` : undefined,
      date: x.DateTimeOriginal instanceof Date ? x.DateTimeOriginal.toISOString().slice(0, 10) : undefined,
    };
  } catch {
    return {};
  }
}

async function averageTone(file: string) {
  try {
    const { data } = await sharp(file).resize(1, 1, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return `rgb(${data[0]} ${data[1]} ${data[2]})`;
  } catch {
    return 'var(--paper-2)';
  }
}

const strip = (o: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as Record<string, string>;

async function build(): Promise<Photo[]> {
  const entries = readEntries();
  const byFile = new Map(entries.filter((e) => e.file).map((e) => [e.file!, e]));
  const real: Photo[] = [];

  for (const [key, mod] of Object.entries(files)) {
    const name = path.basename(key);
    const image = mod.default;
    const source = path.join(DIR, name);
    const entry = byFile.get(name) ?? entrySchema.parse({ file: name });
    const exif = await readExif(source);
    const { date: exifDate, ...exifGear } = exif;

    const thumb = await getImage({ src: image, widths: [480, 800, 1200], format: 'webp', quality: 80 });
    const full = await getImage({ src: image, width: Math.min(image.width, 2400), format: 'webp', quality: 86 });

    real.push({
      id: slugify(name.replace(/\.[^.]+$/, '')),
      title: entry.title ?? name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
      category: entry.category,
      date: entry.date ?? exifDate,
      location: entry.location,
      caption: entry.caption,
      featured: entry.featured,
      gear: { ...strip(exifGear), ...strip(entry.gear) },
      astro: entry.astro,
      aspect: image.width / image.height,
      tone: await averageTone(source),
      thumb: {
        src: thumb.src,
        srcset: thumb.srcSet.attribute,
        width: image.width,
        height: image.height,
      },
      full: full.src,
      placeholder: false,
    });
  }

  // Placeholders hold the layout only until the first real photograph arrives.
  if (real.length) return real.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  return entries
    .filter((e) => e.placeholder)
    .map((e, i) => ({
      id: `placeholder-${i + 1}`,
      title: e.title ?? `Photo ${i + 1}`,
      category: e.category,
      date: e.date,
      location: e.location,
      caption: e.caption,
      featured: e.featured,
      gear: strip(e.gear),
      astro: e.astro,
      aspect: e.aspect ?? 1.5,
      tone: e.kind === 'landscape' ? '#dcdfe3' : '#0b0d12',
      placeholder: true,
      kind: e.kind,
    }));
}

let cache: Promise<Photo[]> | undefined;
export const getPhotos = () => (cache ??= build());
