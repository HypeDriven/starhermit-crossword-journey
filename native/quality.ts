// The look per graphics level. The engine-owned effects (shadows and their
// map size, ambient occlusion, bloom, the grade, anti-aliasing) are the
// level's own (levelSettings(): the same table every StarHermit game reads).
// The game's art (materials, paper and desk textures, round-geometry detail,
// reflections, water, the extra scenery) is the browser build's four presets
// and budgets (js/gfx.js TABLE / BUDGETS) keyed by the level's quality tier,
// with the fireflies scaled within the tier by the level's particle budget
// against the tier's anchor level (quantum, molecular, terrestrial,
// galactic), at most four times. The runtime owns the rest of the old
// Graphics section: Auto and the level choice, render scale and the
// pixel-ratio cap, adaptive resolution, the frame-rate limit and readout.
// The per-effect overrides of the old section are not offered (the
// runtime's Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export type Preset = QualityTier;
export interface Budget {
  /** Diorama materials: Lambert (flat water), standard PBR, or physical (clear-coat water on detailed scenes). */
  material: "lambert" | "standard" | "physical";
  /** Paper-fibre and desk-grain canvas sizes in px (detailed scenery), within the level's largest texture. */
  paperTexture: number;
  woodTexture: number;
  /** Round-geometry LOD: sky, ground, pond, hills, lighthouse and lantern segments. */
  segments: number;
  fireflies: number;
}
export interface Look {
  preset: Preset;
  /** The level's key-light shadow map size, 0 when the level draws no shadows. */
  shadows: number;
  /** The level's ambient occlusion (null: off). */
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null: off). */
  bloom: number | null;
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

type Art = Pick<Look, "reflections" | "water" | "detailed">;
const ART: Record<Preset, Art> = {
  low: { reflections: false, water: true, detailed: false },
  balanced: { reflections: true, water: true, detailed: true },
  high: { reflections: true, water: true, detailed: true },
  ultra: { reflections: true, water: true, detailed: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", paperTexture: 128, woodTexture: 256, segments: 0.5, fireflies: 0 },
  balanced: { material: "standard", paperTexture: 256, woodTexture: 512, segments: 0.75, fireflies: 30 },
  high: { material: "physical", paperTexture: 256, woodTexture: 512, segments: 1, fireflies: 110 },
  ultra: { material: "physical", paperTexture: 512, woodTexture: 1024, segments: 1.5, fireflies: 160 },
};
/** The browser build's Particles caps: Low off, Balanced's "low" tier 40, High and Ultra 440. */
const FIREFLY_CAP: Record<Preset, number> = { low: 0, balanced: 40, high: 440, ultra: 440 };
/** The level whose settings are each tier's preset. */
const ANCHOR: Record<Preset, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a graphics level (the frame's by default). */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = BUDGETS[preset];
  // The fireflies grow with the level's particle budget above the tier's anchor, at most four times the tier's budget.
  const k = Math.min(4, s.particles / levelSettings(ANCHOR[preset]).particles);
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: {
      ...b,
      paperTexture: Math.min(b.paperTexture, s.maxTextureSize), woodTexture: Math.min(b.woodTexture, s.maxTextureSize),
      fireflies: Math.min(FIREFLY_CAP[preset], Math.round(b.fireflies * k)),
    },
  };
}
