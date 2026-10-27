# Crossword Journey — Game Design Document (running spec)

**Status:** shipped; this document describes the game as it runs today.
**Pitch:** a travel journal whose pages are small crosswords — solve clue-driven words across five scenic regions, one shared page every UTC day.
**Genre:** clue puzzle (mini crosswords, 5×5 to 9×9). **Players:** 1; ranked results stay on the device and post to the platform board when signed in. **Session:** 2–5 minutes for a 5×5 page, 10–25 minutes for a 9×9 mastery or challenge page.
**Platforms:** a StarHermit engine script game (engine 1.18.0, host API 1.20, `engine.minor=18`): played natively by the StarHermit client and in desktop and mobile browsers by the engine's web runtime, portrait and landscape. **Rendering:** the board, clues and HUD are `starhermit:ui` widgets (the accessible truth) over a purely decorative `starhermit:scene` papercraft diorama.

## 1. File map

| Path | Role |
|---|---|
| `starhermit.txt` | Manifest: `launch=index.html`, `engine.entry=native/main.ts`, `engine.version=1.18.0`, `engine.minor=18`, capabilities `platform,storage,clipboard`, `server=score-script.js`, controls and gamepad defaults (§6). |
| `native/main.ts` | Entry module: state machine, round lifecycle, command dispatch (pre-validated), time-limit watchdog and 30 s warning, selection, input (keys, letters field, actions), Learn lessons, achievements, Journey progress, results with the local replay check and the leaderboard post, lifecycle (fixed 60 Hz steps). |
| `native/screens.ts` | Every screen as immediate-mode `starhermit:ui`: top bar, title, mode select, play (wide / compact / short-landscape layouts), results, Settings, Help, pause dialog, give-up confirm, toasts. |
| `native/board.ts` | The board: one `region` widget drawn with `starhermit:draw` (tiles, grout, numbers, letters, state colours and ✓ ✗ ◆ marks drawn as shapes, selection, lesson pulse, CVD hatching, paper shading), a `ui.target` per square, tap hit-testing. |
| `native/diorama.ts` | The decorative diorama on `starhermit:scene` (port of the browser build's three.js `diorama.js`), the renderer's post effects, ambient motion. |
| `native/quality.ts` | The browser build's graphics presets and budgets keyed by the runtime's quality tier and level. |
| `native/style.ts` | Registers `assets/ui-style.json`; theme colours into the style tokens; detailed-scenery shadows. |
| `native/audio.ts` | Authored clips (`sfx/*.opus`) plus the ambience loop and arpeggio rendered into clips. |
| `native/i18n.ts` | Locale from the runtime's interface language; `tr()` over `js/strings.js`, `pt()` over `js/platform-strings.js`. |
| `native/platform.ts` | Saves (`starhermit:storage` `saves`, foreign-save migration, conflict merge), legacy settings migration, server clock, player name, invite link, high-score post through `score-script.js`. |
| `js/rules.js` | Pure deterministic rules engine: `createGame`, `applyCommand`, legality queries, scoring, hashing, `replay`, `compareResults`. Shared with `server.js`. |
| `js/content.js` | Versioned content: 5 themes, 353-word original bank with clues, 8 grid masks, seeded backtracking fill generator, Journey/Learn/Daily/Practice/Challenge defs, validators. |
| `js/save.js`, `js/merge.js` | The save document (normalise, browser-save migration, merge, legacy settings keys) and the conflict merge. |
| `js/strings.js`, `js/i18n.js`, `js/platform-strings.js` | Translation tables and lookups (classic scripts, loaded with `loadClassic`) (§10). |
| `tools/ui-style.css` → `assets/ui-style.json` | The browser build's stylesheet rewritten class-based; converted by `npm run css` (`starhermit css`). |
| `index.html`, `starhermit-files.json` | The web loader and file index written by `npm run package` (`starhermit package --web .`); never edited by hand. |
| `score-script.js` | StarHermit platform script (`server=score-script.js`): range-checks a finished ranked round's total and posts it to the `high-score` leaderboard. |
| `server.js` | Dev static host (not packaged); its legacy `/api/v1/score` routes are unused. |
| `sfx/*.opus`, `sfx/manifest.*` | 17 authored clips; canonical `file | event | description | usage` manifest. |
| `assets/key-art.webp`, `assets/results-win.webp`, `assets/results-lose.webp` | Title key art and results illustrations. |
| `cover.jpg`, `coverart.png`, `icon.png` | Platform cover, cover art source, icon. |
| `tests/`, `tools/` | Unit tests, native checks and play scripts, play-script generator, keyboard planner, browser check, CSS and package tools (left out of the package by `.starhermitignore`). |

## 2. Vision and design pillars

1. **The page is the puzzle.** Every round is one journal page: a small, fully-crossed grid you can hold in your head. Rules in: 5×5–9×9 masks, every letter cell belongs to at least one word, mini-crossword numbering. Rules out: full-size 15×15 grids, themed rebus squares, uncrossed letters.
2. **Crossings are the mechanic, not the trivia.** Clues are short, original and gettable; the skill is using confirmed letters to unlock neighbours. Rules in: streak bonus per consecutive word, letter points awarded on first correct placement, an interactive lesson devoted to crossings. Rules out: obscure trivia, clue puns that need cultural knowledge.
3. **Assists are honest tools, never traps.** Check and Reveal are always available (unless a Challenge says otherwise), cost a small, visible number of points, lock what they touch, and can never make the page unfinishable. Rules in: ✓/✗/◆ glyphs on every assisted cell, the score breakdown showing exactly what assists cost. Rules out: assists that consume "lives", assists that make a round silently unranked.
4. **One shared page a day, provably fair.** Daily, Journey and Challenge content is regenerated from its id; a result counts only if the replayed command log reproduces the claimed total. Rules in: gapless command ids, deterministic seeds, `replay` verification. Rules out: client-trusted totals, mutable daily seeds.
5. **The diorama decorates, the UI plays.** The 3D scene changes with theme and seed but never carries information; the board, clues and HUD are UI widgets that work with a keyboard, a pad, touch and a screen reader. Rules out: any control that exists only in the canvas.

## 3. Player experience

**Target player:** casual word-puzzle players who like a daily ritual (mini crossword, word ladders) and want a gentle progression to bigger grids.

**First 60 seconds.** Title screen shows key art, one dominant **Play** button and three cards (Daily Challenge, Journey, Profile). Play opens mode select; the first item is **Learn — First Page**, a 5×5 grid with six banner lessons that each wait for the real action: type any letter into the pulsing square; finish `1 Across` with its clue shown; complete any crossing word; press Check; press Reveal; finish the page. The banner text is the teaching; there is no separate tutorial screen. Returning players tap Daily Challenge on the title screen: the board appears in one action. The Help screen (top bar, always available, also from Pause) lists every control as rule cards with the effective key chips.

**Session shape.** Pick a page → the first playable square is selected and its clue shown in the right rail → type, arrows, Enter to hop clues → words strike through as they complete, streak toasts fire → page completes → results with a six-line score breakdown, achievements, (signed in) the platform board's top three, and a **Next** button that already knows where you are going (next Journey page, the Daily after Learn, a fresh Practice grid).

**Emotional beat.** The cascade: one confirmed crossing letter turning a stubborn clue obvious, the marimba word chime, the streak counter climbing, and finally the fanfare and lantern-lit results page.

## 4. Core loop and rules contract

All rules live in `js/rules.js`; the UI never mutates state except through `applyCommand` (`native/main.ts dispatch`).

### Board and entities
- `createGame(def)` builds `state` from a content def: `rows × cols` cells, each `null` (void) or `{ sol, cur:'', flag:0 }`. Entries are `{ id, dir:'across'|'down', row, col, len, number, clue, cells[] }`.
- Cell flags (`FLAG`): `CONFIRMED=1`, `WRONG=2`, `REVEALED=4`, `AWARDED=8`. `CONFIRMED|REVEALED` cells are locked (`isLocked`, `canType`).
- Selection (`session.sel = { cell, dir }`) is UI state in `native/main.ts`, never rules state.

### Commands (`applyCommand(prev, cmd)`), in resolution order
Every command must carry `id === state.nextCmdId` (else `duplicate-id` / `out-of-order`, state untouched) and may carry `at` (elapsed ms, monotonic: `elapsedMs = max(elapsedMs, floor(at))`). `tick` increments per accepted command; `invalid` increments per rejected one (with reason).

| Command | Preconditions (rejection reason) | Effect |
|---|---|---|
| `letter {cell, ch}` | playable cell (`bad-cell`), A–Z after upper-casing (`bad-letter`), not locked (`locked-cell`) | writes `cur`, clears WRONG, `typed++`; first time a cell becomes correct sets AWARDED and adds `LETTER` points; then word completion check, then terminal check. |
| `clear {cell}` | playable, not locked, non-empty (`nothing-to-clear`) | empties the cell, clears WRONG, decrements `filledCorrect` if it was correct. |
| `check {scope:'cell'|'word'|'grid', cell?, entry?}` | `checksUsed < limits.checks` (`check-limit`), valid target (`bad-cell`/`bad-word`/`bad-scope`) | `checksUsed++`, `assists += CHECK_COST`; each filled target: correct → CONFIRMED (locked), wrong → WRONG (`mistakes++` the first time a cell is flagged). Any wrong letter resets `streak` to 0. |
| `reveal {cell}` | playable, not locked, not already correct (`already-correct`) | writes the solution, sets REVEALED (locked, no letter points), `revealsUsed++`, `assists += REVEAL_COST`, streak reset, then word/terminal checks. `getHint(state, entry)` chooses the cell: first empty then first wrong cell of the current entry, else of any entry. |
| `giveUp` | active | `status='lost'`, `terminalReason='gave-up'`. |

Word completion (`refreshWordCompletions`): an entry whose cells all match the solution, not yet counted, adds `wordsDone`, `streak++`, `bestStreak`, `words += round((WORD_BASE + WORD_PER_LEN·len)·mult)` and `streakScore += round(STREAK_STEP·streak·mult)`. One letter can complete two words at once (both counted, streak +2).

### Terminal states (`finishIfComplete`, evaluated after every accepted command)
1. `filledCorrect === filledTotal` → `won`, `grid-complete`; `complete = round(GRID_COMPLETE·mult)`; if `elapsedMs < par.timeMs`, `time = min(400, floor((par − elapsed)/1000)·2)`.
2. `limits.timeMs !== null && elapsedMs >= limits.timeMs` → `lost`, `time-limit`.
3. `limits.mistakes !== null && mistakes >= limits.mistakes` → `lost`, `mistake-limit`.
Because limits are only evaluated on commands, `native/main.ts` runs a per-frame watchdog that, when the clock passes the limit, commits a neutral letter command (retyping an existing unlocked letter) so the engine declares `time-limit`.

### Scoring constants (`SCORE`)
`LETTER 10`, `WORD_BASE 20`, `WORD_PER_LEN 5`, `STREAK_STEP 15`, `GRID_COMPLETE 150`, `CHECK_COST −15`, `REVEAL_COST −30`, `TIME_BONUS_PER_SEC 2` (cap `400`). `total = letters + words + streak + time + assists + complete`; all integers; `mult` (1, 1.5 or 2) scales letters, words, streak and completion but not assists or time.

**Worked example — Journey page 1 "First Mooring"** (quay5, 17 letters, par 300 s, mult 1). Grid: CAT / L·R·E / ACORN / M·W·T / PEN with entries 1A CAT, 4A ACORN, 5A PEN, 1D CROWN, 2D TENT, 3D LAMP. A sample solve types 2 letters, checks the word (−15), reveals one letter (−30), then types the remaining 14 letters in 8 s:
letters 16 × 10 = **160** (the revealed cell earns nothing) · words 35+45+35+45+40+40 = **240** · streak 15·(1+2+3+4+5+6) = **315** · time min(400, 292·2) = **400** · assists **−45** · completion **150** → **total 1220**.

### Ties, RNG, replay
- `compareResults(a, b)`: won before lost, higher total, fewer invalid actions, lower `elapsedMs`, then `sessionId` string order. Used by `server.js insertEntry`.
- `createStream(seed)` is mulberry32 over an FNV-1a hash (`hashSeed`). Streams are separate: `fill:<seed>:<attempt>` for the grid, `<seed>-deco` for the diorama, none for audio (variant picks use `Math.random`, cosmetic only).
- `replay(envelope)` (`{schema:1, build:RULES_VERSION, contentV, seed, init:def, commands[]}`) rebuilds the state from `init`, applies every command, errors on any rejection, and returns `finalHash` plus checkpoints every 5 commands. `hashState` is FNV-1a over the canonical JSON. `endRound` replays its own log locally before submitting; a mismatch shows a toast and withholds submission.
- **Undo:** none. Backspace/Delete clears the selected square (a `clear` command). Content defs carry an `assists.undo` flag that nothing reads.

## 5. Modes and progression (`js/content.js`, `native/screens.ts` mode select)

| Mode | Content | Limits / multiplier | Ranked | Notes |
|---|---|---|---|---|
| **Learn — First Page** | `learnDef()`: quay5, difficulty 1, seed `learn-quay` (COW, TRAIL, RAT, STAR, COAST, WOLF) | none, ×1 | no | Six lesson steps (`tutorial.steps`) advance only through rules events. Replayable from Settings. Next → Daily. |
| **Journey** | `journeyStage(1..40)`: seed `journey-n`, 5 regions × 8 pages, titles authored (`JOURNEY_TITLES`) | ×1; mastery pages (8, 16, 24, 32, 40) ×1.5 with difficulty +1 | no (the def is unranked; results say so) | Page n+1 unlocks on a win; stars: 1 + (no assists) + (under par). Progress in the save (§12). |
| **Daily Challenge** | `dailyForDate(serverNow)` (the platform clock `serverNow()`, the device clock while the platform is out of reach): id/seed `daily-YYYY-MM-DD`, pattern by weekday (Sun summit9/3, Mon quay5/1, Tue harbor6/1, Wed trail7/2, Thu vale6/2, Fri meadow7/2, Sat vista8/3), theme by date hash | none, ×1 | yes, unless the date is in `DAILY_EXCLUDED` | Same seed everywhere; server regenerates it to validate. |
| **Practice** | `practiceDef(easy|medium|hard)`: random seed per round; easy quay5/open5 d1, medium harbor6/vale6/trail7 d2, hard meadow7/vista8/summit9 d3 | none, ×1 | no (`practice-casual` board) | Next → another grid of the same difficulty. |
| **Challenges** | `CHALLENGES`: Speed Ink (trail7, 6:00 limit, ×1.5), No Eraser (harbor6, 3 mistakes, ×1.5), Blind Corners (meadow7, 2 checks, ×1.5), Long Haul (vista8, no limits, ×2), Summit Push (summit9, 25:00 + 8 mistakes, ×2) | as listed | yes (board per challenge id) | Fixed seeds, so every player gets the same grid. |

**Journey curve** (`TIER_TABLE`): tier 1 quay5/open5 d1 (letters, crossings) → tier 2 harbor6/vale6 d1 (+checks) → tier 3 trail7/meadow7 d2 (+reveals) → tier 4 meadow7/vista8 d2 (+streaks) → tier 5 summit9/vista8 d3. Par seconds per pattern: quay5 300, open5 330, harbor6 420, vale6 450, trail7 600, meadow7 660, vista8 780, summit9 900. Difficulty limits which bank words the fill may use (`d` 1 common, 2 moderate, 3 tricky).

**Achievements** (`ACHIEVEMENTS`, in the save, idempotent): `first-completion`, `mechanic-mastery` (win a mastery page), `streak-5`, `hard-milestone` (win any ×1.5+ round), `long-term-goal` (10 wins).

## 6. Controls and interaction

| Input | Keyboard | Touch / pointer | Gamepad | Feedback |
|---|---|---|---|---|
| Select square | — | click / tap a square | D-pad / left stick on the board | `select` tick, entry tint, ring on the square, current clue over the board / in the right rail |
| Toggle direction | `Space` | tap the selected square again, tray **Across ⇄** | North | entry tint flips, clue text changes |
| Type letter | `A`–`Z` | on-screen letter keys (tray), or the **Type letters** field (the device keyboard) | South on the board moves to the letter keys, South types the focused key | `correct`/`key` sound, 8 ms haptic, cursor advances to the next empty square of the entry |
| Clear | `Backspace`, `Delete` | ⌫ key | West | square empties |
| Move | arrow keys (wrap, skip voids; vertical moves switch to Down where a Down entry exists) | tap | D-pad | selection follows |
| Next / previous clue | `Enter` / `Shift+Enter` | tap a clue in the list | Right shoulder | clue highlighted in the list |
| Check word | `C` (when focus is off the board) or **Check word** | tray **Check** | Select | `check` sound; wrong letters ✗ announced |
| Check grid | `G` or **Check grid** | rail drawer | Left shoulder | as above |
| Reveal | `H` or **Reveal letter** | tray **Reveal** | Right trigger | `reveal` shimmer, ◆ mark |
| Pause / resume | `Esc` | **Pause** | Start | `pause` thud, pause dialog |
| Give up | **Give up** (confirm dialog) | rail drawer | — | `lose` phrase, results |

Actions (`starhermit.txt`, rebindable in the runtime's Options › Controls, grouped Board / Assists / Round): `up`, `down`, `left`, `right`, `nextclue` (Enter), `toggledir` (Space), `clear` (Backspace+Delete), `checkword` (C), `checkgrid` (G), `reveal` (H), `pause` (Escape). The browser build's camel-case names (`nextClue`, `toggleDir`, `checkWord`, `checkGrid`) became lower case as the engine requires; its per-player key overrides are not carried over. Tab moves the UI focus (it is no longer a second Next-clue key).

**Typing.** On keyboard devices the play screen's **Type letters** field (the runtime's text field) holds the focus whenever the board would (round start, a square tapped, a clue picked, an assist pressed): letters typed there go into the board one by one after the keyboard layout and input methods, and the field empties again. While it has the keyboard the runtime holds game actions back (`engine.minor` 17+), so the field itself handles Backspace/Delete (clear), the arrows (steer), Enter (next clue, Shift: previous), Escape (pause) and Space (direction). With the board region focused (or nothing) letter keys type by their key position (`KeyA`–`KeyZ`). A Check or Reveal key bound to a letter types on the board and acts when the focus is elsewhere. On touch devices the tray shows the on-screen letter keys (ABC toggles them; Settings remembers the choice); with them hidden the tray shows the field, whose tap brings up the device keyboard.

Input locking: letters only apply while the round is active; while paused, on results or menus, keys do nothing except Esc. Invalid actions play `invalid`, vibrate 30 ms and announce the reason text (`ERROR_TEXT`). Double commits are impossible because each command carries the engine's next id. A hidden window (`onSuspend`) pauses the round; returning leaves it paused until Resume.

## 7. Screens and UI flow

State machine (`app.phase`): `title ⇄ modes → active ⇄ paused → resolving → results → (title | modes | active)`. Settings and Help are sub-screens (`app.sub`) reachable from the top bar everywhere and Help from the pause dialog; opening one mid-round pauses first, and Back returns to what opened them.

Layouts (`native/screens.ts`, by the window's logical size):
- **Wide (≥ 1024 px):** three rails — left 290 px (objective, progress bar, time / score / streak, scrolling clue lists), the board in the middle (≤ 56 px a column, ≤ 62 % of the height; on screens above 1600 × 1000 it grows to 56 % of the height), the lesson banner under it, right 290 px (current clue, Check word / Check grid / Reveal letter / Give up / Pause, the Type letters field).
- **Compact (< 1024 px):** a scrolling column with the current clue over the board, the lesson banner, and the rails as drawers ("Objective & clues ▾", "Clue & actions ▾", collapsed by default); the thumb tray pinned at the bottom (letter keys or the field, then ABC, Check, Reveal, Across ⇄, Pause).
- **Short landscape (≤ 500 px tall):** the tray docks at the side (≤ 400 px, keys at its bottom) so the board keeps the full height.
- **Left-handed** mirrors the rails, the docked tray and the tray's buttons.
- Menu screens (title, modes, results, Settings, Help) centre a ≤ 520–900 px column; the title's key art gives up height first (never below 96 px) so the menu stays above the fold; lists scroll inside themselves. Toasts stack top-right under the top bar, at most three, 4.2 s; round-end toasts are cleared so nothing covers the results.
- The pause dialog: Resume, Options… (the runtime's menu), Help, Leave round. Give up asks in a dialog (Give up / Cancel).

## 8. Art direction

**Hero:** the board — cream tiles on a dark-cream tile edge with the diorama's sky and hills glowing behind. The title screen's hero is the key art (papercraft harbor diorama rising from a journal beside a brass lantern), which the live diorama echoes in 3D.

**Palette** (theme `harbor`, the default; the theme's colours go into the UI style tokens and the board):

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#f6efe0` | headings on dark, page sheets in the diorama |
| `--ink` | `#26313d` | text, toasts |
| `--tile` / `--tile-edge` | `#fdfaf1` / `#d9cfae` | cells / board grout and borders |
| `--accent` | `#d96c47` | Play, action buttons, tutorial pulse, score |
| `--select` | `#2f80ed` | selected cell and entry (16 % / 38 % mixes) |
| `--ok` / `--wrong` / `--revealed` | `#3f9d63` / `#c0392b` / `#8a6fd0` | ✓ confirmed, ✗ wrong, ◆ revealed |
| `--bg` / `--panel` | `#10151f` / `rgba(255,253,247,.96)` | page ground behind the canvas / rail cards |
| `--focus-ring` | `#ffb020` | 3 px focus outline everywhere |

Five themes (`THEMES`) recolour tiles, accent and the diorama: Harbor Dawn (`sky #bfe0e6`, water `#4f8ea8`, hill `#7fae8e`), Pine Ridge (`#cfdcc8`, `#5c8a96`, `#6f9a6a`, accent `#c96f2e`), Desert Meridian (`#f2d9a7`, `#6aa5b8`, `#d9b678`, accent `#b6543a`), Frost Lantern, Orchard Rail. `select`, `ok`, `wrong`, `revealed` are identical in every theme so state colours never drift. Under the runtime's high contrast the board draws black on white with a `#b34700` accent and 1 px square borders, and the UI takes the runtime's forced colours.

**Shape language:** rounded 10–14 px radii on every card and button, 2 px grout between square cells, paper-and-lantern warmth; the diorama is a papercraft scene on an open journal: a wood-grain desk, a leather cover under stacked paper pages, a cylinder ground disc, faceted hills around the sides and back, cone trees, a pond, and a lantern post with an emissive glass and point light. With detailed scenery it adds paper-fibre textures, a ribbon bookmark, three layered paper-cut hill silhouettes standing at the back like a pop-up page, two-tier trees, a striped lighthouse with a pulsing beacon, three cottages with lit windows, two paper boats on the pond and a brass lantern. Everything is placed by the `<seed>-deco` stream so each page has its own scenery.

**Typography:** system sans (`Segoe UI, system-ui, Roboto…`), 16 px base scaled 1.2× by Larger text; cell letters 1.3 rem bold; rail headings 0.85 rem uppercase tracked; ✓ ✗ ◆ glyphs at 0.55–0.6 rem in the cell corner.

**Motion:** camera drifts ±0.9 units on a ~2-minute sine, lantern flickers on a 2.7 s cycle, water bobs 3 cm, ripples scroll across the pond and the paper boats rock, the lighthouse beacon pulses and fireflies drift; the lesson square pulses. With the runtime's reduced motion all diorama motion and the pulse freeze.

**Graphics.** ACES filmic tone mapping (exposure 1.25); the sky is a background gradient painted once per theme (sRGB, so the theme's sky shows at its true hue) and the fog is pre-inverted through the ACES curve. Lighting: a hemisphere fill in the theme's sky/ground colours, a warm key sun with a soft shadow, the lantern's point light (three.js intensities ÷ π). The runtime's graphics level (Options › Graphics: Auto from the device, or a level; render scale, adaptive resolution, frame-rate limit and readout are the runtime's) picks the browser build's preset by tier (`native/quality.ts`):

| | Low | Balanced | High | Ultra |
|---|---|---|---|---|
| Shadows | off | 1024² | 2048² | 4096² |
| Ambient occlusion | off | off | on | high |
| Bloom (emissive lights only, threshold 0.92) / colour grade + vignette | off | on | on | on |
| Anti-aliasing | MSAA | FXAA | SMAA | MSAA |
| Reflections (RoomEnvironment) | off | on | on | on |
| Materials | Lambert | Standard | Physical water | Physical water |
| Paper / wood textures | 128 / 256 | 256 / 512 | 256 / 512 | 512 / 1024 |
| Round-geometry segments | ×0.5 | ×0.75 | ×1 | ×1.5 |
| Fireflies (scaled up with the level, capped) | 0 | 30 (≤ 40) | 110 (≤ 440) | 160 (≤ 440) |
| Detailed scenery and paper-tile board shading | — | ✓ | ✓ | ✓ |

The browser build's own Graphics section (per-effect overrides, GPU summary, Pause's Cycle quality) is replaced by the runtime's Options.

**Visual assets the design calls for:** title key art (16:9, papercraft harbor journal), a "page complete" results illustration (golden sunset page with wax seal), a "page lost" results illustration (foggy slate hills, dimmed lantern), and the platform cover derived from the key art. All four ship (see §15).

## 9. Audio direction

**Mix:** the runtime's buses (Options › Audio owns volumes, mute and the voice limit): authored one-shots on `effects` (the select tick on `interface`) at the browser build's effects level (0.8 × 0.5); the ambience — two seconds of low-passed brown noise rendered into a looping clip — on `effects` at 0.4 × 0.5; the pentatonic sine arpeggio (each note rendered once into a clip; 700 ms steps on the menus, 420 ms in play with a triangle bass on even steps) on `music` at 0.5 × 0.5. Sound starts with the first press that starts a round. Clips load one at a time once the mixer runs; the browser build's synthesized stand-ins for still-loading clips are not played.

**SFX event table** (source of `sfx/manifest.txt`; several files back one event as variants):

| Event id | File | Sound | Used when |
|---|---|---|---|
| `key` | `key-tap-a/b/c.opus` | mechanical / laptop / typewriter key tap | letter typed that is not correct |
| `correct` | `correct-letter.opus` | single bright xylophone ding | letter typed that matches the solution; Effects slider preview |
| `word` | `word-complete.opus` | three rising marimba notes | an entry becomes fully correct |
| `win` | `round-win.opus` | short brass-and-bells fanfare | grid complete |
| `lose` | `round-lose.opus` | descending wooden flute phrase | time-limit, mistake-limit, gave-up |
| `invalid` | `invalid-buzz.opus` | short low error buzz | any rejected command |
| `check` | `check-mark.opus` | pencil ticking a checkbox on paper | Check word / Check grid |
| `reveal` | `reveal-shimmer.opus` | upward bar-chime glissando | Reveal wrote a letter |
| `select` | `select-tick-a/b.opus` | soft rounded button click / fingertip on wood | cell selected, direction toggled, clue picked |
| `pageTurn` | `page-turn.opus` | thick journal page turning | round start, every mode |
| `pause` | `book-close.opus` | journal cover closing softly | player-initiated pause (not the hidden-tab pause) |
| `achievement` | `passport-stamp.opus` | rubber stamp thud with ink squelch | achievement unlocked |
| `timeWarning` | `time-warning.opus` | pocket-watch ticks then a bell | 30 s left in a timed round (once), with toast + haptic + live text |
| `lesson` | `pencil-flourish.opus` | pencil flourish on paper | a Learn lesson step is satisfied |

Every meaningful sound has a visible counterpart (toast, glyph, banner or live-region text), so nothing is audio-only.

## 10. Localization

The game ships in **nine locales**: en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT.

- **Strings.** English source strings are the keys. `js/strings.js` holds the tables (rows `[en, es-419, de-DE, fr-FR, pt-BR, it-IT]`; en-GB is derived with British spelling — Harbour, colour, Traveller; es-ES and fr-CA list only their differences, e.g. "Ajustes", "Pointage"); `js/i18n.js` (`CJI18N.T(key, vars)`) looks them up; `js/platform-strings.js` holds the account and leaderboard lines. Every string is looked up as it is drawn: menus, mode and page names, blurbs, objective, HUD, clue headings and direction words, square descriptions, board summary, toasts, errors, lesson banners, help cards, results, achievements, theme names, dialogs.
- **Clues stay English.** The word bank, answers and clues are English by construction (the grid is an English crossword in every language); the lesson that quotes a clue says so.
- **Language setting.** The runtime's Options › Language (the player's choice, else the account's preferred language, else the device's) sets the interface language (`preferences().language`, mapped to the nearest shipped locale: es-MX → es-419, en-AU → en-GB, fr → fr-FR). Changing it re-renders everything in place without touching the round, its clock or the board.
- **Layout.** Long text wraps (paragraphs at the column width); German shows nothing cut off at 390 px wide.

## 11. Accessibility (as implemented)

- **Keyboard and pad:** every button, clue and setting is a UI widget (Tab / arrows / Enter, D-pad / South); the board is a region named "Crossword grid" that keeps the arrows, described by the board summary ("Grid r by c, x of y letters correct, m of n words complete") and the selected square; each square is a `ui.target` with its old label ("Row 1 column 2, letter A, confirmed, starts clue 1").
- **Announcements** (`ui.announce`): the objective at round start, the current clue on change, lesson steps, rejected actions and flagged counts (assertive), the time warning, word completions, the outcome.
- **Colour independence:** ✓ ✗ ◆ marks and struck-through clues carry state; Settings › Color-vision-safe markers hatches wrong squares and underlines confirmed letters.
- **Runtime settings:** high contrast, larger text, interface size and reduced motion are the runtime's (Options › Accessibility); the game honours them (board colours, frozen motion).
- **Game settings:** left-handed layout, haptics, the on-screen letter keys, theme, display name.
- **Targets:** every interactive element is ≥ 44 px tall (on-screen keys 40, 32 in short landscape).

## 12. StarHermit integration

| Platform feature | Status |
|---|---|
| Server script (`score-script.js`) | Range-checks and posts a finished ranked round's total to `high-score` (0–100,000). |
| Clock | `serverTime()` at start and every 5 minutes; the Daily and the UTC day use `serverNow()`, the device clock while the platform is out of reach. |
| Identity | Signed in, the top bar shows "<name> · sync status · day UTC" and the Profile card the player's display name; signed out the local display name (Settings › Profile) and the day. Sign in with StarHermit (`requestSignIn`) on the title when signed out; Invite a friend copies the invite link (clipboard) when signed in. |
| Save | The store document `{ v: 1, settings, profile, journey, achievements, stats, tutorialDone }` (`js/save.js`) in `saves` (device + the player's cloud slot, debounced by the runtime). Conflicts merge with `mergeStoreDoc` (highest Journey page, best stars, every achievement at its earliest time, highest wins and words, the union of Daily days, Learn done if either; local settings and profile kept). The browser build's cloud save (`game:<slug>`, the JS SDK's save.json holding the same document) shows as foreign: it is merged in (or taken as is on a first start) and replaced once with `replaceForeign`. Guests' old browser localStorage progress does not migrate. |
| Legacy settings | The browser build's per-player keys are read once: theme, colour-vision markers, left-handed, haptics and the letter-keys choice carry into the save; every legacy key (`theme`, `vol*`, `gfx`, `highContrast`, `largeText`, `reducedMotion`, `audio.options`, `graphics.gpu.*`, `ui.language`…) is then removed. |
| Leaderboards | Signed in, every finished ranked round (Daily, Challenges) whose local replay verifies posts its total (floored at 0) through a practice session's socket (`{type:'result', scores}`) and the results show "Leaderboard rank: #N" (or posted / not posted). Guests post nothing. |
| Options | Sound, graphics, language, controls and accessibility are the runtime's Options (Settings › Options…, Pause › Options…, F1). Reports and crash reports are the runtime's. |
| Achievements | In the save; no platform achievements. |
| Sessions, matchmaking, chat, rooms, voice | Not used — solo ruleset. |

## 13. Technical architecture

- **Modules:** `js/rules.js` (pure, `RULES_VERSION=1`) and `js/content.js` (`CONTENT_VERSION=1`) are the browser build's, imported by the TypeScript client (`allowJs`) and the Node tests unchanged; `native/*.ts` is the client (§1).
- **Determinism and replay:** command log = `[{type, …, id, at}]`; the replay envelope `{schema, build, contentV, seed, init, commands}` replays to the same `hashState`; the results verify it before posting.
- **Time:** elapsed time counts the runtime's fixed steps (60 Hz) while the round is active; paused and hidden time never counts; `at` is stamped on every command. Play scripts replay exactly.
- **Rendering:** the UI is rebuilt every frame; the diorama scene is rebuilt only when theme, seed or the look's assets change; ≤ ~110 meshes.
- **Web runtime:** `npm run package` writes `index.html` + `starhermit-files.json`; re-run after every change (the web runtime refuses a stale index).

## 14. Testing and acceptance criteria

`npm test` = `npm run test:unit` + `npm run test:native`:
- **rules / content** (`tests/rules.test.mjs`, `tests/content.test.mjs`): as before — every command and rejection, scoring, limits, replay and tamper detection, fuzzing; bank, masks, generator determinism, every mode's defs winnable.
- **save** (`tests/save.test.mjs`): browser documents read back with only the game-owned settings, junk refused, the old cloud save migrates, merges keep the better of both, legacy keys.
- **i18n** (`tests/i18n.test.mjs`): every key `native/*.ts` and the content show is translated in every locale with placeholders intact and no unused rows; the account lines in every locale; locale switching.
- **native** (`tests/native.mjs`): the web index is current, `tsc` (strict, no skipLibCheck), `starhermit check .` with zero warnings, and the play scripts in `tests/native/` as guest render checks: `journey.play` (Journey card → page 1 typed into the letters field with one Check and one Reveal → results total, First Completion, Next page → pause → Leave round, title shows 2★), `learn.play` (the six lessons through the real actions), `challenge.play` (Speed Ink solved, ranked, Hard Milestone), `screens.play` (Settings name typed, markers, Options, Help, Practice pause → Help → Resume, Give up with Cancel then confirm, New practice grid). `npm run plays` regenerates the first three from `tools/plan.mjs`.
- **browser** (`npm run test:browser`, `tools/browser-play.mjs`): the packaged loader in Chrome on the GPU at 1366×768, 390×844 (with on-screen key taps; Settings and Help) and 844×390, Journey page 1 to its results by keyboard; fails on console errors or warnings.

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/key-art.webp` (1280×720, 64 KB) | Title screen hero image | FLUX.2 klein, seed 2801, 1536×864, 28 steps | generated in this pass |
| `assets/results-win.webp` (960×540, 39 KB) | Results illustration, page complete | FLUX.2 klein, seed 2802 | generated in this pass |
| `assets/results-lose.webp` (960×540, 20 KB) | Results illustration, page lost | FLUX.2 klein, seed 2803 | generated in this pass |
| `coverart.png` (1200×675, 361 KB) | Platform cover: key art + title/tagline text | key art + ffmpeg drawtext, 256-colour PNG | replaced in this pass (previous file was a generic template) |
| `icon.png`, `favicon.svg` | Platform icon, tab icon | authored | shipped |
| `sfx/key-tap-a/b/c.opus`, `correct-letter`, `word-complete`, `round-win`, `round-lose`, `invalid-buzz`, `check-mark`, `reveal-shimmer`, `select-tick-a/b.opus` | Core play cues (§9) | MOSS-SoundEffect v2, 100 steps | shipped |
| `sfx/page-turn.opus`, `book-close.opus`, `passport-stamp.opus`, `time-warning.opus`, `pencil-flourish.opus` | Round start, pause, achievement, 30 s warning, lesson complete | MOSS-SoundEffect v2, 100 steps | generated in this pass, wired |
| `sfx/manifest.txt` | Canonical clip → event → description → usage table | authored | current |
| 3D models / character animation | none: the diorama is procedural primitives and the game has no character | — | not called for |

## 16. Known limitations

- Clues and answers are English in every locale (§10).
- With the board region focused (not the letters field) letter keys type by key position (US layout); the field types by the player's layout.
- Ranked results are kept on the device; signed in they also post to the single `high-score` board, so all ranked modes share it.
- `assists.undo` in content defs is unused; there is no undo command (Backspace clears).
- Time-limit detection happens through a watchdog letter command, so a `time-limit` loss records one extra typed action.
- Ambience and music are synthesized (rendered clips), not authored, and do not vary by theme.
- Guests' browser-build localStorage progress does not carry over (signed-in cloud saves do).
- The browser build's per-effect graphics overrides, GPU summary and Pause's Mute / Cycle quality / Toggle contrast buttons are the runtime's Options now.

## 17. Design intent not yet implemented

- Per-locale word banks so the crossword itself can be played in each language.
- A Leaderboard screen (global and friends-filtered) reading the own-server `/api/v1/leaderboard` for the Daily, each challenge and Journey per page, beyond the platform board snippet.
- Presence heartbeats and platform-published achievements through the StarHermit API (identity and cloud-saved progression are done).
- Authored per-theme ambience loops (harbor gulls and water, pine wind, desert wind, frost hush, orchard rail) on the ambience bus.
