/**
 * Crossword Journey — end-to-end QA playthrough (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   title → settings open/close → help open/close → Play → Journey →
 *   page 1 → type letters, check word, reveal letter → pause/resume →
 *   solve the grid to the results screen → back home.
 *
 * The solution for Journey page 1 is read from js/content.js (deterministic
 * authored seed); every action still goes through real clicks/key presses.
 * The game is fully playable offline; this test's embedded static server
 * stubs /api/v1/time and /api/v1/score so the online-only bits (clock sync,
 * ranked submission) are exercised too.
 *
 * Two passes: desktop 1280x800, then mobile 390x844 with touch. Any
 * non-benign console error or pageerror fails the run.
 *
 * Run: npm run test:e2e
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { journeyStage } from '../js/content.js';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOT = (stage, vp) => `/tmp/crossword-journey-e2e-${stage}-${vp}.png`;

// Benign GPU/swiftshader noise (from tools/production_game_audit.mjs).
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.ts': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/v1/time') {
      const now = Date.now();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ now, utcDay: new Date(now).toISOString().slice(0, 10) }));
      return;
    }
    if (url.pathname === '/api/v1/score' && req.method === 'POST') {
      for await (const _ of req) { /* drain */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, board: 'e2e-local', rank: 1 }));
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname));
    if (path === '/' || path === sep) path = '/index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
// PORT env pins the embedded server's port (default: any free port).
await new Promise((r) => server.listen(Number(process.env.PORT) || 0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// Journey page 1 solution (deterministic authored content), entry order,
// crossing cells listed once.
const def = journeyStage(1);
const SOLUTION = [];
{
  const seen = new Set();
  for (const e of def.entries) {
    for (const i of e.cells) {
      if (!seen.has(i)) { seen.add(i); SOLUTION.push({ i, ch: def.cells[i] }); }
    }
  }
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});

let failures = 0;
const step = async (name, fn) => {
  await fn();
  console.log(`ok - ${name}`);
};

async function solveGrid(page, vp) {
  const typed = new Set();
  for (const { i, ch } of SOLUTION) {
    if (await page.locator('#screen-results:not([hidden])').count()) break;
    if (typed.has(i)) continue;
    const cell = page.locator(`#board .cell[data-index="${i}"]`);
    const cls = (await cell.getAttribute('class')) || '';
    if (cls.includes('confirmed') || cls.includes('revealed')) continue; // locked, already correct
    await cell.click();
    await page.keyboard.press(ch.toLowerCase());
    typed.add(i);
  }
}

async function runPass(vpName, viewport, hasTouch) {
  const context = await browser.newContext({ viewport, hasTouch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !browserNoise.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  // Desktop shows the right-rail action buttons; mobile collapses the rails
  // and mirrors the same actions in the bottom tray.
  const btnCheck = vpName === 'mobile' ? '#tray-check' : '#act-check-word';
  const btnReveal = vpName === 'mobile' ? '#tray-reveal' : '#act-reveal';

  try {
    await step(`[${vpName}] load → title screen`, async () => {
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForSelector('#screen-title:not([hidden])', { timeout: 15000 });
      await page.waitForSelector('#btn-play', { state: 'visible' });
      await page.screenshot({ path: SHOT('title', vpName) });
    });

    await step(`[${vpName}] settings open/close`, async () => {
      await page.click('#nav-settings');
      await page.waitForSelector('#screen-settings:not([hidden])');
      await page.click('#set-high-contrast'); // toggle a real setting
      if (!(await page.evaluate(() => document.body.classList.contains('hc')))) {
        throw new Error('high-contrast setting did not apply');
      }
      await page.screenshot({ path: SHOT('settings', vpName) });
      await page.click('#btn-settings-back');
      await page.waitForSelector('#screen-title:not([hidden])');
    });

    await step(`[${vpName}] help open/close`, async () => {
      await page.click('#nav-help');
      await page.waitForSelector('#screen-help:not([hidden])');
      await page.click('#btn-help-back');
      await page.waitForSelector('#screen-title:not([hidden])');
    });

    await step(`[${vpName}] play → modes → journey page 1`, async () => {
      await page.click('#btn-play');
      await page.waitForSelector('#screen-modes:not([hidden])');
      await page.locator('#mode-list .mode-item', { hasText: 'Journey' }).first().click();
      await page.locator('#mode-list .mode-item', { hasText: '1.' }).first().click();
      await page.waitForSelector('#screen-play:not([hidden])');
      const cells = await page.locator('#board .cell').count();
      if (cells !== def.rows * def.cols) throw new Error(`expected ${def.rows * def.cols} cells, got ${cells}`);
      await page.screenshot({ path: SHOT('play', vpName) });
    });

    await step(`[${vpName}] type letters + check word + reveal`, async () => {
      // Type the first two letters of the first entry through real key presses.
      const first = def.entries[0];
      for (const i of first.cells.slice(0, 2)) {
        await page.locator(`#board .cell[data-index="${i}"]`).click();
        await page.keyboard.press(def.cells[i].toLowerCase());
      }
      await page.click(btnCheck); // confirms the correct letters, locks them
      await page.click(btnReveal); // reveals one letter elsewhere
      const revealed = await page.locator('#board .cell.revealed').count();
      if (revealed < 1) throw new Error('reveal did not lock any cell');
      await page.screenshot({ path: SHOT('assists', vpName) });
    });

    await step(`[${vpName}] pause → resume`, async () => {
      await page.keyboard.press('Escape');
      await page.waitForSelector('#overlay-pause:not([hidden])');
      await page.screenshot({ path: SHOT('pause', vpName) });
      await page.click('#pause-resume');
      await page.waitForSelector('#overlay-pause', { state: 'hidden' });
      if (await page.locator('#screen-play').isHidden()) throw new Error('did not return to play screen');
    });

    await step(`[${vpName}] solve grid → results`, async () => {
      await solveGrid(page, vpName);
      await page.waitForSelector('#screen-results:not([hidden])', { timeout: 10000 });
      const headline = await page.textContent('#results-headline');
      if (!/Page complete/.test(headline)) throw new Error(`unexpected headline: ${headline}`);
      const rows = await page.locator('#results-breakdown dt').count();
      if (rows < 5) throw new Error(`expected score breakdown rows, got ${rows}`);
      const pct = await page.textContent('#progress-text');
      console.log(`  headline: ${headline.trim()} · completion ${pct}`);
      await page.screenshot({ path: SHOT('results', vpName) });
    });

    await step(`[${vpName}] progression persisted + back home`, async () => {
      const store = await page.evaluate(() => JSON.parse(localStorage.getItem('cwj:v1') || 'null'));
      if (!store || store.journey.unlocked !== 2) throw new Error('journey page 2 not unlocked');
      if (store.stats.wins !== 1) throw new Error('win not recorded');
      await page.click('#btn-results-home');
      await page.waitForSelector('#screen-title:not([hidden])');
    });
  } finally {
    if (errors.length) {
      failures++;
      console.error(`[${vpName}] PAGE ERRORS:\n` + errors.join('\n'));
    }
    await context.close();
  }
}

try {
  await runPass('desktop', { width: 1280, height: 800 }, false);
  await runPass('mobile', { width: 390, height: 844 }, true);
} finally {
  await browser.close();
  server.close();
}

if (failures > 0) {
  console.error(`e2e: ${failures} pass(es) with page errors`);
  process.exit(1);
}
console.log('e2e: all passes completed with no page errors');
