// Crossword Journey — smoke test: boot the server on a random port, fetch
// key assets and APIs, submit a validated replay envelope, read the board.
// Exits non-zero on any failure.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const testData = await mkdtemp(join(tmpdir(), 'crossword-test-'));
import { createGame, applyCommand, RULES_VERSION } from '../js/rules.js';
import { practiceDef, challengeDef } from '../js/content.js';

const PORT = 18000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

async function get(path) {
  const res = await fetch(BASE + path);
  const text = await res.text();
  return { status: res.status, text, json: () => JSON.parse(text) };
}

// Build a valid replay envelope for any def: win the grid legitimately.
// checksFirst prepends that many grid checks (each costs points), letting
// tests produce two runs of the same grid with different scores.
function buildEnvelope(def, name = 'Smoke', checksFirst = 0) {
  let state = createGame(def);
  const commands = [];
  let id = 1;
  for (let k = 0; k < checksFirst; k++) {
    const cmd = { id: id++, type: 'check', scope: 'grid' };
    const r = applyCommand(state, cmd);
    if (r.error) throw new Error('smoke check failed: ' + r.error);
    state = r.state;
    commands.push(cmd);
  }
  for (let i = 0; i < def.cells.length; i++) {
    if (def.cells[i] === null) continue;
    const cmd = { id: id++, type: 'letter', cell: i, ch: def.cells[i] };
    const r = applyCommand(state, cmd);
    if (r.error) throw new Error('smoke solve failed: ' + r.error);
    state = r.state;
    commands.push(cmd);
  }
  return {
    def,
    body: {
      envelope: { schema: 1, build: RULES_VERSION, contentV: def.v, seed: def.seed, init: def, commands },
      result: {
        name,
        sessionId: 'smoke-' + name.toLowerCase() + '-' + Date.now(),
        score: state.score.total,
        status: state.status,
      },
    },
  };
}

async function postScore(body) {
  const res = await fetch(BASE + '/api/v1/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(PORT), CROSSWORD_DATA_DIR: testData },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

try {
  // wait for the listener
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    try { await get('/api/v1/time'); up = true; }
    catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  if (!up) throw new Error('server did not start:\n' + serverLog);

  for (const path of ['/', '/css/style.css', '/js/main.js', '/js/rules.js', '/js/content.js', '/vendor/three.module.js']) {
    const r = await get(path);
    check(`GET ${path}`, r.status === 200 && r.text.length > 100, `status ${r.status}`);
  }

  const t = await get('/api/v1/time');
  const tj = t.json();
  check('GET /api/v1/time', t.status === 200 && Number.isFinite(tj.now) && /^\d{4}-\d{2}-\d{2}$/.test(tj.utcDay), JSON.stringify(tj));

  const { body } = buildEnvelope(practiceDef('easy', 'smoke-seed'));
  const post = await postScore(body);
  const pj = post.json;
  check('POST /api/v1/score (valid)', post.status === 200 && pj.ok === true && pj.rank >= 1, JSON.stringify(pj));

  const bad = await postScore({
    envelope: { ...body.envelope },
    result: { ...body.result, sessionId: 'smoke-bad', score: body.result.score + 1 },
  });
  check('POST /api/v1/score (mismatched score rejected)', bad.status === 422 && bad.json.error === 'score-mismatch', JSON.stringify(bad.json));

  // Ranked challenge rounds get their own board, not the casual one.
  const ch = await postScore(buildEnvelope(challengeDef('challenge-no-eraser'), 'SmokeCh').body);
  check('POST /api/v1/score (challenge board)', ch.status === 200 && ch.json.board === 'challenge-no-eraser', JSON.stringify(ch.json));

  // Self-consistent replay over tampered ranked content must be rejected.
  const tamperedDef = JSON.parse(JSON.stringify(challengeDef('challenge-no-eraser')));
  const ti = tamperedDef.cells.findIndex((c) => c !== null);
  tamperedDef.cells[ti] = tamperedDef.cells[ti] === 'A' ? 'B' : 'A';
  for (const e of tamperedDef.entries) {
    const k = e.cells.indexOf(ti);
    if (k >= 0) e.word = e.word.slice(0, k) + tamperedDef.cells[ti] + e.word.slice(k + 1);
  }
  const tam = await postScore(buildEnvelope(tamperedDef, 'SmokeTam').body);
  check('POST /api/v1/score (tampered content rejected)', tam.status === 422 && tam.json.error === 'content-mismatch', JSON.stringify(tam.json));

  // Higher scores must rank ahead of lower ones on the same board. Same
  // grid for both; the "lo" run spends one grid check (−15 points).
  const orderDef = practiceDef('easy', 'smoke-order');
  const hi = buildEnvelope(orderDef, 'SmokeHi');
  const lo = buildEnvelope(orderDef, 'SmokeLo', 1);
  const [hiP, loP] = [await postScore(hi.body), await postScore(lo.body)];
  const loS = lo.body.result.score;
  const hiS = hi.body.result.score;
  check('leaderboard ranks follow score',
    hiP.status === 200 && loP.status === 200 && hiS > loS && hiP.json.rank < loP.json.rank,
    `hi=${hiS}#${hiP.json.rank} lo=${loS}#${loP.json.rank}`);

  const lb = await get(`/api/v1/leaderboard?board=${pj.board}`);
  const lj = lb.json();
  check('GET /api/v1/leaderboard', lb.status === 200 && Array.isArray(lj.entries) && lj.entries.length >= 1
    && lj.entries.every((e) => ['name', 'score', 'status', 'elapsedMs', 'seed', 'contentV', 'assists', 'durationMs'].every((k) => k in e)),
    `${lj.entries?.length ?? 0} entries`);

  const trav = await new Promise((resolve) => {
    import('node:http').then(({ request }) => {
      const req = request({ host: '127.0.0.1', port: PORT, path: '/../../etc/passwd', method: 'GET' }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode }));
      });
      req.on('error', () => resolve({ status: 0 }));
      req.end();
    });
  });
  check('path traversal blocked', trav.status === 403 || trav.status === 404 || trav.status === 400, `status ${trav.status}`);
} catch (e) {
  console.error('smoke error:', e.message);
  failures++;
} finally {
  const exited = new Promise(r => server.once('exit',r));
  server.kill();
  if (server.exitCode === null && server.signalCode === null) await exited;
  await rm(testData, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`smoke: ${failures} failure(s)`);
  process.exit(1);
}
console.log('smoke: all checks passed');
