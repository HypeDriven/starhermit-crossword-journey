// Crossword Journey — StarHermit platform adapter.
// A thin layer over window.StarHermit (starhermit-sdk.js, loaded as a classic
// script before this module): the SDK reads the launch token, renews it and
// talks to the API; this adapter keeps the game's API — profile nickname, the
// cloud-save mirror of the versioned store document (remote wins on boot;
// debounced saves with a pagehide flush; sync status), the settings KV,
// sign-in, invite link, key bindings and the read-only platform leaderboard.
// main.js calls the own-server GET /api/v1/time with headers() only when
// signed in. Offline play is unchanged: no token → localStorage only and
// zero StarHermit calls.

const SAVE_DEBOUNCE_MS = 2000;
const PATCH_DEBOUNCE_MS = 400;
const sdk = () => (typeof window !== 'undefined' && window.StarHermit) || null;

export const platform = {
  hosted: false,
  profile: null,         // { name } for the signed-in player
  sync: 'offline',       // offline | saving | synced (cloud mirror)
  _syncListeners: [],
  _authListeners: [],
  _started: false,
  _patch: null,
  _patchTimer: null,

  get userId() { return sdk()?.userId || null; },
  get slug() { return sdk()?.slug || null; },
  get token() { return sdk()?.token || null; },

  headers(extra = {}) {
    const t = this.token;
    if (t) extra.Authorization = `Bearer ${t}`;
    return extra;
  },

  init() {
    const s = sdk();
    if (!s) return false;
    if (!this._started) {
      this._started = true;
      s.init();
      s.on('saved', (ok) => { if (this.hosted) this._setSync(ok ? 'synced' : 'offline'); });
      s.on('auth', (a) => {
        const was = this.hosted;
        this.hosted = !!(a && a.signedIn && s.slug);
        if (!this.hosted) { this.profile = null; this._setSync('offline'); }
        if (was !== this.hosted) for (const fn of this._authListeners) { try { fn(this.hosted); } catch { /* ignore */ } }
      });
      try {
        window.addEventListener('pagehide', () => this.flushSave(true));
        document.addEventListener('visibilitychange', () => { if (document.hidden) this.flushSave(true); });
      } catch { /* no window events available */ }
    }
    this.hosted = !!(s.signedIn && s.slug);
    return this.hosted;
  },

  refreshToken() { const s = sdk(); return s ? s.refresh().then((t) => !!t) : Promise.resolve(false); },

  // Nickname from GET /api/v1/users/{id}/profile (SDK: nickname, then
  // "Player <id>" fallback). Never /api/v1/me.
  profileFor(userId) {
    const s = sdk();
    if (!s || !this.hosted || !userId) return Promise.resolve('player');
    return s.profile(String(userId)).then((p) => (p ? p.displayName : `Player ${String(userId).slice(0, 6)}`));
  },
  async fetchProfile() {
    if (!this.hosted) return null;
    const name = String(await this.profileFor(this.userId)).slice(0, 40);
    this.profile = { name };
    return this.profile;
  },

  /* Cloud save: the SDK's slot at /api/v1/me/cloud-saves/game:<slug> holds
   * the store document. Remote wins on boot (the caller validates the shape);
   * localStorage stays the offline cache. */
  loadCloud() {
    const s = sdk();
    if (!s || !this.hosted) return Promise.resolve(null);
    return s.loadJSON().then((obj) => {
      if (this.sync === 'offline') this._setSync('synced');
      return obj ? JSON.stringify(obj) : null;
    }, () => null);
  },
  saveCloud(docJson) {
    const s = sdk();
    if (!s || !this.hosted) return Promise.resolve(false);
    try { s.saveJSON(JSON.parse(docJson), SAVE_DEBOUNCE_MS); } catch { return Promise.resolve(false); }
    this._setSync('saving');
    return Promise.resolve(true);
  },
  flushSave(keepalive) {
    const s = sdk();
    if (!s || !this.hosted) return Promise.resolve(false);
    return s.flushSave(keepalive === true);
  },

  // ---- settings KV (player preferences) ----
  getSettings() {
    const s = sdk();
    return s && this.hosted ? s.getSettings().catch(() => ({})) : Promise.resolve({});
  },
  patchSettings(obj) {
    const s = sdk();
    if (!s || !this.hosted) return Promise.resolve(null);
    this._patch = Object.assign(this._patch || {}, obj);
    if (this._patchTimer) clearTimeout(this._patchTimer);
    return new Promise((resolve) => {
      (this._patchWaiters = this._patchWaiters || []).push(resolve);
      this._patchTimer = setTimeout(() => {
        const body = this._patch, waiters = this._patchWaiters;
        this._patch = null; this._patchTimer = null; this._patchWaiters = [];
        const done = (v) => waiters.forEach((w) => w(v));
        s.patchSettings(body).then(done, () => done(null));
      }, PATCH_DEBOUNCE_MS);
    });
  },

  // ---- key bindings: { action: [codes] } with platform overrides applied ----
  loadBindings(defaults) {
    const copy = () => Object.fromEntries(Object.entries(defaults || {}).map(([k, v]) => [k, v.slice()]));
    const s = sdk();
    if (!s || !this.hosted) return Promise.resolve(copy());
    return s.loadBindings(defaults).catch(copy);
  },

  canSignIn() { const s = sdk(); return !!(s && s.canSignIn()); },
  signIn() { const s = sdk(); return !!(s && s.signIn()); },
  inviteLink() { const s = sdk(); return s && this.hosted ? s.inviteLink() : null; },

  onSync(fn) { if (typeof fn === 'function') this._syncListeners.push(fn); },
  onAuth(fn) { if (typeof fn === 'function') this._authListeners.push(fn); },
  _setSync(state) {
    if (this.sync === state) return;
    this.sync = state;
    for (const fn of this._syncListeners) {
      try { fn(state); } catch { /* listener errors never break the adapter */ }
    }
  },

  /* Platform leaderboard (read-only; clients never submit): the game's first
   * board, entries resolved to nicknames, own row marked. */
  fetchLeaderboard() {
    const s = sdk();
    if (!s || !this.hosted) return Promise.resolve(null);
    return s.leaderboard(null, { pageSize: 20 }).then((r) => {
      if (!r || !r.board) return null;
      return Promise.all((r.items || []).slice(0, 20).map((e) => {
        const uid = String(e.userId != null ? e.userId : e.playerId || '');
        return this.profileFor(uid).then((name) => ({
          name: uid === this.userId ? `You (${name})` : name,
          score: e.score != null ? e.score : e.value,
        }));
      }));
    }).catch(() => null);
  },
};
