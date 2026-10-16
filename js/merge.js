// Crossword Journey — cloud-save conflict merge.
// When another device saved the slot first (SDK `saveconflict`), the game
// reloads the remote document and merges it with the local one, keeping the
// better of each piece of progress; settings and profile stay local.

const num = (v) => (Number.isFinite(v) ? v : 0);

export function mergeStoreDoc(local, remote) {
  if (!remote || remote.v !== 1) return local;
  const out = { ...local };
  const lj = local.journey || {}, rj = remote.journey || {};
  const stars = { ...(lj.stars || {}) };
  for (const [k, v] of Object.entries(rj.stars || {})) stars[k] = Math.max(num(stars[k]), num(v));
  out.journey = { ...lj, unlocked: Math.max(num(lj.unlocked) || 1, num(rj.unlocked) || 1), stars };
  const ach = { ...(local.achievements || {}) };
  for (const [id, at] of Object.entries(remote.achievements || {})) {
    ach[id] = ach[id] == null ? at : Math.min(num(ach[id]), num(at)); // earliest unlock
  }
  out.achievements = ach;
  const ls = local.stats || {}, rs = remote.stats || {};
  out.stats = {
    ...ls,
    wins: Math.max(num(ls.wins), num(rs.wins)),
    wordsCompleted: Math.max(num(ls.wordsCompleted), num(rs.wordsCompleted)),
    dailyDays: [...new Set([...(ls.dailyDays || []), ...(rs.dailyDays || [])])].sort(),
  };
  out.tutorialDone = !!(local.tutorialDone || remote.tutorialDone);
  return out;
}
