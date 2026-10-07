// Crossword Journey — StarHermit adapter unit tests (node --test).
// Loads starhermit-sdk.js (classic script) and the js/platform.js module
// against a stubbed window, fetch and launch hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SDK_SRC = readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8');
const SLUG = 'crossword-journey';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64u({ alg: 'none' })}.${b64u({ sub: 'u-12345678', game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
let n = 0;
// Clear the SDK's renewal timer so the test process can exit.
test.afterEach(() => { globalThis.StarHermit?.signOut(); });

async function boot(hash) {
  const calls = [];
  const store = { save: null, settings: {} };
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, init });
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/api/v1/users/u-12345678/profile')) return json({ nickname: 'Pip' });
    if (url.includes('/api/v1/me/cloud-saves/')) {
      if (method === 'PUT') { store.save = Buffer.from(JSON.parse(init.body).dataBase64, 'base64'); return new Response(null, { status: 204 }); }
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
