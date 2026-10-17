// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in the real Settings
// screen, opens Journey page 1 and keeps typing the solution through visible cell taps and key
// presses (word confirmations, the diorama's water, fireflies, lantern and the post chain all run),
// retrying the page from the results screen.
import { journeyStage } from '../js/content.js';

export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

const def = journeyStage(1);
const SOLUTION = [];
{
  const seen = new Set();
  for (const e of def.entries) for (const i of e.cells) if (!seen.has(i)) { seen.add(i); SOLUTION.push({ i, ch: def.cells[i] }); }
}

export async function setPreset(page, preset) {
  await page.waitForSelector('body[data-gfx-ready="true"]', { timeout: 20000 });
  await page.click('#nav-settings');
  await page.waitForSelector('#screen-settings:not([hidden])');
  await page.locator('#set-quality').scrollIntoViewIfNeeded();
  await page.selectOption('#set-quality', preset);
  await page.waitForSelector(`body[data-gfx-preset="${preset}"]`);
  await page.click('#btn-settings-back');
}

export async function start(page) {
  await page.click('#btn-play');
  await page.waitForSelector('#screen-modes:not([hidden])');
  await page.locator('#mode-list .mode-item', { hasText: 'Journey' }).first().click();
  await page.locator('#mode-list .mode-item', { hasText: '1.' }).first().click();
  await page.waitForSelector('#screen-play:not([hidden])');
  let open = true, k = 0;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try {
        if (await page.locator('#screen-results:not([hidden])').count()) {
          await page.click('#btn-retry', { timeout: 5000 });
          await page.waitForSelector('#screen-play:not([hidden])', { timeout: 5000 });
          k = 0;
        } else {
          const { i, ch } = SOLUTION[k++ % SOLUTION.length];
          const cell = page.locator(`#board .cell[data-index="${i}"]`);
          const cls = (await cell.getAttribute('class', { timeout: 5000 })) || '';
          if (!cls.includes('confirmed') && !cls.includes('revealed')) {
            await cell.click({ timeout: 5000 });
            await page.keyboard.press(ch.toLowerCase());
          }
        }
        await page.waitForTimeout(250);
      } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
    }
  })();
  await page.waitForTimeout(1000);
}
