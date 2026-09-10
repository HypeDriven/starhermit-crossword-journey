// Crossword Journey — browser client.
// Sections: bootstrap helpers, persistence, settings, platform (server sync),
// 3D diorama, session (rules), state machine, board render, input, tutorial,
// modes, results, pause/settings/help wiring.
//
// Hard rules honored here:
//  - Rules state only ever changes via rules.applyCommand with incrementing
//    command ids; the full ordered log is kept for the replay envelope.
//  - The DOM board is the accessible truth; the Three.js diorama is purely
//    decorative and never intercepts input.
import * as THREE from '../vendor/three.module.js';
import * as R from './rules.js';
import * as C from './content.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// Persistence — versioned localStorage document
// ---------------------------------------------------------------------------

const STORE_KEY = 'cwj:v1';

const DEFAULT_STORE = {
  v: 1,
  settings: {
    theme: 'harbor',
    volMusic: 0.5,
    volEffects: 0.8,
    volAmbience: 0.4,
    reducedMotion: false,
    highContrast: false,
    cvd: false,
    largeText: false,
    leftHanded: false,
    haptics: true,
    quality: 'medium',
  },
  profile: { name: 'Guest' },
  journey: { unlocked: 1, stars: {} },
  achievements: {}, // id -> unlockedAt ms
  stats: { wins: 0, wordsCompleted: 0, dailyDays: [] },
  tutorialDone: false,
};

let store = structuredClone(DEFAULT_STORE);
try {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.v === 1) {
      store = { ...structuredClone(DEFAULT_STORE), ...parsed,
        settings: { ...DEFAULT_STORE.settings, ...(parsed.settings || {}) } };
    }
  }
} catch { /* corrupted store: start fresh */ }

function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }
  catch { /* storage full/blocked: non-fatal */ }
}

// ---------------------------------------------------------------------------
// Settings application (CSS classes, theme, audio, quality)
// ---------------------------------------------------------------------------

function theme() { return C.getTheme(store.settings.theme); }

function applySettings() {
  const s = store.settings;
  document.body.classList.toggle('reduced-motion', s.reducedMotion);
  document.body.classList.toggle('hc', s.highContrast);
  document.body.classList.toggle('cvd', s.cvd);
  document.body.classList.toggle('large-text', s.largeText);
  document.body.classList.toggle('left-handed', s.leftHanded);
  const t = theme();
  const root = document.documentElement.style;
  for (const k of ['paper', 'ink', 'tile', 'tileEdge', 'accent', 'select', 'ok', 'wrong', 'revealed']) {
    root.setProperty(`--${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`, t[k]);
  }
  audio.setVolume('music', s.volMusic);
  audio.setVolume('effects', s.volEffects);
  audio.setVolume('ambience', s.volAmbience);
  rebuildScene();
  saveStore();
}

function haptic(ms = 12) {
  if (store.settings.haptics && navigator.vibrate) {
    try { navigator.vibrate(ms); } catch { /* unsupported */ }
  }
}

// ---------------------------------------------------------------------------
// Platform: server time sync, score submission, leaderboards (all non-fatal)
// ---------------------------------------------------------------------------

let timeOffset = 0; // serverNow - clientNow
let serverOnline = false;

async function syncTime() {
  try {
    const t0 = Date.now();
    const res = await fetch('/api/v1/time');
    const t1 = Date.now();
    if (!res.ok) throw new Error('time ' + res.status);
    const body = await res.json();
    // Hosts expose the epoch under different keys (`now`, `serverTime`, `epochMs`).
    const now = Number(body.now ?? body.serverTime ?? body.epochMs);
    if (!Number.isFinite(now)) throw new Error('time shape');
    timeOffset = now - Math.round((t0 + t1) / 2); // round-trip adjusted
    serverOnline = true;
  } catch {
    serverOnline = false; // fall back to local clock
  }
  updateTopbarStatus();
}

const serverNow = () => Date.now() + timeOffset;

function updateTopbarStatus() {
  const el = $('topbar-status');
  if (!el) return;
  const day = new Date(serverNow()).toISOString().slice(0, 10);
  el.textContent = `${serverOnline ? 'online' : 'offline'} · ${day} UTC`;
}

async function postScore(envelope, result) {
  try {
    const res = await fetch('/api/v1/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ envelope, result }),
    });
    const data = await res.json();
    return res.ok ? { ok: true, ...data } : { ok: false, error: data.error || 'rejected' };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

// ---------------------------------------------------------------------------
// Toasts + announcements
// ---------------------------------------------------------------------------

function toast(msg) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild.remove(); // never pile over the screen
  setTimeout(() => el.remove(), 4200);
}

function announceError(msg) { $('error-live').textContent = msg; }
function announceObjective(msg) { $('objective').textContent = msg; }

// ---------------------------------------------------------------------------
// Achievements (static lowercase ids, idempotent unlocks)
// ---------------------------------------------------------------------------

const ACHIEVEMENTS = {
  'first-completion': { name: 'First Completion', desc: 'Finish your first grid.' },
  'mechanic-mastery': { name: 'Mechanic Mastery', desc: 'Win a mastery page.' },
  'streak-5': { name: 'On a Roll', desc: 'Complete 5 words in a row.' },
  'hard-milestone': { name: 'Hard Milestone', desc: 'Win a multiplied (hard) round.' },
  'long-term-goal': { name: 'Seasoned Traveler', desc: 'Win 10 rounds in total.' },
};

function unlockAchievement(id) {
  if (!ACHIEVEMENTS[id] || store.achievements[id]) return;
  store.achievements[id] = Date.now();
  saveStore();
  audio.play('achievement');
  toast(`Achievement unlocked: ${ACHIEVEMENTS[id].name}`);
  session.newAchievements.push(id);
}

// ---------------------------------------------------------------------------
// Three.js decorative diorama — travel journal pages, hills, water, lantern,
// trees. Deterministic decoration from createStream(seed + '-deco').
// ---------------------------------------------------------------------------

const QUALITY = {
  low: { dpr: 1, shadows: false, trees: 6, hills: 3 },
  medium: { dpr: 1.5, shadows: false, trees: 12, hills: 4 },
  high: { dpr: 2, shadows: true, trees: 20, hills: 6 },
};

let renderer = null, scene3 = null, camera3 = null, rafId = null;
let threeOK = false;
let decoSeed = 'title';
let lanternLight = null, waterMesh = null;
let frameClock = 0;

function hex(c) { return new THREE.Color(c); }

function disposeScene() {
  if (!scene3) return;
  scene3.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
  scene3 = null;
}

function rebuildScene() {
  if (!renderer) return;
  disposeScene();
  const t = theme();
  const q = QUALITY[store.settings.quality] || QUALITY.medium;
  scene3 = new THREE.Scene();
  scene3.background = hex(t.sky);
  scene3.fog = new THREE.Fog(hex(t.sky), 18, 42);

  const amb = new THREE.AmbientLight(hex(t.paper), 0.85);
  const key = new THREE.DirectionalLight(0xfff2df, 1.1);
  key.position.set(6, 10, 5);
  if (q.shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
  }
  scene3.add(amb, key);

  const deco = R.createStream(decoSeed + '-deco');
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color: hex(color), roughness: 0.9, ...extra });

  // Journal pages: stacked sheets under the diorama.
  const pageGeo = new THREE.BoxGeometry(16, 0.18, 11);
  for (let i = 0; i < 4; i++) {
    const page = new THREE.Mesh(pageGeo, mat(t.paper));
    page.position.set((deco.next() - 0.5) * 0.6, -1.6 - i * 0.2, (deco.next() - 0.5) * 0.6);
    page.rotation.y = (deco.next() - 0.5) * 0.16;
    page.receiveShadow = q.shadows;
    scene3.add(page);
  }

  // Ground plane.
  const ground = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.6, 0.5, 40), mat(t.ground));
  ground.position.y = -1.3;
  ground.receiveShadow = q.shadows;
  scene3.add(ground);

  // Water inlet on one side.
  waterMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(3.2, 3.4, 0.56, 28),
    mat(t.water, { roughness: 0.35, metalness: 0.1 })
  );
  waterMesh.position.set(-4.4 + deco.next() * 1.5, -1.26, 2.6 + deco.next());
  scene3.add(waterMesh);

  // Hills.
  for (let i = 0; i < q.hills; i++) {
    const r = 1.6 + deco.next() * 2.2;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(t.hill));
    const ang = deco.next() * Math.PI * 2;
    const dist = 6.5 + deco.next() * 4;
    hill.position.set(Math.cos(ang) * dist, -1.4, Math.sin(ang) * dist - 3);
    hill.castShadow = q.shadows;
    scene3.add(hill);
  }

  // Trees: cone canopies on cylinder trunks.
  const trunkGeo = new THREE.CylinderGeometry(0.07, 0.1, 0.5, 6);
  const canopyGeo = new THREE.ConeGeometry(0.42, 1.1, 8);
  for (let i = 0; i < q.trees; i++) {
    const ang = deco.next() * Math.PI * 2;
    const dist = 3.4 + deco.next() * 4.6;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist - 2.5;
    if (waterMesh && Math.hypot(x - waterMesh.position.x, z - waterMesh.position.z) < 3.6) continue;
    const s = 0.7 + deco.next() * 0.8;
    const trunk = new THREE.Mesh(trunkGeo, mat(t.rock));
    trunk.position.set(x, -1.05 + 0.25 * s, z);
    trunk.scale.setScalar(s);
    const canopy = new THREE.Mesh(canopyGeo, mat(t.tree));
    canopy.position.set(x, -1.05 + (0.5 + 0.55) * s, z);
    canopy.scale.setScalar(s);
    canopy.castShadow = q.shadows;
    scene3.add(trunk, canopy);
  }

  // Lantern: warm point light on a small post.
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.5, 6), mat(t.ink));
  post.position.set(3.6, -0.55, 1.8);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb85c, emissiveIntensity: 0.9 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), lampMat);
  lamp.position.set(3.6, 0.28, 1.8);
  lanternLight = new THREE.PointLight(0xffc27a, 1.6, 12);
  lanternLight.position.copy(lamp.position);
  scene3.add(post, lamp, lanternLight);

  camera3 = new THREE.PerspectiveCamera(46, 2, 0.1, 100);
  camera3.position.set(0, 4.2, 12.5);
  camera3.lookAt(0, -0.6, 0);
  threeOK = true;
}

function initThree() {
  const canvas = $('scene');
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch {
    renderer = null;
    $('scene-fallback').hidden = false;
    canvas.hidden = true;
    return;
  }
  applyQuality();
  rebuildScene();
  const onResize = () => {
    if (!renderer || !camera3) return;
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera3.aspect = window.innerWidth / window.innerHeight;
    camera3.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);
  onResize();
  const loop = () => {
    rafId = null;
    if (document.hidden || !threeOK) { scheduleLoop(); return; }
    frameClock += 1 / 60;
    if (!store.settings.reducedMotion) {
      camera3.position.x = Math.sin(frameClock * 0.05) * 0.9;
      camera3.lookAt(0, -0.6, 0);
      if (lanternLight) lanternLight.intensity = 1.5 + Math.sin(frameClock * 2.3) * 0.25;
      if (waterMesh) waterMesh.position.y = -1.26 + Math.sin(frameClock * 0.8) * 0.03;
    }
    renderer.render(scene3, camera3);
    scheduleLoop();
  };
  const scheduleLoop = () => { if (rafId === null) rafId = requestAnimationFrame(loop); };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { scheduleLoop(); audio.resume(); }
    audio.setMuted(document.hidden || allMuted);
  });
  scheduleLoop();
}

function applyQuality() {
  if (!renderer) return;
  const q = QUALITY[store.settings.quality] || QUALITY.medium;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
  renderer.shadowMap.enabled = q.shadows;
}

// ---------------------------------------------------------------------------
// Session: one round = def + rules state + ordered command log + selection
// ---------------------------------------------------------------------------

const session = {
  def: null,
  state: null,
  commands: [],
  sel: { cell: null, dir: 'across' },
  phase: 'boot', // boot|title|modes|preparing|active|paused|resolving|results
  startStamp: 0,   // performance.now() at (re)start of the active clock
  accruedMs: 0,    // elapsed accumulated across pauses
  sessionId: '',
  newAchievements: [],
  roundMechanics: new Set(),
  tutorialStep: 0,
  timeWarned: false, // one-shot 30-second warning in timed rounds
};

const active = () => session.phase === 'active';
const elapsed = () =>
  session.accruedMs + (active() ? performance.now() - session.startStamp : 0);

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// State machine + screen switching
// ---------------------------------------------------------------------------

const SCREENS = ['screen-title', 'screen-modes', 'screen-play', 'screen-results', 'screen-settings', 'screen-help'];
let previousScreen = 'screen-title';

function transition(phase, reason) {
  const from = session.phase;
  session.phase = phase;
  const screenFor = {
    title: 'screen-title', modes: 'screen-modes', preparing: 'screen-play',
    active: 'screen-play', paused: 'screen-play', resolving: 'screen-play',
    results: 'screen-results',
  }[phase];
  if (screenFor) showScreen(screenFor);
  $('overlay-pause').hidden = phase !== 'paused';
  $('tray').hidden = !(phase === 'active' || phase === 'paused');
  audio.setIntensity(phase === 'active' ? 1 : 0);
  if (phase === 'paused') {
    rememberFocus();
    $('pause-resume').focus();
  } else if (from === 'paused') {
    restoreFocus();
  }
  if (reason === 'hidden-tab' && phase === 'paused') audio.suspend();
}

function showScreen(id) {
  for (const s of SCREENS) $(s).hidden = s !== id;
  if (id !== 'screen-play') previousScreen = id;
}

// Focus restoration around modal overlays.
let focusMemory = null;
function rememberFocus() { focusMemory = document.activeElement; }
function restoreFocus() {
  if (focusMemory && document.contains(focusMemory)) focusMemory.focus();
  focusMemory = null;
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------

function startRound(def, { tutorial = false } = {}) {
  session.def = def;
  session.state = R.createGame(def);
  session.commands = [];
  session.sel = { cell: firstPlayableCell(def), dir: 'across' };
  session.sessionId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  session.newAchievements = [];
  session.roundMechanics = new Set();
  session.tutorialStep = 0;
  session.timeWarned = false;
  session.accruedMs = 0;
  session.startStamp = performance.now();
  decoSeed = def.seed;
  rebuildScene();
  buildBoard();
  buildClueLists();
  updateHud();
  updateSelection();
  if (tutorial) setupTutorial();
  else $('tutorial-banner').hidden = true;
  transition('active', 'round-start');
  audio.play('pageTurn');
  announceObjective(objectiveText());
  announceBoardSummary();
}

function firstPlayableCell(def) {
  const i = def.cells.findIndex((c) => c !== null);
  return i >= 0 ? i : null;
}

function objectiveText() {
  const d = session.def;
  if (!d) return '';
  const bits = [`Fill every square of “${d.name}”.`];
  if (d.limits.timeMs) bits.push(`Time limit ${fmtTime(d.limits.timeMs)}.`);
  if (d.limits.mistakes) bits.push(`At most ${d.limits.mistakes} flagged mistakes.`);
  if (d.limits.checks) bits.push(`Only ${d.limits.checks} checks available.`);
  return bits.join(' ');
}

function endRound() {
  transition('resolving', 'terminal');
  const st = session.state;
  // Verify locally: replay our own log before trusting the result.
  const envelope = buildEnvelope();
  const check = R.replay(envelope);
  if (!check.ok || check.finalHash !== R.hashState(st)) {
    console.error('replay verification failed', check);
    toast('Local replay verification failed — score will not be submitted.');
  }
  applyRoundOutcome(st);
  renderResults(check.ok ? envelope : null);
  transition('results', 'round-end');
}

function buildEnvelope() {
  return {
    schema: 1,
    build: R.RULES_VERSION,
    contentV: session.def.v,
    seed: session.def.seed,
    init: session.def,
    commands: session.commands.slice(),
  };
}

function applyRoundOutcome(st) {
  const d = session.def;
  const won = st.status === 'won';
  if (won) {
    store.stats.wins++;
    store.stats.wordsCompleted += st.wordsDone;
    if (d.mode === 'daily') {
      const day = d.id.replace('daily-', '');
      if (!store.stats.dailyDays.includes(day)) store.stats.dailyDays.push(day);
    }
    unlockAchievement('first-completion');
    if (st.bestStreak >= 5) unlockAchievement('streak-5');
    if (d.mult >= 1.5) unlockAchievement('hard-milestone');
    if (d.mode === 'journey' && d.mechanics.includes('mastery')) unlockAchievement('mechanic-mastery');
    if (store.stats.wins >= 10) unlockAchievement('long-term-goal');
    if (d.mode === 'journey') {
      const n = Number(d.id.replace('journey-', ''));
      const stars = 1 + (st.checksUsed + st.revealsUsed === 0 ? 1 : 0) + (d.par.timeMs && st.elapsedMs < d.par.timeMs ? 1 : 0);
      store.journey.stars[n] = Math.max(store.journey.stars[n] || 0, stars);
      store.journey.unlocked = Math.max(store.journey.unlocked, Math.min(40, n + 1));
    }
    saveStore();
  }
}

// ---------------------------------------------------------------------------
// Command dispatch — the ONLY way rules state changes
// ---------------------------------------------------------------------------

// Pre-validate exactly what the rules engine would reject, so the command log
// only ever contains successful commands (replay demands gapless ids and
// errors on any rejected command).
function precheck(cmd) {
  const st = session.state;
  if (!st || st.status !== 'active') return 'not-active';
  const cellOk = (i) => Number.isInteger(i) && i >= 0 && i < st.cells.length && st.cells[i];
  switch (cmd.type) {
    case 'letter': {
      if (!cellOk(cmd.cell)) return 'bad-cell';
      if (!/^[A-Z]$/.test(String(cmd.ch || '').toUpperCase())) return 'bad-letter';
      if (!R.canType(st, cmd.cell)) return 'locked-cell';
      return null;
    }
    case 'clear': {
      if (!cellOk(cmd.cell)) return 'bad-cell';
      if (R.isLocked(st.cells[cmd.cell])) return 'locked-cell';
      if (st.cells[cmd.cell].cur === '') return 'nothing-to-clear';
      return null;
    }
    case 'check': {
      if (st.limits.checks !== null && st.checksUsed >= st.limits.checks) return 'check-limit';
      const scope = cmd.scope || 'grid';
      if (scope === 'cell') return cellOk(cmd.cell) ? null : 'bad-cell';
      if (scope === 'word') return Number.isInteger(cmd.entry) && st.entries[cmd.entry] ? null : 'bad-word';
      return scope === 'grid' ? null : 'bad-scope';
    }
    case 'reveal': {
      if (!cellOk(cmd.cell)) return 'bad-cell';
      const c = st.cells[cmd.cell];
      if (R.isLocked(c)) return 'locked-cell';
      if (c.cur !== '' && c.cur === c.sol) return 'already-correct';
      return null;
    }
    case 'giveUp':
      return null;
    default:
      return 'unknown-command';
  }
}

function dispatch(cmd) {
  if (!session.state) return null;
  const illegal = precheck(cmd);
  if (illegal) {
    handleInvalid(illegal);
    return { error: illegal };
  }
  const full = { ...cmd, id: session.state.nextCmdId, at: Math.floor(elapsed()) };
  const r = R.applyCommand(session.state, full);
  if (r.error) { // should not happen after precheck; stay consistent if it does
    handleInvalid(r.error);
    return r;
  }
  session.state = r.state;
  session.commands.push(full);
  handleEvents(r.events);
  updateHud();
  renderCells();
  updateSelection();
  advanceTutorial(r.events);
  if (session.state.status !== 'active') endRound();
  return r;
}

const ERROR_TEXT = {
  'locked-cell': 'That letter is locked — it was confirmed or revealed.',
  'bad-cell': 'That square is not part of the grid.',
  'bad-letter': 'Only letters A–Z can be entered.',
  'duplicate-id': 'Action already applied.',
  'out-of-order': 'Action arrived out of order.',
  'check-limit': 'No checks left for this round.',
  'nothing-to-clear': 'That square is already empty.',
  'already-correct': 'That letter is already correct.',
  'unknown-command': 'Unknown action.',
  'not-active': 'The round is over.',
  'bad-scope': 'Unknown check scope.',
  'bad-word': 'No such word.',
};

function handleInvalid(reason) {
  audio.play('invalid');
  haptic(30);
  announceError(ERROR_TEXT[reason] || `Invalid action: ${reason}`);
}

function handleEvents(events) {
  for (const ev of events) {
    switch (ev.type) {
      case 'letter':
        audio.play(ev.correct ? 'correct' : 'key');
        haptic(8);
        break;
      case 'word': {
        audio.play('word');
        haptic(20);
        const e = session.state.entries[ev.entry];
        toast(`Word complete: ${e.number} ${e.dir} (streak ${ev.streak})`);
        $('hud-score').textContent = String(session.state.score.total);
        break;
      }
      case 'check':
        audio.play('check');
        if (ev.wrong.length) announceError(`${ev.wrong.length} wrong letter${ev.wrong.length > 1 ? 's' : ''} flagged.`);
        break;
      case 'reveal':
        audio.play('reveal');
        break;
      case 'win':
        audio.play('win');
        haptic(60);
        break;
      case 'lose':
        audio.play('lose');
        haptic(60);
        break;
    }
  }
}

// Time-limit watchdog: rules only evaluate limits on a command, so when the
// clock runs out we commit a neutral nudge (retype an existing letter) at the
// current elapsed time to let the engine declare time-limit.
setInterval(() => {
  if (!active() || !session.state) return;
  const lim = session.state.limits.timeMs;
  if (lim === null || elapsed() < lim) return;
  const st = session.state;
  let cell = st.cells.findIndex((c) => c && c.cur !== '' && !R.isLocked(c));
  if (cell >= 0) {
    dispatch({ type: 'letter', cell, ch: st.cells[cell].cur });
  } else {
    // No retypable cell: every filled square is locked. Find any unlocked
    // (necessarily empty) square and nudge it with a deliberately wrong
    // letter. A round with all squares locked is already complete, so an
    // active round always has one — never dispatch into a locked cell, or
    // the rejection loop would suppress the time-limit loss forever.
    cell = st.cells.findIndex((c) => c && !R.isLocked(c));
    if (cell >= 0) {
      const sol = st.cells[cell].sol;
      dispatch({ type: 'letter', cell, ch: sol === 'A' ? 'B' : 'A' });
    }
  }
  updateHud();
}, 500);

// Live HUD clock.
setInterval(() => {
  if (!session.def || (session.phase !== 'active' && session.phase !== 'paused')) return;
  $('hud-timer').textContent = fmtTime(elapsed());
  // One-shot warning with 30 s left on a time-limited round (sound + text cue).
  const lim = session.state?.limits.timeMs;
  if (active() && lim && !session.timeWarned) {
    const left = lim - elapsed();
    if (left > 0 && left <= 30000) {
      session.timeWarned = true;
      audio.play('timeWarning');
      haptic(40);
      toast('30 seconds left!');
      announceError('30 seconds left.');
    }
  }
}, 250);

// ---------------------------------------------------------------------------
// Board render: semantic DOM grid (the accessible truth)
// ---------------------------------------------------------------------------

let cellButtons = []; // index -> button | null
let cellNumbers = new Map();

function buildBoard() {
  const d = session.def;
  const board = $('board');
  board.innerHTML = '';
  board.style.gridTemplateColumns = `repeat(${d.cols}, minmax(0, 1fr))`;
  board.style.width = `min(92vw, ${Math.max(320, d.cols * 56)}px)`;
  board.style.maxWidth = '62vh';
  cellButtons = new Array(d.rows * d.cols).fill(null);
  cellNumbers = new Map();
  for (const e of d.entries) {
    if (!cellNumbers.has(e.cells[0])) cellNumbers.set(e.cells[0], e.number);
  }
  for (let r = 0; r < d.rows; r++) {
    for (let c = 0; c < d.cols; c++) {
      const i = r * d.cols + c;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cell';
      btn.dataset.index = i;
      btn.setAttribute('role', 'gridcell');
      if (d.cells[i] === null) {
        btn.classList.add('void');
        btn.tabIndex = -1;
        btn.setAttribute('aria-hidden', 'true');
      } else {
        btn.addEventListener('click', () => onCellTap(i));
        cellButtons[i] = btn;
      }
      const num = cellNumbers.get(i);
      if (num !== undefined) {
        const n = document.createElement('span');
        n.className = 'cell-num';
        n.textContent = num;
        n.setAttribute('aria-hidden', 'true');
        btn.appendChild(n);
      }
      board.appendChild(btn);
    }
  }
  renderCells();
}

function cellAriaLabel(i) {
  const st = session.state;
  const r = R.rowOf(st, i) + 1;
  const c = R.colOf(st, i) + 1;
  const cell = st.cells[i];
  const parts = [`Row ${r} column ${c}`];
  parts.push(cell.cur === '' ? 'empty' : `letter ${cell.cur}`);
  if (cell.flag & R.FLAG.CONFIRMED) parts.push('confirmed');
  if (cell.flag & R.FLAG.REVEALED) parts.push('revealed');
  if (cell.flag & R.FLAG.WRONG) parts.push('wrong');
  const num = cellNumbers.get(i);
  if (num !== undefined) parts.push(`starts clue ${num}`);
  return parts.join(', ');
}

function renderCells() {
  const st = session.state;
  if (!st) return;
  for (let i = 0; i < cellButtons.length; i++) {
    const btn = cellButtons[i];
    if (!btn) continue;
    const cell = st.cells[i];
    btn.textContent = cell.cur;
    const num = cellNumbers.get(i);
    if (num !== undefined) {
      const n = document.createElement('span');
      n.className = 'cell-num';
      n.textContent = num;
      n.setAttribute('aria-hidden', 'true');
      btn.appendChild(n);
    }
    btn.classList.toggle('confirmed', (cell.flag & R.FLAG.CONFIRMED) !== 0);
    btn.classList.toggle('wrong', (cell.flag & R.FLAG.WRONG) !== 0);
    btn.classList.toggle('revealed', (cell.flag & R.FLAG.REVEALED) !== 0);
    btn.setAttribute('aria-label', cellAriaLabel(i));
  }
  markSelectedCells();
  announceBoardSummary();
}

function announceBoardSummary() {
  const st = session.state;
  if (!st) return;
  $('board-summary').textContent =
    `Grid ${st.rows} by ${st.cols}. ${st.filledCorrect} of ${st.filledTotal} letters correct. ` +
    `${st.wordsDone} of ${st.entries.length} words complete.`;
}

// Entries containing a cell in a given direction.
function entriesAt(i) {
  const out = { across: -1, down: -1 };
  session.def.entries.forEach((e, idx) => {
    if (e.cells.includes(i)) out[e.dir] = idx;
  });
  return out;
}

function currentEntryIdx() {
  if (session.sel.cell === null) return -1;
  const at = entriesAt(session.sel.cell);
  if (at[session.sel.dir] >= 0) return at[session.sel.dir];
  return at.across >= 0 ? at.across : at.down;
}

function markSelectedCells() {
  const st = session.state;
  if (!st) return;
  const ei = currentEntryIdx();
  const inEntry = new Set(ei >= 0 ? session.def.entries[ei].cells : []);
  for (let i = 0; i < cellButtons.length; i++) {
    const btn = cellButtons[i];
    if (!btn) continue;
    btn.classList.toggle('in-entry', inEntry.has(i));
    btn.classList.toggle('selected', i === session.sel.cell);
    btn.tabIndex = i === session.sel.cell ? 0 : -1;
  }
  // Current clue text
  const clueEl = $('current-clue');
  if (ei >= 0) {
    const e = session.def.entries[ei];
    clueEl.textContent = `${e.number} ${e.dir === 'across' ? 'Across' : 'Down'} — ${e.clue}`;
    for (const li of document.querySelectorAll('.clue')) {
      li.setAttribute('aria-current', li.dataset.entry === String(ei) ? 'true' : 'false');
    }
  } else {
    clueEl.textContent = 'Select a square to begin.';
  }
}

function updateSelection() { markSelectedCells(); }

function buildClueLists() {
  const d = session.def;
  const box = $('clue-lists');
  box.innerHTML = '';
  for (const dir of ['across', 'down']) {
    const h = document.createElement('p');
    h.className = 'clue-dir-heading';
    h.textContent = dir === 'across' ? 'Across' : 'Down';
    box.appendChild(h);
    d.entries.forEach((e, idx) => {
      if (e.dir !== dir) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'clue';
      btn.dataset.entry = idx;
      const num = document.createElement('span');
      num.className = 'clue-num';
      num.textContent = e.number;
      btn.appendChild(num);
      btn.appendChild(document.createTextNode(e.clue));
      btn.addEventListener('click', () => {
        session.sel = { cell: e.cells[0], dir };
        session.roundMechanics.add('clue-nav');
        updateSelection();
        audio.play('select');
        focusSelectedCell();
      });
      box.appendChild(btn);
    });
  }
}

function updateClueStates() {
  const st = session.state;
  if (!st) return;
  for (const li of document.querySelectorAll('.clue')) {
    const idx = Number(li.dataset.entry);
    li.classList.toggle('done', R.entryComplete(st, idx));
  }
}

function updateHud() {
  const st = session.state;
  if (!st) return;
  $('hud-timer').textContent = fmtTime(elapsed());
  $('hud-limit').textContent = st.limits.timeMs ? ` / ${fmtTime(st.limits.timeMs)}` : '';
  $('hud-score').textContent = String(st.score.total);
  $('hud-streak').textContent = String(st.streak);
  const pct = st.filledTotal ? Math.round((st.filledCorrect / st.filledTotal) * 100) : 0;
  $('progress').value = pct;
  $('progress-text').textContent = `${pct}%`;
  updateClueStates();
  // assists availability
  const checksOut = st.limits.checks !== null && st.checksUsed >= st.limits.checks;
  $('act-check-word').disabled = checksOut;
  $('act-check-grid').disabled = checksOut;
  $('tray-check').disabled = checksOut;
}

function focusSelectedCell() {
  const btn = session.sel.cell !== null ? cellButtons[session.sel.cell] : null;
  if (btn) btn.focus();
}

// ---------------------------------------------------------------------------
// Input: pointer + keyboard
// ---------------------------------------------------------------------------

function onCellTap(i) {
  if (!active()) return;
  audio.unlock();
  if (session.sel.cell === i) {
    // re-tap toggles direction when the cell has both
    const at = entriesAt(i);
    if (at.across >= 0 && at.down >= 0) {
      session.sel.dir = session.sel.dir === 'across' ? 'down' : 'across';
    }
  } else {
    const at = entriesAt(i);
    session.sel = { cell: i, dir: at[session.sel.dir] >= 0 ? session.sel.dir : (at.across >= 0 ? 'across' : 'down') };
  }
  audio.play('select');
  updateSelection();
}

function moveSelection(dr, dc) {
  const st = session.state;
  if (!st || session.sel.cell === null) return;
  let r = R.rowOf(st, session.sel.cell);
  let c = R.colOf(st, session.sel.cell);
  for (let step = 0; step < st.rows * st.cols; step++) {
    r = (r + dr + st.rows) % st.rows;
    c = (c + dc + st.cols) % st.cols;
    const i = r * st.cols + c;
    if (st.cells[i]) {
      session.sel.cell = i;
      const at = entriesAt(i);
      if (dr !== 0 && at.down >= 0) session.sel.dir = 'down';
      if (dc !== 0 && at.across >= 0) session.sel.dir = 'across';
      break;
    }
  }
  updateSelection();
  focusSelectedCell();
}

function nextEntry(delta) {
  const d = session.def;
  const ei = currentEntryIdx();
  if (ei < 0) return;
  const n = d.entries.length;
  const next = d.entries[(ei + delta + n) % n];
  session.sel = { cell: next.cells[0], dir: next.dir };
  updateSelection();
  focusSelectedCell();
}

function advanceAfterLetter() {
  const st = session.state;
  const ei = currentEntryIdx();
  if (ei < 0) return;
  const cells = session.def.entries[ei].cells;
  const pos = cells.indexOf(session.sel.cell);
  for (let k = pos + 1; k < cells.length; k++) {
    const i = cells[k];
    if (R.canType(st, i) && st.cells[i].cur === '') {
      session.sel.cell = i;
      return;
    }
  }
  for (let k = pos + 1; k < cells.length; k++) {
    if (R.canType(st, cells[k])) { session.sel.cell = cells[k]; return; }
  }
}

function typeLetter(ch) {
  if (!active() || session.sel.cell === null) return;
  const r = dispatch({ type: 'letter', cell: session.sel.cell, ch });
  if (r && !r.error) advanceAfterLetter();
  updateSelection();
}

function clearCell() {
  if (!active() || session.sel.cell === null) return;
  dispatch({ type: 'clear', cell: session.sel.cell });
}

function checkWord() {
  if (!active()) return;
  const ei = currentEntryIdx();
  if (ei >= 0) {
    session.roundMechanics.add('check');
    dispatch({ type: 'check', scope: 'word', entry: ei });
  }
}

function checkGrid() {
  if (!active()) return;
  session.roundMechanics.add('check');
  dispatch({ type: 'check', scope: 'grid' });
}

function revealHint() {
  if (!active()) return;
  const hint = R.getHint(session.state, currentEntryIdx() >= 0 ? currentEntryIdx() : null);
  if (!hint) { announceError('Nothing to reveal — the grid is complete.'); return; }
  session.roundMechanics.add('reveal');
  session.sel.cell = hint.cell;
  dispatch({ type: 'reveal', cell: hint.cell });
}

function giveUp() {
  if (!active() && session.phase !== 'paused') return;
  if (!window.confirm('Give up this round? It will count as a loss.')) return;
  if (session.phase === 'paused') resumeRound();
  dispatch({ type: 'giveUp' });
}

document.addEventListener('keydown', (ev) => {
  if (ev.defaultPrevented) return;
  const tag = document.activeElement?.tagName;
  const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

  if (ev.key === 'Escape') {
    if (session.phase === 'active') { ev.preventDefault(); pauseRound(); }
    else if (session.phase === 'paused') { ev.preventDefault(); resumeRound(); }
    return;
  }
  if (!active() || typing) return;

  // Letters type into the selected square whenever the board has focus.
  // H/C/G act as command shortcuts when focus is off the grid (e.g. clue
  // list), so the letters H, C and G remain typeable during play.
  const boardFocused = !!document.activeElement?.closest?.('.board');
  if (!boardFocused && /^[hHcCgG]$/.test(ev.key)) {
    ev.preventDefault();
    const k = ev.key.toUpperCase();
    if (k === 'H') revealHint();
    if (k === 'C') checkWord();
    if (k === 'G') checkGrid();
    return;
  }

  if (/^[a-zA-Z]$/.test(ev.key)) {
    ev.preventDefault();
    audio.unlock();
    typeLetter(ev.key.toUpperCase());
    return;
  }
  // Enter/Space/Tab keep their native behavior on focused controls outside
  // the board (clue list, action buttons, tray) so keyboard users can
  // activate them; the board itself uses them for clue navigation.
  const onOuterControl = !boardFocused &&
    !!document.activeElement?.closest?.('button, a, [role="button"]');
  switch (ev.key) {
    case 'Backspace':
    case 'Delete':
      ev.preventDefault(); clearCell(); break;
    case 'ArrowUp': ev.preventDefault(); moveSelection(-1, 0); break;
    case 'ArrowDown': ev.preventDefault(); moveSelection(1, 0); break;
    case 'ArrowLeft': ev.preventDefault(); moveSelection(0, -1); break;
    case 'ArrowRight': ev.preventDefault(); moveSelection(0, 1); break;
    case 'Enter':
      if (onOuterControl) return;
      ev.preventDefault(); nextEntry(ev.shiftKey ? -1 : 1); break;
    case 'Tab':
      if (!boardFocused) return; // allow normal focus navigation
      ev.preventDefault(); nextEntry(ev.shiftKey ? -1 : 1); break;
    case ' ':
      if (onOuterControl) return;
      ev.preventDefault(); onCellTap(session.sel.cell); break;
  }
});

// Backgrounding pauses the solo clock.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && session.phase === 'active') pauseRound('hidden-tab');
});

function pauseRound(reason = 'user') {
  if (session.phase !== 'active') return;
  session.accruedMs = elapsed();
  if (reason === 'user') audio.play('pause');
  transition('paused', reason);
}

function resumeRound() {
  if (session.phase !== 'paused') return;
  session.startStamp = performance.now();
  transition('active', 'resume');
  focusSelectedCell();
}

// ---------------------------------------------------------------------------
// Tutorial (Learn mode): steps advance only when the player performs the
// required action through the rules API.
// ---------------------------------------------------------------------------

function setupTutorial() {
  const steps = session.def.tutorial?.steps || [];
  if (!steps.length) { $('tutorial-banner').hidden = true; return; }
  session.tutorialStep = 0;
  showTutorialStep();
}

function showTutorialStep() {
  const steps = session.def.tutorial.steps;
  const banner = $('tutorial-banner');
  if (session.tutorialStep >= steps.length) {
    banner.hidden = true;
    return;
  }
  const step = steps[session.tutorialStep];
  banner.textContent = `Lesson ${session.tutorialStep + 1} of ${steps.length}: ${step.text}`;
  banner.hidden = false;
  for (const btn of cellButtons) if (btn) btn.classList.remove('tutorial-focus');
  if (step.focus != null && cellButtons[step.focus]) {
    cellButtons[step.focus].classList.add('tutorial-focus');
    session.sel.cell = step.focus;
    updateSelection();
  }
}

function advanceTutorial(events) {
  const tut = session.def?.tutorial;
  if (!tut || session.tutorialStep >= tut.steps.length) return;
  const step = tut.steps[session.tutorialStep];
  const st = session.state;
  const req = step.require;
  let done = false;
  switch (req.type) {
    case 'any-letter':
      done = events.some((e) => e.type === 'letter');
      break;
    case 'complete-entry':
      done = R.entryComplete(st, req.entry);
      break;
    case 'any-word':
      done = events.some((e) => e.type === 'word');
      break;
    case 'any-check':
      done = events.some((e) => e.type === 'check');
      break;
    case 'any-reveal':
      done = events.some((e) => e.type === 'reveal');
      break;
    case 'grid-complete':
      done = st.status === 'won';
      break;
  }
  if (done) {
    session.tutorialStep++;
    if (session.tutorialStep < tut.steps.length) {
      showTutorialStep();
      toast('Lesson complete!');
      audio.play('lesson');
    } else {
      store.tutorialDone = true;
      saveStore();
      $('tutorial-banner').hidden = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Mode select + title wiring
// ---------------------------------------------------------------------------

const MODE_INFO = {
  learn: {
    name: 'Learn — First Page',
    desc: 'Interactive lessons: one rule at a time. ~3 minutes.',
    meta: 'Tutorial · unranked',
  },
  journey: {
    name: 'Journey',
    desc: '40 authored pages across five regions; mastery every eighth page.',
    meta: 'Progress saved locally',
  },
  daily: {
    name: 'Daily Challenge',
    desc: 'One shared grid per UTC day, synchronized to server time. ~5–15 minutes.',
    meta: 'Ranked leaderboard',
  },
  practice: {
    name: 'Practice',
    desc: 'Fresh grid at your chosen difficulty. Restart freely.',
    meta: 'Casual · unranked',
  },
  challenge: {
    name: 'Challenges',
    desc: 'Constrained goals: time limits, few checks, big grids.',
    meta: 'Ranked · bonus multiplier',
  },
};

function buildModeList() {
  const list = $('mode-list');
  list.innerHTML = '';
  const addItem = ({ label, desc, meta, disabled, stars, onPick }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mode-item';
    btn.setAttribute('role', 'listitem');
    if (disabled) btn.disabled = true;
    const name = document.createElement('span');
    name.className = 'mode-name';
    name.textContent = label;
    btn.appendChild(name);
    if (stars) {
      const s = document.createElement('span');
      s.className = 'mode-stars';
      s.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
      s.setAttribute('aria-label', `${stars} of 3 stars`);
      btn.appendChild(s);
    }
    const d = document.createElement('span');
    d.className = 'mode-desc';
    d.textContent = desc;
    btn.appendChild(d);
    if (meta) {
      const m = document.createElement('span');
      m.className = 'mode-meta';
      m.textContent = meta;
      btn.appendChild(m);
    }
    btn.addEventListener('click', onPick);
    list.appendChild(btn);
  };

  for (const key of ['learn', 'daily', 'practice']) {
    addItem({
      label: MODE_INFO[key].name,
      desc: MODE_INFO[key].desc,
      meta: MODE_INFO[key].meta,
      onPick: () => startMode(key),
    });
  }
  addItem({
    label: MODE_INFO.journey.name,
    desc: MODE_INFO.journey.desc,
    meta: `Unlocked through page ${store.journey.unlocked} of 40`,
    onPick: () => buildJourneyList(),
  });
  addItem({
    label: MODE_INFO.challenge.name,
    desc: MODE_INFO.challenge.desc,
    meta: MODE_INFO.challenge.meta,
    onPick: () => buildChallengeList(),
  });
}

function buildJourneyList() {
  const list = $('mode-list');
  list.innerHTML = '';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'chip-btn';
  back.textContent = '← All modes';
  back.addEventListener('click', buildModeList);
  list.appendChild(back);
  const stages = C.journeyStages();
  for (const def of stages) {
    const n = Number(def.id.replace('journey-', ''));
    const locked = n > store.journey.unlocked;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mode-item';
    if (locked) btn.disabled = true;
    const stars = store.journey.stars[n] || 0;
    btn.innerHTML = '';
    const name = document.createElement('span');
    name.className = 'mode-name';
    name.textContent = `${n}. ${def.name}`;
    btn.appendChild(name);
    const s = document.createElement('span');
    s.className = 'mode-stars';
    s.textContent = locked ? '🔒' : '★'.repeat(stars) + '☆'.repeat(3 - stars);
    btn.appendChild(s);
    const d = document.createElement('span');
    d.className = 'mode-desc';
    d.textContent = locked ? 'Finish the previous page to unlock.' : (def.blurb || `${def.pattern}, difficulty ${def.maxDifficulty}`);
    btn.appendChild(d);
    btn.addEventListener('click', () => { if (!locked) startRound(def); });
    list.appendChild(btn);
  }
}

function buildChallengeList() {
  const list = $('mode-list');
  list.innerHTML = '';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'chip-btn';
  back.textContent = '← All modes';
  back.addEventListener('click', buildModeList);
  list.appendChild(back);
  for (const def of C.challengeDefs()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mode-item';
    const name = document.createElement('span');
    name.className = 'mode-name';
    name.textContent = def.name;
    const d = document.createElement('span');
    d.className = 'mode-desc';
    d.textContent = def.blurb;
    const m = document.createElement('span');
    m.className = 'mode-meta';
    m.textContent = `Ranked · ×${def.mult} points`;
    btn.append(name, d, m);
    btn.addEventListener('click', () => startRound(def));
    list.appendChild(btn);
  }
}

function pickPractice() {
  const list = $('mode-list');
  list.innerHTML = '';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'chip-btn';
  back.textContent = '← All modes';
  back.addEventListener('click', buildModeList);
  list.appendChild(back);
  for (const diff of ['easy', 'medium', 'hard']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mode-item';
    const name = document.createElement('span');
    name.className = 'mode-name';
    name.textContent = `Practice — ${diff}`;
    const d = document.createElement('span');
    d.className = 'mode-desc';
    d.textContent = { easy: 'Small 5×5 pages, common words.', medium: '6–7 wide pages, moderate words.', hard: 'Big 7–9 wide pages, tricky words.' }[diff];
    const m = document.createElement('span');
    m.className = 'mode-meta';
    m.textContent = 'Casual · unranked · restart anytime';
    btn.append(name, d, m);
    btn.addEventListener('click', () => startRound(C.practiceDef(diff)));
    list.appendChild(btn);
  }
}

function startMode(key) {
  if (key === 'learn') return startRound(C.learnDef(), { tutorial: true });
  if (key === 'daily') return startRound(C.dailyForDate(new Date(serverNow())));
  if (key === 'practice') return pickPractice();
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function renderResults(validEnvelope) {
  const st = session.state;
  const d = session.def;
  const won = st.status === 'won';
  const reasons = {
    'grid-complete': 'Page complete!',
    'time-limit': 'Out of time.',
    'mistake-limit': 'Too many mistakes.',
    'gave-up': 'You gave up.',
  };
  $('results-headline').textContent = won ? `✦ ${reasons[st.terminalReason]}` : reasons[st.terminalReason];
  const art = $('results-art');
  if (art) {
    art.hidden = false;
    art.src = won ? 'assets/results-win.webp' : 'assets/results-lose.webp';
  }
  $('results-live').textContent =
    `${won ? 'Won' : 'Lost'}: ${d.name}. Score ${st.score.total}. ` +
    `${st.filledCorrect} of ${st.filledTotal} letters correct.`;

  const rows = [
    ['Letters', st.score.letters],
    ['Words', st.score.words],
    [`Streak bonus (best ×${st.bestStreak})`, st.score.streak],
    ['Time bonus', st.score.time],
    [`Assists (${st.checksUsed} checks, ${st.revealsUsed} reveals)`, st.score.assists],
    ['Completion bonus', st.score.complete],
  ];
  const dl = $('results-breakdown');
  dl.innerHTML = '';
  for (const [label, val] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(val);
    dl.append(dt, dd);
  }
  const dt = document.createElement('dt');
  dt.textContent = 'Total';
  dt.className = 'total';
  const dd = document.createElement('dd');
  dd.textContent = String(st.score.total);
  dd.className = 'total';
  const wrapT = document.createElement('div');
  wrapT.className = 'total';
  wrapT.style.display = 'contents';
  wrapT.append(dt, dd);
  dl.appendChild(wrapT);

  $('results-meta').textContent =
    `${d.name} · ${fmtTime(st.elapsedMs)} · ${st.wordsDone}/${st.entries.length} words · ` +
    `${st.invalid} invalid actions · ${d.ranked ? 'ranked' : 'unranked'}`;

  const ach = $('results-achievements');
  ach.innerHTML = '';
  for (const id of session.newAchievements) {
    const el = document.createElement('span');
    el.className = 'achievement';
    el.textContent = `🏅 ${ACHIEVEMENTS[id].name}`;
    ach.appendChild(el);
  }

  // Submit when the local replay verified.
  $('results-rank').textContent = '';
  if (validEnvelope) {
    postScore(validEnvelope, {
      name: store.profile.name,
      sessionId: session.sessionId,
      score: st.score.total,
      status: st.status,
    }).then((r) => {
      if (r.ok) $('results-rank').textContent = `Leaderboard “${r.board}”: rank #${r.rank}`;
      else $('results-rank').textContent = `Score not submitted (${r.error}).`;
    });
  } else {
    $('results-rank').textContent = 'Score not submitted (verification failed).';
  }

  // Next recommended action.
  const next = $('btn-next');
  const label = $('next-label');
  if (d.mode === 'journey' && won) {
    const n = Number(d.id.replace('journey-', ''));
    if (n < 40) {
      label.textContent = `Next page: ${n + 1}`;
      next.onclick = () => startRound(C.journeyStage(n + 1));
    } else {
      label.textContent = 'Journey complete — Daily';
      next.onclick = () => startMode('daily');
    }
  } else if (d.mode === 'learn') {
    label.textContent = 'Try the Daily Challenge';
    next.onclick = () => startMode('daily');
  } else if (d.mode === 'practice') {
    label.textContent = 'New practice grid';
    next.onclick = () => startRound(C.practiceDef(practiceDifficultyOf(d)));
  } else {
    label.textContent = 'Back to modes';
    next.onclick = () => { buildModeList(); transition('modes', 'next'); };
  }
  $('btn-retry').onclick = () => startRound(d, { tutorial: !!d.tutorial && !store.tutorialDone });
}

function practiceDifficultyOf(def) {
  const m = /^practice-(easy|medium|hard)/.exec(def.id);
  return m ? m[1] : 'medium';
}

// ---------------------------------------------------------------------------
// Settings / help / pause wiring
// ---------------------------------------------------------------------------

let allMuted = false;

function openSettingsFromForm() {
  const s = store.settings;
  $('set-name').value = store.profile.name;
  $('set-vol-music').value = Math.round(s.volMusic * 100);
  $('set-vol-effects').value = Math.round(s.volEffects * 100);
  $('set-vol-ambience').value = Math.round(s.volAmbience * 100);
  const themeSel = $('set-theme');
  themeSel.innerHTML = '';
  for (const t of C.THEMES) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    themeSel.appendChild(opt);
  }
  themeSel.value = s.theme;
  $('set-quality').value = s.quality;
  $('set-reduced-motion').checked = s.reducedMotion;
  $('set-high-contrast').checked = s.highContrast;
  $('set-cvd').checked = s.cvd;
  $('set-large-text').checked = s.largeText;
  $('set-left-handed').checked = s.leftHanded;
  $('set-haptics').checked = s.haptics;
}

function wireSettings() {
  const s = store.settings;
  const bind = (id, fn) => $(id).addEventListener('change', fn);
  bind('set-name', (e) => { store.profile.name = e.target.value.trim().slice(0, 24) || 'Guest'; saveStore(); refreshTitle(); });
  bind('set-vol-music', (e) => { s.volMusic = e.target.value / 100; applySettings(); });
  bind('set-vol-effects', (e) => { s.volEffects = e.target.value / 100; applySettings(); audio.play('correct'); });
  bind('set-vol-ambience', (e) => { s.volAmbience = e.target.value / 100; applySettings(); });
  bind('set-theme', (e) => { s.theme = e.target.value; applySettings(); });
  bind('set-quality', (e) => { s.quality = e.target.value; applyQuality(); rebuildScene(); saveStore(); });
  bind('set-reduced-motion', (e) => { s.reducedMotion = e.target.checked; applySettings(); });
  bind('set-high-contrast', (e) => { s.highContrast = e.target.checked; applySettings(); });
  bind('set-cvd', (e) => { s.cvd = e.target.checked; applySettings(); });
  bind('set-large-text', (e) => { s.largeText = e.target.checked; applySettings(); });
  bind('set-left-handed', (e) => { s.leftHanded = e.target.checked; applySettings(); });
  bind('set-haptics', (e) => { s.haptics = e.target.checked; saveStore(); });
  $('btn-settings-back').addEventListener('click', goBackFromSub);
  $('btn-replay-tutorial').addEventListener('click', () => startRound(C.learnDef(), { tutorial: true }));
}

function buildHelpCards() {
  const cards = [
    ['Enter letters', 'Type <kbd>A</kbd>–<kbd>Z</kbd> with the keyboard, or tap a square and type. Letters shared between crossing words fill both.'],
    ['Move around', '<kbd>Arrow keys</kbd> move the selection. <kbd>Enter</kbd>/<kbd>Tab</kbd> jumps to the next clue. Tap a clue in the list to select its word.'],
    ['Direction', 'Tap the selected square again (or press <kbd>Space</kbd>) to switch between Across and Down.'],
    ['Fix mistakes', '<kbd>Backspace</kbd> clears a square. Locked letters (confirmed ✓ or revealed ◆) cannot be changed.'],
    ['Check', '<kbd>C</kbd> checks the current word, <kbd>G</kbd> checks the grid (from the clue list, or via the action buttons). Correct letters lock with ✓; wrong ones are flagged ✗. Each check costs a few points.'],
    ['Reveal', '<kbd>H</kbd> reveals one letter (◆) at a small score cost. Checks and reveals never lock you out of finishing.'],
    ['Pause', '<kbd>Esc</kbd> pauses. The clock stops while paused or while the tab is hidden.'],
    ['Winning', 'Fill every square correctly to complete the page. Score = letters + words + streaks + time bonus − assists.'],
  ];
  const box = $('help-cards');
  box.innerHTML = '';
  for (const [title, html] of cards) {
    const card = document.createElement('article');
    card.className = 'help-card';
    const h = document.createElement('h3');
    h.textContent = title;
    const p = document.createElement('p');
    p.innerHTML = html;
    card.append(h, p);
    box.appendChild(card);
  }
  $('btn-help-back').addEventListener('click', goBackFromSub);
}

let subReturnPhase = 'title';
function goBackFromSub() {
  if (subReturnPhase === 'paused') transition('paused', 'back-to-pause');
  else if (subReturnPhase === 'active') transition('active', 'back-to-round');
  else if (subReturnPhase === 'results') transition('results', 'back');
  else transition('title', 'back');
}

function wirePause() {
  $('pause-resume').addEventListener('click', resumeRound);
  $('pause-mute').addEventListener('click', () => {
    allMuted = !allMuted;
    audio.setMuted(allMuted);
    $('pause-mute').textContent = allMuted ? 'Unmute all' : 'Mute all';
  });
  $('pause-quality').addEventListener('click', () => {
    const order = ['low', 'medium', 'high'];
    const s = store.settings;
    s.quality = order[(order.indexOf(s.quality) + 1) % order.length];
    applyQuality();
    rebuildScene();
    saveStore();
    toast(`Quality: ${s.quality}`);
  });
  $('pause-contrast').addEventListener('click', () => {
    store.settings.highContrast = !store.settings.highContrast;
    applySettings();
  });
  $('pause-help').addEventListener('click', () => { subReturnPhase = 'paused'; $('overlay-pause').hidden = true; showScreen('screen-help'); });
  $('pause-leave').addEventListener('click', () => {
    $('overlay-pause').hidden = true;
    session.phase = 'title';
    transition('title', 'leave-round');
  });
}

// Compact-layout drawers: rails collapse behind a toggle on narrow screens.
function wireDrawers() {
  for (const rail of document.querySelectorAll('.rail')) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'rail-toggle';
    toggle.textContent = rail.classList.contains('rail-left') ? 'Objective & clues ▾' : 'Clue & actions ▾';
    const body = document.createElement('div');
    body.className = 'rail-body';
    while (rail.firstChild) body.appendChild(rail.firstChild);
    rail.append(toggle, body);
    const sync = () => {
      const compact = window.matchMedia('(max-width: 1023px)').matches;
      rail.classList.toggle('collapsed', compact);
      toggle.setAttribute('aria-expanded', String(!compact));
    };
    toggle.addEventListener('click', () => {
      const collapsed = rail.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));
    });
    window.matchMedia('(max-width: 1023px)').addEventListener('change', sync);
    sync();
  }
}

function refreshTitle() {
  $('profile-sub').textContent = store.profile.name;
  const stars = Object.values(store.journey.stars).reduce((a, b) => a + b, 0);
  $('journey-sub').textContent = `Page ${Math.min(store.journey.unlocked, 40)} of 40 · ${stars}★`;
  $('daily-sub').textContent = `${new Date(serverNow()).toISOString().slice(0, 10)} · ranked`;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function wireMenus() {
  $('btn-play').addEventListener('click', () => { audio.unlock(); buildModeList(); transition('modes', 'play'); });
  $('btn-daily').addEventListener('click', () => { audio.unlock(); startMode('daily'); });
  $('btn-journey').addEventListener('click', () => { audio.unlock(); buildJourneyList(); transition('modes', 'journey'); });
  $('btn-profile').addEventListener('click', () => { openSettingsFromForm(); subReturnPhase = 'title'; showScreen('screen-settings'); $('set-name').focus(); });
  $('btn-modes-back').addEventListener('click', () => transition('title', 'back'));
  $('nav-help').addEventListener('click', () => {
    subReturnPhase = session.phase === 'active' ? 'active' : session.phase === 'results' ? 'results' : 'title';
    if (session.phase === 'active') pauseRound();
    subReturnPhase = session.phase === 'paused' ? 'paused' : subReturnPhase;
    showScreen('screen-help');
  });
  $('nav-settings').addEventListener('click', () => {
    subReturnPhase = session.phase === 'active' ? 'active' : session.phase === 'results' ? 'results' : 'title';
    if (session.phase === 'active') pauseRound();
    subReturnPhase = session.phase === 'paused' ? 'paused' : subReturnPhase;
    openSettingsFromForm();
    showScreen('screen-settings');
  });

  // Play actions (rail + tray mirrors).
  $('act-check-word').addEventListener('click', checkWord);
  $('act-check-grid').addEventListener('click', checkGrid);
  $('act-reveal').addEventListener('click', revealHint);
  $('act-give-up').addEventListener('click', giveUp);
  $('act-pause').addEventListener('click', () => pauseRound());
  $('tray-check').addEventListener('click', checkWord);
  $('tray-reveal').addEventListener('click', revealHint);
  $('tray-dir').addEventListener('click', () => { if (session.sel.cell !== null) onCellTap(session.sel.cell); });
  $('tray-pause').addEventListener('click', () => pauseRound());
  $('btn-results-home').addEventListener('click', () => { refreshTitle(); transition('title', 'home'); });
}

function init() {
  applySettings();
  wireMenus();
  wireSettings();
  wirePause();
  wireDrawers();
  buildHelpCards();
  initThree();
  syncTime();
  setInterval(syncTime, 5 * 60 * 1000);
  refreshTitle();
  transition('title', 'boot-done');
}

init();
