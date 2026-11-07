/**
 * Runs after `astro build`: prints the CV to PDF and renders the social share image,
 * so both always match the content.
 *
 * This step is an enhancement, so it can never fail a deploy. Chrome ships on GitHub's
 * ubuntu runners; where it is missing, the site still works and the CV button falls
 * back to the browser's own print dialog.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const DIST = path.resolve('dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const findChrome = () =>
  [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].find((p) => p && fs.existsSync(p));

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(DIST, url);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(DIST) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function render(chrome) {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: chrome,
    args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
  });

  try {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

    // ?lang= stops the time-zone redirect from sending the English CV to /zh/.
    for (const [file, url] of [
      ['cv-en.pdf', '/cv/?lang=en'],
      ['cv-zh.pdf', '/zh/cv/'],
    ]) {
      await page.goto(origin + url, { waitUntil: 'networkidle0' });
      await page.evaluate(() => document.fonts.ready);
      await page.pdf({ path: path.join(DIST, file), printBackground: true, preferCSSPageSize: true });
      console.log(`[postbuild] ${file}`);
    }

    await page.setViewport({ width: 1200, height: 630 });
    await page.goto(`${origin}/og/`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(DIST, 'og.png') });
    console.log('[postbuild] og.png');
  } finally {
    await browser.close();
    server.close();
  }
}

const chrome = findChrome();
if (!chrome) {
  console.warn('[postbuild] Chrome not found: skipping the CV PDF and share image.');
} else {
  try {
    await render(chrome);
  } catch (error) {
    console.warn(`[postbuild] Skipped: ${error.message}`);
  }
}
