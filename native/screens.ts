// The browser build's DOM screens (index.html with css/style.css) as
// starhermit:ui, built every frame over the diorama: the top bar (brand,
// account and UTC day, Help, Settings), the title (key art, Play, the Daily,
// Journey and Profile cards, Sign in and Invite), the mode select (modes,
// the Journey's 40 pages, the challenges, the practice difficulties), the
// play screen, the results, Settings, Help, the pause dialog, the give-up
// confirm and the toasts. The CSS breakpoints are layouts picked by the
// window's logical size:
// - wide (≥ 1024 px): three rails — objective, HUD and the clue lists on the
//   left, the board in the middle, the current clue, the actions and the
//   letters field on the right;
// - compact (< 1024 px): the current clue over the board, the rails as
//   drawers under it ("Objective & clues ▾", "Clue & actions ▾"), and the
//   thumb tray at the bottom (the on-screen letter keys, ABC, Check, Reveal,
//   Across ⇄, Pause);
// - short landscape (≤ 500 px tall): the tray docked at the side so the
//   board keeps the full height.
// Left-handed mirrors the rails and the tray. Settings keeps the game's own
// options (name, theme, colour-vision markers, left-handed layout, haptics,
// the letter keys) and opens the runtime's Options for sound, graphics,
// language, controls and accessibility, which replaced the old panels.
import { frame, openMenu } from "starhermit:engine";
import * as draw from "starhermit:draw";
import { bindings, primaryPointer } from "starhermit:input";
import * as ui from "starhermit:ui";
import * as C from "../js/content.js";
import { boardSize, buildBoard, fitCell } from "./board.ts";
import { N, pt, tr } from "./i18n.ts";
import * as platform from "./platform.ts";
import {
  ACHIEVEMENTS, app, askGiveUp, checkGrid, checkWord, clearCell, closeSub, copyInvite, currentEntryIdx, defName, dirName, doc,
  fmtTime, giveUp, leaveRound, lessonText, modesScreen, objectiveText, openSub, pauseRound, pickClue, practiceDifficultyOf,
  resumeRound, revealHint, saveSettings, session, signIn, startMode, startRound, titleScreen, toggleDir, typeLetter, typedInField,
  type Def, type Entry, show, TYPING, TYPE_ID, typingFocus, fieldShown, focusBoard,
} from "./main.ts";
import { palette } from "./style.ts";

export const BOARD_ID = "board";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; wide: boolean; shortLand: boolean; phone: boolean; big: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  const shortLand = lw > lh && lh <= 500;
  return { lw, lh, sc, wide: lw >= 1024 && !shortLand, shortLand, phone: lw <= 700, big: lw > 1600 && lh > 1000 };
}
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const lastH = new Map<string, number>();
function track(key: string, r: ui.Rect): void { lastH.set(key, r.height / ui.preferences().scale); }
const H = (key: string, def: number): number => lastH.get(key) ?? def;

function textWidth(text: string, style: readonly (string | ui.Style)[], kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: [...style] }).width / ui.preferences().scale;
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, style: (string | ui.Style)[], id?: string): ui.Rect {
  let u = ui.style(...style);
  if (id) u = u.id(id);
  if (textWidth(text, style) <= width) return u.label(text);
  return u.paragraph(text, width);
}
interface Btn { id: string; text: string; style?: (string | ui.Style)[]; act: () => void; content?: () => void; disabled?: boolean; selected?: boolean }
/** A button `width` wide (null: its text's); a label too long for it wraps inside. */
function button(b: Btn, width: number | null = null): boolean {
  const style = b.style ?? ["chip"];
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.selected !== undefined) opts.selected = b.selected;
  if (b.content) opts.content = b.content;
  else if (width != null && textWidth(b.text, style, "button") + 2 > width) {
    const inner = Math.max(20, width - 30);
    const light = style.some((c) => c === "act" || c === "danger" || c === "big");
    opts.content = () => { ui.style({ text: { align: "center", ...(light && !ui.preferences().highContrast ? { color: "#ffffff" } : {}) } }).paragraph(b.text, inner); };
  }
  const hit = ui.style(...style, width != null ? { width } : {}).id(b.id).button(b.text, opts);
  if (hit) b.act();
  return hit;
}
/** Buttons wrapped into rows `width` wide (CSS flex-wrap), each its own width or `each`. */
function flow(id: string, items: Btn[], width: number, gap: number, each: number | null = null, justify: ui.Align = "center"): void {
  const sized = items.map((b) => ({ b, w: each ?? Math.min(width, textWidth(b.text, b.style ?? ["chip"], "button") + 2) }));
  const rows: (typeof sized)[] = [];
  let cur: typeof sized = [], used = 0;
  for (const s of sized) {
    if (cur.length && used + gap + s.w > width) { rows.push(cur); cur = []; used = 0; }
    used += (cur.length ? gap : 0) + s.w;
    cur.push(s);
  }
  if (cur.length) rows.push(cur);
  ui.column(id, () => {
    rows.forEach((r, ri) => ui.row(`${id}-r${ri}`, () => { for (const s of r) button(s.b, s.w); }, { spacing: gap, justify }));
  }, { spacing: gap, align: justify === "center" ? "center" : "start" });
}

// ------------------------------------------------------------------ art
/** An image cover-fitted (CSS object-fit: cover) into a widget `w` × `h` with rounded corners and an optional drop shadow. */
function artWidget(id: string, path: string, w: number, h: number, radius: number, shadow: boolean): void {
  ui.id(id).widget("", {
    role: "image", size: { width: w, height: h },
    draw: (r) => {
      draw.box(r.x, r.y, r.width, r.height, {
        background: [{ image: path, size: "cover" }, "#3a2c20"], radius,
        ...(shadow ? { shadow: { y: 8, blur: 24, color: "#00000073" } } : {}),
      });
    },
  });
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  ui.column("page", () => {
    topbar(L);
    const bodyH = L.lh - H("topbar", 56);
    ui.column("stage", () => {
      if (app.sub === "settings") settingsScreen(L, bodyH);
      else if (app.sub === "help") helpScreen(L, bodyH);
      else if (app.phase === "title") titleScreenUi(L, bodyH);
      else if (app.phase === "modes") modesScreenUi(L, bodyH);
      else if (app.phase === "results") resultsScreen(L, bodyH);
      else if (session.state) playScreen(L, bodyH);
    }, { width: L.lw, height: bodyH, spacing: 0 });
  }, { width: L.lw, height: L.lh, spacing: 0 });
  pauseDialog(L);
  giveUpDialog(L);
  toasts(L);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext === TYPING ? typingFocus() : app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}

// ------------------------------------------------------------------ top bar
function star(id: string, size: number): void {
  ui.id(id).widget("", {
    role: "none", size: { width: size, height: size },
    draw: (r) => {
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2, R0 = r.width / 2, r0 = R0 * 0.28;
      const pts: [number, number][] = [];
      for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 4; const rr = i % 2 ? r0 : R0; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
      draw.polygon(pts, ui.preferences().highContrast ? "#ffffff" : palette().accent);
    },
  });
}
function statusLine(): string {
  const day = tr("{date} UTC", { date: new Date(platform.serverNow()).toISOString().slice(0, 10) });
  if (!platform.signedIn()) return day;
  const s = platform.syncState();
  const sync = s === "synced" ? pt("synced") : s === "saving" ? pt("saving") : pt("nosync");
  return `${platform.displayName() || "…"} · ${sync} · ${day}`;
}
function topbar(L: Layout): void {
  const h = L.shortLand ? 44 : 56;
  const r = ui.style("topbar").row("topbar", () => {
    ui.row("brand", () => {
      star("brand-star", L.phone ? 18 : 21);
      // On a narrow bar the name wraps onto two lines (as the browser build's did).
      const room = L.lw - 28 - 26 - (L.phone ? 16 : 36) - textWidth(tr("Help"), ["chip"], "button") - textWidth(tr("Settings"), ["chip"], "button") - (L.phone ? 0 : textWidth(statusLine(), ["status"]) + 12);
      const brandStyle = ["brand", L.phone ? { text: { size: 16 } } : {}] as (string | ui.Style)[];
      if (textWidth("Crossword Journey", brandStyle) <= room) ui.style(...brandStyle).label("Crossword Journey");
      else ui.style(...brandStyle).paragraph("Crossword Journey", Math.max(60, room));
    }, { spacing: 8, align: "center" });
    ui.spacer();
    if (!L.phone) ui.style("status").id("status").label(statusLine());
    const sub = app.sub;
    button({ id: "nav-help", text: tr("Help"), act: () => (sub === "help" ? closeSub() : openSub("help")) });
    button({ id: "nav-settings", text: tr("Settings"), act: () => (sub === "settings" ? closeSub() : openSub("settings")) });
  }, { width: L.lw, height: h, spacing: L.phone ? 8 : 12, align: "center" });
  track("topbar", r);
}

// ------------------------------------------------------------------ title
function titleScreenUi(L: Layout, bodyH: number): void {
  const d = doc();
  const w = Math.min(L.lw - 32, 640);
  const stars = Object.values(d.journey.stars).reduce((a, b) => a + b, 0);
  ui.scrollArea("title", { width: L.lw, height: bodyH }, () => {
    const r = ui.column("title-col", () => {
      // The key art gives up height first (cropped, never below 96 px) so the menu stays above the fold.
      const others = H("title-rest", 360);
      if (!L.shortLand) {
        const aw = Math.min(560, w), ah = clamp(bodyH - others - 48 - 18, 96, aw * 9 / 16);
        artWidget("title-art", "assets/key-art.webp", aw, ah, 14, true);
      }
      const rest = ui.column("title-rest", () => {
        para(tr("Your travel journal awaits"), w, ["screen-heading", { text: { align: "center" } }], "title-heading");
        para(tr("Solve clue-driven words across scenic pages. One shared grid every day."), w, ["lede", { text: { align: "center" } }], "title-lede");
        button({ id: "btn-play", text: tr("▶ Play"), style: ["big"], act: () => { modesScreen("modes"); } });
        const card = (id: string, title: string, sub: string, act: () => void): Btn => ({
          id, text: title, style: ["card"], act,
          content: () => { ui.style("ink-b", { text: { weight: "700" } }).label(title); ui.style("card-sub").label(sub); },
        });
        const cw = L.phone ? Math.min(w, 340) : 200;
        flow("title-cards", [
          card("btn-daily", tr("Daily Challenge"), tr("{date} · ranked", { date: new Date(platform.serverNow()).toISOString().slice(0, 10) }), () => startMode("daily")),
          card("btn-journey", tr("Journey"), tr("Page {n} of 40 · {stars}★", { n: Math.min(d.journey.unlocked, 40), stars }), () => modesScreen("journey")),
          card("btn-profile", tr("Profile"), platform.signedIn() ? platform.displayName() : (d.profile.name === "Guest" ? tr("Guest") : d.profile.name), () => { openSub("settings"); app.focusNext = "set-name"; }),
        ], w, 12, cw);
        const plat: Btn[] = [];
        if (!platform.signedIn()) plat.push({ id: "btn-signin", text: pt("signIn"), style: ["card"], act: signIn });
        else if (platform.inviteLink()) plat.push({ id: "btn-invite", text: pt("invite"), style: ["card"], act: copyInvite });
        if (plat.length) flow("title-platform", plat, w, 12, cw);
      }, { spacing: 18, align: "center" });
      track("title-rest", rest);
    }, { width: L.lw, spacing: 18, align: "center", padding: { top: 24, bottom: 24 } });
    void r;
  });
}

// ------------------------------------------------------------------ modes
const MODE_INFO: Record<string, { name: string; desc: string; meta: string }> = {
  learn: { name: N("Learn — First Page"), desc: N("Interactive lessons: one rule at a time. ~3 minutes."), meta: N("Tutorial · unranked") },
  journey: { name: N("Journey"), desc: N("40 authored pages across five regions; mastery every eighth page."), meta: N("Progress saved locally") },
  daily: { name: N("Daily Challenge"), desc: N("One shared grid per UTC day, synchronized to server time. ~5–15 minutes."), meta: N("Ranked leaderboard") },
  practice: { name: N("Practice"), desc: N("Fresh grid at your chosen difficulty. Restart freely."), meta: N("Casual · unranked") },
  challenge: { name: N("Challenges"), desc: N("Constrained goals: time limits, few checks, big grids."), meta: N("Ranked · bonus multiplier") },
};
function modeItem(id: string, name: string, desc: string, meta: string | null, w: number, act: () => void, opts: { stars?: number; locked?: boolean } = {}): void {
  const inner = w - 36;
  const starText = opts.locked ? null : opts.stars !== undefined ? "★".repeat(opts.stars) + "☆".repeat(3 - opts.stars) : null;
  const label = [name, starText !== null && opts.stars !== undefined ? tr("{n} of 3 stars", { n: opts.stars }) : opts.locked ? tr("locked") : "", desc, meta ?? ""].filter(Boolean).join(". ");
  const hit = ui.style("mode-item", { width: w }).id(id).button(label, {
    disabled: !!opts.locked,
    content: () => {
      ui.row(`${id}-top`, () => {
        ui.style("ink-b", { text: { weight: "700" } }).label(name);
        ui.spacer();
        if (starText) ui.style("mode-stars").label(starText);
        else if (opts.locked) lockGlyph(`${id}-lock`);
      }, { width: inner, align: "center" });
      para(desc, inner, ["mode-desc"]);
      if (meta) para(meta, inner, ["mode-meta"]);
    },
  });
  if (hit && !opts.locked) act();
}
function lockGlyph(id: string): void {
  ui.id(id).widget("", {
    role: "none", size: { width: 16, height: 16 },
    draw: (r, st) => {
      const k = st.scale, c = ui.preferences().highContrast ? "#ffffff" : "#b08a3e";
      draw.box(r.x + 2 * k, r.y + 7 * k, 12 * k, 9 * k, { background: c, radius: 2 });
      draw.strokeArc(r.x + 8 * k, r.y + 7 * k, 4 * k, Math.PI, Math.PI * 2, c, 2 * k);
    },
  });
}
function modesScreenUi(L: Layout, bodyH: number): void {
  const w = Math.min(620, L.lw - 32);
  const d = doc();
  ui.column("modes", () => {
    para(tr("Choose a mode"), w, ["screen-heading", { text: { align: "center" } }], "modes-heading");
    const listH = Math.max(160, bodyH - 24 - H("modes-heading-h", 48) - 18 * 2 - 48 - 24);
    ui.scrollArea("mode-list", { width: w + 12, height: Math.min(listH, Math.max(listH, 0)) }, () => {
      ui.column("mode-items", () => {
        if (app.modeView === "modes") {
          for (const key of ["learn", "daily", "practice"] as const) {
            const m = MODE_INFO[key]!;
            modeItem(`mode-${key}`, tr(m.name), tr(m.desc), tr(m.meta), w, () => startMode(key));
          }
          modeItem("mode-journey", tr(MODE_INFO.journey!.name), tr(MODE_INFO.journey!.desc), tr("Unlocked through page {n} of 40", { n: d.journey.unlocked }), w, () => modesScreen("journey"));
          modeItem("mode-challenge", tr(MODE_INFO.challenge!.name), tr(MODE_INFO.challenge!.desc), tr(MODE_INFO.challenge!.meta), w, () => modesScreen("challenge"));
        } else {
          button({ id: "modes-all", text: tr("← All modes"), act: () => modesScreen("modes") }, w);
          if (app.modeView === "journey") {
            for (const def of C.journeyStages() as Def[]) {
              const n = Number(def.id.replace("journey-", ""));
              const locked = n > d.journey.unlocked;
              modeItem(`page-${n}`, `${n}. ${defName(def)}`,
                locked ? tr("Finish the previous page to unlock.") : (def.blurb ? tr(def.blurb) : tr("{pattern}, difficulty {n}", { pattern: def.pattern, n: def.maxDifficulty })),
                null, w, () => startRound(def), { stars: d.journey.stars[n] || 0, locked });
            }
          } else if (app.modeView === "challenge") {
            for (const def of C.challengeDefs() as Def[]) {
              modeItem(def.id, defName(def), tr(def.blurb ?? ""), tr("Ranked · ×{n} points", { n: def.mult }), w, () => startRound(def));
            }
          } else {
            const DESC: Record<string, string> = { easy: N("Small 5×5 pages, common words."), medium: N("6–7 wide pages, moderate words."), hard: N("Big 7–9 wide pages, tricky words.") };
            for (const diff of ["easy", "medium", "hard"]) {
              modeItem(`practice-${diff}`, tr("Practice — {difficulty}", { difficulty: tr(diff) }), tr(DESC[diff]!), tr("Casual · unranked · restart anytime"), w,
                () => startRound(C.practiceDef(diff) as Def));
            }
          }
        }
      }, { spacing: 10, padding: { start: 2, end: 10, top: 2, bottom: 2 } });
    });
    button({ id: "btn-modes-back", text: tr("← Back"), act: () => (app.modeView === "modes" ? titleScreen() : modesScreen("modes")) });
  }, { width: L.lw, height: bodyH, spacing: 18, align: "center", justify: "center", padding: { top: 12, bottom: 12 } });
}

// ------------------------------------------------------------------ play
function hudBlock(w: number): void {
  const st = session.state!;
  const pct = st.filledTotal ? Math.round((st.filledCorrect / st.filledTotal) * 100) : 0;
  ui.style("rail-heading").label(tr("Objective").toUpperCase());
  para(objectiveText(), w, ["objective"], "objective");
  ui.row("progress-row", () => {
    ui.progress(pct / 100, w - 50, { tooltip: tr("Grid completion") });
    ui.style("hud").label(`${pct}%`);
  }, { spacing: 8, align: "center" });
  ui.row("hud-time", () => {
    ui.style("hud").label(tr("Time:"));
    ui.style("hud").id("hud-timer").label(fmtTime(session.elapsedMs) + (st.limits.timeMs ? ` / ${fmtTime(st.limits.timeMs)}` : ""));
  }, { spacing: 4 });
  ui.row("hud-score", () => { ui.style("hud").label(tr("Score:")); ui.style("hud-score").id("hud-score-v").label(String(st.score.total)); }, { spacing: 4 });
  ui.row("hud-streak", () => { ui.style("hud").label(tr("Streak:")); ui.style("hud").id("hud-streak-v").label(String(st.streak)); }, { spacing: 4 });
}
/** One clue of the lists: its number in bold and the clue, struck through once the word is complete. */
function clueItem(idx: number, e: Entry, w: number): void {
  const st = session.state!;
  const current = currentEntryIdx() === idx;
  const done = st.entries[idx] ? (st as unknown as { completedWords: boolean[] }).completedWords?.[idx] ?? false : false;
  const k = ui.preferences().scale;
  const size = 14.7 * ui.preferences().textScale;
  const numW = draw.measureText(String(e.number), { size: size * k, weight: "800" }).width / k + 6;
  const textW = w - 24 - numW;
  const m = draw.measureText(e.clue, { size: size * k, maxWidth: textW * k });
  const h = Math.max(44, m.height / k + 16);
  const res = ui.id(`clue-${idx}`).widget(`${e.number} ${e.clue}`, {
    role: "button", size: { width: w, height: h }, description: `${dirName(e.dir)}${done ? ", " + tr("complete") : ""}`,
    draw: (r, ws) => {
      const P = palette(), hc = ws.highContrast;
      const ink = hc ? "#ffffff" : done ? "#5b6472" : P.ink;
      if (current) draw.box(r.x, r.y, r.width, r.height, { radius: 8, background: hc ? "#000000" : "#2f80ed1f", border: { width: 2, color: hc ? "#ffff00" : P.select } });
      else if (ws.hovered) draw.box(r.x, r.y, r.width, r.height, { radius: 8, background: "#0000000d" });
      const x = r.x + 10 * k, y = r.y + 8 * k;
      draw.text(String(e.number), x, y, { size: size * k, weight: "800", color: ink });
      draw.text(e.clue, x + numW * k, y, { size: size * k, maxWidth: textW * k, color: ink });
      if (done) {
        const lines = Math.max(1, Math.round(m.height / (size * k * 1.3)));
        const lh = m.height / lines;
        const one = lines === 1 ? m.width : textW * k;
        for (let l = 0; l < lines; l++) draw.rect(x + numW * k, y + lh * l + lh * 0.55, l === lines - 1 && lines > 1 ? textW * k * 0.6 : one, 1.2 * k, ink);
      }
    },
  });
  if (res.activated) pickClue(idx);
}
function clueLists(w: number): void {
  const d = session.def!;
  for (const dir of ["across", "down"] as const) {
    ui.style("clue-dir").label(dirName(dir));
    d.entries.forEach((e, idx) => { if (e.dir === dir) clueItem(idx, e, w); });
  }
}
function currentClueText(): string {
  const ei = currentEntryIdx();
  if (ei < 0) return tr("Select a square to begin.");
  const e = session.def!.entries[ei]!;
  return `${e.number} ${dirName(e.dir)} — ${e.clue}`;
}
function checksOut(): boolean {
  const st = session.state!;
  return st.limits.checks !== null && st.checksUsed >= st.limits.checks;
}
/** The letters field: what is typed (or what the device keyboard sends) goes into the board, square by square. */
function typeField(w: number): void {
  const t = ui.textField(TYPE_ID, "", { width: w, maxChars: 32, placeholder: tr("Type letters") });
  fieldShown();
  if (t) typedInField(t);
}
/** An action, then the keys back to the board. */
const then = (fn: () => void) => (): void => { fn(); focusBoard(); };
function actionButtons(w: number): void {
  const out = checksOut();
  // An assist pressed hands the keys back to the board (typing goes on at once).
  button({ id: "act-check-word", text: tr("Check word"), style: ["act"], act: then(checkWord), disabled: out }, w);
  button({ id: "act-check-grid", text: tr("Check grid"), style: ["act"], act: then(checkGrid), disabled: out }, w);
  button({ id: "act-reveal", text: tr("Reveal letter"), style: ["act"], act: then(revealHint) }, w);
  button({ id: "act-give-up", text: tr("Give up"), style: ["danger"], act: askGiveUp }, w);
  button({ id: "act-pause", text: tr("Pause"), style: ["act"], act: () => pauseRound() }, w);
}
function lessonBanner(w: number): void {
  const text = lessonText();
  if (!text) return;
  ui.style("banner", { width: w }).column("banner", () => { para(text, w - 37, ["banner", { padding: 0, background: "transparent", border: { width: 0 } }], "lesson"); });
}
function oskShown(): boolean { return doc().settings.osk ?? primaryPointer() === "coarse"; }
function tray(L: Layout, w: number, side: boolean, h = 0): ui.Rect {
  const show = oskShown();
  const left = doc().settings.leftHanded;
  return ui.style("tray").column("tray", () => {
    const inner = w - 20;
    if (show) {
      const rows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM⌫"];
      const kw = Math.min(44, Math.floor((inner - 9 * 4) / 10));
      const kh = L.shortLand ? 32 : 40;
      ui.column("osk", () => {
        for (const row of rows) {
          ui.row(`osk-${row[0]}`, () => {
            for (const ch of row) {
              const wide = ch === "⌫";
              const label = wide ? tr("Backspace") : ch;
              const hit = ui.style("osk-key", { width: wide ? kw * 1.5 + 4 : kw, minHeight: kh, height: kh }).id(`osk-${ch}`).button(label, wide ? { content: () => backspaceGlyph() } : {});
              if (hit) { if (wide) clearCell(); else typeLetter(ch); }
            }
          }, { spacing: 4, justify: "center" });
        }
      }, { spacing: L.shortLand ? 2 : 4, width: inner, align: "center" });
    } else typeField(inner);
    const items: Btn[] = [
      { id: "tray-keys", text: tr("ABC"), style: ["act"], selected: show, act: () => { doc().settings.osk = !show; saveSettings(); } },
      { id: "tray-check", text: tr("Check"), style: ["act"], act: then(checkWord), disabled: checksOut() },
      { id: "tray-reveal", text: tr("Reveal"), style: ["act"], act: then(revealHint) },
      { id: "tray-dir", text: session.sel.dir === "across" ? tr("Across ⇄") : tr("Down ⇄"), style: ["act"], act: then(toggleDir) },
      { id: "tray-pause", text: tr("Pause"), style: ["act"], act: () => pauseRound() },
    ];
    if (left) items.reverse();
    const perRow = side ? 3 : inner >= 560 ? 5 : 3;
    const bw = Math.floor((inner - (perRow - 1) * 8) / perRow);
    flow("tray-actions", items, inner, 8, Math.min(180, bw));
  }, { width: w, spacing: 6, padding: { top: 8, bottom: 8, start: 10, end: 10 }, align: "center", ...(side ? { justify: "end" as const, height: h } : {}) });
}
function backspaceGlyph(): void {
  ui.widget("", {
    role: "none", size: { width: 26, height: 18 },
    draw: (r, st) => {
      const k = st.scale, c = st.highContrast ? "#ffffff" : palette().ink;
      const x = r.x, y = r.y, w = r.width, h = r.height;
      const pts: [number, number][] = [[x, y + h / 2], [x + 7 * k, y], [x + w, y], [x + w, y + h], [x + 7 * k, y + h]];
      for (let i = 0; i < pts.length; i++) { const a = pts[i]!, b = pts[(i + 1) % pts.length]!; draw.line(a[0], a[1], b[0], b[1], c, 2 * k); }
      draw.line(x + 12 * k, y + 5 * k, x + 20 * k, y + h - 5 * k, c, 2 * k);
      draw.line(x + 20 * k, y + 5 * k, x + 12 * k, y + h - 5 * k, c, 2 * k);
    },
  });
}
function drawer(id: string, label: string, open: boolean, toggle: () => void, w: number, body: () => void): void {
  button({ id, text: open ? label.replace("▾", "▴") : label, style: ["toggle-btn"], act: toggle }, w);
  if (open) ui.column(`${id}-body`, body, { spacing: 12 });
}
function playScreen(L: Layout, bodyH: number): void {
  const left = doc().settings.leftHanded;
  const k = ui.preferences().scale;
  void k;
  if (L.wide) {
    const railW = 290;
    const centerW = L.lw - railW * 2 - 12 * 4;
    const bannerH = lessonText() ? H("banner", 80) + 10 : 0;
    const bigCap = L.big ? (bodyH * 0.56) / Math.max(session.def!.cols, session.def!.rows) : 0;
    const cell = fitCell(centerW, Math.min(bodyH - 24 - bannerH, L.lh * 0.62), 28, bigCap);
    const leftRail = (): void => {
      ui.column("rail-left", () => {
        ui.style("rail-block").column("rail-hud", () => hudBlock(railW - 30), { width: railW, spacing: 6 });
        const used = H("rail-hud", 200) + 12;
        ui.style("rail-block").column("rail-clues", () => {
          ui.style("rail-heading").label(tr("Clues").toUpperCase());
          ui.scrollArea("clue-scroll", { width: railW - 28, height: Math.max(80, bodyH - 24 - used - 28 - 40) }, () => {
            ui.column("clue-lists", () => clueLists(railW - 40), { spacing: 4 });
          });
        }, { width: railW, spacing: 8 });
      }, { width: railW, spacing: 12 });
    };
    const rightRail = (): void => {
      ui.column("rail-right", () => {
        ui.style("rail-block").column("rail-clue", () => {
          ui.style("rail-heading").label(tr("Current clue").toUpperCase());
          para(currentClueText(), railW - 30, ["current-clue"], "current-clue");
        }, { width: railW, spacing: 6, minHeight: 104 } as ui.Layout);
        ui.style("rail-block").column("rail-actions", () => {
          actionButtons(railW - 30);
          typeField(railW - 30);
        }, { width: railW, spacing: 8 });
      }, { width: railW, spacing: 12 });
    };
    ui.row("play", () => {
      if (left) rightRail(); else leftRail();
      ui.column("board-region", () => {
        buildBoard(BOARD_ID, cell);
        const bw = Math.min(centerW, 560);
        const b = ui.column("banner-wrap", () => lessonBanner(bw), {});
        track("banner", b);
      }, { width: centerW, height: bodyH - 24, spacing: 10, align: "center", justify: "center" });
      if (left) leftRail(); else rightRail();
    }, { width: L.lw, height: bodyH, spacing: 12, padding: 12 });
    return;
  }
  // compact and short landscape
  const side = L.shortLand;
  const trayW = side ? Math.min(400, Math.floor(L.lw * 0.46)) : L.lw;
  const mainW = side ? L.lw - trayW : L.lw;
  const trayH = side ? bodyH : H("tray", 180);
  const mainH = side ? bodyH : bodyH - trayH;
  const contentW = Math.min(mainW - 24, 900);
  const clueH = H("board-clue", 30);
  const bannerH = lessonText() ? H("banner", 90) + 10 : 0;
  const cell = fitCell(contentW, mainH - 24 - clueH - 10 - (side ? 0 : bannerH), side ? 28 : 34, 0);
  const main = (): void => {
    ui.scrollArea("play-scroll", { width: mainW, height: mainH }, () => {
      ui.column("play-col", () => {
        const bc = para(currentClueText(), Math.min(contentW, boardSize(cell).width + 40), ["board-clue", { text: { align: "center" } }], "board-clue");
        track("board-clue", bc);
        buildBoard(BOARD_ID, cell);
        const b = ui.column("banner-wrap", () => lessonBanner(Math.min(contentW, 560)), {});
        track("banner", b);
        drawer("drawer-left", tr("Objective & clues ▾"), app.drawers.left, () => { app.drawers.left = !app.drawers.left; }, contentW, () => {
          ui.style("rail-block").column("rail-hud", () => hudBlock(contentW - 30), { width: contentW, spacing: 6 });
          ui.style("rail-block").column("rail-clues", () => {
            ui.style("rail-heading").label(tr("Clues").toUpperCase());
            ui.column("clue-lists", () => clueLists(contentW - 30), { spacing: 4 });
          }, { width: contentW, spacing: 8 });
        });
        drawer("drawer-right", tr("Clue & actions ▾"), app.drawers.right, () => { app.drawers.right = !app.drawers.right; }, contentW, () => {
          ui.style("rail-block").column("rail-actions", () => actionButtons(contentW - 30), { width: contentW, spacing: 8 });
        });
      }, { width: mainW, spacing: 10, align: "center", padding: { top: 12, bottom: 12 } });
    });
  };
  if (side) {
    ui.row("play", () => {
      if (left) tray(L, trayW, true, bodyH);
      main();
      if (!left) tray(L, trayW, true, bodyH);
    }, { width: L.lw, height: bodyH, spacing: 0 });
  } else {
    ui.column("play", () => {
      main();
      const t = tray(L, trayW, false);
      track("tray", t);
    }, { width: L.lw, height: bodyH, spacing: 0 });
  }
}

// ------------------------------------------------------------------ results
const REASONS: Record<string, string> = {
  "grid-complete": N("Page complete!"), "time-limit": N("Out of time."), "mistake-limit": N("Too many mistakes."), "gave-up": N("You gave up."),
};
function resultsScreen(L: Layout, bodyH: number): void {
  const st = session.state!, d = session.def!;
  const won = st.status === "won";
  const w = Math.min(560, L.lw - 32);
  const inner = w - 48;
  ui.scrollArea("results", { width: L.lw, height: bodyH }, () => {
    ui.column("results-col", () => {
      para(tr("Results"), w, ["screen-heading", { text: { align: "center" } }], "results-heading");
      ui.style("results-card", { width: w }).column("results-card", () => {
        artWidget("results-art", won ? "assets/results-win.webp" : "assets/results-lose.webp", inner, Math.min(inner * 9 / 16, L.lh * 0.32), 10, false);
        const reason = REASONS[st.terminalReason ?? ""] ? tr(REASONS[st.terminalReason ?? ""]!) : "";
        ui.row("results-head", () => {
          if (won) star("results-star", 22);
          para(reason, inner - 30, ["results-headline"], "results-headline");
        }, { spacing: 8, align: "center" });
        const rows: [string, number][] = [
          [tr("Letters"), st.score.letters],
          [tr("Words"), st.score.words],
          [tr("Streak bonus (best ×{n})", { n: st.bestStreak }), st.score.streak],
          [tr("Time bonus"), st.score.time],
          [tr("Assists ({checks} checks, {reveals} reveals)", { checks: st.checksUsed, reveals: st.revealsUsed }), st.score.assists],
          [tr("Completion bonus"), st.score.complete],
        ];
        ui.grid("breakdown", () => {
          rows.forEach(([label, v], i) => { para(label, inner - 80, ["bd-label"], `bd-l${i}`); ui.style("bd-value").id(`bd-v${i}`).label(String(v)); });
        }, { columns: [{ fr: 1 }, { width: "auto", align: "end" }], gap: { row: 4, column: 16 }, width: inner });
        ui.style("rule").widget("", { role: "none", size: { width: inner, height: 2 } });
        ui.row("bd-total", () => { ui.style("bd-total").label(tr("Total")); ui.spacer(); ui.style("bd-total").id("bd-total-v").label(String(st.score.total)); }, { width: inner, align: "center" });
        para(`${defName(d)} · ${fmtTime(st.elapsedMs)} · ` + tr("{done}/{total} words · {invalid} invalid actions", { done: st.wordsDone, total: st.entries.length, invalid: st.invalid }) + ` · ${d.ranked ? tr("ranked") : tr("unranked")}`,
          inner, ["meta"], "results-meta");
        if (session.newAchievements.length) {
          ui.style("meta").label(tr("Achievements unlocked"));
          ui.column("results-ach", () => {
            for (const id of session.newAchievements) ui.style("achievement").id(`ach-${id}`).label(tr(ACHIEVEMENTS[id]!.name));
          }, { spacing: 8 });
        }
        const rank = !session.verified ? tr("Score not submitted (verification failed).") : !d.ranked ? tr("Unranked round — result saved on this device.") : tr("Result saved on this device.");
        para(rank, inner, ["meta"], "results-rank");
        if (session.lbLine) para(session.lbLine(), inner, ["meta"], "results-lb");
      }, { spacing: 10 });
      // the next recommended action
      let nextText = tr("Back to modes");
      let next = (): void => modesScreen("modes");
      if (d.mode === "journey" && won) {
        const n = Number(d.id.replace("journey-", ""));
        if (n < 40) { nextText = tr("Next page: {n}", { n: n + 1 }); next = () => startRound(C.journeyStage(n + 1) as Def); }
        else { nextText = tr("Journey complete — Daily"); next = () => startMode("daily"); }
      } else if (d.mode === "learn") { nextText = tr("Try the Daily Challenge"); next = () => startMode("daily"); }
      else if (d.mode === "practice") { nextText = tr("New practice grid"); next = () => startRound(C.practiceDef(practiceDifficultyOf(d)) as Def); }
      flow("results-actions", [
        { id: "btn-retry", text: tr("Retry"), style: ["big"], act: () => startRound(d, !!d.tutorial && !doc().tutorialDone) },
        { id: "btn-next", text: nextText, style: ["card"], act: next },
        { id: "btn-results-home", text: tr("Home"), act: () => titleScreen() },
      ], w, 12);
    }, { width: L.lw, spacing: 18, align: "center", padding: { top: 24, bottom: 24 } });
  });
}

// ------------------------------------------------------------------ settings
let nameEdit: string | null = null;
function settingsScreen(L: Layout, bodyH: number): void {
  const w = Math.min(520, L.lw - 32);
  const inner = w - 34;
  const d = doc();
  ui.column("settings", () => {
    para(tr("Settings"), w, ["screen-heading", { text: { align: "center" } }], "settings-heading");
    ui.scrollArea("settings-scroll", { width: w + 12, height: Math.max(160, bodyH - 24 - 48 - 18 * 2 - H("settings-foot", 50) - 24) }, () => {
      ui.column("settings-form", () => {
        ui.style("fieldset", { width: w }).column("fs-profile", () => {
          ui.style("legend").label(tr("Profile"));
          ui.style("ink").label(tr("Display name"));
          const shown = nameEdit ?? (d.profile.name === "Guest" ? "" : d.profile.name);
          const v = ui.textField("set-name", shown, { width: inner, maxChars: 24, placeholder: tr("Guest") });
          if (v !== shown) {
            nameEdit = v;
            d.profile.name = v.trim().slice(0, 24) || "Guest"; // 'Guest' is the stored default name
            platform.persist();
          }
          if (ui.focused() !== "set-name" && nameEdit !== null && frame().frame % 30 === 0) nameEdit = null;
        }, { spacing: 8 });
        ui.style("fieldset", { width: w }).column("fs-look", () => {
          ui.style("legend").label(tr("Graphics"));
          const idx = Math.max(0, C.THEMES.findIndex((t) => t.id === d.settings.theme));
          ui.row("theme-row", () => {
            ui.style("ink").label(tr("Theme"));
            ui.spacer();
            const n = ui.id("set-theme").select(tr("Theme"), idx, C.THEMES.map((t) => tr(t.name)));
            if (n !== idx) { d.settings.theme = C.THEMES[n]!.id; saveSettings(); }
          }, { width: inner, align: "center" });
        }, { spacing: 8 });
        ui.style("fieldset", { width: w }).column("fs-a11y", () => {
          ui.style("legend").label(tr("Accessibility"));
          const check = (id: string, label: string, key: "cvd" | "leftHanded" | "haptics"): void => {
            const v = ui.id(id).checkbox(label, d.settings[key]);
            if (v !== d.settings[key]) { d.settings[key] = v; saveSettings(); }
          };
          check("set-cvd", tr("Color-vision-safe markers"), "cvd");
          check("set-left-handed", tr("Left-handed layout"), "leftHanded");
          check("set-haptics", tr("Haptics (vibration)"), "haptics");
          const osk = oskShown();
          const v = ui.id("set-osk").checkbox(tr("Letter keyboard"), osk);
          if (v !== osk) { d.settings.osk = v; saveSettings(); }
        }, { spacing: 6 });
        ui.style("fieldset", { width: w }).column("fs-more", () => {
          para(tr("Sound, graphics, language, controls, high contrast, larger text and reduced motion are in Options."), inner, ["ink"], "more-text");
          button({ id: "btn-options", text: tr("Options…"), style: ["act"], act: () => openMenu() }, inner);
        }, { spacing: 8 });
      }, { spacing: 14, padding: { end: 12 } });
    });
    const foot = ui.row("settings-foot", () => {
      button({ id: "btn-replay-tutorial", text: tr("Replay tutorial"), act: () => startRound(C.learnDef() as Def, true) });
      button({ id: "btn-settings-back", text: tr("← Back"), act: closeSub });
    }, { spacing: 12 });
    track("settings-foot", foot);
  }, { width: L.lw, height: bodyH, spacing: 18, align: "center", justify: "center", padding: { top: 12, bottom: 12 } });
  if (ui.back() && frame().frame !== app.openedFrame) closeSub();
}

// ------------------------------------------------------------------ help
const KEY_WORDS: Record<string, string> = { Escape: N("Esc"), Space: N("Space"), Enter: N("Enter"), Tab: N("Tab"), Backspace: N("Backspace"), Delete: N("Delete") };
const ARROWS: Record<string, string> = { ArrowUp: N("Up arrow"), ArrowDown: N("Down arrow"), ArrowLeft: N("Left arrow"), ArrowRight: N("Right arrow") };
function keysOf(action: string): string[] {
  return bindings(action).filter((b) => b.device === "keyboard").map((b) => (ARROWS[b.code] ? tr(ARROWS[b.code]!) : KEY_WORDS[b.code] ? tr(KEY_WORDS[b.code]!) : b.label));
}
function helpScreen(L: Layout, bodyH: number): void {
  const w = Math.min(900, L.lw - 32);
  const cols = w >= 700 ? 3 : w >= 460 ? 2 : 1;
  const cw = Math.floor((w - (cols - 1) * 12) / cols);
  const k = (a: string): string => keysOf(a).join("/");
  const cards: [string, string, string[]][] = [
    [tr("Enter letters"), tr("Type {a}–{z} with the keyboard, or tap a square and type. Letters shared between crossing words fill both.", { a: "A", z: "Z" }), ["A", "Z"]],
    [tr("Move around"), tr("{keys} move the selection. {next} jumps to the next clue. Tap a clue in the list to select its word.", { keys: [k("up"), k("down"), k("left"), k("right")].join(" "), next: k("nextclue") }), [...keysOf("up"), ...keysOf("down"), ...keysOf("left"), ...keysOf("right"), ...keysOf("nextclue")]],
    [tr("Direction"), tr("Tap the selected square again (or press {key}) to switch between Across and Down.", { key: k("toggledir") }), keysOf("toggledir")],
    [tr("Fix mistakes"), tr("{key} clears a square. Locked letters (confirmed ✓ or revealed ◆) cannot be changed.", { key: k("clear") }), keysOf("clear")],
    [tr("Check"), tr("{word} checks the current word, {grid} checks the grid (from the clue list, or via the action buttons). Correct letters lock with ✓; wrong ones are flagged ✗. Each check costs a few points.", { word: k("checkword"), grid: k("checkgrid") }), [...keysOf("checkword"), ...keysOf("checkgrid")]],
    [tr("Reveal"), tr("{key} reveals one letter (◆) at a small score cost. Checks and reveals never lock you out of finishing.", { key: k("reveal") }), keysOf("reveal")],
    [tr("Pause"), tr("{key} pauses. The clock stops while paused or while the tab is hidden.", { key: k("pause") }), keysOf("pause")],
    [tr("Winning"), tr("Fill every square correctly to complete the page. Score = letters + words + streaks + time bonus − assists."), []],
  ];
  ui.column("help", () => {
    para(tr("How to play"), w, ["screen-heading", { text: { align: "center" } }], "help-heading");
    ui.scrollArea("help-scroll", { width: w + 12, height: Math.max(160, bodyH - 24 - 48 - 18 * 2 - 48 - 24) }, () => {
      ui.grid("help-cards", () => {
        cards.forEach(([title, text, keys], i) => {
          ui.style("help-card", { width: cw }).column(`help-${i}`, () => {
            ui.style("help-title").label(title);
            if (keys.length) {
              // key chips wrapped into rows the card's width
              const rows: string[][] = [[]];
              let used = 0;
              for (const key of [...new Set(keys)]) {
                const kw = textWidth(key, ["kbd"]) + 6;
                if (used && used + kw > cw - 32) { rows.push([]); used = 0; }
                rows[rows.length - 1]!.push(key);
                used += kw;
              }
              rows.forEach((r, ri) => ui.row(`help-keys-${i}-${ri}`, () => { r.forEach((key, j) => ui.style("kbd").id(`kbd-${i}-${ri}-${j}`).label(key)); }, { spacing: 6 }));
            }
            para(text.replace(/[✓◆✗]/g, (m) => ({ "✓": "(✓)", "◆": "(◆)", "✗": "(✗)" }[m] ?? m)), cw - 32, ["help-text"], `help-t${i}`);
          }, { spacing: 6 });
        });
      }, { columns: cols, gap: 12, width: w, align: "stretch" });
    });
    button({ id: "help-back", text: tr("← Back"), act: closeSub });
  }, { width: L.lw, height: bodyH, spacing: 18, align: "center", justify: "center", padding: { top: 12, bottom: 12 } });
  if (ui.back() && frame().frame !== app.openedFrame) closeSub();
}

// ------------------------------------------------------------------ pause, give up, toasts
function pauseDialog(L: Layout): void {
  const open = app.phase === "paused" && !app.sub;
  const w = Math.min(420, L.lw - 32);
  const still = ui.dialog(tr("Paused"), "", open, () => {
    ui.style("overlay-card", { width: w }).column("pause-card", () => {
      ui.style("pause-title", { text: { align: "center" } }).label(tr("Paused"));
      const inner = w - 52;
      button({ id: "pause-resume", text: tr("Resume"), style: ["big"], act: resumeRound }, inner);
      flow("pause-more", [
        { id: "pause-options", text: tr("Options…"), act: () => openMenu() },
        { id: "pause-help", text: tr("Help"), act: () => openSub("help") },
        { id: "pause-leave", text: tr("Leave round"), style: ["danger"], act: leaveRound },
      ], inner, 8);
    }, { spacing: 12, align: "center" });
  });
  if (open && !still && frame().frame !== app.openedFrame) resumeRound();
}
function giveUpDialog(L: Layout): void {
  const open = app.confirmGiveUp && app.phase === "active";
  const w = Math.min(420, L.lw - 32);
  const still = ui.dialog(tr("Give up"), "", open, () => {
    ui.style("overlay-card", { width: w }).column("giveup-card", () => {
      para(tr("Give up this round? It will count as a loss."), w - 52, ["ink-b", { text: { align: "center" } }], "giveup-text");
      flow("giveup-actions", [
        { id: "giveup-yes", text: tr("Give up"), style: ["danger"], act: giveUp },
        { id: "giveup-cancel", text: tr("Cancel"), act: () => { app.confirmGiveUp = false; focusBoard(); } },
      ], w - 52, 12);
    }, { spacing: 14, align: "center" });
  });
  if (open && !still && frame().frame !== app.openedFrame) app.confirmGiveUp = false;
}
function toasts(L: Layout): void {
  if (!app.toasts.length) return;
  const w = Math.min(420, L.lw - 24);
  // A 0 × 0 placed widget's draw paints over everything without taking the pointer.
  const items = app.toasts.map((t) => t.text());
  ui.place("toasts", { anchor: "top-end", x: 12, y: H("topbar", 56) + 8 }, () => {
    ui.widget("", {
      role: "none", size: { width: 0, height: 0 },
      draw: (r, st) => {
        const k = st.scale;
        let y = r.y;
        for (const text of items) {
          const size = 16 * k * ui.preferences().textScale;
          const m = draw.measureText(text, { size, weight: "600", maxWidth: (w - 32) * k });
          const bw = m.width + 32 * k, bh = m.height + 20 * k;
          const x = r.x - bw;
          draw.box(x, y, bw, bh, { background: st.highContrast ? "#000000" : palette().ink, radius: 10, shadow: { y: 4, blur: 14, color: "#00000066" }, ...(st.highContrast ? { border: { width: 2, color: "#ffffff" } } : {}) });
          draw.text(text, x + 16 * k, y + 10 * k, { size, weight: "600", color: st.highContrast ? "#ffffff" : palette().paper, maxWidth: (w - 32) * k });
          y += bh + 8 * k;
        }
      },
    });
  });
}
export { show };
