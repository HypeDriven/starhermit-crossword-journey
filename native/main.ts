// Crossword Journey on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (js/rules.js) and the content
// (js/content.js) are the browser build's, unchanged; this module is what its
// js/main.js did around them: the state machine (title ⇄ modes → active ⇄
// paused → results, with Settings and Help as sub-screens), one round = def +
// rules state + the ordered command log + the selection, command dispatch
// (the ONLY way rules state changes, pre-validated so the log replays), the
// time-limit watchdog and the 30-second warning, input (letters, arrows,
// clue hops, direction, clear, check, reveal, pause), the Learn lessons,
// achievements, the Journey progress and the results with the local replay
// check and the leaderboard post. The screens are drawn by screens.ts
// (starhermit:ui), the board by board.ts, the diorama by diorama.ts.
//
// Time is the runtime's fixed steps (60 a second) counted while a round is
// active: paused and hidden time never counts, and play scripts replay
// exactly. Letters are typed text (input.onText, after the keyboard layout
// and input methods) while the board or nothing has focus, or the
// runtime's text field on the play screen (a tap on a phone brings up the
// device keyboard; at engine.minor 17+ the field holds game actions back
// while it has the keyboard), or the on-screen letter keys.
import { clipboard, frame, onFixedUpdate, onQuit, onRender, onResume, onStart, onSuspend, onUpdate, onPreferencesChange, preferences, setFixedRate } from "starhermit:engine";
import { bindings, isKeyDown, onAction, onKey, primaryPointer, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { requestSignIn } from "starhermit:platform";
import * as R from "../js/rules.js";
import * as C from "../js/content.js";
import * as audio from "./audio.ts";
import * as dio from "./diorama.ts";
import { N, pt, tr } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor, type Look } from "./quality.ts";
import { drawScreens, BOARD_ID } from "./screens.ts";
import { applyLook as styleLook, applyTheme, initStyles } from "./style.ts";

// ------------------------------------------------------------------ types
export type Dir = "across" | "down";
export interface Entry { id: number; dir: Dir; row: number; col: number; len: number; number: number; clue: string; cells: number[] }
export interface Def {
  id: string; name: string; seed: string; mode: string; rows: number; cols: number; cells: (string | null)[];
  entries: Entry[]; limits: { timeMs: number | null; checks: number | null; mistakes: number | null };
  par: { timeMs: number | null }; mult: number; mechanics: string[]; ranked: boolean; blurb?: string; pattern: string;
  maxDifficulty: number; v: number; theme: string;
  tutorial?: { steps: { text: string; require: { type: string; entry?: number }; focus?: number }[] };
}
export interface Cell { sol: string; cur: string; flag: number }
export interface State {
  rows: number; cols: number; cells: (Cell | null)[]; entries: Entry[]; nextCmdId: number; status: string; terminalReason: string | null;
  elapsedMs: number; invalid: number; checksUsed: number; revealsUsed: number; mistakes: number; filledCorrect: number; filledTotal: number;
  streak: number; bestStreak: number; wordsDone: number;
  score: { letters: number; words: number; streak: number; time: number; assists: number; complete: number; total: number };
  limits: { timeMs: number | null; checks: number | null; mistakes: number | null };
}
export interface Cmd { type: string; cell?: number; ch?: string; scope?: string; entry?: number; id?: number; at?: number }
interface GameEvent { type: string; entry?: number; streak?: number; correct?: boolean; wrong?: number[] }
export type Phase = "title" | "modes" | "active" | "paused" | "resolving" | "results";
export type Sub = null | "settings" | "help";
export type ModeView = "modes" | "journey" | "challenge" | "practice";

// ------------------------------------------------------------------ app state
export const app = {
  phase: "title" as Phase,
  sub: null as Sub,
  modeView: "modes" as ModeView,
  /** Frame the screen opened on (the press that opened it must not also act on it). */
  openedFrame: 0,
  /** Widget to focus once the screen is built. */
  focusNext: null as string | null,
  toasts: [] as { text: () => string; until: number }[],
  look: lookFor("balanced", 2) as Look,
  confirmGiveUp: false,
  /** Compact layouts: which drawers are open. */
  drawers: { left: false, right: false },
};

export const session = {
  def: null as Def | null,
  state: null as State | null,
  commands: [] as Cmd[],
  sel: { cell: null as number | null, dir: "across" as Dir },
  elapsedMs: 0,
  sessionId: "",
  newAchievements: [] as string[],
  tutorialStep: 0,
  tutorial: false,
  timeWarned: false,
  /** The tutorial's pulsing square (null: none). */
  tutorialFocus: null as number | null,
  /** The results' local replay check passed. */
  verified: false,
  /** The results screen's leaderboard line (null: hidden), re-read in the current language. */
  lbLine: null as (() => string) | null,
  /** The rules' terminal frame (results open on the next). */
  endedAt: 0,
};

export const active = (): boolean => app.phase === "active";
export const doc = (): platform.Doc => platform.getDoc();
export function theme(): ReturnType<typeof C.getTheme> { return C.getTheme(doc().settings.theme); }
export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export const dirName = (dir: Dir): string => (dir === "across" ? tr("Across") : tr("Down"));

// ------------------------------------------------------------------ toasts, announcements, haptics
export function toast(text: () => string): void {
  app.toasts.push({ text, until: frame().time + 4.2 });
  while (app.toasts.length > 3) app.toasts.shift(); // never pile over the screen
  ui.announce(text().slice(0, 500), { politeness: "polite" });
}
export function announceError(msg: string): void { if (msg) ui.announce(msg.slice(0, 500), { politeness: "assertive" }); }
function haptic(ms = 12): void { if (doc().settings.haptics) { try { vibrate(ms); } catch { /* unsupported */ } } }

// ------------------------------------------------------------------ names
/** Display name of a round definition (definitions keep English names). */
export function defName(d: Def | null): string {
  if (!d) return "";
  if (d.mode === "daily") return tr("Daily — {date}", { date: d.id.replace("daily-", "") });
  if (d.mode === "practice") {
    const m = /^practice-(easy|medium|hard)/.exec(d.id);
    return tr("Practice ({difficulty})", { difficulty: tr(m ? m[1]! : "medium") });
  }
  return tr(d.name);
}
/** Lesson text: the clue-solving step names its entry, so build it from the entry. */
export function stepText(step: NonNullable<Def["tutorial"]>["steps"][number]): string {
  if (step.require?.type === "complete-entry") {
    const e = session.def?.entries.find((x) => x.id === step.require.entry);
    if (e) return tr("Now solve this clue to finish the word: {number} {dir} — “{clue}”. Wrong letters can be retyped or cleared.", { number: e.number, dir: dirName(e.dir), clue: e.clue });
  }
  return tr(step.text);
}
export function objectiveText(): string {
  const d = session.def;
  if (!d) return "";
  const bits = [tr("Fill every square of “{name}”.", { name: defName(d) })];
  if (d.limits.timeMs) bits.push(tr("Time limit {time}.", { time: fmtTime(d.limits.timeMs) }));
  if (d.limits.mistakes) bits.push(tr("At most {n} flagged mistakes.", { n: d.limits.mistakes }));
  if (d.limits.checks) bits.push(tr("Only {n} checks available.", { n: d.limits.checks }));
  return bits.join(" ");
}

// ------------------------------------------------------------------ achievements
export const ACHIEVEMENTS: Record<string, { name: string; desc: string }> = {
  "first-completion": { name: N("First Completion"), desc: N("Finish your first grid.") },
  "mechanic-mastery": { name: N("Mechanic Mastery"), desc: N("Win a mastery page.") },
  "streak-5": { name: N("On a Roll"), desc: N("Complete 5 words in a row.") },
  "hard-milestone": { name: N("Hard Milestone"), desc: N("Win a multiplied (hard) round.") },
  "long-term-goal": { name: N("Seasoned Traveler"), desc: N("Win 10 rounds in total.") },
};
/** quiet: the results screen lists the unlock as a chip, so no toast over it. */
function unlockAchievement(id: string, quiet = false): void {
  const d = doc();
  if (!ACHIEVEMENTS[id] || d.achievements[id]) return;
  d.achievements[id] = Date.now();
  platform.persist();
  audio.play("achievement");
  if (!quiet) toast(() => tr("Achievement unlocked: {name}", { name: tr(ACHIEVEMENTS[id]!.name) }));
  session.newAchievements.push(id);
}

// ------------------------------------------------------------------ screens
export function show(phase: Phase, focus: string | null): void {
  app.phase = phase;
  app.sub = null;
  app.openedFrame = frame().frame;
  app.focusNext = focus;
  app.confirmGiveUp = false;
  ui.setFocus(null);
  audio.setIntensity(phase === "active" ? 1 : 0);
  if (phase === "title" || phase === "modes") dio.setSeed("title");
}
export function openSub(sub: Sub): void {
  if (app.phase === "active") pauseRound("menu");
  app.sub = sub;
  app.openedFrame = frame().frame;
  app.focusNext = sub === "settings" ? "set-theme" : "help-back";
  ui.setFocus(null);
}
export function closeSub(): void {
  const wasPaused = app.phase === "paused";
  app.sub = null;
  app.openedFrame = frame().frame;
  app.focusNext = wasPaused ? "pause-resume" : app.phase === "results" ? "btn-next" : app.phase === "title" ? "btn-play" : null;
  ui.setFocus(null);
}
export function titleScreen(): void { show("title", "btn-play"); }
export function modesScreen(view: ModeView = "modes"): void {
  app.modeView = view;
  show("modes", view === "modes" ? "mode-learn" : "modes-all");
}

// ------------------------------------------------------------------ round lifecycle
function firstPlayableCell(def: Def): number | null {
  const i = def.cells.findIndex((c) => c !== null);
  return i >= 0 ? i : null;
}
export function startRound(def: Def, tutorial = false): void {
  audio.unlock();
  session.def = def;
  session.state = R.createGame(def) as State;
  session.commands = [];
  session.sel = { cell: firstPlayableCell(def), dir: "across" };
  session.sessionId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  session.newAchievements = [];
  session.tutorialStep = 0;
  session.tutorial = tutorial && !!def.tutorial?.steps.length;
  session.tutorialFocus = null;
  session.timeWarned = false;
  session.elapsedMs = 0;
  session.lbLine = null;
  dio.setSeed(def.seed);
  show("active", TYPING);
  if (session.tutorial) showTutorialStep();
  audio.play("pageTurn");
  ui.announce(objectiveText().slice(0, 500), { politeness: "polite" });
}
export function startMode(key: "learn" | "daily" | "practice"): void {
  if (key === "learn") startRound(C.learnDef() as Def, true);
  else if (key === "daily") startRound(C.dailyForDate(new Date(platform.serverNow())) as Def);
  else modesScreen("practice");
}
export function practiceDifficultyOf(def: Def): string {
  const m = /^practice-(easy|medium|hard)/.exec(def.id);
  return m ? m[1]! : "medium";
}

function buildEnvelope(): unknown {
  const d = session.def!;
  return { schema: 1, build: R.RULES_VERSION, contentV: d.v, seed: d.seed, init: d, commands: session.commands.slice() };
}

function endRound(): void {
  app.phase = "resolving";
  const st = session.state!;
  // Verify locally: replay our own log before trusting the result.
  const check = R.replay(buildEnvelope()) as { ok: boolean; finalHash?: string };
  app.toasts = []; // in-play toasts would sit over the results heading on phones
  session.verified = !!check.ok && check.finalHash === R.hashState(st);
  if (!session.verified) {
    console.warn("replay verification failed");
    toast(() => tr("Local replay verification failed — score will not be submitted."));
  }
  applyRoundOutcome(st);
  if (session.verified && session.def!.ranked) postToLeaderboard(Math.max(0, st.score.total));
  const won = st.status === "won";
  ui.announce(tr(won ? "Won: {name}. Score {score}. {correct} of {total} letters correct." : "Lost: {name}. Score {score}. {correct} of {total} letters correct.",
    { name: defName(session.def), score: st.score.total, correct: st.filledCorrect, total: st.filledTotal }).slice(0, 500), { politeness: "assertive" });
  // Run in a microtask so the rest of this frame never reads a half-switched screen.
  queueMicrotask(() => show("results", "btn-next"));
}

function applyRoundOutcome(st: State): void {
  const d = session.def!;
  const p = doc();
  if (st.status !== "won") return;
  p.stats.wins++;
  p.stats.wordsCompleted += st.wordsDone;
  if (d.mode === "daily") {
    const day = d.id.replace("daily-", "");
    if (!p.stats.dailyDays.includes(day)) p.stats.dailyDays.push(day);
  }
  unlockAchievement("first-completion", true);
  if (st.bestStreak >= 5) unlockAchievement("streak-5", true);
  if (d.mult >= 1.5) unlockAchievement("hard-milestone", true);
  if (d.mode === "journey" && d.mechanics.includes("mastery")) unlockAchievement("mechanic-mastery", true);
  if (p.stats.wins >= 10) unlockAchievement("long-term-goal", true);
  if (d.mode === "journey") {
    const n = Number(d.id.replace("journey-", ""));
    const stars = 1 + (st.checksUsed + st.revealsUsed === 0 ? 1 : 0) + (d.par.timeMs && st.elapsedMs < d.par.timeMs ? 1 : 0);
    p.journey.stars[n] = Math.max(p.journey.stars[n] || 0, stars);
    p.journey.unlocked = Math.max(p.journey.unlocked, Math.min(40, n + 1));
  }
  platform.persist();
}

/** Signed in only: post a ranked round's total to the high-score board and show the rank on the results. */
function postToLeaderboard(total: number): void {
  if (!platform.signedIn()) { session.lbLine = null; return; }
  const posting = (): string => pt("lbPosting");
  session.lbLine = posting;
  const round = session.def;
  void platform.postLeaderboard(total).then((r) => {
    if (session.def !== round || session.lbLine !== posting) return;
    session.lbLine = () => (!r.posted ? pt("lbNotPosted") : r.rank ? pt("lbRank", { rank: r.rank }) : pt("lbPosted"));
  });
}

// ------------------------------------------------------------------ command dispatch
/** Pre-validates exactly what the rules would reject, so the log only holds accepted commands (replay demands gapless ids). */
function precheck(cmd: Cmd): string | null {
  const st = session.state;
  if (!st || st.status !== "active") return "not-active";
  const cellOk = (i: unknown): boolean => Number.isInteger(i) && (i as number) >= 0 && (i as number) < st.cells.length && !!st.cells[i as number];
  switch (cmd.type) {
    case "letter":
      if (!cellOk(cmd.cell)) return "bad-cell";
      if (!/^[A-Z]$/.test(String(cmd.ch || "").toUpperCase())) return "bad-letter";
      if (!R.canType(st, cmd.cell)) return "locked-cell";
      return null;
    case "clear":
      if (!cellOk(cmd.cell)) return "bad-cell";
      if (R.isLocked(st.cells[cmd.cell!])) return "locked-cell";
      if (st.cells[cmd.cell!]!.cur === "") return "nothing-to-clear";
      return null;
    case "check": {
      if (st.limits.checks !== null && st.checksUsed >= st.limits.checks) return "check-limit";
      const scope = cmd.scope || "grid";
      if (scope === "cell") return cellOk(cmd.cell) ? null : "bad-cell";
      if (scope === "word") return Number.isInteger(cmd.entry) && st.entries[cmd.entry!] ? null : "bad-word";
      return scope === "grid" ? null : "bad-scope";
    }
    case "reveal": {
      if (!cellOk(cmd.cell)) return "bad-cell";
      const c = st.cells[cmd.cell!]!;
      if (R.isLocked(c)) return "locked-cell";
      if (c.cur !== "" && c.cur === c.sol) return "already-correct";
      return null;
    }
    case "giveUp": return null;
    default: return "unknown-command";
  }
}

const ERROR_TEXT: Record<string, string> = {
  "locked-cell": N("That letter is locked — it was confirmed or revealed."),
  "bad-cell": N("That square is not part of the grid."),
  "bad-letter": N("Only letters A–Z can be entered."),
  "duplicate-id": N("Action already applied."),
  "out-of-order": N("Action arrived out of order."),
  "check-limit": N("No checks left for this round."),
  "nothing-to-clear": N("That square is already empty."),
  "already-correct": N("That letter is already correct."),
  "unknown-command": N("Unknown action."),
  "not-active": N("The round is over."),
  "bad-scope": N("Unknown check scope."),
  "bad-word": N("No such word."),
};
function handleInvalid(reason: string): void {
  audio.play("invalid");
  haptic(30);
  announceError(ERROR_TEXT[reason] ? tr(ERROR_TEXT[reason]!) : tr("Invalid action: {reason}", { reason }));
}

function dispatch(cmd: Cmd): { error?: string } | null {
  if (!session.state) return null;
  const illegal = precheck(cmd);
  if (illegal) { handleInvalid(illegal); return { error: illegal }; }
  const full: Cmd = { ...cmd, id: session.state.nextCmdId, at: Math.floor(session.elapsedMs) };
  const r = R.applyCommand(session.state, full) as { error?: string; state: State; events: GameEvent[] };
  if (r.error) { handleInvalid(r.error); return r; }
  session.state = r.state;
  session.commands.push(full);
  handleEvents(r.events);
  advanceTutorial(r.events);
  if (session.state.status !== "active") endRound();
  return r;
}

function handleEvents(events: GameEvent[]): void {
  for (const ev of events) {
    switch (ev.type) {
      case "letter": audio.play(ev.correct ? "correct" : "key"); haptic(8); break;
      case "word": {
        audio.play("word");
        haptic(20);
        const e = session.state!.entries[ev.entry!]!;
        const streak = ev.streak;
        toast(() => tr("Word complete: {number} {dir} (streak {streak})", { number: e.number, dir: dirName(e.dir), streak: streak ?? 0 }));
        break;
      }
      case "check":
        audio.play("check");
        if (ev.wrong?.length) { const n = ev.wrong.length; announceError(tr(n > 1 ? "{n} wrong letters flagged." : "{n} wrong letter flagged.", { n })); }
        break;
      case "reveal": audio.play("reveal"); break;
      case "win": audio.play("win"); haptic(60); break;
      case "lose": audio.play("lose"); haptic(60); break;
      default: break;
    }
  }
}

/** Time-limit watchdog: the rules only evaluate limits on a command, so when the clock runs out a neutral nudge (retyping an existing letter) lets them declare time-limit. */
function watchdog(): void {
  const st = session.state;
  if (!active() || !st) return;
  const lim = st.limits.timeMs;
  if (lim !== null && session.elapsedMs >= lim) {
    let cell = st.cells.findIndex((c) => c && c.cur !== "" && !R.isLocked(c));
    if (cell >= 0) dispatch({ type: "letter", cell, ch: st.cells[cell]!.cur });
    else {
      // No retypable cell: nudge any unlocked (necessarily empty) square with a deliberately wrong letter.
      cell = st.cells.findIndex((c) => c && !R.isLocked(c));
      if (cell >= 0) { const sol = st.cells[cell]!.sol; dispatch({ type: "letter", cell, ch: sol === "A" ? "B" : "A" }); }
    }
    return;
  }
  // One-shot warning with 30 s left on a time-limited round (sound + text cue).
  if (lim && !session.timeWarned) {
    const left = lim - session.elapsedMs;
    if (left > 0 && left <= 30000) {
      session.timeWarned = true;
      audio.play("timeWarning");
      haptic(40);
      toast(() => tr("30 seconds left!"));
      announceError(tr("30 seconds left."));
    }
  }
}

// ------------------------------------------------------------------ selection and play actions
/** The entries holding a cell, by direction (−1: none). */
export function entriesAt(i: number): { across: number; down: number } {
  const out = { across: -1, down: -1 };
  session.def!.entries.forEach((e, idx) => { if (e.cells.includes(i)) out[e.dir] = idx; });
  return out;
}
export function currentEntryIdx(): number {
  if (session.sel.cell === null || !session.def) return -1;
  const at = entriesAt(session.sel.cell);
  if (at[session.sel.dir] >= 0) return at[session.sel.dir];
  return at.across >= 0 ? at.across : at.down;
}
let lastClueAnnounced = "";
function announceClue(): void {
  const ei = currentEntryIdx();
  if (ei < 0) return;
  const e = session.def!.entries[ei]!;
  const text = `${e.number} ${dirName(e.dir)} — ${e.clue}`;
  if (text !== lastClueAnnounced) { lastClueAnnounced = text; ui.announce(text, { politeness: "polite" }); }
}
export function onCellTap(i: number): void {
  if (!active() || !session.state?.cells[i]) return;
  audio.unlock();
  if (session.sel.cell === i) {
    // A second tap toggles the direction when the square has both.
    const at = entriesAt(i);
    if (at.across >= 0 && at.down >= 0) session.sel.dir = session.sel.dir === "across" ? "down" : "across";
  } else {
    const at = entriesAt(i);
    session.sel = { cell: i, dir: at[session.sel.dir] >= 0 ? session.sel.dir : (at.across >= 0 ? "across" : "down") };
  }
  audio.play("select");
  announceClue();
}
export function toggleDir(): void { if (session.sel.cell !== null) onCellTap(session.sel.cell); }
export function pickClue(idx: number): void {
  const e = session.def?.entries[idx];
  if (!e || !active()) return;
  session.sel = { cell: e.cells[0]!, dir: e.dir };
  audio.play("select");
  announceClue();
  focusBoard();
}
function moveSelection(dr: number, dc: number): void {
  const st = session.state;
  if (!st || session.sel.cell === null) return;
  let r = R.rowOf(st, session.sel.cell);
  let c = R.colOf(st, session.sel.cell);
  for (let step = 0; step < st.rows * st.cols; step++) {
    r = (r + dr + st.rows) % st.rows;
    c = (c + dc + st.cols) % st.cols;
    const i = r * st.cols + c;
    if (st.cells[i]) {
      session.sel.cell = i;
      const at = entriesAt(i);
      if (dr !== 0 && at.down >= 0) session.sel.dir = "down";
      if (dc !== 0 && at.across >= 0) session.sel.dir = "across";
      break;
    }
  }
  announceClue();
}
export function nextClue(delta: number): void { nextEntry(delta); }
function nextEntry(delta: number): void {
  const d = session.def;
  const ei = currentEntryIdx();
  if (!d || ei < 0) return;
  const n = d.entries.length;
  const next = d.entries[(ei + delta + n) % n]!;
  session.sel = { cell: next.cells[0]!, dir: next.dir };
  announceClue();
}
function advanceAfterLetter(): void {
  const st = session.state!;
  const ei = currentEntryIdx();
  if (ei < 0) return;
  const cells = session.def!.entries[ei]!.cells;
  const pos = cells.indexOf(session.sel.cell!);
  for (let k = pos + 1; k < cells.length; k++) {
    const i = cells[k]!;
    if (R.canType(st, i) && st.cells[i]!.cur === "") { session.sel.cell = i; return; }
  }
  for (let k = pos + 1; k < cells.length; k++) {
    if (R.canType(st, cells[k]!)) { session.sel.cell = cells[k]!; return; }
  }
}
export function typeLetter(ch: string): void {
  if (!active() || session.sel.cell === null) return;
  audio.unlock();
  const r = dispatch({ type: "letter", cell: session.sel.cell, ch: ch.toUpperCase() });
  if (r && !r.error && active()) advanceAfterLetter();
}
export function clearCell(): void {
  if (!active() || session.sel.cell === null) return;
  dispatch({ type: "clear", cell: session.sel.cell });
}
export function checkWord(): void {
  if (!active()) return;
  const ei = currentEntryIdx();
  if (ei >= 0) dispatch({ type: "check", scope: "word", entry: ei });
}
export function checkGrid(): void { if (active()) dispatch({ type: "check", scope: "grid" }); }
export function revealHint(): void {
  if (!active()) return;
  const ei = currentEntryIdx();
  const hint = (R.getHint as (s: unknown, e: number | null) => { cell: number } | null)(session.state, ei >= 0 ? ei : null);
  if (!hint) { announceError(tr("Nothing to reveal — the grid is complete.")); return; }
  session.sel.cell = hint.cell;
  dispatch({ type: "reveal", cell: hint.cell });
}
/** Give up asks first (the inline confirm on the play screen, the browser build's confirm()). */
export function askGiveUp(): void {
  if (!active() && app.phase !== "paused") return;
  if (app.phase === "paused") resumeRound();
  app.confirmGiveUp = true;
  app.openedFrame = frame().frame;
  app.focusNext = "giveup-cancel";
}
export function giveUp(): void {
  app.confirmGiveUp = false;
  if (active()) dispatch({ type: "giveUp" });
}
export function pauseRound(reason: "user" | "menu" | "hidden" = "user"): void {
  if (app.phase !== "active") return;
  if (reason === "user") audio.play("pause");
  app.phase = "paused";
  app.confirmGiveUp = false;
  app.openedFrame = frame().frame;
  app.focusNext = "pause-resume";
  audio.setIntensity(0);
}
export function resumeRound(): void {
  if (app.phase !== "paused") return;
  app.phase = "active";
  app.sub = null;
  app.openedFrame = frame().frame;
  app.focusNext = TYPING;
  audio.setIntensity(1);
}
export function leaveRound(): void { titleScreen(); }

// ------------------------------------------------------------------ the Learn lessons
function showTutorialStep(): void {
  const steps = session.def!.tutorial!.steps;
  session.tutorialFocus = null;
  if (session.tutorialStep >= steps.length) return;
  const step = steps[session.tutorialStep]!;
  ui.announce(tr("Lesson {n} of {total}: {text}", { n: session.tutorialStep + 1, total: steps.length, text: stepText(step) }).slice(0, 500), { politeness: "polite" });
  if (step.focus != null) { session.tutorialFocus = step.focus; session.sel.cell = step.focus; }
}
function advanceTutorial(events: GameEvent[]): void {
  const tut = session.def?.tutorial;
  if (!session.tutorial || !tut || session.tutorialStep >= tut.steps.length) return;
  const step = tut.steps[session.tutorialStep]!;
  const st = session.state!;
  const req = step.require;
  let done = false;
  switch (req.type) {
    case "any-letter": done = events.some((e) => e.type === "letter"); break;
    case "complete-entry": done = R.entryComplete(st, req.entry); break;
    case "any-word": done = events.some((e) => e.type === "word"); break;
    case "any-check": done = events.some((e) => e.type === "check"); break;
    case "any-reveal": done = events.some((e) => e.type === "reveal"); break;
    case "grid-complete": done = st.status === "won"; break;
    default: break;
  }
  if (!done) return;
  session.tutorialStep++;
  if (session.tutorialStep < tut.steps.length) {
    showTutorialStep();
    toast(() => tr("Lesson complete!"));
    audio.play("lesson");
  } else {
    session.tutorialFocus = null;
    doc().tutorialDone = true;
    platform.persist();
  }
}
/** The banner's text now (null: no lesson showing). */
export function lessonText(): string | null {
  const tut = session.def?.tutorial;
  if (!session.tutorial || !tut || session.tutorialStep >= tut.steps.length) return null;
  return tr("Lesson {n} of {total}: {text}", { n: session.tutorialStep + 1, total: tut.steps.length, text: stepText(tut.steps[session.tutorialStep]!) });
}

// ------------------------------------------------------------------ settings and the platform
export function saveSettings(): void {
  platform.persist();
  applyTheme(theme());
  dio.setTheme(theme());
}
export function copyInvite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  let ok = false;
  try { clipboard.writeText(link); ok = true; } catch { ok = false; }
  toast(() => (ok ? pt("copied") : pt("copyFail", { link })));
}
export function signIn(): void { void requestSignIn().catch(() => undefined); }

// ------------------------------------------------------------------ input
// Letters reach the board three ways. The play screen's letters field (screens.ts, the runtime's
// text field) takes typed text after the keyboard layout and input methods; on a keyboard device
// it has the focus whenever the board would (round start, a square tapped, a clue picked), and
// while it holds the keyboard (no game actions then, engine.minor 17+) Backspace and Delete clear
// the square, the arrows steer, Enter hops to the next clue (Shift: previous), Escape pauses and
// Space switches Across / Down. With the board region focused (or nothing) letter keys type by
// their key (KeyA–KeyZ); a Check or Reveal key on a letter types there and acts elsewhere (the
// browser build's rule). Touch players get the on-screen letter keys, or the field, whose tap
// brings up the device keyboard.
export const TYPE_ID = "type-field";
export const typeFieldLabel = (): string => tr("Type letters");
let fieldShownAt = -10;
/** screens.ts built the letters field this frame. */
export function fieldShown(): void { fieldShownAt = frame().frame; }
export function fieldFocused(): boolean { const f = ui.focused(); return f === TYPE_ID || f === typeFieldLabel(); }
/** The board has the keys: it, the letters field, or nothing is focused. */
export function boardFocused(): boolean {
  const f = ui.focused();
  return f === null || f === boardLabel() || fieldFocused();
}
export const boardLabel = (): string => tr("Crossword grid");
/** Where typing focus goes: the letters field on keyboard devices while it shows, else the board. */
export function typingFocus(): string {
  return primaryPointer() !== "coarse" && frame().frame - fieldShownAt <= 2 ? TYPE_ID : BOARD_ID;
}
/** app.focusNext's stand-in for typingFocus(), resolved as the screen is built. */
export const TYPING = "@typing";
export function focusBoard(): void { app.focusNext = TYPING; app.openedFrame = frame().frame; }
const LETTER_ACTIONS = ["checkword", "checkgrid", "reveal"];
let lastKeyCode = "";
let lastKeyFrame = -1;
const held = (...codes: string[]): boolean => codes.some((c) => isKeyDown(c));
onKey((e) => {
  if (!e.pressed) return;
  lastKeyCode = e.code;
  lastKeyFrame = frame().frame;
  if (!active() || app.sub || app.confirmGiveUp) return;
  const shift = held("ShiftLeft", "ShiftRight");
  if (ui.capturingKeys()) {
    if (!fieldFocused()) return;
    switch (e.code) {
      case "Backspace": case "Delete": clearCell(); break;
      // The arrows steer the board; the UI's arrow navigation may take the focus off the
      // field, so it is handed back.
      case "ArrowUp": moveSelection(-1, 0); focusBoard(); break;
      case "ArrowDown": moveSelection(1, 0); focusBoard(); break;
      case "ArrowLeft": moveSelection(0, -1); focusBoard(); break;
      case "ArrowRight": moveSelection(0, 1); focusBoard(); break;
      case "Enter": case "NumpadEnter": nextEntry(shift ? -1 : 1); break;
      case "Escape": if (!e.repeat) pauseRound(); break;
      default: break;
    }
    return;
  }
  if (held("ControlLeft", "ControlRight", "MetaLeft", "MetaRight", "AltLeft", "AltRight")) return;
  const m = /^Key([A-Z])$/.exec(e.code);
  if (m && (boardFocused() || !boundLetterKey(e.code))) typeLetter(m[1]!);
});
/** A letter key bound to Check or Reveal: typed on the board, acting elsewhere. */
function boundLetterKey(code: string): boolean {
  if (!/^Key[A-Z]$/.test(code)) return false;
  return LETTER_ACTIONS.some((a) => bindings(a).some((b) => b.device === "keyboard" && b.code === code));
}
/** What the letters field received this frame: each letter goes into the board (the field empties again), a space switches direction. */
export function typedInField(text: string): void {
  for (const ch of text) {
    if (/^[a-zA-Z]$/.test(ch)) typeLetter(ch);
    else if (ch === " ") toggleDir();
  }
}

onAction((e) => {
  if (!e.pressed) return;
  if (e.action === "pause") {
    if (app.sub || app.confirmGiveUp) return; // Escape closes those (ui.back)
    if (app.phase === "active") pauseRound();
    else if (app.phase === "paused" && frame().frame !== app.openedFrame) resumeRound();
    return;
  }
  if (!active() || app.sub || app.confirmGiveUp) return;
  const kb = e.source === "keyboard";
  const onBoard = boardFocused();
  const letterKey = kb && lastKeyFrame === frame().frame && /^Key[A-Z]$/.test(lastKeyCode);
  switch (e.action) {
    case "up": case "down": case "left": case "right": {
      // The keyboard's arrows always steer the board (the browser build's window keydown); a pad's
      // D-pad steers it from the board and navigates the UI elsewhere.
      if (!kb && !onBoard) return;
      const [dr, dc] = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[e.action] as [number, number];
      moveSelection(dr, dc);
      if (!onBoard) focusBoard();
      break;
    }
    case "nextclue":
      if (kb && !onBoard) return; // Enter activates a focused button
      nextEntry(kb && (isKeyDown("ShiftLeft") || isKeyDown("ShiftRight")) ? -1 : 1);
      break;
    case "toggledir":
      if (kb && !onBoard) return; // Space activates a focused button
      toggleDir();
      break;
    case "clear": clearCell(); break;
    case "checkword": if (!(letterKey && onBoard)) checkWord(); break;
    case "checkgrid": if (!(letterKey && onBoard)) checkGrid(); break;
    case "reveal": if (!(letterKey && onBoard)) revealHint(); break;
    default: break;
  }
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const key = `${f.quality}:${f.levelIndex}`;
  if (key === lookKey) return;
  lookKey = key;
  app.look = lookFor(f.quality, f.levelIndex);
  styleLook(app.look);
  dio.applyLook(app.look);
}

let suspended = false;
onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  platform.onDocChange(() => { applyTheme(theme()); dio.setTheme(theme()); });
  applyTheme(theme());
  dio.setTheme(theme());
  dio.setReducedMotion(preferences().reducedMotion);
  onPreferencesChange((p) => dio.setReducedMotion(p.reducedMotion));
  applyLook();
  titleScreen();
});
// A hidden window pauses the round (the clock never counts it); returning leaves it paused.
onSuspend(() => { suspended = true; pauseRound("hidden"); platform.flush(); });
onResume(() => { suspended = false; });
onQuit(() => { platform.flush(); });
onFixedUpdate(() => { if (!suspended && active()) session.elapsedMs += 1000 / 60; });
onUpdate(() => {
  applyLook();
  audio.update();
  watchdog();
  const now = frame().time;
  app.toasts = app.toasts.filter((t) => t.until > now);
});
onRender(() => {
  const f = frame();
  dio.update(f.width, f.height, f.delta);
  drawScreens();
});
