// The look of the screens: the browser build's css/style.css, rewritten
// class-based in tools/ui-style.css and converted once with `starhermit css`
// into assets/ui-style.json (`npm run css`), registered at start. The theme
// (Settings › Theme) writes its colours into the tokens, as the browser
// build's applySettings wrote CSS variables, so every panel, button and the
// board recolour at once. Detailed scenery (the graphics level) folds the
// d-* classes (panel shadows) into the plain ones, as body.gfx-detailed did.
// High contrast, larger text and reduced motion are the runtime's (it forces
// the UI's colours, scales its text and stills its motion).
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";
import type { Look } from "./quality.ts";

export interface ThemeColors { paper: string; ink: string; tile: string; tileEdge: string; accent: string; select: string; ok: string; wrong: string; revealed: string }

let css: ui.CssStyles | null = null;
let look: Look | null = null;
let colors: ThemeColors | null = null;

/** The current theme's colours (the board draws with them). */
export function palette(): ThemeColors {
  return colors ?? { paper: "#f6efe0", ink: "#26313d", tile: "#fdfaf1", tileEdge: "#d9cfae", accent: "#d96c47", select: "#2f80ed", ok: "#3f9d63", wrong: "#c0392b", revealed: "#8a6fd0" };
}

function shadowList(v: unknown): ui.Shadow[] {
  if (!v || typeof v === "string") return [];
  return Array.isArray(v) ? (v as ui.Shadow[]) : [v as ui.Shadow];
}
function styles(): { [key: string]: ui.Style } {
  const s = { ...(css!.styles as { [key: string]: ui.Style }) };
  if (look?.detailed) {
    for (const k of [".rail-block", ".results-card", ".card"]) {
      const d = s[".d-" + k.slice(1)];
      if (d) s[k] = { ...s[k], shadow: [...shadowList(s[k]?.shadow), ...shadowList(d.shadow)] };
    }
  }
  return {
    ...s,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    heading: { text: { color: "$ink" } },
    widget: { focusRing: { color: "#ffb020", width: 3, offset: 2 } },
    button: { focusRing: { color: "#ffb020", width: 3, offset: 2 } },
    dialog: { background: "transparent", padding: 0, parts: { backdrop: { background: "#0a0e16b8" } } },
    scrollArea: { parts: { bar: { background: "$muted", radius: 4 } } },
    textField: { background: "#ffffff", border: { width: 2, color: "$tile-edge" }, radius: 8, minHeight: 44, padding: { start: 10, end: 10, top: 6, bottom: 6 }, text: { color: "$ink", size: 16 } },
    select: { background: "#ffffff", border: { width: 2, color: "$tile-edge" }, radius: 8, minHeight: 44, text: { color: "$ink", size: 16 } },
    checkbox: { minHeight: 44, text: { color: "$ink", size: 16 } },
  };
}

export function initStyles(): void {
  css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setTheme({
    fontSize: 16, smallSize: 13.6, headingSize: 25.6, padding: 8, spacing: 8, radius: 10,
    text: "#26313d", muted: "#5b6472", panel: "#fffdf7", control: "#fdfaf1", hovered: "#f3ead6",
    pressed: "#e8dcc0", field: "#ffffff", accent: "#d96c47", focus: "#ffb020", outline: "#d9cfae",
  });
  ui.setTokens(css.tokens);
  ui.setStyles(styles());
}

/** Detailed scenery from the graphics level (quality.ts). */
export function applyLook(l: Look): void {
  look = l;
  if (css) ui.setStyles(styles());
}

/** A content theme (js/content.js THEMES): its colours into the tokens. */
export function applyTheme(t: ThemeColors): void {
  colors = { paper: t.paper, ink: t.ink, tile: t.tile, tileEdge: t.tileEdge, accent: t.accent, select: t.select, ok: t.ok, wrong: t.wrong, revealed: t.revealed };
  if (!css) return;
  ui.setTokens({ ...css.tokens, paper: t.paper, ink: t.ink, tile: t.tile, "tile-edge": t.tileEdge, accent: t.accent, select: t.select, ok: t.ok, wrong: t.wrong, revealed: t.revealed });
  ui.setTheme({ text: t.ink, accent: t.accent, outline: t.tileEdge, control: t.tile });
}
