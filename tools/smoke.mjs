// Crossword Journey — smoke test: boot the server on a random port, fetch
// key assets and APIs, submit a validated replay envelope, read the board.
// Exits non-zero on any failure.
import { spawn } from 'node:child_process';
import { createGame, applyCommand, RULES_VERSION } from '../js/rules.js';
import { practiceDef } from '../js/content.js';

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

// Build a small valid replay envelope: win a practice grid legitimately.
function buildEnvelope() {
  const def = practiceDef('easy', 'smoke-seed');
  let state = createGame(def);
  const commands = [];
  let id = 1;
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
        name: 'Smoke',
        sessionId: 'smoke-' + Date.now(),
        score: state.score.total,
        status: state.status,
      },
    },
  };
}

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(PORT) },
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

  const { body } = buildEnvelope();
  const post = await fetch(BASE + '/api/v1/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const pj = await post.json();
  check('POST /api/v1/score (valid)', post.status === 200 && pj.ok === true && pj.rank >= 1, JSON.stringify(pj));

  const bad = await fetch(BASE + '/api/v1/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: { ...body.envelope }, result: { ...body.result, sessionId: 'smoke-bad', score: body.result.score + 1 } }),
  });
  const bj = await bad.json();
  check('POST /api/v1/score (mismatched score rejected)', bad.status === 422 && bj.error === 'score-mismatch', JSON.stringify(bj));

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
  server.kill();
}

if (failures > 0) {
  console.error(`smoke: ${failures} failure(s)`);
  process.exit(1);
}
console.log('smoke: all checks passed');
