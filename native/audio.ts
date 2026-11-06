// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, several clips backing one event as variants), the quiet
// low-passed brown-noise ambience loop and the pentatonic sine arpeggio
// (700 ms steps on the menus, 420 ms in play with a triangle bass on even
// steps). As in the browser build the ambience and the music start with the
// first press that starts something (audio unlock).
//
// The browser build's three buses become the runtime's (Options › Audio owns
// the volumes, the mute and the voice limit): music → "music", effects and
// ambience → "effects", the select tick → "interface"; the old default bus
// levels (music 50 %, effects 80 %, ambience 40 %, each × 0.5) are folded
// into each sound's gain. The ambience and the arpeggio's notes, which the
// browser build played with oscillators and a noise buffer, are rendered
// once into clips (OfflineAudioContext); the synthesized stand-ins it played while a
// sample loaded are not ported (the engine's web runtime drops clip loads
// while a synthesis graph changes). The one-shot clips all load at once in
// onStart (every loaded clip reaches the mixer, natively and on the web).
import { context, createClip, loadClip, OfflineAudioContext, play as playClip, SoundBank, type AudioClip } from "starhermit:audio";

const LEVEL = { music: 0.5 * 0.5, effects: 0.8 * 0.5, ambience: 0.4 * 0.5 };
const SFX_EVENTS: Record<string, string> = {
  "key-tap-a": "key", "key-tap-b": "key", "key-tap-c": "key",
  "correct-letter": "correct", "word-complete": "word", "round-win": "win", "round-lose": "lose",
  "invalid-buzz": "invalid", "check-mark": "check", "reveal-shimmer": "reveal",
  "select-tick-a": "select", "select-tick-b": "select", "page-turn": "pageTurn", "book-close": "pause",
  "passport-stamp": "achievement", "time-warning": "timeWarning", "pencil-flourish": "lesson",
};
const EVENT_SAMPLES: Record<string, string[]> = {};
for (const [name, ev] of Object.entries(SFX_EVENTS)) (EVENT_SAMPLES[ev] ??= []).push(name);
const banks = new Map<string, SoundBank>();
/** Loads every clip at once and renders the ambience and notes (onStart); a cue whose clips are still loading is skipped. */
export function loadSfx(): void {
  for (const [event, names] of Object.entries(EVENT_SAMPLES)) {
    void Promise.all(names.map((name) => loadClip(`sfx/${name}.opus`).catch((e: unknown) => { console.warn(`sfx ${name}: ${String(e)}`); return null; }))).then((loaded) => {
      const list = loaded.filter((c) => c !== null);
      if (list.length) banks.set(event, new SoundBank({ clips: list, bus: event === "select" ? "interface" : "effects", gain: LEVEL.effects }));
    });
  }
  renderTones().catch((e: unknown) => console.warn(`audio: ${String(e)}`));
}

let started = false;
/** The first press that starts something (js/audio.js unlock): the ambience and the music begin. */
export function unlock(): void { started = true; }

let intensity = 0;
/** 0 on the menus, 1 in play (the arpeggio's tempo and bass). */
export function setIntensity(n: number): void { intensity = n; }

/** Plays a logical event's sample (a random variant); still-loading samples are silent. */
export function play(event: string): void {
  if (!started) return;
  try { banks.get(event)?.play(); }
  catch { /* the mixer is full this frame: skip it */ }
}

// -- the rendered ambience and arpeggio ------------------------------------------------------
const RATE = 22050;
/** A blip as js/audio.js's: an oscillator from `level` falling exponentially to 0.001 over `dur`. */
async function renderBlip(freq: number, dur: number, type: "sine" | "triangle", level: number): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, Math.round((dur + 0.03) * RATE), RATE);
  const osc = off.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const gain = off.createGain();
  gain.gain.setValueAtTime(level, 0);
  gain.gain.exponentialRampToValueAtTime(0.001, dur);
  gain.gain.setValueAtTime(0, dur);
  osc.connect(gain).connect(off.destination);
  osc.start();
  const r = await off.startRendering();
  return createClip(r);
}
/** Two seconds of brown noise, low-passed at 480 Hz (the ambience wash; periodic once the filter settles, so it loops seamlessly). */
async function renderAmbience(): Promise<AudioClip> {
  const n = RATE * 2, settle = Math.round(RATE * 0.25);
  const off = new OfflineAudioContext(1, settle + n, RATE);
  const noise = off.createNoise({ color: "brown", seed: 12345, seconds: 2 });
  const lp = off.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 480;
  const gain = off.createGain();
  gain.gain.value = 0.269; // make-up to the old wash's measured rms (0.0551)
  noise.connect(lp).connect(gain).connect(off.destination);
  noise.start();
  const r = await off.startRendering();
  const loop = r.getChannelData(0).slice(settle);
  return createClip([loop], RATE);
}
async function renderTones(): Promise<void> {
  ambience = await renderAmbience();
  const render = async (list: number[], dur: number, type: "sine" | "triangle", level: number): Promise<AudioClip[]> => {
    const out: AudioClip[] = [];
    for (const f of list) out.push(await renderBlip(f, dur, type, level));
    return out;
  };
  const menu = await render(SCALE, 0.5, "sine", 0.12), play = await render(SCALE, 0.5, "sine", 0.16);
  bass = await render(SCALE.map((f) => f / 2), 0.7, "triangle", 0.08);
  notes = [menu, play];
}
const SCALE = [262, 294, 330, 392, 440, 523, 587, 659];
let notes: AudioClip[][] = []; // [menu, play] gains per scale step
let bass: AudioClip[] = [];
let ambience: AudioClip | null = null;
let ambienceStarted = false;
let nextStep = 0;
let step = 0;

/** Each frame once the mixer runs and the tones are rendered: (once unlocked) the
 * ambience loop and the arpeggio by mixer time. */
export function update(): void {
  if (context.state !== "running") return; // starting the ambience and music still waits for the mixer
  if (!started || !ambience || !notes.length) return;
  if (!ambienceStarted) {
    ambienceStarted = true;
    try { playClip(ambience, { bus: "effects", gain: LEVEL.ambience, loop: true }); } catch { ambienceStarted = false; }
    return; // the music starts on a frame of its own
  }
  const now = context.currentTime;
  if (now >= nextStep) {
    if (nextStep === 0 || now - nextStep > 1) nextStep = now;
    // A wander over the scale with light randomness (cosmetic only).
    step += [1, 1, 2, -1, -2][Math.floor(Math.random() * 5)]!;
    step = (step + SCALE.length * 2) % SCALE.length;
    try {
      playClip(notes[intensity > 0 ? 1 : 0]![step]!, { bus: "music", gain: LEVEL.music });
      if (intensity > 0 && step % 2 === 0) playClip(bass[step]!, { bus: "music", gain: LEVEL.music });
    } catch { /* the mixer is full */ }
    nextStep += intensity > 0 ? 0.42 : 0.7;
  }
}
