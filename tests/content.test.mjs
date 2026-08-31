// Crossword Journey — content module tests.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as C from '../js/content.js';
import * as R from '../js/rules.js';

test('word bank: every entry matches its length bucket and has a clue', () => {
  for (const [lenStr, list] of Object.entries(C.WORD_BANK)) {
    const len = Number(lenStr);
    const seen = new Set();
    for (const [w, clue, d] of list) {
      assert.equal(w.length, len, `${w} in bucket ${len}`);
      assert.match(w, /^[A-Z]+$/);
      assert.ok(clue && clue.length > 3, `${w} needs a clue`);
      assert.ok(d >= 1 && d <= 3);
      assert.ok(!seen.has(w), `duplicate ${w}`);
      seen.add(w);
    }
  }
});

test('patterns: masks are square, sized and fully covered', () => {
  for (const [key, pat] of Object.entries(C.PATTERNS)) {
    assert.equal(pat.mask.length, pat.size, key);
    for (const row of pat.mask) assert.equal(row.length, pat.size, key);
    const cov = C.maskCoverage(pat.mask);
    assert.deepEqual(cov.uncovered, [], `${key} has uncovered cells`);
    assert.ok(cov.slots.length >= 5, `${key} has enough slots`);
  }
});

test('generateGrid is deterministic per seed', () => {
  const a = C.generateGrid('det-1', { pattern: 'quay5', maxDifficulty: 1 });
  const b = C.generateGrid('det-1', { pattern: 'quay5', maxDifficulty: 1 });
  assert.deepEqual(a.cells, b.cells);
  assert.deepEqual(a.entries.map((e) => e.word), b.entries.map((e) => e.word));
  const c = C.generateGrid('det-2', { pattern: 'quay5', maxDifficulty: 1 });
  assert.notDeepEqual(a.cells, c.cells);
});

test('generateGrid entries agree with the cell letters', () => {
  const g = C.generateGrid('geo', { pattern: 'harbor6', maxDifficulty: 2 });
  for (const e of g.entries) {
    assert.equal(e.cells.map((i) => g.cells[i]).join(''), e.word);
  }
  // clue numbering increases in row-major order of start cells
  const starts = g.entries.map((e) => e.cells[0]);
  const nums = g.entries.map((e) => e.number);
  const sorted = starts.map((s, i) => [s, nums[i]]).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i][1] >= sorted[i - 1][1]);
});

test('generateGrid rejects unknown patterns and fills every pattern', () => {
  assert.throws(() => C.generateGrid('x', { pattern: 'nope' }));
  for (const key of Object.keys(C.PATTERNS)) {
    const g = C.generateGrid('all-' + key, { pattern: key, maxDifficulty: 3 });
    assert.ok(g.entries.length >= 5, key);
  }
});

test('journeyStages: 40 authored stages, all valid defs', () => {
  const stages = C.journeyStages();
  assert.equal(stages.length, 40);
  const ids = new Set(stages.map((s) => s.id));
  assert.equal(ids.size, 40);
  for (const s of stages) assert.deepEqual(C.validateDef(s), [], s.id);
  // mastery every eighth page with a score multiplier
  assert.ok(stages[7].mechanics.includes('mastery'));
  assert.ok(stages[7].mult > 1);
  assert.ok(!stages[6].mechanics.includes('mastery'));
  assert.throws(() => C.journeyStage(0));
  assert.throws(() => C.journeyStage(41));
});

test('learnDef: valid tutorial with ordered steps and a playable grid', () => {
  const def = C.learnDef();
  assert.deepEqual(C.validateDef(def), []);
  assert.equal(def.mode, 'learn');
  assert.ok(def.tutorial.steps.length >= 5);
  assert.equal(def.tutorial.steps[0].require.type, 'any-letter');
  assert.equal(def.tutorial.steps.at(-1).require.type, 'grid-complete');
  assert.equal(C.learnDef(), def); // cached
});

test('dailyForDate: stable per UTC date, ranked, weekday-driven pattern', () => {
  const a = C.dailyForDate(new Date(Date.UTC(2026, 7, 30))); // Sunday
  const b = C.dailyForDate(new Date(Date.UTC(2026, 7, 30, 23, 59)));
  assert.equal(a.id, 'daily-2026-08-30');
  assert.equal(a.seed, b.seed);
  assert.deepEqual(a.cells, b.cells);
  assert.equal(a.pattern, 'summit9'); // Sunday per DAILY_TABLE
  const c = C.dailyForDate(new Date(Date.UTC(2026, 7, 31))); // Monday
  assert.equal(c.pattern, 'quay5');
  assert.notEqual(c.id, a.id);
  assert.deepEqual(C.validateDef(a), []);
  assert.equal(a.ranked, true);
});

test('practiceDef: difficulty tiers, seeded determinism, unranked', () => {
  const easy = C.practiceDef('easy', 'p-easy');
  assert.deepEqual(C.validateDef(easy), []);
  assert.ok(['quay5', 'open5'].includes(easy.pattern));
  assert.equal(easy.ranked, false);
  const hard = C.practiceDef('hard', 'p-hard');
  assert.ok(['meadow7', 'vista8', 'summit9'].includes(hard.pattern));
  const again = C.practiceDef('easy', 'p-easy');
  assert.deepEqual(again.cells, easy.cells);
  const unknown = C.practiceDef('nonsense', 'p-x'); // falls back to medium
  assert.ok(['harbor6', 'vale6', 'trail7'].includes(unknown.pattern));
});

test('challengeDefs: five valid constrained challenges', () => {
  const defs = C.challengeDefs();
  assert.equal(defs.length, 5);
  const ids = new Set(defs.map((d) => d.id));
  assert.equal(ids.size, 5);
  for (const d of defs) {
    assert.deepEqual(C.validateDef(d), [], d.id);
    assert.equal(d.ranked, true);
    assert.ok(d.mult >= 1.5);
  }
  const limited = defs.filter((d) => Object.keys(d.limits).length > 0);
  assert.ok(limited.length >= 3);
  assert.throws(() => C.challengeDef('nope'));
});

test('validateAll passes for every shipped def', () => {
  const all = C.validateAll();
  assert.ok(Object.keys(all).length >= 46); // 40 journey + learn + 5 challenges
  for (const [id, errors] of Object.entries(all)) assert.deepEqual(errors, [], id);
});

test('validateDef catches structural problems', () => {
  const good = C.practiceDef('easy', 'val-1');
  assert.deepEqual(C.validateDef(good), []);
  const badWord = { ...good, entries: good.entries.map((e, i) => (i === 0 ? { ...e, word: 'ZZZZZZZZZ' } : e)) };
  assert.ok(C.validateDef(badWord).some((e) => e.startsWith('unknown-word')));
  const noPar = { ...good, par: { timeMs: 0 } };
  assert.ok(C.validateDef(noPar).includes('bad-par'));
});

test('generated defs are playable to a win through the rules engine', () => {
  const def = C.practiceDef('easy', 'play-1');
  let state = R.createGame(def);
  let id = 1;
  def.cells.forEach((sol, i) => {
    if (sol === null || state.status !== 'active') return;
    const r = R.applyCommand(state, { id: id++, type: 'letter', cell: i, ch: sol });
    assert.ok(!r.error, r.error);
    state = r.state;
  });
  assert.equal(state.status, 'won');
  assert.equal(state.terminalReason, 'grid-complete');
});

test('themes: five palettes with all required colors', () => {
  assert.equal(C.THEMES.length, 5);
  const keys = ['paper', 'ink', 'tile', 'accent', 'select', 'ok', 'wrong', 'revealed', 'sky', 'ground', 'water', 'hill', 'tree'];
  for (const t of C.THEMES) {
    for (const k of keys) assert.match(t[k], /^#[0-9a-f]{6}$/i, `${t.id}.${k}`);
  }
  assert.equal(C.getTheme('pine').id, 'pine');
  assert.equal(C.getTheme('nope').id, C.THEMES[0].id);
});
