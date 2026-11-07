/**
 * Create a note with today's date:
 *   pnpm note "Power Flow Analysis" electrical/power-systems
 */
import fs from 'node:fs';
import path from 'node:path';

const [title, folder = ''] = process.argv.slice(2);
if (!title) {
  console.error('Usage: pnpm note "Note Title" [category/field]');
  process.exit(1);
}

const dir = path.join('content/notes', folder);
const file = path.join(dir, `${title}.md`);
if (fs.existsSync(file)) {
  console.error(`Already exists: ${file}`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  file,
  `---
title: "${title}"
title_zh: ""
tags: []
status: seed
created: ${today}
---

`,
);
console.log(`Created ${file}`);
