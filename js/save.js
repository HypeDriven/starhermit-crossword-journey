// Crossword Journey — the save document, pure (shared by the engine client
// native/platform.ts and the Node tests).
//
// The save is the browser build's versioned store document (`cwj:v1`):
// { v: 1, settings, profile, journey, achievements, stats, tutorialDone }.
// Its settings are the game's own preferences that the runtime's Options do
// not cover (theme, colour-vision markers, left-handed layout, haptics, the
// on-screen letter keys); the browser build's volumes, graphics, reduced
// motion, high contrast and larger text are the runtime's now and are
// dropped when a document is read. The browser build's cloud save (the JS
// SDK's save.json) is this same document as JSON text.
import { mergeStoreDoc } from './merge.js';

export const SETTINGS = { theme: 'harbor', cvd: false, leftHanded: false, haptics: true, osk: null };
const THEMES = ['harbor', 'pine', 'desert', 'frost', 'orchard'];

export function defaultDoc() {
  return {
    v: 1,
    settings: { ...SETTINGS },
    profile: { name: 'Guest' },
    journey: { unlocked: 1, stars: {} },
    achievements: {},
    stats: { wins: 0, wordsCompleted: 0, dailyDays: [] },
    tutorialDone: false,
  };
}

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Settings kept from a (possibly old) settings object. */
export function cleanSettings(s) {
  const src = obj(s);
  const out = { ...SETTINGS };
  if (THEMES.includes(src.theme)) out.theme = src.theme;
  for (const k of ['cvd', 'leftHanded', 'haptics']) if (typeof src[k] === 'boolean') out[k] = src[k];
  if (typeof src.osk === 'boolean') out.osk = src.osk;
  return out;
}

/** A stored document (engine save data or the parsed browser doc) → a clean v1 doc, or null. */
export function normalizeDoc(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1) return null;
  const d = defaultDoc();
  d.settings = cleanSettings(data.settings);
  const name = obj(data.profile).name;
  if (typeof name === 'string' && name.trim()) d.profile.name = name.trim().slice(0, 24);
  const j = obj(data.journey);
  d.journey.unlocked = Math.max(1, Math.min(40, Math.floor(num(j.unlocked, 1))));
  for (const [k, v] of Object.entries(obj(j.stars))) if (Number.isFinite(v)) d.journey.stars[k] = Math.max(0, Math.min(3, v));
  for (const [k, v] of Object.entries(obj(data.achievements))) if (Number.isFinite(v)) d.achievements[k] = v;
  const s = obj(data.stats);
  d.stats.wins = Math.max(0, num(s.wins));
  d.stats.wordsCompleted = Math.max(0, num(s.wordsCompleted));
  d.stats.dailyDays = Array.isArray(s.dailyDays) ? s.dailyDays.filter((x) => typeof x === 'string') : [];
  d.tutorialDone = !!data.tutorialDone;
  return d;
}

/** The browser build's cloud save text (save.json) → a clean doc, or null when absent or unusable. */
export function fromBrowserSave(text) {
  if (typeof text !== 'string' || !text) return null;
  try { return normalizeDoc(JSON.parse(text)); } catch { return null; }
}

/** Two documents' progress merged (js/merge.js: the better of both); `local`'s settings and profile kept. */
export function mergeDocs(local, remote) {
  const a = normalizeDoc(local), b = normalizeDoc(remote);
  if (!a) return b;
  if (!b) return a;
  return normalizeDoc(mergeStoreDoc(a, b));
}

/** Whether a document holds real progress (an empty slot is seeded only with that). */
export function hasProgress(st) {
  const j = st.journey || {}, s = st.stats || {};
  return j.unlocked > 1 || Object.keys(j.stars || {}).length > 0 ||
    Object.keys(st.achievements || {}).length > 0 || s.wins > 0 || s.wordsCompleted > 0;
}

/** The browser build's per-player settings keys (patchSettings of its store.settings, game-options.js, sh-language.js). */
export const LEGACY_KEYS = ['theme', 'volMusic', 'volEffects', 'volAmbience', 'reducedMotion', 'highContrast', 'cvd', 'largeText', 'leftHanded', 'haptics', 'gfx', 'osk'];
export function isLegacySettingKey(key) {
  return LEGACY_KEYS.includes(key) || key === 'audio.options' || key === 'ui.language' || key === 'graphics' || key.startsWith('graphics.gpu.');
}
/** The legacy settings the game still has (theme, markers, layout, haptics) over a doc's settings. */
export function applyLegacySettings(settings, read) {
  const src = {};
  for (const k of ['theme', 'cvd', 'leftHanded', 'haptics', 'osk']) { const v = read(k); if (v !== undefined) src[k] = v; }
  return cleanSettings({ ...settings, ...src });
}
