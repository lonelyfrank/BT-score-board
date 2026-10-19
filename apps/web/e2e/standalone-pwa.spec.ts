import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const banner = (page: Page) => page.locator('.turn-banner');
async function controlled(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);
}
/** A two-player Hi-Score match, left with the first player's total saved. */
async function matchInProgress(page: Page, names: [string, string]) {
  await page.goto('/partite/nuova');
  await page.getByRole('button', { name: 'Aggiungi giocatore' }).click();
  const field = page.getByLabel('Cerca tra i giocatori del locale');
  for (const name of names) {
    await field.fill(name);
    await field.press('Enter');
    await expect(field).toHaveValue('');
  }
  await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await page.getByRole('button', { name: 'INIZIA PARTITA' }).click();
  await page.getByRole('button', { name: 'CONFERMA E INIZIA' }).click();
  await score(page, names[0], 620);
  await expect(banner(page)).toHaveText(`PUNTEGGIO DI ${names[1]}`);
  return page.url();
}
async function score(page: Page, player: string, value: number) {
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeEnabled();
  await page.keyboard.type(String(value));
  await page.getByRole('button', { name: `Conferma il punteggio di ${player}` }).click();
  await expect(page.locator('.score-card').filter({ hasText: player })).toContainText(
    String(value),
  );
}

test('starts, navigates and saves scores offline after the first visit', async ({
  page,
  context,
}) => {
  const api: string[] = [];
  page.on('request', (r) => new URL(r.url()).pathname.startsWith('/api') && api.push(r.url()));
  await page.goto('/');
  await controlled(page);
  const matchUrl = await matchInProgress(page, ['Ugo', 'Vera']);
  await page.goto('/impostazioni');
  await expect(page.locator('.settings-row', { hasText: 'Uso senza connessione' })).toContainText(
    'Pronta',
  );

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Impostazioni' })).toBeVisible();
  // Deep link to the live match, served by the service worker's SPA fallback.
  await page.goto(matchUrl);
  await expect(banner(page)).toHaveText('PUNTEGGIO DI Vera');
  await score(page, 'Vera', 580);
  await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
  await expect(page.locator('.final-rows li.first')).toContainText('Ugo');
  // In-app navigation and further deep links, still offline.
  await page.getByRole('link', { name: 'Indietro' }).click();
  await page.getByRole('link', { name: 'Giocatori' }).click();
  await expect(page.getByRole('button', { name: /Vera/ })).toBeVisible();
  await page.goto('/tornei');
  await expect(page.getByRole('link', { name: /Partita libera/ })).toBeVisible();
  await page.goto('/pagina-che-non-esiste');
  await expect(page.getByRole('heading', { name: 'Pagina non trovata' })).toBeVisible();
  // Brand fonts and images come from the precache too.
  await page.goto('/');
  expect(await page.evaluate(() => document.fonts.check('600 23px Oswald'))).toBe(true);
  expect(
    await page.evaluate(async () =>
      (await fetch('/assets/bt-hero.jpg')).headers.get('content-type'),
    ),
  ).toContain('image/jpeg');
  expect(api).toEqual([]);
});

test('a new version waits for a safe moment and keeps the data', async ({ page }) => {
  await page.goto('/');
  await controlled(page);
  await matchInProgress(page, ['Zeno', 'Alba']);
  // Simulate a deploy: the static host now serves a different service worker.
  const worker = 'dist/sw.js';
  const original = readFileSync(worker, 'utf8');
  writeFileSync(worker, `${original}\n// next release\n`);
  try {
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    await expect
      .poll(() =>
        page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
      )
      .toBe(true);
    // Result entry is never interrupted nor covered by the notice.
    await page.waitForTimeout(500);
    await expect(page.getByText('Nuova versione disponibile')).toHaveCount(0);
    await score(page, 'Alba', 600);
    await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
    await page.goto('/tornei');
    const notice = page.getByRole('status').filter({ hasText: 'Nuova versione disponibile' });
    await expect(notice).toBeVisible();
    const reloaded = page.waitForEvent('load');
    await notice.getByRole('button', { name: 'Aggiorna' }).click();
    await reloaded;
    await expect(page.getByRole('link', { name: /Partita libera/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Partita libera/ })).toContainText('CONCLUSO');
    await expect(page.getByText('Nuova versione disponibile')).toHaveCount(0);
    expect(
      await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
    ).toBe(false);
  } finally {
    writeFileSync(worker, original);
  }
});
