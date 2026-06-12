// Headless selftest runner (C1).
//
// Serves the repo over a local HTTP server, opens reader.html?selftest=1 in
// headless Chromium (Playwright), waits for the in-browser selftest suite to
// publish window.__selftestResults, and exits non-zero on any failure. The
// same suite a developer runs by opening ?selftest=1 in a browser becomes a
// pre-merge gate.
//
// Usage:
//   npm install            (installs playwright; then: npx playwright install chromium)
//   node test/run-selftest.mjs
//
// Optional: pass extra page URLs (relative to the server root) as arguments to
// run the suite against more entry points, e.g. a real EPUB via ?src=.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.epub': 'application/epub+zip',
  '.webmanifest': 'application/manifest+json',
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let rel = normalize(urlPath).replace(/^([/\\])+/, '');
      if (rel.split(sep).includes('..')) { res.writeHead(403); res.end(); return; }
      if (rel === '') rel = 'index.html';
      const body = await readFile(join(ROOT, rel));
      res.writeHead(200, { 'content-type': MIME[extname(rel)] || 'application/octet-stream' });
      res.end(body);
    } catch (_) {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function runPage(browser, base, path) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  const url = base + path;
  console.log(`\n=== ${path} ===`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.__selftestResults), null, { timeout: 60000 });
  const results = await page.evaluate(() => window.__selftestResults);
  const failures = results.filter((r) => !r.ok);
  for (const f of failures) console.error('  ' + f.display);
  console.log(`  ${results.length - failures.length}/${results.length} passed`);
  if (pageErrors.length) {
    console.error('  Uncaught page errors:');
    for (const e of pageErrors) console.error('   ', e);
  }
  await page.close();
  return failures.length === 0 && pageErrors.length === 0;
}

const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}/`;
const pages = process.argv.slice(2);
if (!pages.length) {
  pages.push('reader.html?selftest=1');
  // Exercise the full EPUB pipeline (jszip + epub.js + extraction) when the
  // bundled library books are present.
  pages.push('reader.html?selftest=1&src=' +
    encodeURIComponent('books/Fiction/Jane Austen/pride-and-prejudice.epub') + '&id=pp-selftest');
}

const browser = await chromium.launch();
let ok = true;
try {
  for (const p of pages) ok = (await runPage(browser, base, p)) && ok;
} finally {
  await browser.close();
  server.close();
}
console.log(ok ? '\nSelftest: PASS' : '\nSelftest: FAIL');
process.exit(ok ? 0 : 1);
