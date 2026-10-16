// Crossword Journey — StarHermit adapter unit tests (node --test).
// Loads starhermit-sdk.js (classic script) and the js/platform.js module
// against a stubbed window, fetch and launch hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { mergeStoreDoc } from '../js/merge.js';

const SDK_SRC = readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8');
const SLUG = 'crossword-journey';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64u({ alg: 'none' })}.${b64u({ sub: 'u-12345678', game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
let n = 0;
// Clear the SDK's renewal timer so the test process can exit.
test.afterEach(() => { globalThis.StarHermit?.signOut(); });

async function boot(hash) {
  const calls = [];
  const store = { save: null, settings: {}, refuseNextPut: false };
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, init });
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/api/v1/users/u-12345678/profile')) return json({ nickname: 'Pip' });
    if (url.includes('/api/v1/me/cloud-saves/') && url.endsWith('/info')) {
      return json(store.save ? { exists: true, etag: '"v' + calls.length + '"' } : { exists: false });
    }
    if (url.includes('/api/v1/me/cloud-saves/')) {
      // refuseNextPut: the next write loses to "another device" (412, conditional write refused).
      if (method === 'PUT' && store.refuseNextPut) { store.refuseNextPut = false; return new Response(JSON.stringify({ error: 'precondition-failed' }), { status: 412, headers: { 'Content-Type': 'application/json' } }); }
      if (method === 'PUT') { store.save = Buffer.from(JSON.parse(init.body).dataBase64, 'base64'); return json({ etag: '"v' + calls.length + '"' }); }
      return store.save ? new Response(store.save, { status: 200 }) : new Response('', { status: 404 });
    }
    if (url.endsWith(`/api/v1/games/${SLUG}/settings`)) {
      if (method === 'PATCH') Object.assign(store.settings, JSON.parse(init.body).settings);
      return json({ settings: store.settings });
    }
    if (url.endsWith(`/api/v1/games/${SLUG}/controls`)) return json({ actions: [{ action: 'reveal', codes: ['F2'] }] });
    if (url.endsWith(`/api/v1/games/${SLUG}/leaderboards`)) return json([{ id: 'lb1', key: 'high-score' }]);
    if (url.includes('/api/v1/leaderboards/lb1/entries')) return json({ items: [{ userId: 'u-12345678', score: 900 }] });
    return new Response('', { status: 404 });
  };
  const location = { hash, search: '', pathname: '/', hostname: 'localhost', href: 'http://localhost/' + hash, origin: 'http://localhost' };
  globalThis.window = {
    location,
    history: { state: null, replaceState(_s, _t, url) { const i = url.indexOf('#'); location.hash = i >= 0 ? url.slice(i) : ''; } },
    addEventListener() {},
  };
  globalThis.document = { hidden: false, addEventListener() {} };
  vm.runInThisContext(SDK_SRC);               // defines globalThis.StarHermit
  window.StarHermit = globalThis.StarHermit;
  const { platform } = await import(`../js/platform.js?boot=${++n}`);
  return { P: platform, calls, store };
}

test('launch token: read from the fragment, stripped, slug from claims', async () => {
  const { P } = await boot('#game_token=' + JWT + '&session_id=s1');
  assert.equal(P.init(), true);
  assert.equal(P.slug, SLUG);
  assert.equal(P.userId, 'u-12345678');
  assert.equal(window.location.hash, '');
  assert.equal(P.headers().Authorization, 'Bearer ' + JWT);
});

test('profile name comes from the profile nickname', async () => {
  const { P } = await boot('#game_token=' + JWT);
  P.init();
  assert.deepEqual(await P.fetchProfile(), { name: 'Pip' });
});

test('cloud save round-trips through /api/v1/me/cloud-saves/game:<slug>', async () => {
  const { P, calls } = await boot('#game_token=' + JWT);
  P.init();
  const doc = JSON.stringify({ v: 1, settings: { theme: 'harbor' } });
  await P.saveCloud(doc);
  assert.equal(P.sync, 'saving');
  assert.equal(await P.flushSave(true), true);
  const put = calls.find((c) => c.method === 'PUT');
  assert.ok(put.url.endsWith('/api/v1/me/cloud-saves/' + encodeURIComponent('game:' + SLUG)), put.url);
  assert.equal(put.init.keepalive, true);
  assert.equal(P.sync, 'synced');
  assert.equal(await P.loadCloud(), doc);
});

test('settings patch, bindings, invite link and platform board', async () => {
  const { P, calls, store } = await boot('#game_token=' + JWT);
  P.init();
  await Promise.all([P.patchSettings({ volMusic: 0.2 }), P.patchSettings({ cvd: true })]);
  assert.deepEqual(store.settings, { volMusic: 0.2, cvd: true });
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 1, 'patches are debounced into one');
  assert.deepEqual((await P.getSettings()).cvd, true);
  assert.deepEqual(await P.loadBindings({ reveal: ['KeyH'], pause: ['Escape'] }), { reveal: ['F2'], pause: ['Escape'] });
  assert.match(P.inviteLink(), /game-invite\/u-12345678\/crossword-journey$/);
  assert.deepEqual(await P.fetchLeaderboard(), [{ name: 'You (Pip)', score: 900 }]);
});

test('standalone: no token means no fetch at all', async () => {
  const { P, calls } = await boot('');
  assert.equal(P.init(), false);
  assert.equal(P.canSignIn(), false);
  assert.equal(P.inviteLink(), null);
  assert.equal(await P.fetchProfile(), null);
  assert.equal(await P.loadCloud(), null);
  await P.saveCloud('{"v":1}');
  await P.flushSave(true);
  await P.patchSettings({ a: 1 });
  assert.deepEqual(await P.getSettings(), {});
  assert.deepEqual(await P.loadBindings({ pause: ['Escape'] }), { pause: ['Escape'] });
  assert.equal(await P.fetchLeaderboard(), null);
  assert.deepEqual(P.headers(), {});
  assert.equal(calls.length, 0);
});

test('save conflict: remote doc is reloaded, merged and saved again', async () => {
  const { P, store } = await boot('#game_token=' + JWT);
  P.init();
  const base = { v: 1, settings: { theme: 'harbor' }, profile: { name: 'Guest' }, tutorialDone: false };
  const other = { ...base, journey: { unlocked: 5, stars: { 2: 3, 4: 1 } }, achievements: { 'first-completion': 100 }, stats: { wins: 4, wordsCompleted: 30, dailyDays: ['2026-10-01'] } };
  P.saveCloud(JSON.stringify(other));
  assert.equal(await P.flushSave(), true, 'other device saved first');
  let mine = { ...base, settings: { theme: 'pine' }, journey: { unlocked: 3, stars: { 2: 1, 3: 2 } }, achievements: { 'first-completion': 50, 'streak-5': 70 }, stats: { wins: 2, wordsCompleted: 40, dailyDays: ['2026-10-02'] }, tutorialDone: true };
  const merged = new Promise((resolve) => P.onConflict((remote) => {
    mine = mergeStoreDoc(mine, remote);
    P.saveCloud(JSON.stringify(mine));
    P.flushSave().then(resolve);
  }));
  store.refuseNextPut = true;
  P.saveCloud(JSON.stringify(mine));
  assert.equal(await P.flushSave(), false, 'stale write refused');
  assert.equal(await merged, true, 'merged doc saved');
  assert.equal(window.StarHermit.saveConflicted(), false);
  const cloud = JSON.parse(await P.loadCloud());
  assert.deepEqual(cloud.journey, { unlocked: 5, stars: { 2: 3, 3: 2, 4: 1 } });
  assert.deepEqual(cloud.achievements, { 'first-completion': 50, 'streak-5': 70 });
  assert.deepEqual(cloud.stats, { wins: 4, wordsCompleted: 40, dailyDays: ['2026-10-01', '2026-10-02'] });
  assert.equal(cloud.tutorialDone, true);
  assert.equal(cloud.settings.theme, 'pine', 'settings stay local');
});
