// Localization: the browser build's string tables (js/strings.js through
// js/i18n.js, the nine StarHermit locales, English text as the key) in the
// interface language the runtime reports (preferences().language: the
// player's choice in Options › Language, else the account's preferred
// language or the device's). The runtime's Options replaced the game's own
// Language selector (sh-language.js). Every string is looked up as it is
// drawn, so a language change re-renders everything in place (the round,
// its clock and the board stay put). The account lines are
// js/platform-strings.js's tables. Clues and answers stay English: the word
// bank is English in every language.
import { loadClassic } from "starhermit:script";
import { onPreferencesChange, preferences } from "starhermit:engine";
import * as ui from "starhermit:ui";

for (const f of ["js/strings.js", "js/i18n.js", "js/platform-strings.js"]) loadClassic(f);

interface I18nApi {
  T(key: string, vars?: Record<string, string | number> | null): string;
  setLocale(tag: string): string;
  readonly lang: string;
  locales: string[];
}
interface PlatformStringsApi {
  platformStrings(lang: string): Record<string, string>;
  fmtPlatform(s: string, vars?: Record<string, string | number>): string;
}
const g = globalThis as unknown as { CJI18N: I18nApi; CJPlatformStrings: PlatformStringsApi };
const I18n = g.CJI18N;
const PlatformStrings = g.CJPlatformStrings;

const PRIMARY: Record<string, string> = { en: "en-US", es: "es-419", de: "de-DE", fr: "fr-FR", pt: "pt-BR", it: "it-IT" };

/** The shipped locale nearest a BCP 47 tag (en-GB, es-ES and fr-CA by region; es-MX → es-419, en-AU → en-GB). */
export function pickLocale(tag: string): string {
  const s = String(tag || "en-US");
  const exact = I18n.locales.find((l) => l.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const lang = s.split("-")[0]!.toLowerCase();
  if (lang === "en" && /-(gb|uk|ie|au|nz|za|in)$/i.test(s)) return "en-GB";
  if (lang === "es" && /-es$/i.test(s)) return "es-ES";
  if (lang === "fr" && /-ca$/i.test(s)) return "fr-CA";
  return PRIMARY[lang] ?? "en-US";
}

let locale = "";
const listeners = new Set<() => void>();
function apply(tag: string): void {
  const next = pickLocale(tag);
  if (next === locale) return;
  locale = I18n.setLocale(next);
  ui.setLanguage(locale);
  for (const fn of listeners) fn();
}
apply(preferences().language);
onPreferencesChange((p) => apply(p.language));

export function currentLocale(): string { return locale; }
/** fn() after the interface language changed. */
export function onLocaleChange(fn: () => void): void { listeners.add(fn); }

export type Vars = Record<string, string | number>;
/** A game string by its English key in the player's language; `{name}` placeholders from vars. */
export function tr(key: string, vars?: Vars | null): string { return I18n.T(key, vars ?? null); }
/** Marks an English key translated with tr() where it is shown. */
export const N = (s: string): string => s;

export type PlatformKey = "offline" | "playing" | "synced" | "saving" | "nosync" | "signIn" | "invite" | "copied" | "copyFail" | "lbPosting" | "lbRank" | "lbPosted" | "lbNotPosted";
/** An account line (js/platform-strings.js) in the player's language. */
export function pt(key: PlatformKey, vars?: Vars): string {
  return PlatformStrings.fmtPlatform(PlatformStrings.platformStrings(locale)[key] ?? key, vars);
}
