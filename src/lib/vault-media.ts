/**
 * Serves `content/notes/_attachments/` at /notes-media/ so images can live inside
 * the Obsidian vault, next to the notes that embed them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { MEDIA_DIR, MEDIA_URL } from './vault';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

export function vaultMedia(): AstroIntegration {
  return {
    name: 'vault-media',
    hooks: {
      'astro:server:setup': ({ server }) => {
        server.middlewares.use(MEDIA_URL, (req, res, next) => {
          const name = decodeURIComponent((req.url ?? '').split('?')[0]);
          const file = path.normalize(path.join(MEDIA_DIR, name));
          if (!file.startsWith(MEDIA_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            return next();
          }
          res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
          fs.createReadStream(file).pipe(res);
        });
      },
      'astro:build:done': ({ dir }) => {
        if (!fs.existsSync(MEDIA_DIR)) return;
        fs.cpSync(MEDIA_DIR, path.join(fileURLToPath(dir), MEDIA_URL), { recursive: true });
      },
    },
  };
}
