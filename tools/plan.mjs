// A keyboard solve of a page, as native/main.ts plays it: from the round's
// first square (Across), type the letters each entry still needs (the cursor
// skips to the next empty square of the entry after each letter, as
// advanceAfterLetter does), then Enter to the next clue, until the grid is
// complete. Used by tools/gen-play.mjs (play scripts) and
// tools/browser-play.mjs (keyboard runs in Chrome).
//   plan(def) → [{ type: 'COW' } | { key: 'Enter' }, …]
import * as R from '../js/rules.js';

export function plan(def, { check = false, reveal = false, after = 1 } = {}) {
  let st = R.createGame(def);
  let id = 1;
  const apply = (cmd) => { const r = R.applyCommand(st, { ...cmd, id: id++, at: 0 }); if (r.error) throw new Error(r.error); st = r.state; };
  const entriesAt = (i) => { const o = { across: -1, down: -1 }; def.entries.forEach((e, k) => { if (e.cells.includes(i)) o[e.dir] = k; }); return o; };
  const sel = { cell: def.cells.findIndex((c) => c !== null), dir: 'across' };
  const cur = () => { const a = entriesAt(sel.cell); return a[sel.dir] >= 0 ? a[sel.dir] : a.across >= 0 ? a.across : a.down; };
  const steps = [];
  let typed = '';
  const flush = () => { if (typed) steps.push({ type: typed }); typed = ''; };
  let done = 0;
  for (let guard = 0; st.status === 'active' && guard < 500; guard++) {
    const ei = cur();
    const cells = def.entries[ei].cells;
    if (!R.entryComplete(st, ei)) {
      // type from the cursor until the entry is complete
      for (let g = 0; !R.entryComplete(st, ei) && st.status === 'active' && g < 50; g++) {
        let i = sel.cell;
        if (!R.canType(st, i)) {
          // a locked square (confirmed or revealed): step along the entry with the arrow keys
          const pos0 = cells.indexOf(i);
          const nx = cells.slice(pos0 + 1).find((c) => R.canType(st, c));
          if (nx === undefined) break;
          flush();
          const arrow = def.entries[ei].dir === 'across' ? 'ArrowRight' : 'ArrowDown';
          for (let k = pos0; k < cells.indexOf(nx); k++) steps.push({ key: arrow });
          sel.cell = i = nx;
        }
        apply({ type: 'letter', cell: i, ch: st.cells[i].sol });
        typed += st.cells[i].sol;
        const pos = cells.indexOf(i);
        let next = null;
        for (let k = pos + 1; k < cells.length; k++) if (R.canType(st, cells[k]) && st.cells[cells[k]].cur === '') { next = cells[k]; break; }
        if (next === null) for (let k = pos + 1; k < cells.length; k++) if (R.canType(st, cells[k])) { next = cells[k]; break; }
        if (next === null) break;
        sel.cell = next;
      }
      done++;
      const first = done === after;
      if (first && check) { flush(); steps.push({ action: 'check' }); apply({ type: 'check', scope: 'word', entry: ei }); }
      if (first && reveal && st.status === 'active') {
        flush();
        const h = R.getHint(st, null);
        steps.push({ action: 'reveal' });
        apply({ type: 'reveal', cell: h.cell });
        sel.cell = h.cell;
      }
    }
    if (st.status !== 'active') break;
    flush();
    steps.push({ key: 'Enter' });
    const n = def.entries.length;
    const nx = def.entries[(cur() + 1) % n];
    sel.cell = nx.cells[0]; sel.dir = nx.dir;
  }
  flush();
  if (st.status !== 'won') throw new Error(`plan did not finish ${def.id}: ${st.status}`);
  return { steps, state: st };
}
