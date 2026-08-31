// Crossword Journey — deterministic rules engine.
// Pure module: no DOM, no rendering, no I/O. Same file runs in browser and Node.
//
// Rules contract:
//  - Grid is `rows` x `cols`; each cell is null (void) or holds a solution
//    letter. Entries are across/down runs with authored clues.
//  - Legal actions: enter a letter, clear a letter, check a cell/word/grid,
//    reveal a cell (hint), give up. Selection lives in the UI layer, never
//    in rules state.
//  - Win: every non-void cell holds its solution letter ("grid-complete").
//  - Loss: configured time / mistake limits exceeded, or the player gave up.
//  - Checks confirm correct letters and flag wrong ones; reveals write the
//    solution letter. Both are tracked as assist usage with a small score
//    cost; accessibility aids (timing assist) are never score-punished but
//    make a round unranked.
// Determinism: state changes happen only through applyCommand(); identical
// (version, seed, command list) always yields identical state hashes.

export const RULES_VERSION = 1;

export const SCORE = {
  LETTER: 10,             // first time a cell becomes correct
  WORD_BASE: 20,
  WORD_PER_LEN: 5,        // bonus per letter of a completed word
  STREAK_STEP: 15,        // added per consecutive word completion
  GRID_COMPLETE: 150,
  CHECK_COST: -15,
  REVEAL_COST: -30,
  TIME_BONUS_PER_SEC: 2,  // under par
  TIME_BONUS_CAP: 400,
};

// Cell flag bits (stored on each cell; serializable integers).
export const FLAG = {
  CONFIRMED: 1,  // check proved this letter correct (locked)
  WRONG: 2,      // last check found this letter wrong
  REVEALED: 4,   // hint wrote this letter (locked)
  AWARDED: 8,    // letter points already granted for this cell
};

// ---------------------------------------------------------------------------
// Seeded random streams (rules / decoration / audiovisual stay separate)
// ---------------------------------------------------------------------------

export function hashSeed(str) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createStream(seed) {
  // mulberry32
  let s = (typeof seed === 'string' ? hashSeed(seed) : seed >>> 0) || 0x9e3779b9;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // inclusive
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    getState: () => s,
  };
}

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

// def: { id, seed, mode, rows, cols,
//        cells: [ 'A' | null, ... ]        solution letters (row-major),
//        entries: [{ id, dir:'across'|'down', row, col, len, number, clue,
//                    cells: [indices] }],
//        limits:{ timeMs, checks, mistakes }, par:{ timeMs }, mult,
//        mechanics: [], assists: {} }
export function createGame(def) {
  if (!def || !Array.isArray(def.cells) || !def.rows || !def.cols) {
    throw new Error('createGame: def needs rows, cols and cells');
  }
  if (def.cells.length !== def.rows * def.cols) {
    throw new Error('createGame: cells must fill rows x cols');
  }
  const cells = def.cells.map((sol) =>
    sol === null ? null : { sol, cur: '', flag: 0 });
  let filledTotal = 0;
  for (const c of cells) if (c) filledTotal++;
  return {
    v: RULES_VERSION,
    seed: String(def.seed),
    contentId: def.id || null,
    mode: def.mode || 'practice',
    rows: def.rows,
    cols: def.cols,
    cells,
    entries: def.entries.map((e) => ({ ...e, cells: e.cells.slice() })),
    tick: 0,                 // monotonically increasing command tick
    nextCmdId: 1,            // action identifiers prevent double commits
    status: 'active',        // active | won | lost
    terminalReason: null,    // grid-complete | time-limit | mistake-limit | gave-up
    elapsedMs: 0,
    typed: 0,                // letter-entry actions
    invalid: 0,              // rejected commands
    checksUsed: 0,
    revealsUsed: 0,
    mistakes: 0,             // wrong letters found by checks (cumulative)
    filledCorrect: 0,
    filledTotal,
    streak: 0,               // consecutive word completions
    bestStreak: 0,
    wordsDone: 0,
    completedWords: def.entries.map(() => false),
    score: { letters: 0, words: 0, streak: 0, time: 0, assists: 0, complete: 0, total: 0 },
    limits: {
      timeMs: def.limits?.timeMs ?? null,
      checks: def.limits?.checks ?? null,
      mistakes: def.limits?.mistakes ?? null,
    },
    par: { timeMs: def.par?.timeMs ?? null },
    mult: typeof def.mult === 'number' ? def.mult : 1,
    mechanics: Array.isArray(def.mechanics) ? def.mechanics.slice() : [],
  };
}

// ---------------------------------------------------------------------------
// Legality queries (shared by play, hints and tutorials)
// ---------------------------------------------------------------------------

export function cellAt(state, row, col) {
  if (row < 0 || col < 0 || row >= state.rows || col >= state.cols) return null;
  return state.cells[row * state.cols + col];
}

export function indexOf(state, row, col) { return row * state.cols + col; }
export function rowOf(state, i) { return Math.floor(i / state.cols); }
export function colOf(state, i) { return i % state.cols; }

export function isLocked(cell) {
  return !!cell && (cell.flag & (FLAG.CONFIRMED | FLAG.REVEALED)) !== 0;
}

export function canType(state, i) {
  const c = state.cells[i];
  return !!c && !isLocked(c);
}

export function emptyCells(state) {
  const out = [];
  for (let i = 0; i < state.cells.length; i++) {
    const c = state.cells[i];
    if (c && c.cur === '') out.push(i);
  }
  return out;
}

export function wrongCells(state) {
  const out = [];
  for (let i = 0; i < state.cells.length; i++) {
    const c = state.cells[i];
    if (c && c.cur !== '' && c.cur !== c.sol) out.push(i);
  }
  return out;
}

export function entryComplete(state, ei) {
  return state.entries[ei].cells.every((i) => state.cells[i].cur === state.cells[i].sol);
}

// Hint uses the same data the player sees: pick a fixable cell, preferring
// the given entry, then the first empty cell anywhere.
export function getHint(state, entryIdx = null) {
  const pickFrom = (cells) => {
    let firstWrong = -1;
    for (const i of cells) {
      const c = state.cells[i];
      if (c.cur === '') return i;
      if (firstWrong < 0 && c.cur !== c.sol) firstWrong = i;
    }
    return firstWrong;
  };
  if (entryIdx !== null && entryIdx !== undefined) {
    const hit = pickFrom(state.entries[entryIdx].cells);
    if (hit >= 0) return { cell: hit, entry: entryIdx };
  }
  for (let e = 0; e < state.entries.length; e++) {
    const hit = pickFrom(state.entries[e].cells);
    if (hit >= 0) return { cell: hit, entry: e };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function totalScore(s) {
  const sc = s.score;
  sc.total = sc.letters + sc.words + sc.streak + sc.time + sc.assists + sc.complete;
}

function refreshWordCompletions(state, events, touched) {
  for (let e = 0; e < state.entries.length; e++) {
    if (state.completedWords[e]) continue;
    if (touched && !state.entries[e].cells.some((i) => touched.has(i))) continue;
    if (entryComplete(state, e)) {
      state.completedWords[e] = true;
      state.wordsDone++;
      state.streak++;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
      const len = state.entries[e].len;
      state.score.words += Math.round((SCORE.WORD_BASE + SCORE.WORD_PER_LEN * len) * state.mult);
      state.score.streak += Math.round(SCORE.STREAK_STEP * state.streak * state.mult);
      events.push({ type: 'word', entry: e, streak: state.streak, len });
    }
  }
}

function breakStreak(state) {
  state.streak = 0;
}

function finishIfComplete(state, events) {
  if (state.status !== 'active') return;
  if (state.filledCorrect === state.filledTotal) {
    state.status = 'won';
    state.terminalReason = 'grid-complete';
    state.score.complete = Math.round(SCORE.GRID_COMPLETE * state.mult);
    if (state.par.timeMs && state.elapsedMs < state.par.timeMs) {
      const secs = Math.floor((state.par.timeMs - state.elapsedMs) / 1000);
      state.score.time = Math.min(SCORE.TIME_BONUS_CAP, secs * SCORE.TIME_BONUS_PER_SEC);
    }
    events.push({ type: 'win', reason: 'grid-complete' });
    return;
  }
  if (state.limits.timeMs !== null && state.elapsedMs >= state.limits.timeMs) {
    state.status = 'lost';
    state.terminalReason = 'time-limit';
    events.push({ type: 'lose', reason: 'time-limit' });
    return;
  }
  if (state.limits.mistakes !== null && state.mistakes >= state.limits.mistakes) {
    state.status = 'lost';
    state.terminalReason = 'mistake-limit';
    events.push({ type: 'lose', reason: 'mistake-limit' });
  }
}

// Every state change flows through here. Returns { state, events } or
// { error, state } — on error the returned state is unchanged except for the
// invalid counter, keeping the attempt inspectable.
export function applyCommand(prev, cmd) {
  const state = deserialize(serialize(prev)); // immutable snapshots in, out
  const events = [];
  if (state.status !== 'active') return { error: 'not-active', state: prev };
  if (typeof cmd.id !== 'number' || cmd.id !== state.nextCmdId) {
    return { error: (typeof cmd.id === 'number' && cmd.id < state.nextCmdId) ? 'duplicate-id' : 'out-of-order', state: prev };
  }
  if (typeof cmd.at === 'number' && cmd.at > state.elapsedMs) state.elapsedMs = Math.floor(cmd.at);
  state.nextCmdId++;
  state.tick++;

  const fail = (reason) => {
    state.invalid++;
    totalScore(state);
    return { error: reason, state, events: [{ type: 'invalid', reason }] };
  };

  switch (cmd.type) {
    case 'letter': {
      const i = cmd.cell;
      const ch = String(cmd.ch || '').toUpperCase();
      if (!Number.isInteger(i) || i < 0 || i >= state.cells.length || !state.cells[i]) {
        return fail('bad-cell');
      }
      if (!/^[A-Z]$/.test(ch)) return fail('bad-letter');
      const cell = state.cells[i];
      if (isLocked(cell)) return fail('locked-cell');
      const wasCorrect = cell.cur !== '' && cell.cur === cell.sol;
      cell.cur = ch;
      cell.flag &= ~FLAG.WRONG;
      state.typed++;
      const correct = ch === cell.sol;
      if (correct && !wasCorrect) state.filledCorrect++;
      if (!correct && wasCorrect) state.filledCorrect--;
      if (correct && (cell.flag & FLAG.AWARDED) === 0) {
        cell.flag |= FLAG.AWARDED;
        state.score.letters += Math.round(SCORE.LETTER * state.mult);
      }
      events.push({ type: 'letter', cell: i, ch, correct });
      refreshWordCompletions(state, events, new Set([i]));
      finishIfComplete(state, events);
      break;
    }
    case 'clear': {
      const i = cmd.cell;
      if (!Number.isInteger(i) || i < 0 || i >= state.cells.length || !state.cells[i]) {
        return fail('bad-cell');
      }
      const cell = state.cells[i];
      if (isLocked(cell)) return fail('locked-cell');
      if (cell.cur === '') return fail('nothing-to-clear');
      if (cell.cur === cell.sol) state.filledCorrect--;
      cell.cur = '';
      cell.flag &= ~FLAG.WRONG;
      events.push({ type: 'clear', cell: i });
      finishIfComplete(state, events);
      break;
    }
    case 'check': {
      if (state.limits.checks !== null && state.checksUsed >= state.limits.checks) {
        return fail('check-limit');
      }
      const scope = cmd.scope || 'grid';
      let targets = [];
      if (scope === 'cell') {
        const i = cmd.cell;
        if (!Number.isInteger(i) || !state.cells[i]) return fail('bad-cell');
        targets = [i];
      } else if (scope === 'word') {
        const e = cmd.entry;
        if (!Number.isInteger(e) || !state.entries[e]) return fail('bad-word');
        targets = state.entries[e].cells.slice();
      } else if (scope === 'grid') {
        for (let i = 0; i < state.cells.length; i++) if (state.cells[i]) targets.push(i);
      } else {
        return fail('bad-scope');
      }
      state.checksUsed++;
      state.score.assists += SCORE.CHECK_COST;
      const wrong = [];
      const confirmed = [];
      for (const i of targets) {
        const cell = state.cells[i];
        if (cell.cur === '') continue;
        if (cell.cur === cell.sol) {
          if ((cell.flag & FLAG.CONFIRMED) === 0 && (cell.flag & FLAG.REVEALED) === 0) {
            cell.flag |= FLAG.CONFIRMED;
            confirmed.push(i);
          }
        } else {
          if ((cell.flag & FLAG.WRONG) === 0) state.mistakes++;
          cell.flag |= FLAG.WRONG;
          wrong.push(i);
        }
      }
      if (wrong.length > 0) breakStreak(state);
      events.push({ type: 'check', scope, wrong, confirmed, checksUsed: state.checksUsed });
      finishIfComplete(state, events);
      break;
    }
    case 'reveal': {
      const i = cmd.cell;
      if (!Number.isInteger(i) || i < 0 || i >= state.cells.length || !state.cells[i]) {
        return fail('bad-cell');
      }
      const cell = state.cells[i];
      if (isLocked(cell)) return fail('locked-cell');
      if (cell.cur === cell.sol && cell.cur !== '') return fail('already-correct');
      // Reaching here, cur is either empty or wrong (wrong cells were never
      // counted in filledCorrect), so writing the solution always adds one.
      cell.cur = cell.sol;
      cell.flag |= FLAG.REVEALED;
      cell.flag &= ~FLAG.WRONG;
      state.filledCorrect++;
      state.revealsUsed++;
      state.score.assists += SCORE.REVEAL_COST;
      breakStreak(state);
      events.push({ type: 'reveal', cell: i, ch: cell.sol });
      refreshWordCompletions(state, events, new Set([i]));
      finishIfComplete(state, events);
      break;
    }
    case 'giveUp': {
      state.status = 'lost';
      state.terminalReason = 'gave-up';
      events.push({ type: 'lose', reason: 'gave-up' });
      break;
    }
    default:
      return fail('unknown-command');
  }

  totalScore(state);
  return { state, events };
}

// ---------------------------------------------------------------------------
// Serialization / hashing / replay
// ---------------------------------------------------------------------------

export function serialize(state) {
  return JSON.parse(JSON.stringify(state));
}

export function deserialize(data) {
  return JSON.parse(JSON.stringify(data));
}

export function hashState(state) {
  // Canonical hash over the full logical state.
  const s = JSON.stringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// envelope: { schema, build, contentV, seed, init: <createGame def>,
//             commands: [...], checkpoints?: [{after, hash}] }
export function replay(envelope) {
  if (!envelope || envelope.schema !== 1) return { ok: false, error: 'bad-schema' };
  if (envelope.build !== RULES_VERSION) return { ok: false, error: 'stale-version' };
  let state;
  try {
    state = createGame(envelope.init);
  } catch (e) {
    return { ok: false, error: `init-failed:${e.message}` };
  }
  const checkpoints = [{ after: 0, hash: hashState(state) }];
  const cmds = Array.isArray(envelope.commands) ? envelope.commands : [];
  for (const cmd of cmds) {
    const r = applyCommand(state, cmd);
    if (r.error) return { ok: false, error: `command-${cmd.id}:${r.error}` };
    state = r.state;
    if (cmd.id % 5 === 0 || state.status !== 'active') {
      checkpoints.push({ after: cmd.id, hash: hashState(state) });
    }
  }
  return { ok: true, final: state, finalHash: hashState(state), checkpoints };
}

// ---------------------------------------------------------------------------
// Leaderboard ordering (ties: completion, fewer invalid, lower elapsed, id)
// ---------------------------------------------------------------------------

export function compareResults(a, b) {
  const complete = (r) => (r.status === 'won' ? 1 : 0);
  if (complete(a) !== complete(b)) return complete(b) - complete(a);
  if (a.score.total !== b.score.total) return b.score.total - a.score.total;
  if (a.invalid !== b.invalid) return a.invalid - b.invalid;
  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
  return String(a.sessionId).localeCompare(String(b.sessionId));
}
