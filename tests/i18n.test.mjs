// Localization coverage: every English key the markup, code and content use is
// translated in every locale (en-GB → en-US, es-ES → es-419, fr-CA → fr-FR
// inherit), placeholders survive, and the language follows sh-language.js and
// switches live. Clues and answers stay English (the word bank is English).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTables, codeKeys, htmlKeys, audit, bootI18n } from './i18n-common.mjs';
import * as C from '../js/content.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

export function usedKeys() {
  const keys = new Set(htmlKeys(read('index.html')));
  for (const f of ['js/main.js', 'js/platform.js']) codeKeys(read(f), ['tr', 'html']).forEach((k) => keys.add(k));
  for (const k of ['easy', 'medium', 'hard']) keys.add(k);
  for (const t of C.THEMES) keys.add(t.name);
  for (const d of [...C.journeyStages(), ...C.challengeDefs(), C.learnDef()]) {
    keys.add(d.name);
    if (d.blurb && d.mode !== 'learn') keys.add(d.blurb);
  }
  for (const s of C.learnDef().tutorial.steps) if (s.require.type !== 'complete-entry') keys.add(s.text);
  // Single-letter key hints (title="C") stay as they are.
  return [...keys].filter((k) => /[A-Za-z]/.test(k) && k.length > 1).sort();
}

test('every used key is translated in every locale; placeholders and markup intact', () => {
  assert.deepEqual(audit(loadTables(ROOT, 'js/strings.js', 'CJ_STRINGS'), usedKeys()), []);
});

test('the locale follows sh-language and switches live', () => {
  const { I18N, events, doc } = bootI18n(ROOT, { strings: 'js/strings.js', i18n: 'js/i18n.js', global: 'CJI18N', languages: ['de-DE'] });
  assert.equal(I18N.lang, 'de-DE');
  assert.equal(doc.documentElement.lang, 'de-DE');
  assert.equal(I18N.T('Resume'), 'Fortsetzen');
  I18N.language.setChoice('fr-CA');
  assert.equal(I18N.lang, 'fr-CA');
  assert.equal(events.at(-1), 'fr-CA');
  I18N.language.setChoice('en-GB');
  assert.equal(I18N.T('Harbor Dawn'), 'Harbour Dawn');
  assert.equal(I18N.T('Row {r} column {c}', { r: 2, c: 3 }), 'Row 2 column 3');
});
