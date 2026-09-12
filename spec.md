# Crossword Journey — Game Design Document (running spec)

**Status:** shipped; this document describes the game as it runs today.
**Pitch:** a travel journal whose pages are small crosswords — solve clue-driven words across five scenic regions, one shared page every UTC day.
**Genre:** clue puzzle (mini crosswords, 5×5 to 9×9). **Players:** 1, with asynchronous ranked boards. **Session:** 2–5 minutes for a 5×5 page, 10–25 minutes for a 9×9 mastery or challenge page.
**Platforms:** desktop and mobile browsers, portrait and landscape. **Rendering:** semantic HTML/CSS board (the accessible truth) over a purely decorative Three.js papercraft diorama; no WebGL required to play.

## 1. File map

| Path | Role |
|---|---|
| `index.html` | Single page: title, mode select, play, results, settings, help screens, pause overlay, mobile tray, toasts, live regions. |
| `css/style.css` | Layout (three rails / drawers / thumb tray), themes via CSS variables, high-contrast, CVD, reduced-motion, large-text, left-handed. |
| `js/main.js` | Client: persistence, settings, platform sync, Three.js diorama, session/state machine, board render, input, tutorial, modes, results, pause/help wiring. |
| `js/rules.js` | Pure deterministic rules engine: `createGame`, `applyCommand`, legality queries, scoring, hashing, `replay`, `compareResults`. Shared by browser and server. |
| `js/content.js` | Versioned content: 5 themes, 353-word original bank with clues, 8 grid masks, seeded backtracking fill generator, Journey/Learn/Daily/Practice/Challenge defs, validators. |
| `js/audio.js` | WebAudio: three buses, authored Opus one-shots with synthesized fallbacks, procedural ambience pad and pentatonic music loop. |
| `server.js` | Node static host + `/api/v1/time`, `/api/v1/score` (authoritative replay validation), `/api/v1/leaderboard`; boards mirrored to `data/leaderboard.json`. |
| `vendor/three.module.js` | Three.js (decorative scene only). |
| `sfx/*.opus`, `sfx/manifest.txt` | 17 authored clips; canonical `file | event | description | usage` manifest (`manifest.json` drives generation). |
| `assets/key-art.webp`, `assets/results-win.webp`, `assets/results-lose.webp` | Title key art and results illustrations. |
| `coverart.png`, `icon.png`, `favicon.svg` | Platform cover (1200×675), icon, tab icon. |
| `tests/rules.test.mjs`, `tests/content.test.mjs`, `tests/e2e.mjs` | 50 unit tests (`npm test`) and the Playwright playthrough (`npm run test:e2e`). |
| `tools/smoke.mjs` | Dev-only server smoke test (boots server, submits a replay envelope, reads a board). Not shipped. |
| `starhermit.txt`, `LICENSE.md` | Platform manifest (`server=server.js`, `cover=coverart.png`); PolyForm Noncommercial 1.0.0. |

## 2. Vision and design pillars

1. **The page is the puzzle.** Every round is one journal page: a small, fully-crossed grid you can hold in your head. Rules in: 5×5–9×9 masks, every letter cell belongs to at least one word, mini-crossword numbering. Rules out: full-size 15×15 grids, themed rebus squares, uncrossed letters.
2. **Crossings are the mechanic, not the trivia.** Clues are short, original and gettable; the skill is using confirmed letters to unlock neighbours. Rules in: streak bonus per consecutive word, letter points awarded on first correct placement, an interactive lesson devoted to crossings. Rules out: obscure trivia, clue puns that need cultural knowledge.
3. **Assists are honest tools, never traps.** Check and Reveal are always available (unless a Challenge says otherwise), cost a small, visible number of points, lock what they touch, and can never make the page unfinishable. Rules in: ✓/✗/◆ glyphs on every assisted cell, the score breakdown showing exactly what assists cost. Rules out: assists that consume "lives", assists that make a round silently unranked.
4. **One shared page a day, provably fair.** Daily, Journey and Challenge content is regenerated from its id on the server; a score is accepted only if the replayed command log reproduces the claimed total. Rules in: gapless command ids, deterministic seeds, server-side `replay`. Rules out: client-trusted totals, mutable daily seeds.
5. **The diorama decorates, the DOM plays.** The 3D scene changes with theme and seed but never carries information; the board, clues and HUD are plain buttons and text that work without WebGL, with a keyboard, and with a screen reader. Rules out: any control that exists only in the canvas.

## 3. Player experience

**Target player:** casual word-puzzle players who like a daily ritual (mini crossword, word ladders) and want a gentle progression to bigger grids.

**First 60 seconds.** Title screen shows key art, one dominant **Play** button and three cards (Daily Challenge, Journey, Profile). Play opens mode select; the first item is **Learn — First Page**, a 5×5 grid with six banner lessons that each wait for the real action: type any letter into the pulsing square; finish `1 Across` with its clue shown; complete any crossing word; press Check; press Reveal; finish the page. The banner text is the teaching; there is no separate tutorial screen. Returning players tap Daily Challenge on the title screen: the board appears in one action. The Help screen (top bar, always available, also from Pause) lists every control as rule cards.

**Session shape.** Pick a page → the first playable square is selected and its clue shown in the right rail → type, arrows, Enter to hop clues → words strike through as they complete, streak toasts fire → page completes → results with a six-line score breakdown, achievements, leaderboard rank, and a **Next** button that already knows where you are going (next Journey page, the Daily after Learn, a fresh Practice grid).

**Emotional beat.** The cascade: one confirmed crossing letter turning a stubborn clue obvious, the marimba word chime, the streak counter climbing, and finally the fanfare and lantern-lit results page.

## 4. Core loop and rules contract

All rules live in `js/rules.js`; the UI never mutates state except through `applyCommand` (`main.js dispatch`).

### Board and entities
- `createGame(def)` builds `state` from a content def: `rows × cols` cells, each `null` (void) or `{ sol, cur:'', flag:0 }`. Entries are `{ id, dir:'across'|'down', row, col, len, number, clue, cells[] }`.
- Cell flags (`FLAG`): `CONFIRMED=1`, `WRONG=2`, `REVEALED=4`, `AWARDED=8`. `CONFIRMED|REVEALED` cells are locked (`isLocked`, `canType`).
- Selection (`session.sel = { cell, dir }`) is UI state in `main.js`, never rules state.

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
Because limits are only evaluated on commands, `main.js` runs a 500 ms watchdog that, when the clock passes the limit, commits a neutral letter command (retyping an existing unlocked letter) so the engine declares `time-limit`.

### Scoring constants (`SCORE`)
`LETTER 10`, `WORD_BASE 20`, `WORD_PER_LEN 5`, `STREAK_STEP 15`, `GRID_COMPLETE 150`, `CHECK_COST −15`, `REVEAL_COST −30`, `TIME_BONUS_PER_SEC 2` (cap `400`). `total = letters + words + streak + time + assists + complete`; all integers; `mult` (1, 1.5 or 2) scales letters, words, streak and completion but not assists or time.

**Worked example — Journey page 1 "First Mooring"** (quay5, 17 letters, par 300 s, mult 1). Grid: CAT / L·R·E / ACORN / M·W·T / PEN with entries 1A CAT, 4A ACORN, 5A PEN, 1D CROWN, 2D TENT, 3D LAMP. The e2e bot types 2 letters, checks the word (−15), reveals one letter (−30), then types the remaining 14 letters in 8 s:
letters 16 × 10 = **160** (the revealed cell earns nothing) · words 35+45+35+45+40+40 = **240** · streak 15·(1+2+3+4+5+6) = **315** · time min(400, 292·2) = **400** · assists **−45** · completion **150** → **total 1220**.

### Ties, RNG, replay
- `compareResults(a, b)`: won before lost, higher total, fewer invalid actions, lower `elapsedMs`, then `sessionId` string order. Used by `server.js insertEntry`.
- `createStream(seed)` is mulberry32 over an FNV-1a hash (`hashSeed`). Streams are separate: `fill:<seed>:<attempt>` for the grid, `<seed>-deco` for the diorama, none for audio (variant picks use `Math.random`, cosmetic only).
- `replay(envelope)` (`{schema:1, build:RULES_VERSION, contentV, seed, init:def, commands[]}`) rebuilds the state from `init`, applies every command, errors on any rejection, and returns `finalHash` plus checkpoints every 5 commands. `hashState` is FNV-1a over the canonical JSON. `endRound` replays its own log locally before submitting; a mismatch shows a toast and withholds submission.
- **Undo:** none. Backspace/Delete clears the selected square (a `clear` command). Content defs carry an `assists.undo` flag that nothing reads.

## 5. Modes and progression (`js/content.js`, `main.js buildModeList`)

| Mode | Content | Limits / multiplier | Ranked | Notes |
|---|---|---|---|---|
| **Learn — First Page** | `learnDef()`: quay5, difficulty 1, seed `learn-quay` (COW, TRAIL, RAT, STAR, COAST, WOLF) | none, ×1 | no | Six lesson steps (`tutorial.steps`) advance only through rules events. Replayable from Settings. Next → Daily. |
| **Journey** | `journeyStage(1..40)`: seed `journey-n`, 5 regions × 8 pages, titles authored (`JOURNEY_TITLES`) | ×1; mastery pages (8, 16, 24, 32, 40) ×1.5 with difficulty +1 | yes (`journey` board) | Page n+1 unlocks on a win; stars: 1 + (no assists) + (under par). Progress in `localStorage`. |
| **Daily Challenge** | `dailyForDate(serverNow)`: id/seed `daily-YYYY-MM-DD`, pattern by weekday (Sun summit9/3, Mon quay5/1, Tue harbor6/1, Wed trail7/2, Thu vale6/2, Fri meadow7/2, Sat vista8/3), theme by date hash | none, ×1 | yes, unless the date is in `DAILY_EXCLUDED` | Same seed everywhere; server regenerates it to validate. |
| **Practice** | `practiceDef(easy|medium|hard)`: random seed per round; easy quay5/open5 d1, medium harbor6/vale6/trail7 d2, hard meadow7/vista8/summit9 d3 | none, ×1 | no (`practice-casual` board) | Next → another grid of the same difficulty. |
| **Challenges** | `CHALLENGES`: Speed Ink (trail7, 6:00 limit, ×1.5), No Eraser (harbor6, 3 mistakes, ×1.5), Blind Corners (meadow7, 2 checks, ×1.5), Long Haul (vista8, no limits, ×2), Summit Push (summit9, 25:00 + 8 mistakes, ×2) | as listed | yes (board per challenge id) | Fixed seeds, so every player gets the same grid. |

**Journey curve** (`TIER_TABLE`): tier 1 quay5/open5 d1 (letters, crossings) → tier 2 harbor6/vale6 d1 (+checks) → tier 3 trail7/meadow7 d2 (+reveals) → tier 4 meadow7/vista8 d2 (+streaks) → tier 5 summit9/vista8 d3. Par seconds per pattern: quay5 300, open5 330, harbor6 420, vale6 450, trail7 600, meadow7 660, vista8 780, summit9 900. Difficulty limits which bank words the fill may use (`d` 1 common, 2 moderate, 3 tricky).

**Achievements** (`ACHIEVEMENTS`, local, idempotent): `first-completion`, `mechanic-mastery` (win a mastery page), `streak-5`, `hard-milestone` (win any ×1.5+ round), `long-term-goal` (10 wins).

## 6. Controls and interaction

| Input | Desktop | Mobile | Feedback |
|---|---|---|---|
| Select square | click | tap | `select` tick, blue fill on the entry, ring on the cell, clue text in the right rail / drawer |
| Toggle direction | click the selected square again, `Space` | tap again, tray **Across ⇄** | entry highlight flips, clue text changes |
| Type letter | `A`–`Z` | on-screen keyboard is not used: cells are buttons, so the tray and physical/Bluetooth keyboards type; see Known limitations | `correct`/`key` sound, 8 ms haptic, cursor advances to the next empty cell in the entry |
| Clear | `Backspace`, `Delete` | — | cell empties |
| Move | arrow keys (wrap, skip voids; vertical moves switch to Down where a Down entry exists) | tap | selection + focus follow |
| Next / previous clue | `Enter` / `Shift+Enter`, `Tab` / `Shift+Tab` while the board has focus | tap a clue in the list | clue gets `aria-current` |
| Check word | `C` (when focus is off the board) or **Check word** | tray **Check** | `check` sound; wrong letters ✗ announced |
| Check grid | `G` or **Check grid** | — (rail drawer) | as above |
| Reveal | `H` or **Reveal letter** | tray **Reveal** | `reveal` shimmer, ◆ glyph |
| Pause / resume | `Esc`, **Pause** | tray **Pause** | `pause` thud, overlay, focus to Resume |
| Give up | **Give up** (confirm dialog) | rail drawer | `lose` phrase, results |

Input locking: letters only apply while `session.phase === 'active'`; while paused, hidden, on results or menus, keys do nothing except `Esc`. Invalid actions play `invalid`, vibrate 30 ms and announce the reason text (`ERROR_TEXT`). Double commits are impossible because each command carries the engine's next id. A tab going hidden pauses the round and suspends audio; returning resumes audio but leaves the game paused until the player presses Resume.

## 7. Screens and UI flow

State machine (`session.phase`, `transition()`): `boot → title ⇄ modes → active ⇄ paused → resolving → results → (title | modes | active)`. Settings and Help are sub-screens reachable from title, results, and mid-round (which pauses first); `goBackFromSub` returns to the phase that opened them. Every transition has one owner and a reason string.

Layouts (`style.css`):
- **Wide desktop ≥ 1024 px:** three rails — left (objective, progress bar, time/score/streak, scrolling clue lists), centre board (`min(92vw, cols·56px)`, max 62vh), right (current clue, action buttons). Tray hidden. Key art 560 px wide on the title screen.
- **Compact ≤ 1023 px:** rails become drawers with a toggle button ("Objective & clues ▾", "Clue & actions ▾"), collapsed by default; the board is ordered first. Cells 40 px minimum.
- **Portrait mobile ≤ 700 px:** top bar drops the status text, clue list capped at 30vh, sticky bottom tray (Check, Reveal, Across ⇄, Pause) padded by `safe-area-inset-bottom`.
- **Landscape mobile ≤ 500 px tall:** rails return side-by-side at 200 px, 44 px cells, 44 px top bar, key art hidden so Play is on screen.
- Safe areas: all edges use `env(safe-area-inset-*)`. Must never be cut off: the whole board, the current clue, the Play button, Resume in the pause overlay, Retry/Next/Home on results. Toasts stack top-right, capped at three.

## 8. Art direction

**Hero:** the board — cream tiles on a dark-cream tile edge with the diorama's sky and hills glowing behind. The title screen's hero is the key art (papercraft harbor diorama rising from a journal beside a brass lantern), which the live diorama echoes in 3D.

**Palette** (theme `harbor`, the default; `applySettings` writes the theme colours into CSS variables):

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

Five themes (`THEMES`) recolour tiles, accent and the diorama: Harbor Dawn (`sky #bfe0e6`, water `#4f8ea8`, hill `#7fae8e`), Pine Ridge (`#cfdcc8`, `#5c8a96`, `#6f9a6a`, accent `#c96f2e`), Desert Meridian (`#f2d9a7`, `#6aa5b8`, `#d9b678`, accent `#b6543a`), Frost Lantern, Orchard Rail. `select`, `ok`, `wrong`, `revealed` are identical in every theme so state colours never drift. High contrast (`body.hc`) swaps to pure black/white with `#b34700` accent and 1 px cell borders.

**Shape language:** rounded 10–14 px radii on every card and button, 2 px grout between square cells, paper-and-lantern warmth; the diorama is built from primitives (stacked box pages, cylinder ground, hemisphere hills, cone trees, a lantern post with an emissive sphere and point light) placed by the `<seed>-deco` stream so each page has its own scenery.

**Typography:** system sans (`Segoe UI, system-ui, Roboto…`), 16 px base scaled 1.2× by Larger text; cell letters 1.3 rem bold; rail headings 0.85 rem uppercase tracked; ✓ ✗ ◆ glyphs at 0.55–0.6 rem in the cell corner.

**Motion:** camera drifts ±0.9 units on a ~2-minute sine, lantern flickers on a 2.7 s cycle, water bobs 3 cm; tutorial cell pulses; toasts slide 8 px. With `prefers-reduced-motion` or the Reduce-motion setting all CSS animation is removed and the diorama camera, lantern and water freeze (render continues). Rendering pauses while the tab is hidden. Quality tiers (`QUALITY`): low dpr 1/6 trees/3 hills, medium dpr 1.5/12/4, high dpr 2 + shadows/20/6.

**Visual assets the design calls for:** title key art (16:9, papercraft harbor journal), a "page complete" results illustration (golden sunset page with wax seal), a "page lost" results illustration (foggy slate hills, dimmed lantern), and the platform cover derived from the key art. All four ship (see §15).

## 9. Audio direction

**Mix:** three gain buses (`music`, `effects`, `ambience`) each at slider × 0.5; effects default 0.8, music 0.5, ambience 0.4; Mute all from Pause zeroes every bus; the context is created only on a user gesture (`audio.unlock` from Play/Daily/Journey/first cell tap or key). Ambience is a looping low-passed brown-noise wash; music is a pentatonic sine arpeggio (700 ms steps in menus, 420 ms in play with a triangle bass on even steps) — `setIntensity` follows the phase. Authored clips are fetched lazily on first use and win over the synthesized fallbacks, which remain for load failures.

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

The shipped build is **English only**: `<html lang="en">`, strings hard-coded in `index.html` (screen chrome), `main.js` (mode blurbs, results, errors, help cards, toasts) and `content.js` (clues, page titles). The word bank and clues are English by construction, so a localized build needs a per-locale bank rather than string translation. Target locales for the product line — en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT — are listed under Design intent (§17). Layout already tolerates ~30 % expansion: 70ch caps on prose, wrapping menu cards, 44 px minimum targets, drawers on compact screens.

## 11. Accessibility (as implemented)

- **Keyboard-only path:** skip link to `#board-region`; the board is a roving-tabindex grid (`role="grid"`, cells `role="gridcell"` with full `aria-label`s: position, letter, confirmed/revealed/wrong, clue number); arrows/Enter/Tab/Space navigate; `H`/`C`/`G` act from the clue list; every rail button, clue and tray button is a real `<button>`; the pause overlay is `role="dialog" aria-modal` with focus moved to Resume and restored afterwards (`rememberFocus`/`restoreFocus`).
- **Focus:** 3 px `#ffb020` outline on `:focus-visible` everywhere.
- **Live regions:** objective and current clue (`polite`), score (`polite`), board summary "Grid r by c, x of y letters correct, m of n words complete" (`polite`, after every command), `#error-live` (`assertive`) for rejected actions, flagged counts and the time warning, `#results-live` (`assertive`) for the outcome.
- **Colour independence:** ✓ ✗ ◆ glyphs and strike-through clues carry state; the CVD setting additionally hatches wrong cells and underlines confirmed ones; High contrast swaps the whole palette.
- **Reduced motion:** honours the media query and the setting; kills CSS animation and diorama motion.
- **Other settings:** Larger text (1.2×), Left-handed (mirrors rails and tray), Haptics toggle, independent Music/Effects/Ambience sliders, tutorial replay.
- **Targets:** every interactive element is ≥ 44 × 44 CSS px on desktop and mobile (cells 40 px on compact tablets), tray buttons stretch to share the thumb zone.

## 12. StarHermit integration

Manifest: `name=Crossword Journey`, `launch=index.html`, `server=server.js`, `cover=coverart.png`.

| Platform feature | Status |
|---|---|
| Server script (`server.js`) | **Used.** Same-origin `/api/v1/time` (round-trip-adjusted offset drives the UTC day and Daily seed; refreshed every 5 minutes), `/api/v1/score` (authoritative replay of the command log, claimed score/status must match, content regenerated from id for ranked boards, idempotent per `sessionId`, 256 KB body cap), `/api/v1/leaderboard?board=` (top 20). Boards: `daily-YYYY-MM-DD`, `journey`, each challenge id, `practice-casual`. Static serving refuses dotfiles, `data/`, `node_modules/`, `tests/`. |
| Sessions / offline | The round runs locally; the score is posted only after the local replay verifies. Offline shows "offline · date UTC" in the top bar, uses the local clock, and reports "Score not submitted (offline)". |
| Identity / profile | **Used when hosted.** `js/platform.js` reads `#game_token=<jwt>` from the URL fragment (stripped after the read; query forms for local dev), decodes `sub` + `game_scope` (never hard-coded), sends it as `Authorization: Bearer` on every hosted call, and re-mints it every 45 min via `POST /api/v1/games/{slug}/launch-token` (60 s retry). The top bar shows "<nickname> · sync status · day UTC" from `GET /api/v1/users/{sub}/profile` (never usernames, never `/api/v1/me`; `Player <id8>` fallback); score submissions carry the account nickname + id. Offline keeps the local "Guest" name and the online/offline status. |
| Presence, invitations, realtime rooms, chat, voice | **Not used** — solo ruleset. |
| Achievements | Local, in `localStorage` (`cwj:v1`), not published to the platform. |
| Cloud save | **Used when hosted**: the store document mirrors to one zip+base64 slot at `GET/PUT /api/v1/me/cloud-saves/{slug}` — remote wins on boot (version-validated), saves debounce 2 s and flush on `pagehide`/hidden with keepalive, and the top bar reflects sync status. localStorage stays the offline cache. |

## 13. Technical architecture

- **Modules:** `rules.js` (pure, versioned `RULES_VERSION=1`), `content.js` (`CONTENT_VERSION=1`, deterministic generation with a 32-attempt seeded backtracking fill using minimum-remaining-values ordering; 8 hand-authored masks proven fillable by the validators), `audio.js`, `main.js` (everything DOM/Three/session), `server.js`.
- **Determinism and replay:** command log = `[{type, …, id, at}]`; `buildEnvelope()` is the replay envelope; identical `(build, seed, commands)` yields identical `hashState`. The server re-derives Daily/Journey/Challenge defs from the id and compares seed, mode, size, cells, entry geometry, limits, par and multiplier (`contentMatches`).
- **Time:** elapsed = accrued + `performance.now()` since the last resume; paused and hidden time is excluded; `at` is stamped on every command. Par/limits are content-authored in ms.
- **Persistence:** one versioned localStorage document `cwj:v1`; unknown versions are discarded; server boards mirrored to `data/leaderboard.json` (debounced 250 ms), each board trimmed to 200 entries.
- **Performance:** DOM board of at most 81 buttons re-rendered per command; diorama ≤ ~60 meshes, DPR capped by tier, shadows only on high, render loop skipped while hidden. No per-frame allocations in the loop besides Three internals.
- **Resilience:** WebGL failure hides the canvas and shows a one-line fallback message; the game is unaffected. Missing key art or results art hides itself (`onerror`). Missing/failed audio clips fall back to synthesis permanently for that clip.
- **How the e2e drives the UI:** `tests/e2e.mjs` starts its own static server (stubbing `/api/v1/time` and `/api/v1/score`), launches Chrome via `playwright-core`, and clicks real controls: Settings (toggles High contrast and asserts `body.hc`), Help, Play → Journey → page 1, clicks two cells and presses their letters, clicks Check and Reveal (asserts a `.revealed` cell), presses Esc and clicks Resume, then solves the grid cell-by-cell from the authored solution and asserts the results headline, breakdown rows, `journey.unlocked === 2` and `stats.wins === 1` in localStorage, then Home. Desktop 1280×800 and mobile 390×844 (touch, tray buttons); any console error or page error fails the run. `PORT` pins the embedded server's port.

## 14. Testing and acceptance criteria

`npm test` (`node --test tests/*.test.mjs`, 50 tests):
- **rules:** stream determinism and bounds; createGame validation; every command's success and each rejection reason; scoring once per letter; check confirm/flag/cost; reveal lock/cost/streak break; give up; not-active after terminal; win with and without time bonus; time-limit via `at`; mistake-limit; duplicate/out-of-order ids; streak growth and reset; crossings completing two words; `getHint` preference; serialization round-trip; replay hash stability, rejection cases and tamper detection; snapshot migration sanity; `compareResults` order; fuzzed malformed commands never throw; random valid playthroughs always terminate.
- **content:** bank buckets and clues; masks square and fully covered; `generateGrid` deterministic, consistent, fills every pattern; 40 valid Journey defs; Learn tutorial ordered; Daily stable per date and weekday-driven; Practice tiers; five valid challenges; `validateAll`; `validateDef` catches structural faults; generated defs winnable through the engine; five complete themes.

`npm run test:e2e`: the playthrough in §13, both viewports, zero console errors.

QA bar (checkable): the first-time player is taught by Learn's banners or can read Help in one click; every implemented feature (all five modes, all assists, pause, settings, help, results actions) is reachable by clicking visible controls; no console errors or warnings at 1280×800 or 390×844; the board, current clue, and every primary button are fully visible at both sizes and in landscape 844×390; keyboard-only play completes a page; screen-reader users get the board summary and every error.

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

- No localization; English only (§10).
- Mobile letter entry relies on a hardware/Bluetooth keyboard or the browser's key events: cells are `<button>`s, so the on-screen keyboard does not open on tap. Assists and navigation work by touch; typing does not on a phone without a keyboard.
- The own-server `/api/v1/leaderboard` is still never read; ranked results show the submit rank, and when hosted the platform board (read via `GET /api/v1/games/{slug}` → leaderboardId → entries, nicknames resolved) renders its top 3 on the results screen.
- `assists.undo` in content defs is unused; there is no undo command (Backspace clears).
- Journey wins post to a single shared `journey` board regardless of page, so a page-40 score and a page-1 score compete.
- Achievements and journey progress live only in the browser's localStorage; clearing site data resets them.
- Time-limit detection happens through a watchdog letter command, so a `time-limit` loss records one extra typed action.
- `data/leaderboard.json` ships empty (0 bytes); the server logs a one-line "leaderboard load failed, starting empty" warning at start and proceeds.
- Ambience and music are synthesized, not authored, and do not vary by theme.
- No gamepad support.

## 17. Design intent not yet implemented

- Localized string tables and per-locale word banks for en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT, with the language chosen from `navigator.languages` and overridable in Settings.
- A Leaderboard screen (global and friends-filtered) reading the own-server `/api/v1/leaderboard` for the Daily, each challenge and Journey per page, beyond the platform board snippet.
- Tap-to-type on touch devices via a hidden focused text input or an on-screen letter tray.
- Presence heartbeats and platform-published achievements through the StarHermit API (identity and cloud-saved progression are done).
- Authored per-theme ambience loops (harbor gulls and water, pine wind, desert wind, frost hush, orchard rail) on the ambience bus.
