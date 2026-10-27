// The crossword board as the browser build's DOM grid drew it (index.html
// #board, js/main.js buildBoard/renderCells, css/style.css .board/.cell):
// cream tiles in 2 px tile-edge grout on a rounded board, void squares
// showing the grout, clue numbers in the corner, letters in bold, the
// current entry tinted (16 % select), the selected square stronger (38 %)
// with a 3 px select ring, confirmed / wrong / revealed letters in the
// state colours with their ✓ ✗ ◆ marks (drawn, not glyphs), the
// colour-vision aid's hatched wrong squares and underlined confirmed
// letters, the Learn lesson's pulsing accent ring, and with detailed scenery
// the paper-tile shading (a soft top light and bevel per square and a lit
// board frame), never under high contrast.
//
// The board is one `region` widget named "Crossword grid" (it keeps the
// arrows, so they steer the selection instead of moving focus), described by
// the board summary and the selected square, with a `ui.target` per square
// (its old aria-label: "Row 1 column 2, letter A, confirmed, starts clue 1")
// for screen readers and play scripts. A tap or click on a square selects it
// (a second tap switches Across / Down), as the old cell buttons did; South
// on a pad moves to the on-screen letter keys.
import { frame } from "starhermit:engine";
import * as draw from "starhermit:draw";
import { onPointerButton, onTouch } from "starhermit:input";
import * as ui from "starhermit:ui";
import * as R from "../js/rules.js";
import { tr } from "./i18n.ts";
import { app, currentEntryIdx, doc, focusBoard, onCellTap, session, active } from "./main.ts";
import { palette } from "./style.ts";

const GAP = 2;
const PAD = 6;

/** Logical size of the board for a cell size. */
export function boardSize(cell: number): { width: number; height: number } {
  const d = session.def!;
  return { width: d.cols * cell + (d.cols - 1) * GAP + PAD * 2, height: d.rows * cell + (d.rows - 1) * GAP + PAD * 2 };
}
/** The cell size that fits (availW × availH) logical pixels: at most 56 a column (more on large screens), at least `min`. */
export function fitCell(availW: number, availH: number, min: number, bigCap: number): number {
  const d = session.def!;
  const byW = (availW - PAD * 2 - (d.cols - 1) * GAP) / d.cols;
  const byH = (availH - PAD * 2 - (d.rows - 1) * GAP) / d.rows;
  const cap = Math.max(56, bigCap);
  return Math.max(min, Math.floor(Math.min(cap, byW, byH)));
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1, 7), 16), pb = parseInt(b.slice(1, 7), 16);
  const ch = (s: number): number => Math.round(((pa >> s) & 255) * t + ((pb >> s) & 255) * (1 - t));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

// --- taps --------------------------------------------------------------------------------
let downAt: { x: number; y: number } | null = null;
let tapAt: { x: number; y: number; px: number; py: number; frame: number } | null = null;
onPointerButton((e) => {
  if (e.button !== 0) return;
  if (e.pressed) downAt = { x: e.x, y: e.y };
  else if (downAt) { tapAt = { x: e.x, y: e.y, px: downAt.x, py: downAt.y, frame: frame().frame }; downAt = null; }
});
onTouch((e) => {
  if (e.control || !e.primary) return;
  if (e.phase === "start") downAt = { x: e.x, y: e.y };
  else if (e.phase === "end" && downAt) { tapAt = { x: e.x, y: e.y, px: downAt.x, py: downAt.y, frame: frame().frame }; downAt = null; }
  else if (e.phase === "cancel") downAt = null;
});

function cellLabel(i: number, numbers: Map<number, number>): string {
  const st = session.state!;
  const cell = st.cells[i]!;
  const parts = [tr("Row {r} column {c}", { r: R.rowOf(st, i) + 1, c: R.colOf(st, i) + 1 })];
  parts.push(cell.cur === "" ? tr("empty") : tr("letter {ch}", { ch: cell.cur }));
  if (cell.flag & R.FLAG.CONFIRMED) parts.push(tr("confirmed"));
  if (cell.flag & R.FLAG.REVEALED) parts.push(tr("revealed"));
  if (cell.flag & R.FLAG.WRONG) parts.push(tr("wrong"));
  const num = numbers.get(i);
  if (num !== undefined) parts.push(tr("starts clue {n}", { n: num }));
  return parts.join(", ");
}
export function boardSummary(): string {
  const st = session.state;
  if (!st) return "";
  return tr("Grid {rows} by {cols}. {correct} of {total} letters correct. {words} of {entries} words complete.",
    { rows: st.rows, cols: st.cols, correct: st.filledCorrect, total: st.filledTotal, words: st.wordsDone, entries: st.entries.length });
}

/** Builds the board at the current place in the UI with `cell` logical pixels a square. */
export function buildBoard(id: string, cell: number): void {
  const d = session.def, st = session.state;
  if (!d || !st) return;
  const size = boardSize(cell);
  const numbers = new Map<number, number>();
  for (const e of d.entries) if (!numbers.has(e.cells[0]!)) numbers.set(e.cells[0]!, e.number);
  const ei = currentEntryIdx();
  const inEntry = new Set(ei >= 0 ? d.entries[ei]!.cells : []);
  const sel = session.sel.cell;
  const detailed = app.look.detailed;
  const cvd = doc().settings.cvd;
  const focusCell = session.tutorialFocus;
  const desc = boardSummary() + (sel !== null && st.cells[sel] ? ". " + tr("Selected: {cell}", { cell: cellLabel(sel, numbers) }) : "");
  const res = ui.id(id).widget(tr("Crossword grid"), {
    role: "region", arrows: true, size, description: desc,
    draw: (r, ws) => {
      const k = ws.scale;
      const hc = ws.highContrast;
      const P = palette();
      const tile = hc ? "#ffffff" : P.tile, edge = hc ? "#000000" : P.tileEdge, ink = hc ? "#000000" : P.ink;
      const sc = hc ? "#0044cc" : P.select;
      const ok = hc ? "#006400" : P.ok, wrong = hc ? "#b30000" : P.wrong, rev = hc ? "#5a2d91" : P.revealed, accent = hc ? "#b34700" : P.accent;
      draw.box(r.x, r.y, r.width, r.height, {
        background: detailed && !hc ? [{ type: "linear", angle: 145, stops: ["#ffffff47", "#00000014"] }, edge] : edge,
        radius: 12,
        shadow: detailed && !hc
          ? [{ y: 14, blur: 34, color: "#00000061" }, { y: 2, blur: 6, color: "#00000040" }, { y: 1, inset: true, color: "#ffffff80" }]
          : { y: 8, blur: 24, color: "#00000059" },
      });
      const cs = cell * k, gap = GAP * k, pad = PAD * k;
      const pulse = ws.reducedMotion ? 0 : 0.5 - 0.5 * Math.cos(frame().time * Math.PI * 2 / 1.4);
      for (let i = 0; i < st.cells.length; i++) {
        const c = st.cells[i];
        if (!c) continue;
        const x = r.x + pad + R.colOf(st, i) * (cs + gap);
        const y = r.y + pad + R.rowOf(st, i) * (cs + gap);
        const selected = i === sel;
        const bg = selected ? mix(sc, tile, 0.38) : inEntry.has(i) ? mix(sc, tile, 0.16) : tile;
        draw.rect(x, y, cs, cs, bg);
        if (hc) draw.strokeRect(x, y, cs, cs, "#000000", 1 * k);
        else if (detailed) {
          draw.box(x, y, cs, cs, { background: { type: "linear", angle: 165, stops: [{ color: "#ffffff80", at: 0 }, { color: "#ffffff00", at: 0.55 }, { color: "#78643c0d", at: 1 }] } });
          if (!selected && i !== focusCell) { draw.rect(x, y, cs, 1 * k, "#ffffffd9"); draw.rect(x, y + cs - 2 * k, cs, 2 * k, "#5a46281a"); }
        }
        const isWrong = (c.flag & R.FLAG.WRONG) !== 0, isOk = (c.flag & R.FLAG.CONFIRMED) !== 0, isRev = (c.flag & R.FLAG.REVEALED) !== 0;
        if (cvd && isWrong) {
          // hatched: 45° stripes, 2 px every 8 px
          const clip = { clip: { x, y, width: cs, height: cs } };
          for (let o = -cs; o < cs; o += 8 * k) draw.line(x + o, y + cs, x + o + cs, y, "#0000001f", 2 * k, clip);
        }
        const num = numbers.get(i);
        if (num !== undefined) draw.text(String(num), x + 4 * k, y + 2 * k, { size: Math.max(9.6, cs / k * 0.17) * k, weight: "600", color: hc ? "#333333" : "#5b6472" });
        if (c.cur) {
          const size = Math.max(20.8, cell * 0.4) * k;
          const col = isOk ? ok : isWrong ? wrong : isRev ? rev : ink;
          const m = draw.measureText(c.cur, { size, weight: "700" });
          const ty = y + (cs - m.height) / 2;
          draw.text(c.cur, x + cs / 2, ty, { size, weight: "700", color: col, align: "center" });
          if (cvd && isOk) draw.rect(x + cs / 2 - m.width / 2, ty + m.height * 0.92, m.width, 2 * k, ok);
        }
        // state marks in the bottom-right corner
        const g = Math.max(7, cs / k * 0.16) * k, gx = x + cs - g - 3 * k, gy = y + cs - g - 2 * k;
        if (isOk) { draw.line(gx, gy + g * 0.55, gx + g * 0.38, gy + g * 0.9, ok, 1.6 * k); draw.line(gx + g * 0.38, gy + g * 0.9, gx + g, gy + g * 0.1, ok, 1.6 * k); }
        else if (isWrong) { draw.line(gx, gy, gx + g, gy + g, wrong, 1.6 * k); draw.line(gx + g, gy, gx, gy + g, wrong, 1.6 * k); }
        else if (isRev) draw.polygon([[gx + g / 2, gy], [gx + g, gy + g / 2], [gx + g / 2, gy + g], [gx, gy + g / 2]], rev);
        if (i === focusCell) draw.strokeRect(x + 1.5 * k, y + 1.5 * k, cs - 3 * k, cs - 3 * k, accent, (3 + 2 * pulse) * k);
        else if (selected) draw.strokeRect(x + 1.5 * k, y + 1.5 * k, cs - 3 * k, cs - 3 * k, sc, 3 * k);
      }
    },
  });
  // squares for screen readers and play scripts
  const k = ui.preferences().scale;
  for (let i = 0; i < st.cells.length; i++) {
    if (!st.cells[i]) continue;
    const x = res.x + (PAD + R.colOf(st, i) * (cell + GAP)) * k;
    const y = res.y + (PAD + R.rowOf(st, i) * (cell + GAP)) * k;
    ui.id(`cell-${i}`).target(cellLabel(i, numbers), { x, y, width: cell * k, height: cell * k }, { role: "button" });
  }
  // a tap: pressed and released on the same square of the board
  if (tapAt && tapAt.frame >= frame().frame - 1) {
    const t = tapAt;
    tapAt = null;
    if (active() && !app.confirmGiveUp) {
      const i = hit(t.x, t.y, res, cell * k, GAP * k, PAD * k);
      if (i !== null && i === hit(t.px, t.py, res, cell * k, GAP * k, PAD * k)) { onCellTap(i); focusBoard(); }
    }
  }
  if (res.keys?.includes("South")) { app.focusNext = "osk-Q"; app.openedFrame = frame().frame; }
}
function hit(px: number, py: number, r: ui.Rect, cs: number, gap: number, pad: number): number | null {
  const st = session.state!;
  const c = Math.floor((px - r.x - pad) / (cs + gap)), row = Math.floor((py - r.y - pad) / (cs + gap));
  if (c < 0 || row < 0 || c >= st.cols || row >= st.rows) return null;
  const i = row * st.cols + c;
  return st.cells[i] ? i : null;
}
