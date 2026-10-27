// Plays the web package in Chrome on the GPU (the loader index.html that
// `npm run package` writes), past ~/games/tools/engine-web-smoke.mjs's start:
// at a desktop viewport (the wide three-rail layout), a phone and a phone
// held sideways, by keyboard: Tab to the title's Journey card, page 1, the
// page typed as tools/plan.mjs solves it (Enter hops clues) to its results;
// on the phone also taps on the on-screen letter keys; Settings and Help at
// phone and desktop widths. Fails on console
// errors or warnings or the runtime's error screen.
//   node tools/browser-play.mjs [GAME_DIR] [--shots OUT_DIR]
// Serves GAME_DIR on loopback (never tests/, tools/ or dot-names), the engine
// itself from wiki.starhermit.com as the loader pins it. playwright-core is
// resolved from GAME_DIR's node_modules or any sibling game's.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const dir = resolve(args[0] ?? '.');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const shots = opt('--shots', null);
const waitMs = Number(opt('--wait', '8000'));

function findPlaywright() {
  const roots = [dir, resolve(dir, '..'), ...readdirSync(resolve(dir, '..')).map((d) => resolve(dir, '..', d))];
  for (const r of roots) {
    const p = join(r, 'node_modules', 'playwright-core');
    if (existsSync(p)) return createRequire(join(r, 'package.json'))('playwright-core');
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();

const types = { '.opus': 'audio/ogg', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  if (path === 'api/v1/time') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ serverTime: Date.now(), serverTimeIso: new Date().toISOString() })); return; }
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.') || p === '..') || ['tests', 'tools', 'node_modules'].includes(parts[0])) { res.writeHead(404).end(); return; }
  const file = join(dir, path);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

// Headed Chrome on the machine's GPU (~/games/tools/gpu-chrome.mjs; GPU_ADAPTER=software: headless SwiftShader).
const { launchChrome } = await import(join(dir, '..', 'tools', 'gpu-chrome.mjs'));
const { browser, gpu, close } = await launchChrome(chromium);
console.log(`# chrome on ${gpu}`);
// The GPU path draws black at device pixel ratio 3 (engine bug, reported): phones at 2 there.
const phoneDpr = gpu === 'software' ? 3 : 2;
let failed = false;
const C = await import(join(dir, 'js', 'content.js'));
const { plan } = await import(join(dir, 'tools', 'plan.mjs'));
const solve = [];
for (const s of plan(C.journeyStage(1)).steps) solve.push(s.type ? ['type', s.type] : ['key', s.key]);
const toPage = [['shot', 'title'], ['key', 'Tab'], ['key', 'Tab'], ['key', 'Enter'], ['shot', 'journey'], ['key', 'Tab'], ['key', 'Enter'], ['wait', 1500], ['shot', 'play']];
const play = [...toPage, ...solve.slice(0, 2), ['shot', 'typed'], ...solve.slice(2), ['wait', 2500], ['shot', 'results']];
const views = [
  { name: 'desktop', viewport: { width: 1366, height: 768 }, steps: play },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: phoneDpr,
    steps: [...toPage, ['tap', 28, 625], ['tap', 135, 625], ['shot', 'osk'], ['tap', 325, 713], ['shot', 'osk-cleared'], ...solve, ['wait', 2500], ['shot', 'results']] },
  // Settings and Help at phone width: nothing cut off.
  { name: 'phone-screens', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: phoneDpr,
    steps: [['shot', 'title'], ['tap', 330, 28], ['shot', 'settings'], ['tap', 243, 28], ['shot', 'help']] },
  { name: 'desktop-screens', viewport: { width: 1366, height: 768 }, steps: [['click', 1305, 28], ['shot', 'settings'], ['click', 1215, 28], ['shot', 'help']] },
  { name: 'landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: phoneDpr, steps: play },
];
for (const v of views) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor });
  const page = await ctx.newPage();
  const problems = [];
  const environment = /^No available adapters\.$|GL Driver Message/;
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !environment.test(m.text())) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load' });
  // The first start compiles shaders: wait for the runtime to run (up to 90 s), not a fixed delay.
  const started = await page.waitForFunction(() => {
    const st = document.documentElement.dataset.starhermit;
    return st === 'running' || st === 'error';
  }, null, { timeout: 90000 }).then(() => true, () => false);
  await page.waitForTimeout(3000); // a key press during start-up can be lost
  for (const [op, a, b] of v.steps) {
    if (op === 'key') { await page.keyboard.down(a); await page.waitForTimeout(60); await page.keyboard.up(a); await page.waitForTimeout(250); continue; }
    if (op === 'type') { for (const ch of a) { await page.keyboard.press(`Key${ch}`); await page.waitForTimeout(120); } continue; }
    if (op === 'tap') { await page.touchscreen.tap(a, b); await page.waitForTimeout(500); continue; }
    if (op === 'click') { await page.mouse.click(a, b); await page.waitForTimeout(500); continue; }
    if (op === 'wait') { await page.waitForTimeout(a); continue; }
    if (op === 'shot' && shots) { mkdirSync(shots, { recursive: true }); await page.waitForTimeout(700); await page.screenshot({ path: join(shots, `${v.name}-${a}.png`) }); }
    await page.waitForTimeout(800);
  }
  const state = await page.evaluate(() => document.documentElement.dataset.starhermit ?? '');
  const ok = started && state !== 'error' && problems.length === 0;
  failed ||= !ok;
  console.log(`${ok ? 'ok' : 'not ok'} - ${v.name} played: started=${started} state=${state || '-'}`);
  for (const p of problems) console.log(`  ${p}`);
  await ctx.close();
}
await close();
server.close();
process.exit(failed ? 1 : 0);
