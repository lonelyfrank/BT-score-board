import { expect, test, type Page } from '@playwright/test';
import { addPlayers, enterScore, freeMatch, guardNetwork, newTournament, atBt } from './helpers';
const names = (n: number) =>
  Array.from({ length: n }, (_, i) => `Seat${String(i + 1).padStart(2, '0')}`);
const editor = (page: Page) => page.getByRole('dialog', { name: 'Organizza manche' });
const slot = (page: Page, heat: number, position: number) =>
  editor(page).getByRole('button', { name: new RegExp(`^Manche ${heat}, slot ${position}:`) });
const atBoard = (page: Page) => page.locator('.now h2');
/** From Live: the heat organizer sits in the turn controls. */
async function organize(page: Page) {
  await page.getByRole('button', { name: 'Controlli del turno' }).click();
  await page.getByRole('button', { name: /^Organizza manche/ }).click();
}

test('custom slots, swaps, heat order, reset and offline reopening at 320px', async ({
  page,
  context,
}) => {
  const guard = guardNetwork(page);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/partite/nuova');
  await atBt(page);
  await page.getByRole('button', { name: 'Scegli i giocatori' }).click();
  await addPlayers(page, names(13));
  await page.getByRole('radio', { name: 'Manuale', exact: true }).click();
  await page.getByRole('button', { name: 'Avvia partita' }).click();
  await expect(editor(page)).toBeVisible();
  expect(
    await editor(page)
      .locator('.seg button')
      .evaluateAll((buttons) =>
        buttons.every((button) => button.scrollWidth <= button.clientWidth),
      ),
  ).toBe(true);
  await expect(editor(page).locator('.heat-slots .slot')).toHaveCount(16);
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
  await editor(page)
    .locator('.sh-body')
    .evaluate((el) => {
      el.scrollTop = 0;
    });
  await page.screenshot({
    path: '../../docs/release/screenshots-v1.4/organizza-320.png',
    fullPage: false,
  });
  await editor(page).getByRole('button', { name: 'Conferma organizzazione' }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(atBoard(page)).toHaveText('Seat13');
  await expect(page.locator('.now')).toContainText('posto 4');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(atBoard(page)).toHaveText('Seat13');
  await organize(page);
  await expect(slot(page, 1, 4)).toContainText('Seat13');
  await expect(slot(page, 1, 1)).toContainText('libero');
  await editor(page).getByRole('button', { name: 'Chiudi', exact: true }).click();
  // The singleton heat advances to its own next round, with no phantom seats.
  await page.getByRole('radio', { name: 'Totale', exact: true }).click();
  await page.keyboard.type('60');
  await page.getByRole('button', { name: 'Conferma il turno di Seat13' }).click();
  await expect(page.locator('.strip .rd')).toContainText('Round 2/');
  await organize(page);
  // The heat at the board is protected: listed, not editable.
  await expect(slot(page, 1, 4)).toHaveCount(0);
  await expect(editor(page).locator('.locked-heats')).toContainText('Seat13');
  await slot(page, 2, 1).click();
  await slot(page, 2, 2).click();
  await editor(page).getByRole('button', { name: 'Conferma organizzazione' }).click();
  await expect(atBoard(page)).toHaveText('Seat13');
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
  await page.getByRole('link', { name: 'Matrice', exact: true }).click();
  await expect(page.getByRole('radio', { name: /^M\d/ })).toHaveCount(4);
  await page.getByRole('link', { name: 'Live', exact: true }).click();
  for (let h = 0; h < 4; h++) {
    const seats = players.slice(h * 4, h * 4 + 4);
    if (h) {
      // The end of the previous heat calls the next one to the totem.
      await page.getByRole('link', { name: 'Live', exact: true }).click();
      await page.getByRole('button', { name: `Inizia Manche ${h + 1}` }).click();
    }
    await page.getByRole('radio', { name: 'Totale', exact: true }).click();
    for (let round = 1; round <= 7; round++) {
      for (const p of seats) {
        await expect(atBoard(page)).toHaveText(p);
        await page.keyboard.type(String(10 + players.indexOf(p)));
        await page.getByRole('button', { name: `Conferma il turno di ${p}` }).click();
        // Saved: the digits are cleared (a single seat keeps the same name at the board).
        if (round < 7 || p !== seats.at(-1))
          await expect(page.getByLabel('Valore del turno da confermare')).toHaveText('–');
      }
    }
    await expect(page.locator('.heat-end-head')).toContainText(`Manche ${h + 1} chiusa!`);
    await page.getByRole('button', { name: /Totali del totem/ }).click();
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
  await newTournament(page, {
    format: 'Hi-Score rapido',
    players,
    tracking: 'Solo finale',
    groups: (p) => p.getByRole('radio', { name: 'Riempi', exact: true }).click(),
  });
  // The qualification opens at once on its first heat.
  await expect(page).toHaveURL(/\/partite\//);
  for (let i = 0; i < players.length; i++) {
    if (i && i % 4 === 0)
      await page.getByRole('button', { name: `AVVIA MANCHE ${i / 4 + 1}` }).click();
    await enterScore(page, players[i]!, 300 + i);
  }
  await page.getByRole('link', { name: 'VAI AL TORNEO' }).click();
  await page.getByRole('button', { name: 'CONFERMA QUALIFICA' }).click();
  await page.getByRole('button', { name: 'VAI ALLA FINALE' }).click();
  await page.getByRole('button', { name: 'GENERA FINALE' }).click();
  await page.getByRole('link', { name: 'GIOCA LA FINALE' }).click();
  await expect(page.locator('.result-rows .rk .nm b')).toHaveText(players.slice(-4));
  for (const [i, p] of players.slice(-4).entries()) await enterScore(page, p, 400 + i);
  await expect(page.getByRole('heading', { name: 'Risultato registrato' })).toBeVisible();
});
