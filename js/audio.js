// Crossword Journey — WebAudio synth: short original transients, a quiet
// ambient pad, and a simple adaptive music loop. Authored one-shot samples
// (sfx/*.opus, see sfx/manifest.json) are lazy-loaded after unlock and take
// priority; the synthesized effects remain as the loading/failure fallback.

let ctx = null;
let buses = null; // { music, effects, ambience }
let volumes = { music: 0.5, effects: 0.8, ambience: 0.4 };
let muted = false;
let musicTimer = null;
let ambienceNodes = null;
let started = false;

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const mk = () => {
    const g = ctx.createGain();
    g.connect(ctx.destination);
    return g;
  };
  buses = { music: mk(), effects: mk(), ambience: mk() };
  applyVolumes();
  return ctx;
}

function applyVolumes() {
  if (!buses) return;
  for (const [k, bus] of Object.entries(buses)) {
    bus.gain.value = muted ? 0 : volumes[k] * 0.5;
  }
}

// --- Transients ---------------------------------------------------------------

function blip(bus, { freq = 440, dur = 0.08, type = 'triangle', gain = 0.5, slide = 0 }) {
  if (!ensureCtx()) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(buses[bus]);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const EFFECTS = {
  key: (b) => blip(b, { freq: 520 + Math.random() * 60, dur: 0.06, gain: 0.3 }),
  correct: (b) => { blip(b, { freq: 660, dur: 0.09, gain: 0.35 }); blip(b, { freq: 880, dur: 0.12, gain: 0.25 }); },
  word: (b) => [523, 659, 784].forEach((f, i) => setTimeout(() => blip(b, { freq: f, dur: 0.12, gain: 0.3 }), i * 70)),
  win: (b) => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(b, { freq: f, dur: 0.22, gain: 0.32 }), i * 110)),
  lose: (b) => [392, 330, 262].forEach((f, i) => setTimeout(() => blip(b, { freq: f, dur: 0.25, gain: 0.3, type: 'sine' }), i * 140)),
  invalid: (b) => blip(b, { freq: 140, dur: 0.15, type: 'sawtooth', gain: 0.22, slide: -40 }),
  check: (b) => blip(b, { freq: 740, dur: 0.07, type: 'square', gain: 0.18 }),
  reveal: (b) => blip(b, { freq: 980, dur: 0.18, type: 'sine', gain: 0.3, slide: 220 }),
  select: (b) => blip(b, { freq: 340, dur: 0.04, gain: 0.18 }),
  // Round start / page turn: soft filtered noise-like sweep.
  pageTurn: (b) => blip(b, { freq: 220, dur: 0.18, type: 'triangle', gain: 0.16, slide: 260 }),
  // Pause: low soft thud (journal closing).
  pause: (b) => blip(b, { freq: 160, dur: 0.16, type: 'sine', gain: 0.28, slide: -90 }),
  // Achievement: stamp thud plus bright tail.
  achievement: (b) => { blip(b, { freq: 120, dur: 0.12, type: 'sine', gain: 0.32 }); setTimeout(() => blip(b, { freq: 1046, dur: 0.2, gain: 0.22 }), 60); },
  // Time warning: three quick ticks then a bell.
  timeWarning: (b) => { [0, 90, 180].forEach((t) => setTimeout(() => blip(b, { freq: 900, dur: 0.04, type: 'square', gain: 0.16 }), t)); setTimeout(() => blip(b, { freq: 1318, dur: 0.35, type: 'sine', gain: 0.24 }), 300); },
  // Lesson complete: quick rising flourish.
  lesson: (b) => blip(b, { freq: 440, dur: 0.16, type: 'triangle', gain: 0.22, slide: 400 }),
};

// --- Sampled one-shots --------------------------------------------------------
// Runtime event map for authored clips (sfx/manifest.json): every clip basename
// maps to the existing named event it backs; several clips may back one event
// as variants. Clips are fetched/decoded lazily, only after the user-gesture
// unlock created the AudioContext, and played through the effects bus.

const SFX_EVENTS = {
  'key-tap-a': 'key',
  'key-tap-b': 'key',
  'key-tap-c': 'key',
  'correct-letter': 'correct',
  'word-complete': 'word',
  'round-win': 'win',
  'round-lose': 'lose',
  'invalid-buzz': 'invalid',
  'check-mark': 'check',
  'reveal-shimmer': 'reveal',
  'select-tick-a': 'select',
  'select-tick-b': 'select',
  'page-turn': 'pageTurn',
  'book-close': 'pause',
  'passport-stamp': 'achievement',
  'time-warning': 'timeWarning',
  'pencil-flourish': 'lesson',
};

const EVENT_SAMPLES = {}; // event name -> [clip basenames]
for (const [name, ev] of Object.entries(SFX_EVENTS)) {
  (EVENT_SAMPLES[ev] ||= []).push(name);
}

// name -> AudioBuffer | Promise<AudioBuffer|null> | null (failed)
const sampleCache = new Map();

function loadSample(name) {
  if (sampleCache.has(name)) return sampleCache.get(name);
  const pending = fetch(`sfx/${name}.opus`)
    .then((r) => {
      if (!r.ok) throw new Error(`sfx ${name}: ${r.status}`);
      return r.arrayBuffer();
    })
    .then((bytes) => ctx.decodeAudioData(bytes))
    .then((buf) => {
      sampleCache.set(name, buf);
      return buf;
    })
    .catch(() => {
      sampleCache.set(name, null); // permanent fallback to synthesis
      return null;
    });
  sampleCache.set(name, pending);
  return pending;
}

// Play a decoded clip through the effects bus; returns false while the clip is
// still loading or failed so the caller can fall back to synthesis.
function playSample(name) {
  const entry = sampleCache.get(name);
  if (entry instanceof AudioBuffer) {
    const src = ctx.createBufferSource();
    src.buffer = entry;
    src.connect(buses.effects);
    src.start();
    return true;
  }
  if (entry === undefined) loadSample(name); // kick off the lazy fetch/decode
  return false; // still loading, or previously failed
}

// Pick a clip for an event (random variant when several exist) and try to play
// it; false means synthesis should run instead.
function playEventSample(name) {
  const names = EVENT_SAMPLES[name];
  if (!names || !names.length) return false;
  const pick = names.length > 1 ? names[Math.floor(Math.random() * names.length)] : names[0];
  return playSample(pick);
}

// --- Ambience: quiet filtered noise wash ---------------------------------------

function startAmbience() {
  if (!ensureCtx() || ambienceNodes) return;
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let v = 0;
  for (let i = 0; i < len; i++) {
    v = v * 0.98 + (Math.random() * 2 - 1) * 0.02; // brown-ish
    data[i] = v * 3;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 480;
  const g = ctx.createGain();
  g.gain.value = 0.35;
  src.connect(filt).connect(g).connect(buses.ambience);
  src.start();
  ambienceNodes = { src, g };
}

// --- Adaptive music: slow seeded arpeggio over a pentatonic scale --------------

const SCALE = [262, 294, 330, 392, 440, 523, 587, 659];
let musicStep = 0;
let musicIntensity = 0; // 0 menus, 1 active play, 2 endgame

function musicTick() {
  if (!ctx || muted) return;
  // deterministic-ish wander with light randomness
  musicStep += [1, 1, 2, -1, -2][Math.floor(Math.random() * 5)];
  musicStep = (musicStep + SCALE.length * 2) % SCALE.length;
  const f = SCALE[musicStep];
  blip('music', { freq: f, dur: 0.5, type: 'sine', gain: 0.12 + musicIntensity * 0.04 });
  if (musicIntensity > 0 && musicStep % 2 === 0) {
    blip('music', { freq: f / 2, dur: 0.7, type: 'triangle', gain: 0.08 });
  }
}

function startMusic() {
  if (!ensureCtx() || musicTimer) return;
  musicTimer = setInterval(musicTick, musicIntensity > 0 ? 420 : 700);
}
function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = null;
}

// --- Public API -----------------------------------------------------------------

export const audio = {
  unlock() {
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (!started) {
      started = true;
      startAmbience();
      startMusic();
    }
  },
  play(name) {
    if (!ctx || muted) return;
    // Prefer the authored sample; synthesize only while it loads or on failure.
    if (!playEventSample(name)) EFFECTS[name]?.('effects');
  },
  setVolume(bus, v) {
    if (bus in volumes) volumes[bus] = Math.max(0, Math.min(1, v));
    applyVolumes();
  },
  getVolume: (bus) => volumes[bus],
  setMuted(m) {
    muted = m;
    applyVolumes();
  },
  setIntensity(n) {
    musicIntensity = n;
    if (musicTimer) { stopMusic(); startMusic(); }
  },
  suspend() {
    if (ctx && ctx.state === 'running') ctx.suspend();
  },
  resume() {
    if (ctx && ctx.state === 'suspended' && started) ctx.resume();
  },
};
