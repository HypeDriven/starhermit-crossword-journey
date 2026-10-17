import test from 'node:test';
import assert from 'node:assert/strict';
import '../js/gpu-level.js'; // globalThis.StarHermitGpu, as the page's classic script
import * as G from '../js/gfx.js';
import { CATEGORIES, PRESETS, choosePreset, describe, detectPreset, presetTier, resolve } from '../js/gfx.js';
import { GFX_STRINGS, pickLocale } from '../js/gfx-strings.js';

const DESK = { webgl: true, webgl2: true, cores: 8, memoryGb: 8 };
const PHONE = { webgl: true, webgl2: true, mobile: true, cores: 8, memoryGb: 8 };

test('hardware level → preset: Low 0, Balanced 4, High 10, Ultra 17', () => {
  assert.equal(G.detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', DESK), 'low');
  assert.equal(G.detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', DESK), 0);
  assert.equal(G.detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0)', DESK), 'low');
  assert.equal(G.detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', DESK), 'low');
  assert.equal(G.detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', DESK), 'balanced');
  assert.equal(G.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', DESK), 'high');
  assert.equal(G.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  assert.equal(G.detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 20);
  assert.equal(G.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  assert.equal(G.presetForLevel(3), 'low');
  assert.equal(G.presetForLevel(16), 'high');
});

test('phones and tablets are capped at Balanced; software GPUs stay Low', () => {
  assert.equal(G.detectPreset('Adreno (TM) 740', PHONE), 'balanced');
  assert.ok(G.detectLevel('Adreno (TM) 740', PHONE) <= 9);
  assert.equal(G.detectPreset('NVIDIA GeForce RTX 5090', PHONE), 'balanced');
  assert.equal(G.detectPreset('SwiftShader', PHONE), 'low');
});

test('every preset has an explicit budget that grows from Low to Ultra and scales with the level', () => {
  const order = ['low', 'balanced', 'high', 'ultra'];
  for (const p of order) for (const k of ['material', 'paperTexture', 'woodTexture', 'segments', 'fireflies', 'bloomRes', 'aoRes']) assert.ok(G.BUDGETS[p][k] != null, `${p}.${k}`);
  for (let i = 1; i < order.length; i++) {
    for (const k of ['paperTexture', 'woodTexture', 'segments', 'fireflies', 'bloomRes', 'aoRes']) assert.ok(G.BUDGETS[order[i]][k] >= G.BUDGETS[order[i - 1]][k], `${order[i]}.${k}`);
  }
  assert.equal(G.BUDGETS.low.material, 'lambert');
  assert.deepEqual(G.resolve({ preset: 'ultra' }, 'low', 0).budget, G.resolve({ preset: 'ultra' }, 'ultra', 17).budget,
    'a manual Ultra on a weak GPU keeps the Ultra floor budget');
  const b10 = G.resolve({ preset: 'high' }, 'high', 10).budget, b14 = G.resolve({ preset: 'high' }, 'high', 14).budget;
  assert.ok(b14.fireflies > b10.fireflies, 'counts scale up within the preset');
  assert.equal(G.resolve({ preset: 'ultra', particles: 'low' }, 'ultra', 20).budget.fireflies, G.FIREFLY_CAP.low, 'Particles tier caps');
  assert.equal(G.resolve({ preset: 'low' }, 'low', 0).budget.fireflies, 0, 'Low: Particles off');
  assert.equal(G.resolve({ preset: 'balanced' }, 'balanced').scale, 0.9, 'Balanced renders at 0.9');
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
