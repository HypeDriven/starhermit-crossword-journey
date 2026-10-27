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
// once into clips (createClip); the synthesized stand-ins it played while a
// sample loaded are not ported (the engine's web runtime drops clip loads
// while a synthesis graph changes). Clips load once the mixer runs
// (natively at once, in a browser after the first press), one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Bus } from "starhermit:audio";

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
// The first sounds of a round load first.
const FIRST = ["select-tick-a", "key-tap-a", "correct-letter", "word-complete", "page-turn", "invalid-buzz", "check-mark", "reveal-shimmer"];

const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let asked = false;
function load(name: string): void { if (!queue.includes(name) && !clips.has(name)) queue.push(name); }
function pump(): void {
  if (loading || !queue.length) return;
  const name = queue.shift()!;
  loading = true;
  loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => { console.warn(`sfx ${name}: ${String(e)}`); loading = false; });
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
  const names = EVENT_SAMPLES[event];
  if (!names?.length) return;
  const file = names.length > 1 ? names[Math.floor(Math.random() * names.length)]! : names[0]!;
  const clip = clips.get(file) ?? names.map((n) => clips.get(n)).find((c) => !!c);
  if (!clip) return;
  const bus: Bus = event === "select" ? "interface" : "effects";
  try { playClip(clip, { bus, gain: LEVEL.effects }); }
  catch { clips.delete(file); load(file); } // a clip the mixer lost: load it again
}

// -- the rendered ambience and arpeggio ------------------------------------------------------
const RATE = 22050;
/** A blip as js/audio.js's: an oscillator from `gain` falling exponentially to 0.001 over `dur`. */
function blipClip(freq: number, dur: number, type: "sine" | "triangle", gain: number): AudioClip {
  const n = Math.round((dur + 0.03) * RATE);
  const out = new Float32Array(n);
  const k = Math.log(0.001 / gain) / dur;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const e = t < dur ? gain * Math.exp(k * t) : 0;
    const ph = (freq * t) % 1;
    const w = type === "sine" ? Math.sin(2 * Math.PI * ph) : 1 - 4 * Math.abs(ph - 0.5);
    out[i] = w * e;
  }
  return createClip([out], RATE);
}
/** Two seconds of brown-ish noise, low-passed at 480 Hz, at 0.35 (the ambience wash; seamless loop by a short crossfade). */
function ambienceClip(): AudioClip {
  const n = RATE * 2;
  const out = new Float32Array(n);
  let v = 0, lp = 0;
  const a = 1 - Math.exp((-2 * Math.PI * 480) / RATE);
  let seed = 12345;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    v = v * 0.98 + (rnd() * 2 - 1) * 0.02;
    lp += a * (v * 3 - lp);
    out[i] = lp * 0.35;
  }
  const fade = Math.round(RATE * 0.05);
  for (let i = 0; i < fade; i++) { const w = i / fade; out[i] = out[i]! * w + out[n - fade + i]! * (1 - w); }
  return createClip([out.subarray(0, n - fade).slice()], RATE);
}
const SCALE = [262, 294, 330, 392, 440, 523, 587, 659];
const notes: AudioClip[][] = []; // [menu, play] gains per scale step
const bass: AudioClip[] = [];
let ambience: AudioClip | null = null;
let ambienceStarted = false;
let nextStep = 0;
let step = 0;

/** Each frame: the samples once the mixer runs (one at a time), one rendered clip a frame,
 * then (once unlocked) the ambience loop and the arpeggio by mixer time. */
export function update(): void {
  if (context.state !== "running") return;
  if (!asked) {
    asked = true;
    for (const name of FIRST) load(name);
    for (const name of Object.keys(SFX_EVENTS)) load(name);
  }
  pump();
  if (loading || queue.length) return;
  try {
    if (!ambience) { ambience = ambienceClip(); return; }
    if (notes.length < 2) { notes.push(SCALE.map((f) => blipClip(f, 0.5, "sine", notes.length ? 0.16 : 0.12))); return; }
    if (bass.length < SCALE.length) { bass.push(blipClip(SCALE[bass.length]! / 2, 0.7, "triangle", 0.08)); return; }
  } catch (e) { console.warn(`audio: ${String(e)}`); return; }
  if (!started) return;
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
