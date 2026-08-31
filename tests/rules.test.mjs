// Crossword Journey — rules engine unit tests.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as R from '../js/rules.js';

// --- Fixtures ----------------------------------------------------------------

// Two across words, no crossings: "ACE" / "DOG".
const DEF_1x = {
  rows: 2, cols: 3,
  cells: ['A', 'C', 'E', 'D', 'O', 'G'],
  entries: [
    { id: 0, dir: 'across', row: 0, col: 0, len: 3, number: 1, clue: 'Top card', cells: [0, 1, 2] },
    { id: 1, dir: 'across', row: 1, col: 0, len: 3, number: 2, clue: 'Loyal barker', cells: [3, 4, 5] },
  ],
};

// One across + one down crossing at cell 0: "ACE" across, "ARC" down.
const DEF_X = {
  rows: 3, cols: 3,
  cells: ['A', 'C', 'E', 'R', null, null, 'C', null, null],
  entries: [
    { id: 0, dir: 'across', row: 0, col: 0, len: 3, number: 1, clue: 'Top card', cells: [0, 1, 2] },
    { id: 1, dir: 'down', row: 0, col: 0, len: 3, number: 1, clue: 'Curved path', cells: [0, 3, 6] },
  ],
};

const game = (def = DEF_1x, extra = {}) => R.createGame({ ...def, ...extra });
const run = (state, cmds) => {
  let s = state;
  const out = [];
  for (const cmd of cmds) {
    const r = R.applyCommand(s, cmd);
    out.push(r);
    s = r.state;
  }
  return { state: s, results: out };
};
// Fill a def's solution through letter commands (ids from state.nextCmdId).
const solveCommands = (def, skip = []) => {
  const skipSet = new Set(skip);
  const cmds = [];
  let id = 1;
  def.cells.forEach((sol, i) => {
    if (sol === null || skipSet.has(i)) return;
    cmds.push({ id: id++, type: 'letter', cell: i, ch: sol });
  });
  return cmds;
};

// --- Streams -----------------------------------------------------------------

test('createStream is deterministic and bounded', () => {
  const a = R.createStream('abc');
  const b = R.createStream('abc');
  for (let i = 0; i < 100; i++) {
    const v = a.next();
    assert.ok(v >= 0 && v < 1);
    assert.equal(v, b.next());
  }
  assert.notEqual(R.createStream('abc').next(), R.createStream('abd').next());
  const s = R.createStream(42);
  for (let i = 0; i < 50; i++) {
    const n = s.int(3, 7);
    assert.ok(n >= 3 && n <= 7 && Number.isInteger(n));
  }
  const arr = [1, 2, 3, 4, 5];
  const shuffled = R.createStream('sh').shuffle(arr.slice());
  assert.deepEqual(shuffled.slice().sort(), arr);
});

test('hashSeed is stable', () => {
  assert.equal(R.hashSeed('journey'), R.hashSeed('journey'));
  assert.notEqual(R.hashSeed('a'), R.hashSeed('b'));
});

// --- Game creation ------------------------------------------------------------

test('createGame builds a clean active state', () => {
  const g = game();
  assert.equal(g.status, 'active');
  assert.equal(g.terminalReason, null);
  assert.equal(g.nextCmdId, 1);
  assert.equal(g.tick, 0);
  assert.equal(g.filledTotal, 6);
  assert.equal(g.filledCorrect, 0);
  assert.equal(g.cells.length, 6);
  assert.equal(g.cells[0].sol, 'A');
  assert.equal(g.completedWords.length, 2);
});

test('createGame rejects malformed defs', () => {
  assert.throws(() => R.createGame(null));
  assert.throws(() => R.createGame({ rows: 2, cols: 2 }));
  assert.throws(() => R.createGame({ rows: 2, cols: 2, cells: ['A'] }));
});

test('index helpers round-trip', () => {
  const g = game(DEF_X);
  assert.equal(R.indexOf(g, 1, 2), 5);
  assert.equal(R.rowOf(g, 5), 1);
  assert.equal(R.colOf(g, 5), 2);
  assert.equal(R.cellAt(g, 0, 0).sol, 'A');
  assert.equal(R.cellAt(g, 1, 1), null); // void cell
  assert.equal(R.cellAt(g, -1, 0), null);
  assert.equal(R.cellAt(g, 99, 0), null);
});

// --- Letter command -----------------------------------------------------------

test('letter: correct letter scores once and counts filled', () => {
  const { state, results } = run(game(), [{ id: 1, type: 'letter', cell: 0, ch: 'A' }]);
  const r = results[0];
  assert.ok(!r.error);
  assert.equal(r.state.cells[0].cur, 'A');
  assert.equal(r.state.score.letters, R.SCORE.LETTER);
  assert.equal(r.state.score.total, R.SCORE.LETTER);
  assert.equal(r.state.filledCorrect, 1);
  assert.equal(r.state.typed, 1);
  assert.equal(r.events[0].type, 'letter');
  // retyping the same correct letter does not double-award
  const again = R.applyCommand(r.state, { id: 2, type: 'letter', cell: 0, ch: 'B' });
  assert.equal(again.state.score.letters, R.SCORE.LETTER);
  assert.equal(again.state.filledCorrect, 0);
  const back = R.applyCommand(again.state, { id: 3, type: 'letter', cell: 0, ch: 'A' });
  assert.equal(back.state.score.letters, R.SCORE.LETTER); // AWARDED flag kept
  assert.equal(back.state.filledCorrect, 1);
});

test('letter: lowercase input is normalized', () => {
  const r = R.applyCommand(game(), { id: 1, type: 'letter', cell: 0, ch: 'a' });
  assert.ok(!r.error);
  assert.equal(r.state.cells[0].cur, 'A');
});

test('letter: wrong letter does not score', () => {
  const r = R.applyCommand(game(), { id: 1, type: 'letter', cell: 0, ch: 'Z' });
  assert.ok(!r.error);
  assert.equal(r.state.filledCorrect, 0);
  assert.equal(r.state.score.letters, 0);
});

test('letter: bad-cell and bad-letter reasons', () => {
  assert.equal(R.applyCommand(game(), { id: 1, type: 'letter', cell: 99, ch: 'A' }).error, 'bad-cell');
  assert.equal(R.applyCommand(game(DEF_X), { id: 1, type: 'letter', cell: 4, ch: 'A' }).error, 'bad-cell'); // void
  assert.equal(R.applyCommand(game(), { id: 1, type: 'letter', cell: -1, ch: 'A' }).error, 'bad-cell');
  assert.equal(R.applyCommand(game(), { id: 1, type: 'letter', cell: 1.5, ch: 'A' }).error, 'bad-cell');
  assert.equal(R.applyCommand(game(), { id: 1, type: 'letter', cell: 0, ch: '1' }).error, 'bad-letter');
  assert.equal(R.applyCommand(game(), { id: 1, type: 'letter', cell: 0, ch: 'AB' }).error, 'bad-letter');
  assert.equal(R.applyCommand(game(), { id: 1, type: 'letter', cell: 0 }).error, 'bad-letter');
});

// --- Clear command ------------------------------------------------------------

test('clear: removes a letter and uncounts correct fills', () => {
  const { state } = run(game(), [{ id: 1, type: 'letter', cell: 0, ch: 'A' }]);
  const r = R.applyCommand(state, { id: 2, type: 'clear', cell: 0 });
  assert.ok(!r.error);
  assert.equal(r.state.cells[0].cur, '');
  assert.equal(r.state.filledCorrect, 0);
});

test('clear: nothing-to-clear and locked-cell', () => {
  assert.equal(R.applyCommand(game(), { id: 1, type: 'clear', cell: 0 }).error, 'nothing-to-clear');
  assert.equal(R.applyCommand(game(), { id: 1, type: 'clear', cell: 42 }).error, 'bad-cell');
  // reveal locks the cell
  const { state } = run(game(), [{ id: 1, type: 'reveal', cell: 0 }]);
  assert.equal(R.applyCommand(state, { id: 2, type: 'clear', cell: 0 }).error, 'locked-cell');
  assert.equal(R.applyCommand(state, { id: 2, type: 'letter', cell: 0, ch: 'A' }).error, 'locked-cell');
});

// --- Check command ------------------------------------------------------------

test('check grid: confirms correct, flags wrong, costs points', () => {
  const { state } = run(game(), [
    { id: 1, type: 'letter', cell: 0, ch: 'A' }, // correct
    { id: 2, type: 'letter', cell: 1, ch: 'Z' }, // wrong
  ]);
  const r = R.applyCommand(state, { id: 3, type: 'check', scope: 'grid' });
  assert.ok(!r.error);
  assert.equal(r.state.cells[0].flag & R.FLAG.CONFIRMED, R.FLAG.CONFIRMED);
  assert.equal(r.state.cells[1].flag & R.FLAG.WRONG, R.FLAG.WRONG);
  assert.equal(r.state.checksUsed, 1);
  assert.equal(r.state.mistakes, 1);
  assert.equal(r.state.score.assists, R.SCORE.CHECK_COST);
  // confirmed cell is locked now
  assert.equal(R.applyCommand(r.state, { id: 4, type: 'letter', cell: 0, ch: 'B' }).error, 'locked-cell');
  // repeated checks do not double-count mistakes
  const again = R.applyCommand(r.state, { id: 4, type: 'check', scope: 'grid' });
  assert.equal(again.state.mistakes, 1);
});

test('check: cell and word scopes', () => {
  const { state } = run(game(), [{ id: 1, type: 'letter', cell: 0, ch: 'A' }]);
  const c = R.applyCommand(state, { id: 2, type: 'check', scope: 'cell', cell: 0 });
  assert.ok(!c.error);
  assert.equal(c.state.cells[0].flag & R.FLAG.CONFIRMED, R.FLAG.CONFIRMED);
  const w = R.applyCommand(c.state, { id: 3, type: 'check', scope: 'word', entry: 1 });
  assert.ok(!w.error);
  assert.equal(w.state.checksUsed, 2);
});

test('check: bad-scope, bad-word, bad-cell, check-limit', () => {
  assert.equal(R.applyCommand(game(), { id: 1, type: 'check', scope: 'nope' }).error, 'bad-scope');
  assert.equal(R.applyCommand(game(), { id: 1, type: 'check', scope: 'word', entry: 9 }).error, 'bad-word');
  assert.equal(R.applyCommand(game(), { id: 1, type: 'check', scope: 'cell', cell: 99 }).error, 'bad-cell');
  const g = game(DEF_1x, { limits: { checks: 1 } });
  const { state } = run(g, [{ id: 1, type: 'check', scope: 'grid' }]);
  assert.equal(R.applyCommand(state, { id: 2, type: 'check', scope: 'grid' }).error, 'check-limit');
});

// --- Reveal command -----------------------------------------------------------

test('reveal: writes solution, locks cell, costs points, breaks streak', () => {
  const { state } = run(game(), [
    { id: 1, type: 'letter', cell: 0, ch: 'A' },
    { id: 2, type: 'letter', cell: 1, ch: 'C' },
    { id: 3, type: 'letter', cell: 2, ch: 'E' }, // word 0 complete, streak 1
  ]);
  assert.equal(state.streak, 1);
  const r = R.applyCommand(state, { id: 4, type: 'reveal', cell: 3 });
  assert.ok(!r.error);
  assert.equal(r.state.cells[3].cur, 'D');
  assert.equal(r.state.cells[3].flag & R.FLAG.REVEALED, R.FLAG.REVEALED);
  assert.equal(r.state.revealsUsed, 1);
  assert.equal(r.state.score.assists, R.SCORE.REVEAL_COST);
  assert.equal(r.state.streak, 0);
  assert.equal(r.state.filledCorrect, 4);
});

test('reveal: already-correct, locked-cell, bad-cell', () => {
  const { state } = run(game(), [{ id: 1, type: 'letter', cell: 0, ch: 'A' }]);
  assert.equal(R.applyCommand(state, { id: 2, type: 'reveal', cell: 0 }).error, 'already-correct');
  assert.equal(R.applyCommand(game(), { id: 1, type: 'reveal', cell: 99 }).error, 'bad-cell');
  const { state: s2 } = run(game(), [{ id: 1, type: 'reveal', cell: 0 }]);
  assert.equal(R.applyCommand(s2, { id: 2, type: 'reveal', cell: 0 }).error, 'locked-cell');
});

// --- Give up / terminal states -------------------------------------------------

test('giveUp loses with gave-up reason', () => {
  const r = R.applyCommand(game(), { id: 1, type: 'giveUp' });
  assert.ok(!r.error);
  assert.equal(r.state.status, 'lost');
  assert.equal(r.state.terminalReason, 'gave-up');
  assert.equal(r.events[0].type, 'lose');
});

test('commands after terminal state are not-active', () => {
  const { state } = run(game(), [{ id: 1, type: 'giveUp' }]);
  assert.equal(R.applyCommand(state, { id: 2, type: 'letter', cell: 1, ch: 'C' }).error, 'not-active');
});

test('win: grid-complete awards completion and time bonus under par', () => {
  const def = { ...DEF_1x, par: { timeMs: 60000 } };
  const { state } = run(game(def), solveCommands(DEF_1x));
  assert.equal(state.status, 'won');
  assert.equal(state.terminalReason, 'grid-complete');
  assert.equal(state.score.complete, R.SCORE.GRID_COMPLETE);
  assert.ok(state.score.time > 0);
  assert.ok(state.score.time <= R.SCORE.TIME_BONUS_CAP);
  const expected =
    6 * R.SCORE.LETTER +
    2 * (R.SCORE.WORD_BASE + R.SCORE.WORD_PER_LEN * 3) +
    (R.SCORE.STREAK_STEP * 1 + R.SCORE.STREAK_STEP * 2) +
    state.score.time + R.SCORE.GRID_COMPLETE;
  assert.equal(state.score.total, expected);
});

test('win: no time bonus at or over par', () => {
  const def = { ...DEF_1x, par: { timeMs: 1000 } };
  const cmds = solveCommands(DEF_1x);
  cmds[cmds.length - 1].at = 5000;
  const { state } = run(game(def), cmds);
  assert.equal(state.status, 'won');
  assert.equal(state.score.time, 0);
});

test('loss: time-limit via elapsed timestamps', () => {
  const def = { ...DEF_1x, limits: { timeMs: 1000 } };
  const r = R.applyCommand(game(def), { id: 1, type: 'letter', cell: 0, ch: 'A', at: 2000 });
  assert.ok(!r.error);
  assert.equal(r.state.status, 'lost');
  assert.equal(r.state.terminalReason, 'time-limit');
});

test('loss: mistake-limit via checks', () => {
  const def = { ...DEF_1x, limits: { mistakes: 1 } };
  const { state } = run(game(def), [{ id: 1, type: 'letter', cell: 0, ch: 'Z' }]);
  const r = R.applyCommand(state, { id: 2, type: 'check', scope: 'grid' });
  assert.equal(r.state.status, 'lost');
  assert.equal(r.state.terminalReason, 'mistake-limit');
});

// --- Command id discipline -----------------------------------------------------

test('duplicate and out-of-order ids are rejected idempotently', () => {
  const g = game();
  const ok = R.applyCommand(g, { id: 1, type: 'letter', cell: 0, ch: 'A' });
  assert.equal(R.applyCommand(ok.state, { id: 1, type: 'letter', cell: 1, ch: 'C' }).error, 'duplicate-id');
  assert.equal(R.applyCommand(ok.state, { id: 5, type: 'letter', cell: 1, ch: 'C' }).error, 'out-of-order');
  assert.equal(R.applyCommand(ok.state, { id: 'x', type: 'letter', cell: 1, ch: 'C' }).error, 'out-of-order');
  // failed commands still consume their id (invalid counter incremented)
  const bad = R.applyCommand(ok.state, { id: 2, type: 'letter', cell: 99, ch: 'A' });
  assert.equal(bad.error, 'bad-cell');
  assert.equal(bad.state.invalid, 1);
  assert.equal(bad.state.nextCmdId, 3);
});

test('unknown-command is rejected', () => {
  assert.equal(R.applyCommand(game(), { id: 1, type: 'teleport' }).error, 'unknown-command');
});

// --- Streaks and words ---------------------------------------------------------

test('streak grows per consecutive word and resets on wrong check', () => {
  const { state } = run(game(), solveCommands(DEF_1x, [4])); // all but cell 4
  // word 0 completed during fill: streak 1
  assert.equal(state.streak, 1);
  assert.equal(state.wordsDone, 1);
  // type wrong letter at 4 and check: streak breaks
  const s2 = R.applyCommand(state, { id: state.nextCmdId, type: 'letter', cell: 4, ch: 'Z' }).state;
  const s3 = R.applyCommand(s2, { id: s2.nextCmdId, type: 'check', scope: 'word', entry: 1 }).state;
  assert.equal(s3.streak, 0);
  // fix and complete: streak restarts at 1
  const s4 = R.applyCommand(s3, { id: s3.nextCmdId, type: 'letter', cell: 4, ch: 'O' }).state;
  assert.equal(s4.streak, 1);
  assert.equal(s4.status, 'won');
  assert.equal(s4.bestStreak, 1);
});

test('crossing letters complete two words with one letter', () => {
  // fill down ARC first, then across ACE: typing cell 0 once completes both.
  const cmds = [
    { id: 1, type: 'letter', cell: 0, ch: 'A' },
    { id: 2, type: 'letter', cell: 3, ch: 'R' },
    { id: 3, type: 'letter', cell: 6, ch: 'C' },
    { id: 4, type: 'letter', cell: 1, ch: 'C' },
    { id: 5, type: 'letter', cell: 2, ch: 'E' },
  ];
  const { state } = run(game(DEF_X), cmds);
  assert.equal(state.status, 'won');
  assert.equal(state.wordsDone, 2);
  assert.equal(state.filledCorrect, 5);
});

// --- Hints / legality queries --------------------------------------------------

test('getHint prefers the requested entry and fixable cells', () => {
  const g = game(DEF_X);
  const h = R.getHint(g, 1);
  assert.equal(h.entry, 1);
  assert.equal(h.cell, 0);
  const { state } = run(g, [{ id: 1, type: 'letter', cell: 0, ch: 'Z' }]);
  const h2 = R.getHint(state, 0);
  assert.equal(h2.entry, 0);
  assert.equal(h2.cell, 1); // first empty in entry 0
  const solved = run(game(DEF_X), solveCommands(DEF_X)).state;
  assert.equal(R.getHint(solved), null);
});

test('isLocked and canType respect flags', () => {
  const g = game();
  assert.ok(R.canType(g, 0));
  const { state } = run(g, [{ id: 1, type: 'reveal', cell: 0 }]);
  assert.ok(R.isLocked(state.cells[0]));
  assert.ok(!R.canType(state, 0));
  assert.ok(!R.isLocked(null));
});

// --- Serialization / hashing / replay ------------------------------------------

test('serialization round-trip preserves state and playability', () => {
  const { state } = run(game(), [{ id: 1, type: 'letter', cell: 0, ch: 'A' }]);
  const copy = R.deserialize(R.serialize(state));
  assert.deepEqual(copy, state);
  assert.equal(R.hashState(copy), R.hashState(state));
  const cont = R.applyCommand(copy, { id: 2, type: 'letter', cell: 1, ch: 'C' });
  assert.ok(!cont.error);
});

test('replay: same envelope produces identical final hash twice', () => {
  const env = { schema: 1, build: R.RULES_VERSION, contentV: 1, seed: 'def-1x', init: DEF_1x, commands: solveCommands(DEF_1x) };
  const a = R.replay(env);
  const b = R.replay(env);
  assert.ok(a.ok && b.ok);
  assert.equal(a.finalHash, b.finalHash);
  assert.equal(a.final.status, 'won');
  assert.deepEqual(a.checkpoints, b.checkpoints);
});

test('replay: rejects bad schema, stale build, broken init and bad commands', () => {
  assert.equal(R.replay(null).ok, false);
  assert.equal(R.replay({ schema: 2, build: R.RULES_VERSION }).error, 'bad-schema');
  assert.equal(R.replay({ schema: 1, build: 999, init: DEF_1x }).error, 'stale-version');
  assert.equal(R.replay({ schema: 1, build: R.RULES_VERSION, init: { rows: 1 } }).ok, false);
  const bad = { schema: 1, build: R.RULES_VERSION, init: DEF_1x, commands: [{ id: 1, type: 'letter', cell: 99, ch: 'A' }] };
  const r = R.replay(bad);
  assert.ok(!r.ok);
  assert.match(r.error, /^command-1:/);
});

test('replay: tampered commands change the final hash', () => {
  const good = solveCommands(DEF_1x);
  const env = { schema: 1, build: R.RULES_VERSION, init: DEF_1x, commands: good };
  const h1 = R.replay(env).finalHash;
  const tampered = good.map((c) => ({ ...c }));
  tampered[1].ch = 'Z';
  const r2 = R.replay({ ...env, commands: tampered });
  assert.ok(r2.ok); // legal but different path
  assert.notEqual(r2.finalHash, h1);
});

test('migration sanity: older snapshots without optional fields keep working', () => {
  const { state } = run(game(), [{ id: 1, type: 'letter', cell: 0, ch: 'A' }]);
  const legacy = R.serialize(state);
  delete legacy.mechanics;
  delete legacy.par;
  const restored = R.deserialize(legacy);
  const cont = R.applyCommand(restored, { id: 2, type: 'letter', cell: 1, ch: 'C' });
  assert.ok(!cont.error);
  assert.equal(cont.state.cells[1].cur, 'C');
});

// --- compareResults ------------------------------------------------------------

test('compareResults: completion, score, invalids, elapsed, id', () => {
  const base = { status: 'won', score: { total: 100 }, invalid: 0, elapsedMs: 1000, sessionId: 'b' };
  assert.ok(R.compareResults(base, { ...base, status: 'lost' }) < 0);
  assert.ok(R.compareResults(base, { ...base, score: { total: 200 } }) > 0);
  assert.ok(R.compareResults(base, { ...base, invalid: 1 }) < 0);
  assert.ok(R.compareResults(base, { ...base, elapsedMs: 500 }) > 0);
  assert.ok(R.compareResults(base, { ...base, sessionId: 'a' }) > 0);
});

// --- Fuzz ----------------------------------------------------------------------

test('fuzz: malformed commands never throw or hang', () => {
  const rng = R.createStream('fuzz-1');
  for (let round = 0; round < 20; round++) {
    let state = game(DEF_X, { limits: { timeMs: 60000, checks: 50, mistakes: 50 } });
    for (let i = 0; i < 200; i++) {
      const kind = rng.int(0, 7);
      const cmd = [
        { id: rng.int(-2, 210), type: 'letter', cell: rng.int(-3, 12), ch: String.fromCharCode(rng.int(32, 126)) },
        { id: rng.int(0, 210), type: 'clear', cell: rng.int(-1, 12) },
        { id: rng.int(0, 210), type: 'check', scope: ['grid', 'cell', 'word', 'bogus'][rng.int(0, 3)], cell: rng.int(-1, 12), entry: rng.int(-1, 4) },
        { id: rng.int(0, 210), type: 'reveal', cell: rng.int(-1, 12) },
        { id: rng.int(0, 210), type: 'giveUp' },
        { id: rng.int(0, 210), type: ['jump', null, 42][rng.int(0, 2)] },
        { id: rng.int(0, 210), type: 'letter', cell: rng.int(0, 8), ch: ['a', 'Z', '1', ''][rng.int(0, 3)], at: rng.int(0, 120000) },
        null,
      ][kind];
      const r = R.applyCommand(state, cmd || { id: rng.int(0, 5), type: 'letter', cell: 0, ch: 'Q' });
      state = r.state;
      assert.ok(r.error || Array.isArray(r.events));
      assert.ok(Number.isFinite(state.score.total));
      assert.ok(state.filledCorrect >= 0 && state.filledCorrect <= state.filledTotal);
    }
  }
});

test('fuzz: random valid playthroughs always terminate cleanly', () => {
  const rng = R.createStream('fuzz-2');
  for (let round = 0; round < 10; round++) {
    let state = game(DEF_1x);
    const open = [0, 1, 2, 3, 4, 5];
    let guard = 0;
    while (state.status === 'active' && guard++ < 500) {
      const cell = open[rng.int(0, open.length - 1)];
      const correct = rng.next() < 0.8;
      const ch = correct ? state.cells[cell].sol : 'Z';
      const r = R.applyCommand(state, { id: state.nextCmdId, type: 'letter', cell, ch, at: guard * 100 });
      state = r.state;
    }
    assert.equal(state.status, 'won');
  }
});
