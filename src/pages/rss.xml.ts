import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getVault } from '../lib/vault';
import { getProfile } from '../lib/data';
import { tr } from '../i18n';

export function GET(context: APIContext) {
  const profile = getProfile();
  const name = tr(profile.name, 'en');
  return rss({
    title: `${name} · Notes`,
    description: tr(profile.tagline, 'en'),
    site: context.site!,
    items: getVault().notes.map((n) => ({
      title: n.title,
      description: n.summary ?? n.excerpt,
      pubDate: new Date(n.created),
      link: `/notes/${n.slug}/`,
      categories: n.tags,
    })),
  });
}
