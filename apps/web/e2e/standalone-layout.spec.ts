import { expect, test, type Page } from '@playwright/test';
import { enterScore, freeMatch } from './helpers';

// Layout checks on the viewports of the V1.2 checklist. Chromium emulation only: Safari iOS
// and Chrome Android on real phones remain manual checks (docs/standalone/MOBILE_CHECKLIST.md).
const viewports = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
];
const pages = ['/', '/giocatori', '/tornei', '/hiscore', '/impostazioni', '/partite/nuova'];

/** Problems found on the current page, empty when the layout holds. */
function audit(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > window.innerWidth + 1)
      problems.push(`horizontal scroll ${root.scrollWidth} > ${window.innerWidth}`);
    const nav = document.querySelector('.bottom-nav');
    if (nav) {
      for (const link of nav.querySelectorAll('a')) {
        const r = link.getBoundingClientRect();
        if (r.width < 44 || r.height < 44) problems.push(`nav target ${r.width}x${r.height}`);
        const label = link.querySelector('span')!;
        if (label.scrollWidth > link.clientWidth + 1)
          problems.push(`nav label cut: ${label.textContent}`);
      }
      // Only the content scrolls. At its end the content stays above the bar, never under it.
      // The Home is the one exception of V1.1: its decorative footer runs under the glass, its
      // controls do not.
      const main = document.querySelector('#main-content')!;
      const scroller = main.querySelector<HTMLElement>(':scope > main');
      if (root.scrollHeight > window.innerHeight + 1)
        problems.push(`page scrolls: ${root.scrollHeight} > ${window.innerHeight}`);
      scroller?.scrollTo(0, scroller.scrollHeight);
      const top = nav.getBoundingClientRect().top;
      const last = scroller?.lastElementChild?.getBoundingClientRect();
      if (scroller?.matches('main:not(.home)') && last && last.bottom > top + 1)
        problems.push(`content under the bar: ${last.bottom} > ${top}`);
      const controls = [
        ...main.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary'),
      ].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
      });
      for (const control of controls) {
        const r = control.getBoundingClientRect();
        if (r.bottom > top + 1 && r.top < window.innerHeight)
          problems.push(`covered by the bar: ${control.textContent?.trim() || control.tagName}`);
      }
      scroller?.scrollTo(0, 0);
    }
    return problems;
  });
}
/** The control is on screen and nothing (bar, toast, sheet) is drawn over its centre. */
async function reachable(page: Page, selector: string) {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      inside: r.top >= 0 && r.bottom <= window.innerHeight + 1,
      free: !!hit && (hit === el || el.contains(hit)),
      size: [Math.round(r.width), Math.round(r.height)],
    };
  });
}

test('no horizontal scroll, bar never over the controls, touch targets of 44px', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await freeMatch(page, 'Hi-Score', ['Ada', 'Bruno', 'Carla']);
  await enterScore(page, 'Ada', 410);
  const match = page.url();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const path of pages) {
      await page.goto(path);
      await expect(page.locator('#main-content h1, #main-content h2').first()).toBeVisible();
      expect(await audit(page), `${path} at ${viewport.width}x${viewport.height}`).toEqual([]);
    }
    // Result entry: full screen, the confirm button reachable and free, keys large enough.
    await page.goto(match);
    await page.keyboard.type('5');
    const key = await reachable(page, '.actionbar .btn.cta');
    expect(key, `confirm key at ${viewport.width}x${viewport.height}`).toMatchObject({
      inside: true,
      free: true,
    });
    expect(Math.min(...key.size)).toBeGreaterThanOrEqual(44);
    const digit = await reachable(page, '.keys button:first-child');
    expect(Math.min(...digit.size)).toBeGreaterThanOrEqual(44);
    expect(await audit(page)).toEqual([]);
  }
});

test.describe('touch screen', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('the bar steps aside while the virtual keyboard is open', async ({ page }) => {
    await page.goto('/giocatori');
    const nav = page.getByRole('navigation', { name: 'Navigazione principale' });
    await expect(nav).toBeVisible();
    await page.getByRole('button', { name: 'Nuovo giocatore' }).click();
    const field = page.getByLabel('Nome', { exact: true });
    await field.focus();
    await expect(nav).toBeHidden();
    await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
    await expect(nav).toBeVisible();
  });
});
