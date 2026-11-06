// Localization coverage: every English key the engine client (native/*.ts)
// and the content show is translated in every locale (en-GB → en-US,
// es-ES → es-419, fr-CA → fr-FR inherit), placeholders and markup survive,
// and no table keeps a key nothing shows. Clues and answers stay English (the word bank is English).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { codeKeys, audit } from './i18n-common.mjs';
import * as C from '../js/content.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

export function usedKeys() {
  const keys = new Set();
  for (const f of readdirSync(new URL('native/', ROOT)).filter((n) => n.endsWith('.ts'))) {
    codeKeys(read('native/' + f), ['tr']).forEach((k) => keys.add(k));
  }
  for (const k of ['easy', 'medium', 'hard']) keys.add(k);
  for (const t of C.THEMES) keys.add(t.name);
  for (const d of [...C.journeyStages(), ...C.challengeDefs(), C.learnDef()]) {
    keys.add(d.name);
    if (d.blurb && d.mode !== 'learn') keys.add(d.blurb);
  }
  for (const s of C.learnDef().tutorial.steps) if (s.require.type !== 'complete-entry') keys.add(s.text);
  // The brand name and single letters (the ABC key) stay as they are.
  keys.delete('Crossword Journey');
  return [...keys].filter((k) => /[A-Za-z]/.test(k) && k.length > 1 && !k.startsWith('starhermit.')).sort();
}

test('every used key is translated in every locale; placeholders and markup intact', () => {
  assert.deepEqual(audit(JSON.parse(read('assets/strings.json')), usedKeys()), []);
});
