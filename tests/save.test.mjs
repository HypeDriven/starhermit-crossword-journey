// The save document (js/save.js): the browser build's store document read
// back clean (its runtime-owned settings dropped), the old cloud save
// (save.json text) migrated, two devices' documents merged (the better of
// both, local settings and profile kept), and the legacy per-player
// settings carried over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLegacySettings, defaultDoc, fromBrowserSave, hasProgress, isLegacySettingKey, mergeDocs, normalizeDoc } from '../js/save.js';

const OLD = {
  v: 1,
  settings: { theme: 'pine', volMusic: 0.2, volEffects: 1, volAmbience: 0, reducedMotion: true, highContrast: true, cvd: true, largeText: true, leftHanded: true, haptics: false, gfx: { preset: 'high' }, osk: true },
  profile: { name: 'Ada' },
  journey: { unlocked: 5, stars: { 1: 3, 2: 2, 3: 1, 4: 1 } },
  achievements: { 'first-completion': 1700000000000 },
  stats: { wins: 4, wordsCompleted: 30, dailyDays: ['2026-10-01'] },
  tutorialDone: true,
};

test('a browser-build document reads back with only the game-owned settings', () => {
  const d = normalizeDoc(JSON.parse(JSON.stringify(OLD)));
  assert.deepEqual(d.settings, { theme: 'pine', cvd: true, leftHanded: true, haptics: false, osk: true });
  assert.equal(d.profile.name, 'Ada');
  assert.equal(d.journey.unlocked, 5);
  assert.deepEqual(d.journey.stars, { 1: 3, 2: 2, 3: 1, 4: 1 });
  assert.equal(d.stats.wins, 4);
  assert.equal(d.tutorialDone, true);
});

test('unknown versions, junk and bad fields are refused or cleaned', () => {
  assert.equal(normalizeDoc(null), null);
  assert.equal(normalizeDoc({ v: 2 }), null);
  assert.equal(normalizeDoc([1]), null);
  const d = normalizeDoc({ v: 1, settings: { theme: 'nope', cvd: 'yes' }, journey: { unlocked: 99, stars: { 1: 'x', 2: 7 } }, stats: { wins: -3, dailyDays: 'x' } });
  assert.equal(d.settings.theme, 'harbor');
  assert.equal(d.settings.cvd, false);
  assert.equal(d.journey.unlocked, 40);
  assert.deepEqual(d.journey.stars, { 2: 3 });
  assert.equal(d.stats.wins, 0);
  assert.deepEqual(d.stats.dailyDays, []);
});

test('the old cloud save (save.json text) migrates; corrupt text does not', () => {
  assert.equal(fromBrowserSave(JSON.stringify(OLD)).journey.unlocked, 5);
  assert.equal(fromBrowserSave('{not json'), null);
  assert.equal(fromBrowserSave(null), null);
  assert.equal(fromBrowserSave(''), null);
});

test('two documents merge to the better of both, local settings and profile kept', () => {
  const local = defaultDoc();
  local.settings.theme = 'frost';
  local.profile.name = 'Here';
  local.journey = { unlocked: 7, stars: { 1: 1, 6: 2 } };
  local.achievements = { 'first-completion': 1800000000000, 'streak-5': 1800000000001 };
  local.stats = { wins: 2, wordsCompleted: 50, dailyDays: ['2026-10-02'] };
  const m = mergeDocs(local, OLD);
  assert.equal(m.settings.theme, 'frost');
  assert.equal(m.profile.name, 'Here');
  assert.equal(m.journey.unlocked, 7);
  assert.deepEqual(m.journey.stars, { 1: 3, 2: 2, 3: 1, 4: 1, 6: 2 });
  assert.equal(m.achievements['first-completion'], 1700000000000);
  assert.ok(m.achievements['streak-5']);
  assert.equal(m.stats.wins, 4);
  assert.equal(m.stats.wordsCompleted, 50);
  assert.deepEqual(m.stats.dailyDays, ['2026-10-01', '2026-10-02']);
  assert.equal(m.tutorialDone, true);
  assert.equal(mergeDocs(null, OLD).journey.unlocked, 5);
  assert.equal(mergeDocs(OLD, null).journey.unlocked, 5);
});

test('progress detection and the legacy settings', () => {
  assert.equal(hasProgress(defaultDoc()), false);
  assert.equal(hasProgress(normalizeDoc(OLD)), true);
  for (const k of ['theme', 'volMusic', 'gfx', 'audio.options', 'ui.language', 'graphics.gpu.amd']) assert.ok(isLegacySettingKey(k), k);
  assert.equal(isLegacySettingKey('game.x'), false);
  const legacy = { theme: 'desert', haptics: false, highContrast: true, cvd: 'bad' };
  const s = applyLegacySettings(defaultDoc().settings, (k) => legacy[k]);
  assert.deepEqual(s, { theme: 'desert', cvd: false, leftHanded: false, haptics: false, osk: null });
});
