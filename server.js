// Crossword Journey — local static + API server (Node http, no deps).
//
// Static files with path-traversal protection, plus:
//   GET  /api/v1/time         -> { now, utcDay }
//   POST /api/v1/score        -> validate replay envelope, store, return rank
//   GET  /api/v1/leaderboard  -> ?board=<id> top 20 entries
// Leaderboards are kept in memory and mirrored to ./data/leaderboard.json.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { replay, compareResults, RULES_VERSION } from './js/rules.js';
import { dailyForDate, journeyStage, challengeDef, CHALLENGES } from './js/content.js';

const ROOT = new URL('.', import.meta.url).pathname;
const DATA_DIR = process.env.CROSSWORD_DATA_DIR || join(ROOT, 'data');
const BOARD_FILE = join(DATA_DIR, 'leaderboard.json');
const PORT = Number(process.env.PORT) || 8000;
const BODY_CAP = 256 * 1024; // bytes
const BOARD_TOP = 20;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.opus': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

// ---------------------------------------------------------------------------
// Leaderboard store (in-memory + JSON file)
// ---------------------------------------------------------------------------

// boards: Map<boardId, entry[]>, entry: { name, score, status, elapsedMs,
//   seed, contentV, assists, durationMs, invalid, sessionId, at }
const boards = new Map();

function loadBoards() {
  try {
    if (!existsSync(BOARD_FILE)) return;
    const data = JSON.parse(readFileSync(BOARD_FILE, 'utf8'));
    for (const [id, list] of Object.entries(data.boards || {})) {
      boards.set(id, Array.isArray(list) ? list : []);
    }
  } catch (e) {
    console.warn('leaderboard load failed, starting empty:', e.message);
  }
}

let saveTimer = null;
function saveBoards() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await mkdir(DATA_DIR, { recursive: true });
      const data = { v: 1, boards: Object.fromEntries(boards) };
      await writeFile(BOARD_FILE, JSON.stringify(data));
    } catch (e) {
      console.warn('leaderboard save failed:', e.message);
    }
  }, 250);
}

function insertEntry(boardId, entry) {
  const list = boards.get(boardId) || [];
  // idempotent by sessionId: a resubmission replaces, never duplicates
  const idx = list.findIndex((e) => e.sessionId === entry.sessionId);
  if (idx >= 0) list.splice(idx, 1);
  list.push(entry);
  // Board entries store score as a plain number; compareResults expects the
  // rules-side result shape ({ status, score: { total }, invalid, ... }).
  const asResult = (e) => ({
    status: e.status, score: { total: e.score },
    invalid: e.invalid, elapsedMs: e.elapsedMs, sessionId: e.sessionId,
  });
  list.sort((a, b) => compareResults(asResult(a), asResult(b)));
  const rank = list.indexOf(entry) + 1;
  boards.set(boardId, list.slice(0, 200));
  saveBoards();
  return rank;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': MIME['.json'], 'access-control-allow-origin': '*' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_CAP) {
        reject(new Error('body-too-large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const utcDay = (now) => new Date(now).toISOString().slice(0, 10);

// Board id from a submitted envelope; practice is labelled casual.
function boardFor(envelope) {
  const id = envelope.init?.id || '';
  if (/^daily-\d{4}-\d{2}-\d{2}$/.test(id)) return id;
  if (envelope.init?.mode === 'journey') return 'journey';
  if (envelope.init?.mode === 'challenge' && CHALLENGES.some((c) => c.id === id)) return id;
  return 'practice-casual';
}

// Regenerate the authoritative def for ranked content ids (daily, journey,
// challenge). Returns null for casual content, which needs no check.
function expectedDefFor(id) {
  try {
    if (/^daily-\d{4}-\d{2}-\d{2}$/.test(id)) return dailyForDate(new Date(id.slice(6) + 'T00:00:00Z'));
    const j = /^journey-(\d+)$/.exec(id);
    if (j) {
      const n = Number(j[1]);
      if (n >= 1 && n <= 40) return journeyStage(n);
      return false; // unknown journey page: reject
    }
    if (CHALLENGES.some((c) => c.id === id)) return challengeDef(id);
    return null;
  } catch {
    return false; // generator failed: reject rather than trust the claim
  }
}

// The submitted initial state must match the authoritative content for its
// id, otherwise anyone could top a ranked board with a custom trivial grid.
function contentMatches(init, expected) {
  const shape = (d) => JSON.stringify({
    seed: d.seed, mode: d.mode, rows: d.rows, cols: d.cols,
    cells: d.cells,
    entries: (d.entries || []).map((e) => [e.dir, e.row, e.col, e.len, e.number, e.cells]),
    limits: d.limits || {},
    par: { timeMs: d.par?.timeMs ?? null },
    mult: d.mult ?? 1,
  });
  return !!init && !!expected && shape(init) === shape(expected);
}

function handleScore(body, res) {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return send(res, 400, { error: 'bad-json' });
  }
  const envelope = payload?.envelope;
  const summary = payload?.result || {};
  if (!envelope || envelope.schema !== 1) return send(res, 400, { error: 'bad-envelope' });
  if (envelope.build !== RULES_VERSION) return send(res, 409, { error: 'stale-version' });

  const name = String(summary.name || 'Guest').slice(0, 24) || 'Guest';
  const sessionId = String(summary.sessionId || '').slice(0, 64);
  if (!sessionId) return send(res, 400, { error: 'missing-session' });

  // Authoritative validation: replay the ordered command log.
  const check = replay(envelope);
  if (!check.ok) return send(res, 422, { error: `replay-failed:${check.error}` });
  const final = check.final;

  // The claimed score must match the recomputed authoritative score.
  const claimed = Number(summary.score);
  if (!Number.isFinite(claimed)) return send(res, 400, { error: 'missing-score' });
  if (claimed !== final.score.total) {
    return send(res, 422, { error: 'score-mismatch', expected: final.score.total });
  }
  if (summary.status && summary.status !== final.status) {
    return send(res, 422, { error: 'status-mismatch', expected: final.status });
  }

  const boardId = boardFor(envelope);
  if (boardId !== 'practice-casual') {
    const expected = expectedDefFor(envelope.init?.id || '');
    if (!expected || !contentMatches(envelope.init, expected)) {
      return send(res, 422, { error: 'content-mismatch' });
    }
  }
  const entry = {
    name,
    score: final.score.total,
    status: final.status,
    elapsedMs: final.elapsedMs,
    seed: envelope.seed ?? envelope.init?.seed ?? null,
    contentV: envelope.contentV ?? null,
    assists: final.checksUsed + final.revealsUsed,
    durationMs: final.elapsedMs,
    invalid: final.invalid,
    sessionId,
    at: Date.now(),
  };
  const rank = insertEntry(boardId, entry);
  return send(res, 200, { ok: true, board: boardId, rank, finalHash: check.finalHash });
}

function handleLeaderboard(url, res) {
  const boardId = url.searchParams.get('board');
  if (!boardId) return send(res, 400, { error: 'missing-board' });
  const list = (boards.get(boardId) || []).slice(0, BOARD_TOP).map((e) => ({
    name: e.name,
    score: e.score,
    status: e.status,
    elapsedMs: e.elapsedMs,
    seed: e.seed,
    contentV: e.contentV,
    assists: e.assists,
    durationMs: e.durationMs,
  }));
  return send(res, 200, { board: boardId, entries: list });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

loadBoards();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  try {
    if (p === '/api/v1/time' && req.method === 'GET') {
      const now = Date.now();
      return send(res, 200, { now, utcDay: utcDay(now) });
    }
    if (p === '/api/v1/score' && req.method === 'POST') {
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 413, { error: 'body-too-large' });
      }
      return handleScore(body, res);
    }
    if (p === '/api/v1/leaderboard' && req.method === 'GET') {
      return handleLeaderboard(url, res);
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'not-found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, { error: 'method-not-allowed' });
    }

    // Static files with path traversal protection.
    const rel = p === '/' ? 'index.html' : normalize(p).replace(/^([/\\])+/, '');
    if (rel.split(/[\\/]/).some(part => part.startsWith('.') || ['data', 'node_modules', 'tests'].includes(part))) return send(res, 403, { error: 'forbidden' });
    const file = join(ROOT, rel);
    if (file !== ROOT && !file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
      return send(res, 403, { error: 'forbidden' });
    }
    const buf = await readFile(file);
    const type = MIME[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
    return res.end(buf);
  } catch (e) {
    if (e?.code === 'ENOENT' || e?.code === 'EISDIR') return send(res, 404, { error: 'not-found' });
    console.error(e);
    if (!res.headersSent) return send(res, 500, { error: 'internal' });
    res.end();
  }
});

server.on('error', (e) => {
  console.error(`server error: ${e.message}`);
  process.exitCode = 1;
});

server.listen(PORT, () => {
  console.log(`Crossword Journey server: http://localhost:${PORT}`);
});
