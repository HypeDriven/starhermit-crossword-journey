// Graphics quality model: presets, per-category overrides, GPU detection and a
// cost summary. Pure (no three.js), so the Settings panel, the renderer and the
// unit tests agree on what a setting means.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],
  water: ['static', 'animated'],
  particles: ['off', 'low', 'high'],
  detail: ['plain', 'detailed'],
};

// Each preset is a row of tiers, a device-pixel-ratio cap and a render scale.
const TABLE = {
  low: { cap: 1, scale: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa', reflections: 'off', water: 'animated', particles: 'off', detail: 'plain' },
  balanced: { cap: 1.5, scale: 0.9, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', water: 'animated', particles: 'low', detail: 'detailed' },
  high: { cap: 2, scale: 1, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', water: 'animated', particles: 'high', detail: 'detailed' },
  ultra: { cap: 2, scale: 1.25, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', water: 'animated', particles: 'high', detail: 'detailed' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };
export const PARTICLE_COUNT = { off: 0, low: 40, high: 110 };

export const DEFAULT_GFX = { preset: 'auto', render_scale: 1, adaptive: true, show_fps: false };

// Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX
// 5090; js/gpu-level.js → globalThis.StarHermitGpu): Low from 0, Balanced from 4, High from 10, Ultra from 17.
// Phones, tablets and ≤ 4 GB machines are capped at level 9 (Balanced); software renderers are level 0.
export const PRESET_LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level (0–20) for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system = {}) {
  const G = gpuApi();
  if (!G) return PRESET_LEVELS.balanced;
  return G.detectLevel({ ...(system || {}), gpu: String(gpu || '') });
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  if (G) return G.presetForLevel(level, PRESET_LEVELS);
  return level >= 17 ? 'ultra' : level >= 10 ? 'high' : level >= 4 ? 'balanced' : 'low';
}

/** Best preset for a GPU (the hardware level already caps phones/tablets at Balanced). */
export function detectPreset(gpu, system = {}) {
  return presetForLevel(detectLevel(gpu, system));
}

/** Scale a count tuned at the preset's floor level up for faster GPUs (≤ 4×, never below the floor). */
function scaleCount(n, preset, level) {
  const G = gpuApi();
  const floor = PRESET_LEVELS[preset] || 0;
  return Math.round(G ? G.scaleBudget(n, Math.max(Number(level) || 0, floor), floor) : n);
}

/*
 * Per-preset asset and effect budget. Each preset is tuned to hold 60 FPS on the weakest GPU Auto gives
 * it (Low → level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs).
 *   material      diorama materials: 'lambert' | 'standard' | 'physical' (clear-coat water on detailed scenes);
 *   paperTexture / woodTexture  paper-fibre and desk-grain canvas sizes in px (detailed scene);
 *   segments      round-geometry LOD: multiplies sky, ground, water, hills, lighthouse and lantern segments;
 *   fireflies     firefly sprites at the floor level (the Particles tier caps them: off 0, low 40);
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame.
 */
export const BUDGETS = {
  low: { material: 'lambert', paperTexture: 128, woodTexture: 256, segments: 0.5, fireflies: 20, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: 'standard', paperTexture: 256, woodTexture: 512, segments: 0.75, fireflies: 30, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: 'physical', paperTexture: 256, woodTexture: 512, segments: 1, fireflies: 110, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: 'physical', paperTexture: 512, woodTexture: 1024, segments: 1.5, fireflies: 160, bloomRes: 1, aoRes: 1 },
};
export const FIREFLY_CAP = { off: 0, low: 40, high: 440 };

/** A preset's concrete budget for a hardware level and Particles tier. */
export function budgetFor(preset, level, particles = 'high') {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  b.fireflies = Math.min(FIREFLY_CAP[particles] ?? FIREFLY_CAP.high, scaleCount(b.fireflies, preset, level));
  return b;
}

/**
 * Resolve saved settings into concrete tiers (`level`: hardware level; defaults to the preset's floor).
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const renderScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto, cap: row.cap, renderScale, scale: row.scale * renderScale };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = level == null ? PRESET_LEVELS[preset] : level;
  out.budget = budgetFor(preset, out.level, out.particles);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; otherwise the canvas draws directly.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' || out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** Choosing a preset clears every per-category override (keeps scale/adaptive/fps). */
export function choosePreset(saved, preset) {
  const s = saved || {};
  const out = {
    preset: PRESETS.includes(preset) ? preset : 'auto',
    render_scale: s.render_scale ?? 1,
    adaptive: s.adaptive !== false,
    show_fps: !!s.show_fps,
  };
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset]?.[cat];
}

/** Short cost summary. `words` optionally localizes the fixed phrases. */
export function describe(r, pixels, words = {}) {
  const w = { noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion', bloom: 'bloom', noAa: 'no anti-aliasing', ...words };
  const parts = [
    r.shadows === 'off' ? w.noShadows : `${SHADOW_MAP[r.shadows]}² ${w.shadows}`,
    r.ao === 'off' ? null : r.ao === 'high' ? w.aoHigh : w.ao,
    r.bloom === 'on' ? w.bloom : null,
    r.antialias === 'off' ? w.noAa : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
