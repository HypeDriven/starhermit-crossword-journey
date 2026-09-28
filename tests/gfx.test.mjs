import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, PRESETS, choosePreset, describe, detectPreset, presetTier, resolve } from '../js/gfx.js';
import { GFX_STRINGS, pickLocale } from '../js/gfx-strings.js';

test('detectPreset maps GPU strings to tiers', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('Apple M2'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(detectPreset('Mali-G78'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
});

test('detectPreset caps Auto at Balanced on mobile', () => {
  assert.equal(detectPreset('Apple M2', { mobile: true }), 'balanced');
  assert.equal(detectPreset('SwiftShader', { mobile: true }), 'low');
});

test('resolve: auto follows the detected preset', () => {
  const r = resolve({ preset: 'auto' }, 'low');
  assert.equal(r.preset, 'low');
  assert.equal(r.auto, true);
  assert.equal(r.shadows, 'off');
  assert.equal(r.post, false, 'Low draws without post-processing');
  assert.equal(r.cap, 1);
  assert.equal(resolve({}, undefined).preset, 'balanced');
});

test('resolve: explicit preset, overrides and scale clamp', () => {
  const r = resolve({ preset: 'high', bloom: 'off', shadows: 'high', render_scale: 5 }, 'low');
  assert.equal(r.preset, 'high');
  assert.equal(r.auto, false);
  assert.equal(r.bloom, 'off');
  assert.equal(r.shadows, 'high');
  assert.equal(r.ao, presetTier('high', 'ao'));
  assert.equal(r.renderScale, 2);
  assert.equal(resolve({ preset: 'low', render_scale: 0.1 }).renderScale, 0.5);
  assert.equal(resolve({ preset: 'ultra' }).scale, 1.25);
  // Unknown tiers fall back to the preset's.
  assert.equal(resolve({ preset: 'low', particles: 'lots' }).particles, 'off');
  assert.equal(resolve({ preset: 'high', adaptive: false, show_fps: true }).adaptive, false);
  assert.equal(resolve({ preset: 'high', show_fps: true }).showFps, true);
});

test('every preset defines every category with a valid tier', () => {
  for (const p of PRESETS) {
    for (const [cat, tiers] of Object.entries(CATEGORIES)) {
      assert.ok(tiers.includes(presetTier(p, cat)), `${p}.${cat}`);
    }
  }
});

test('choosing a preset clears overrides but keeps scale/adaptive/fps', () => {
  const next = choosePreset({ preset: 'high', bloom: 'off', ao: 'high', render_scale: 1.5, adaptive: false, show_fps: true }, 'low');
  assert.deepEqual(next, { preset: 'low', render_scale: 1.5, adaptive: false, show_fps: true });
  assert.equal(choosePreset({}, 'nonsense').preset, 'auto');
});

test('describe summarises cost', () => {
  const s = describe(resolve({ preset: 'high' }), [1280, 800]);
  assert.match(s, /2048² shadows/);
  assert.match(s, /SMAA/);
  assert.match(s, /1280×800 px/);
  assert.match(describe(resolve({ preset: 'low' })), /no shadows/);
});

test('graphics strings exist for every locale and key', () => {
  const locales = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  const base = GFX_STRINGS['en-US'];
  for (const l of locales) {
    const s = GFX_STRINGS[l];
    assert.ok(s, l);
    for (const k of Object.keys(base)) assert.ok(s[k], `${l}.${k}`);
    for (const cat of Object.keys(CATEGORIES)) assert.ok(s.cat[cat], `${l}.cat.${cat}`);
    for (const tiers of Object.values(CATEGORIES)) for (const t of tiers) assert.ok(s.tier[t], `${l}.tier.${t}`);
    for (const p of PRESETS) assert.ok(s[p], `${l}.${p}`);
  }
  assert.equal(pickLocale(['de']), 'de-DE');
  assert.equal(pickLocale(['es-MX']), 'es-419');
  assert.equal(pickLocale(['fr-CA']), 'fr-CA');
  assert.equal(pickLocale(['en-AU']), 'en-GB');
  assert.equal(pickLocale(['ja-JP']), 'en-US');
});
