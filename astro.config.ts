import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { remarkObsidian } from './src/markdown/remark-obsidian';
import { rehypeEnhance } from './src/markdown/rehype-enhance';
import { inkTheme } from './src/markdown/shiki-ink';
import { vaultMedia } from './src/lib/vault-media';

export default defineConfig({
  site: 'https://weber-5.github.io',
  // Astro 7 defaults to JSX-style whitespace, which eats spaces between inline tags.
  compressHTML: true,
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  integrations: [
    vaultMedia(),
    sitemap({
      i18n: { defaultLocale: 'en', locales: { en: 'en', zh: 'zh-CN' } },
      filter: (page) => !page.includes('/og/'),
    }),
  ],
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath, remarkObsidian],
      rehypePlugins: [[rehypeKatex, { strict: false, output: 'htmlAndMathml' }], rehypeEnhance],
    }),
    shikiConfig: {
      themes: { light: inkTheme('light'), dark: inkTheme('dark') },
      defaultColor: false,
      wrap: false,
    },
  },
});
