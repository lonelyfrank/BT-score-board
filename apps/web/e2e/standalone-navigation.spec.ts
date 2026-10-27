import { expect, test } from '@playwright/test';
import { atBt } from './helpers';

test('navigation keeps links, route ownership and browser history in sync', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Navigazione principale' });
  for (const [name, path] of [
    ['Partite', '/partite/nuova'],
    ['Tornei', '/tornei'],
    ['Hi-Score', '/hiscore'],
    ['Giocatori', '/giocatori'],
    ['Home', '/'],
  ]) {
    await nav.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const selected = nav.locator('[aria-current="page"]');
    await expect(async () => {
      const indicator = await nav.locator('.bt-nav-selection').boundingBox();
      const link = await selected.boundingBox();
      expect(Math.abs(indicator!.x - link!.x)).toBeLessThan(1.1);
      expect(Math.abs(indicator!.width - link!.width)).toBeLessThan(1.1);
    }).toPass();
  }
  await page.goBack();
  await expect(nav.getByRole('link', { name: 'Giocatori' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // A tournament is created full screen, one step at a time: no bar to leave by mistake.
  await page.goto('/tornei/nuovo');
  await atBt(page);
  await expect(nav).toHaveCount(0);
  await page.goto('/tornei/nuovo?passo=2');
  await expect(nav).toHaveCount(0);
  // Pages opened from Home belong to Home: its item marks the section, not the page.
  await page.goto('/impostazioni');
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'location');
  await expect(nav.locator('.bt-nav-selection')).toHaveCount(1);
  await page.goto('/regole');
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'location');
});

test('keyboard focus and reduced motion remain usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const nav = page.locator('.bottom-nav');
  await nav.getByRole('link', { name: 'Home' }).focus();
  await page.keyboard.press('Tab');
  const next = nav.getByRole('link', { name: 'Partite' });
  await expect(next).toBeFocused();
  expect(await next.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(next).toHaveAttribute('aria-current', 'page');
  expect(
    await nav.locator('.bt-nav-selection').evaluate((el) => ({
      transition: getComputedStyle(el).transitionDuration,
      animation: getComputedStyle(el).animationName,
    })),
  ).toEqual({ transition: '0s', animation: 'none' });
});

test('safe-area clearance and high-contrast fallback preserve geometry', async ({ page }) => {
  await page.goto('/giocatori');
  // env() is supplied by the OS; override its resolved token to emulate a 34px inset.
  await page.addStyleTag({ content: ':root { --bt-nav-bottom: 34px; }' });
  const nav = page.locator('.bottom-nav');
  const rect = await nav.boundingBox();
  expect(Math.round(page.viewportSize()!.height - rect!.y - rect!.height)).toBe(34);
  await page.emulateMedia({ contrast: 'more' });
  expect(
    await nav.locator('.bt-nav-lens').evaluate((el) => ({
      blur: getComputedStyle(el).backdropFilter,
      background: getComputedStyle(el).backgroundColor,
    })),
  ).toEqual({ blur: 'none', background: 'rgba(16, 16, 19, 0.96)' });
  expect(await nav.boundingBox()).toEqual(rect);
});

test('DEV laboratory is absent from the production application', async ({ page }) => {
  await page.goto('/glass-lab.html');
  await expect(page.getByRole('heading', { name: 'Pagina non trovata' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Glass Laboratory', exact: true })).toHaveCount(0);
});
