// The game's data and the StarHermit platform, on the runtime's modules:
// - the save is the browser build's store document (js/save.js), kept with
//   starhermit:storage `saves` on the device and in the player's cloud slot;
//   two devices' copies merge on a conflict (js/merge.js keeps the better of
//   both: highest Journey page, best stars, every achievement, wins, words,
//   Daily days, Learn done). The slot the browser build wrote (the JS SDK's
//   zipped save.json holding the same document) shows as foreign and is
//   merged in and replaced once;
// - the browser build's per-player settings keys (its store.settings, the
//   shared options panel's and the language selector's) are read once: the
//   theme, colour-vision markers, left-handed layout and haptics carry over
//   into the save, then every legacy key is removed (volumes, graphics,
//   language, reduced motion, high contrast and larger text are the
//   runtime's Options now);
// - the server clock for the Daily (serverTime / serverNow; the device's
//   clock while the platform is out of reach), the player's name, the invite
//   link, and posting a finished ranked round through score-script.js (a
//   practice session whose socket carries { type: 'result', scores }, as the
//   JS SDK's submitScores did) with the rank on the high-score board.
import type { JsonValue } from "starhermit:engine";
import {
  connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, serverNow as platformNow, serverTime, sessions,
} from "starhermit:platform";
import { saves, settings as store, storage } from "starhermit:storage";
import { applyLegacySettings, defaultDoc, fromBrowserSave, hasProgress, isLegacySettingKey, mergeDocs, normalizeDoc } from "../js/save.js";

export interface Settings { theme: string; cvd: boolean; leftHanded: boolean; haptics: boolean; osk: boolean | null }
export interface Doc {
  v: 1;
  settings: Settings;
  profile: { name: string };
  journey: { unlocked: number; stars: Record<string, number> };
  achievements: Record<string, number>;
  stats: { wins: number; wordsCompleted: number; dailyDays: string[] };
  tutorialDone: boolean;
}

// --- the save ------------------------------------------------------------------------------
let doc: Doc = defaultDoc() as Doc;
let lastSavedAt = 0;
const changeListeners = new Set<() => void>();
/** fn() when the document was replaced from elsewhere (another device, the old build's save). */
export function onDocChange(fn: () => void): void { changeListeners.add(fn); }
function changed(): void { for (const fn of changeListeners) fn(); }

export function getDoc(): Doc { return doc; }
/** Writes the save (device at once, the account debounced by the runtime). */
export function persist(): void {
  try { saves.save(doc as unknown as JsonValue, { schema: 1 }); }
  catch (e) { console.warn(`save: ${String(e)}`); }
}

/** Takes another document's progress in (merged with this device's); whether it changed. */
function adopt(other: unknown): boolean {
  if (!other) return false;
  const before = JSON.stringify(doc);
  const next = mergeDocs(doc, other) as Doc | null;
  if (!next || JSON.stringify(next) === before) return false;
  doc = next;
  changed();
  return true;
}

saves.onConflict((local, remote) => ({
  merged: (mergeDocs(local?.data, remote.data) ?? normalizeDoc(remote.data) ?? defaultDoc()) as unknown as JsonValue,
}));
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  // The account's save replaced the device's (another device saved last): merge it in.
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    if (adopt(cur.data)) persist();
  }
});

/** The browser build's cloud save: merged with this device's progress, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const remote = fromBrowserSave(old.text) as Doc | null;
  if (remote && !hasProgress(doc) && !saves.load()) doc = remote; // first start here: the old save as it was
  else adopt(remote);
  changed();
  try { saves.save(doc as unknown as JsonValue, { schema: 1, replaceForeign: true }); }
  catch (e) { console.warn(`save migration: ${String(e)}`); }
}

/** For the top bar's account line: offline (a guest) | saving | synced | error. */
export function syncState(): "offline" | "saving" | "synced" | "error" {
  if (!player()) return "offline";
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "error";
  if (st === "loading" || st === "uploading" || st === "foreign" || saves.status() === "pending") return "saving";
  return "synced";
}
export function flush(): void { void saves.flush().catch(() => undefined); }

// --- the browser build's settings ----------------------------------------------------------
function migrateLegacy(): void {
  const keys = store.legacyKeys();
  if (!keys || !keys.length) return;
  const have = new Set(keys);
  const next = applyLegacySettings(doc.settings, (k: string) => (have.has(k) ? store.legacy(k) : undefined)) as Settings;
  if (JSON.stringify(next) !== JSON.stringify(doc.settings)) { doc.settings = next; persist(); changed(); }
  for (const key of keys) if (isLegacySettingKey(key)) { try { store.removeLegacy(key); } catch { /* next start */ } }
}

// --- the clock -------------------------------------------------------------------------------
/** The platform's clock (ms since the epoch), the device's while it is out of reach. */
export function serverNow(): number { return platformNow() ?? Date.now(); }
function syncTime(): void { serverTime().then(() => undefined, () => undefined); }

/** Reads the device's save (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  const d = normalizeDoc(cur?.data) as Doc | null;
  if (d) doc = d;
  else persist();
  store.onLegacy(migrateLegacy);
  migrateLegacy();
  if (saves.state() === "foreign") migrateForeign();
  refreshPlayer();
  syncTime();
  setInterval(syncTime, 5 * 60 * 1000);
}

// --- the player ----------------------------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function displayName(): string { return player()?.displayName ?? ""; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
  void highScoreBoard().catch(() => null);
  syncTime();
}
onPlayerChange(() => refreshPlayer());

// --- the StarHermit high-score board -------------------------------------------------------
const BOARD_KEY = "crosswordjourney.board-id";
let boardId: string | null = null;
/** The high-score board's id: listed signed in, then kept on the device. */
async function highScoreBoard(): Promise<string | null> {
  if (boardId) return boardId;
  if (player()) {
    try {
      const list = await leaderboards.list();
      const b = list.find((x) => x.key === "high-score") ?? list[0];
      if (b) { boardId = b.id; try { storage.set(BOARD_KEY, b.id); } catch { /* full */ } }
    } catch { /* offline */ }
  }
  if (!boardId) { try { boardId = storage.getText(BOARD_KEY); } catch { boardId = null; } }
  return boardId;
}

/** Signed in only: post a finished ranked round's total through score-script.js; { posted, rank }. Never rejects. */
export async function postLeaderboard(total: number): Promise<{ posted: boolean; rank: number | null }> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (data) => {
        const d = data as { type?: string; accepted?: string[] } | null;
        if (d && d.type === "result-ack") finish(Array.isArray(d.accepted) ? d.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const id = await highScoreBoard();
    if (!id) return { posted: true, rank: null };
    const r = await leaderboards.entries(id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}
