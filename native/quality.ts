// The look per graphics level: the browser build's four presets and budgets
// (js/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// Auto gave it) keyed by the runtime's quality tier (frame().quality), with
// the fireflies scaled within the tier by the level (frame().levelIndex), as
// the browser build scaled them by its hardware level. The runtime owns the
// rest of the old Graphics section: Auto and the level choice, render scale
// and the pixel-ratio cap, adaptive resolution, the frame-rate limit and
// readout. The per-effect overrides of the old section are not offered (the
// runtime's Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export type Preset = QualityTier;
export interface Budget {
  /** Diorama materials: Lambert (flat water), standard PBR, or physical (clear-coat water on detailed scenes). */
  material: "lambert" | "standard" | "physical";
  /** Paper-fibre and desk-grain canvas sizes in px (detailed scenery). */
  paperTexture: number;
  woodTexture: number;
  /** Round-geometry LOD: sky, ground, pond, hills, lighthouse and lantern segments. */
  segments: number;
  fireflies: number;
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: Preset;
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  /** RoomEnvironment image-based reflections (brass, water, a sheen on paper). */
  reflections: boolean;
  /** Ripples scrolling across the pond and the paper boats rocking. */
  water: boolean;
  /** The extra scenery, paper textures and the paper-tile shading of the board. */
  detailed: boolean;
  budget: Budget;
}

const TABLE: Record<Preset, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, water: true, detailed: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, water: true, detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, water: true, detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, water: true, detailed: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", paperTexture: 128, woodTexture: 256, segments: 0.5, fireflies: 0, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", paperTexture: 256, woodTexture: 512, segments: 0.75, fireflies: 30, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", paperTexture: 256, woodTexture: 512, segments: 1, fireflies: 110, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", paperTexture: 512, woodTexture: 1024, segments: 1.5, fireflies: 160, bloomRes: 1, aoRes: 1 },
};
/** The browser build's Particles caps: Low off, Balanced's "low" tier 40, High and Ultra 440. */
const FIREFLY_CAP: Record<Preset, number> = { low: 0, balanced: 40, high: 440, ultra: 440 };
/** The first level index of each tier. */
const TIER_FLOOR: Record<Preset, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 … 9). */
export function lookFor(preset: Preset, levelIndex: number): Look {
  const b = { ...(BUDGETS[preset] ?? BUDGETS.balanced) };
  // Levels are about 1.64× apart in GPU throughput: the fireflies grow with
  // the level above the tier's first, at most four times the tier's budget.
  const k = Math.min(4, Math.pow(1.64, Math.max(0, levelIndex - (TIER_FLOOR[preset] ?? 0))));
  b.fireflies = Math.min(FIREFLY_CAP[preset] ?? 0, Math.round(b.fireflies * k));
  return { preset, ...(TABLE[preset] ?? TABLE.balanced), budget: b };
}
