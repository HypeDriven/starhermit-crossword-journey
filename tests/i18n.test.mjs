// Localization coverage: every English key the engine client (native/*.ts)
// and the content show is translated in every locale (en-GB → en-US,
// es-ES → es-419, fr-CA → fr-FR inherit), placeholders and markup survive,
// no table keeps a key nothing shows, the account lines exist in every
// locale, and the classic js/i18n.js switches locale as native/i18n.ts
// drives it. Clues and answers stay English (the word bank is English).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { loadTables, codeKeys, audit, LOCALES } from './i18n-common.mjs';
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
  return [...keys].filter((k) => /[A-Za-z]/.test(k) && k.length > 1).sort();
}

function boot() {
  const sandbox = {};
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const f of ['js/strings.js', 'js/i18n.js', 'js/platform-strings.js']) vm.runInContext(read(f), sandbox);
  return sandbox;
}

test('every used key is translated in every locale; placeholders and markup intact', () => {
  assert.deepEqual(audit(loadTables(ROOT, 'js/strings.js', 'CJ_STRINGS'), usedKeys()), []);
});

test('the account and leaderboard lines exist in every locale with their placeholders', () => {
  const P = boot().CJPlatformStrings;
  const en = P.platformStrings('en-US');
  for (const loc of LOCALES) {
    const t = P.platformStrings(loc);
    assert.deepEqual(Object.keys(t).sort(), Object.keys(en).sort(), loc);
    for (const k of Object.keys(en)) {
      assert.deepEqual((t[k].match(/\{\w+\}/g) || []).sort(), (en[k].match(/\{\w+\}/g) || []).sort(), `${loc} ${k}`);
    }
  }
  assert.equal(P.fmtPlatform(P.platformStrings('de-DE').lbRank, { rank: 4 }), 'Platz in der Bestenliste: #4');
});

test('the locale switches as the engine client sets it, with the regional tables', () => {
  const I18N = boot().CJI18N;
  assert.equal(I18N.lang, 'en-US');
  assert.equal(I18N.setLocale('de-DE'), 'de-DE');
  assert.equal(I18N.T('Resume'), 'Fortsetzen');
  I18N.setLocale('fr-CA');
  assert.equal(I18N.T('Score:'), 'Pointage :');
  I18N.setLocale('en-GB');
  assert.equal(I18N.T('Harbor Dawn'), 'Harbour Dawn');
  I18N.setLocale('es-ES');
  assert.equal(I18N.T('Settings'), 'Ajustes');
  assert.equal(I18N.setLocale('xx-YY'), 'en-US');
  assert.equal(I18N.T('Row {r} column {c}', { r: 2, c: 3 }), 'Row 2 column 3');
});
