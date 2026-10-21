import { expect, test, type Page } from '@playwright/test';
import {
  addPlayers,
  freeMatch,
  enterScore,
  guardNetwork,
  addEntrants,
  chooseTracking,
} from './helpers';
const names = (n: number) =>
  Array.from({ length: n }, (_, i) => `Seat${String(i + 1).padStart(2, '0')}`);
const editor = (page: Page) => page.getByRole('dialog', { name: 'Organizza manche' });
const slot = (page: Page, heat: number, position: number) =>
  editor(page).getByRole('button', { name: new RegExp(`^Manche ${heat}, slot ${position}:`) });

test('custom slots, swaps, heat order, reset and offline reopening at 320px', async ({
  page,
  context,
}) => {
  const guard = guardNetwork(page);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/partite/nuova');
  await addPlayers(page, names(13));
  await page.getByRole('radio', { name: 'Personalizzata', exact: true }).click();
  await page.getByRole('button', { name: 'INIZIA PARTITA' }).click();
  await page.getByRole('button', { name: 'CONFERMA E INIZIA' }).click();
  await expect(editor(page)).toBeVisible();
  expect(
    await editor(page)
      .locator('.segmented button')
      .evaluateAll((buttons) =>
        buttons.every((button) => button.scrollWidth <= button.clientWidth),
      ),
  ).toBe(true);
  await expect(editor(page).locator('.heat-slot')).toHaveCount(16);
  await expect(slot(page, 4, 4)).toContainText('libero');
  await slot(page, 1, 1).click();
  await slot(page, 4, 4).click();
  await expect(slot(page, 1, 1)).toContainText('libero');
  await slot(page, 1, 2).click();
  await slot(page, 1, 3).click();
  await editor(page).getByRole('button', { name: 'Anticipa manche 4' }).click();
  await editor(page).getByRole('button', { name: 'Nuova manche', exact: true }).click();
  await expect(
    editor(page).getByRole('button', { name: 'Conferma organizzazione' }),
  ).toBeDisabled();
  await editor(page).getByRole('button', { name: 'Elimina manche 5' }).click();
  await editor(page).getByRole('radio', { name: 'Bilanciata', exact: true }).click();
  await editor(page).getByRole('button', { name: 'Ripristina distribuzione' }).click();
  await expect(slot(page, 1, 1)).toContainText('Seat01');
  await slot(page, 4, 1).click();
  await slot(page, 4, 4).click();
  await editor(page).getByRole('button', { name: 'Anticipa manche 4' }).click();
  await editor(page).getByRole('button', { name: 'Anticipa manche 3' }).click();
  await editor(page).getByRole('button', { name: 'Anticipa manche 2' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await editor(page).evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: '../../docs/release/screenshots-v1.3.1/organizza-320.png',
    fullPage: false,
  });
  await editor(page).getByRole('button', { name: 'Conferma organizzazione' }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator('.g-now h2')).toHaveText('Seat13');
  await expect(page.locator('.g-now')).toContainText('Slot 4');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.g-now h2')).toHaveText('Seat13');
  await page.getByRole('button', { name: 'Organizza manche', exact: true }).click();
  await expect(slot(page, 1, 4)).toContainText('Seat13');
  await expect(slot(page, 1, 1)).toContainText('libero');
  await editor(page).getByRole('button', { name: 'Chiudi', exact: true }).click();
  // The singleton heat advances to its own next round, with no phantom seats.
  await page.getByRole('radio', { name: 'Totale', exact: true }).click();
  await page.keyboard.type('60');
  await page.locator('.g-ctas .cta').click();
  await expect(page.locator('.g-next')).toContainText('Round 2');
  await page.locator('.g-next').click();
  await page.getByRole('button', { name: 'Organizza manche', exact: true }).click();
  await expect(slot(page, 1, 4)).toBeDisabled();
  await expect(editor(page)).toContainText('composizione e ordine protetti');
  await slot(page, 2, 1).click();
  await slot(page, 2, 2).click();
  await editor(page).getByRole('button', { name: 'Conferma organizzazione' }).click();
  await expect(page.locator('.g-now h2')).toHaveText('Seat13');
  expect(guard.api).toEqual([]);
  expect(guard.errors).toEqual([]);
});

test('eleven players finish 4+4+3 with official results', async ({ page }) => {
  const guard = guardNetwork(page);
  const players = names(11);
  await freeMatch(page, 'Hi-Score', players);
  await expect(page.getByRole('radio', { name: /^M\d/ })).toHaveCount(3);
  for (let i = 0; i < players.length; i++) {
    if (i && i % 4 === 0)
      await page.getByRole('button', { name: `AVVIA MANCHE ${i / 4 + 1}` }).click();
    await enterScore(page, players[i]!, 300 + i);
  }
  await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
  expect(guard.errors).toEqual([]);
  expect(guard.api).toEqual([]);
});

test('thirteen players complete guided scoring including the last singleton heat', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const players = names(13);
  const guard = guardNetwork(page);
  await freeMatch(page, 'Hi-Score', players, 'Round per round');
  await expect(page.getByRole('radio', { name: /^M\d/ })).toHaveCount(4);
  for (let h = 0; h < 4; h++) {
    if (h) {
      await page.getByRole('button', { name: `AVVIA MANCHE ${h + 1}` }).click();
      await page.getByRole('link', { name: 'Live', exact: true }).click();
      await page.getByRole('radio', { name: new RegExp(`^M${h + 1}`) }).click();
    }
    const seats = players.slice(h * 4, h * 4 + 4);
    await page.getByRole('radio', { name: 'Totale', exact: true }).click();
    for (let round = 1; round <= 7; round++) {
      for (const p of seats) {
        await expect(page.locator('.g-now h2')).toHaveText(p);
        await page.keyboard.type(String(10 + players.indexOf(p)));
        await page.locator('.g-ctas .cta').click();
      }
      if (round < 7) await page.locator('.g-next').click();
    }
    for (const p of seats) await enterScore(page, p, 7 * (10 + players.indexOf(p)));
  }
  await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
  expect(guard.errors).toEqual([]);
  expect(guard.api).toEqual([]);
});

test('fifteen entrants qualify globally across 4+4+4+3 and play a four-seat final', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const players = names(15);
  await page.goto('/tornei/nuovo');
  await page.getByRole('radio', { name: 'Hi-Score rapido' }).click();
  await addEntrants(page, players);
  await chooseTracking(page, 'Solo finale');
  await page.getByRole('button', { name: 'AVVIA TORNEO' }).click();
  await expect(page).toHaveURL(/\/hiscore\//);
  const url = page.url();
  await page.getByRole('link', { name: 'Gioca l’incontro' }).click();
  for (let i = 0; i < players.length; i++) {
    if (i && i % 4 === 0)
      await page.getByRole('button', { name: `AVVIA MANCHE ${i / 4 + 1}` }).click();
    await enterScore(page, players[i]!, 300 + i);
  }
  await page.goto(url);
  await page.getByRole('button', { name: 'CONFERMA QUALIFICA' }).click();
  await page.getByRole('button', { name: 'VAI ALLA FINALE' }).click();
  await page.getByRole('button', { name: 'GENERA FINALE' }).click();
  await page.getByRole('link', { name: 'GIOCA LA FINALE' }).click();
  await expect(page.locator('.score-card .player-name')).toHaveText(players.slice(-4));
  for (const [i, p] of players.slice(-4).entries()) await enterScore(page, p, 400 + i);
  await expect(page.getByRole('heading', { name: 'Risultato registrato' })).toBeVisible();
});
