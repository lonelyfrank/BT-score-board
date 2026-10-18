import { expect, test, type Page } from '@playwright/test';

// Standalone mode: static build, no backend. Any request to /api would be a regression.
function guardNetwork(page: Page) {
  const api: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api')) api.push(request.url());
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { api, errors };
}
/** Several players in one sheet: type a name, Enter, the field is ready for the next one. */
async function addPlayers(page: Page, names: string[]) {
  await page.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  const field = page.getByLabel('Nuovo giocatore');
  for (const name of names) {
    await field.fill(name);
    await field.press('Enter');
    await expect(field).toHaveValue('');
    await expect(field).toBeFocused();
  }
  await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
}
async function reduceTurnsTo1(page: Page, from: number) {
  for (let i = from; i > 1; i--)
    await page.getByRole('button', { name: 'Riduci Turni per giocatore' }).click();
}
const banner = (page: Page) => page.locator('.turn-banner');
/** Enters a total on the keypad and waits until the save moved the turn on. */
async function scoreTurn(page: Page, score: number, next: string | 'end') {
  // The keyboard reaches the keypad once the live screen is ready for input.
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeEnabled();
  await page.keyboard.type(String(score));
  await expect(page.getByLabel('Punteggio da confermare')).toHaveText(String(score));
  await page.getByRole('button', { name: 'Conferma turno' }).click();
  if (next === 'end')
    await expect(page.getByRole('heading', { name: 'Incontro terminato' })).toBeVisible();
  else await expect(banner(page)).toHaveText(`TURNO DI ${next}`);
}
async function playMatch(page: Page, turns: [string, number][]) {
  await page.getByRole('button', { name: 'Inizia incontro' }).click();
  await expect(banner(page)).toHaveText(`TURNO DI ${turns[0]![0]}`);
  for (let i = 0; i < turns.length; i++)
    await scoreTurn(page, turns[i]![1], turns[i + 1]?.[0] ?? 'end');
  await page.getByRole('link', { name: 'VAI ALLA CLASSIFICA' }).click();
}

test('Quick High Score for 8 players with playoff, final and official results after reopening', async ({
  page,
  context,
}) => {
  const guard = guardNetwork(page);
  const players = ['Ada', 'Bruno', 'Carla', 'Dario', 'Elsa', 'Fabio', 'Gaia', 'Ivo'];
  const scores = [100, 90, 80, 70, 70, 50, 40, 30];
  await page.goto('/');
  await page.getByRole('link', { name: /NUOVO TORNEO/ }).click();
  await addPlayers(page, players);
  await reduceTurnsTo1(page, 8);
  await expect(page.getByText('Un solo girone di qualifica. I 4 migliori')).toBeVisible();
  await page.getByRole('button', { name: 'AVVIA TORNEO' }).click();
  await page.getByRole('button', { name: 'Conferma e inizia' }).click();
  await expect(page).toHaveURL(/\/hiscore\//);
  const tournamentUrl = page.url();
  await page.getByRole('link', { name: /Gioca l’incontro/ }).click();
  await page.getByRole('button', { name: 'Inizia incontro' }).click();
  for (let i = 0; i < 3; i++) await scoreTurn(page, scores[i]!, players[i + 1]!);

  // Refresh mid-qualification: same player at the oche, no score lost or duplicated.
  await page.reload();
  await expect(banner(page)).toHaveText('TURNO DI Dario');
  await page.goto('/');
  const resume = page.getByRole('link', { name: /RIPRENDI PARTITA/ });
  await expect(resume).toContainText('Al tiro Dario · Turno 1 di 1');
  await expect(resume).toContainText('Ultimo punteggio: Carla 80');
  await resume.click();
  for (let i = 3; i < 8; i++) await scoreTurn(page, scores[i]!, players[i + 1] ?? 'end');
  await page.getByRole('link', { name: 'VAI ALLA CLASSIFICA' }).click();

  // Dario and Elsa tie for the fourth place: the qualification cannot be confirmed.
  await page.getByRole('button', { name: 'CONFERMA QUALIFICA' }).click();
  await expect(page.getByRole('alert')).toContainText('Parità decisiva');
  await page.getByRole('button', { name: 'Organizza spareggio' }).click();
  await page.getByRole('checkbox', { name: /Dario/ }).check();
  await page.getByRole('checkbox', { name: /Elsa/ }).check();
  await page.getByRole('button', { name: 'Crea incontro di spareggio' }).click();
  await page.getByRole('link', { name: /Gioca l’incontro/ }).click();
  await playMatch(page, [
    ['Dario', 20],
    ['Elsa', 60],
  ]);
  await page.getByRole('button', { name: 'CONFERMA QUALIFICA' }).click();
  await page.getByRole('button', { name: 'GENERA FINALE' }).click();
  await page.getByRole('button', { name: /VAI ALLA FINALE/ }).click();
  await page.getByRole('link', { name: /Gioca l’incontro/ }).click();
  // The final starts from zero between the four qualifiers.
  await expect(page.locator('.score-card strong')).toHaveText(['0', '0', '0', '0']);
  await playMatch(page, [
    ['Ada', 40],
    ['Bruno', 100],
    ['Carla', 60],
    ['Elsa', 20],
  ]);
  await page.getByRole('button', { name: 'CONFERMA RISULTATO FINALE' }).click();
  await page.getByRole('tab', { name: /^Finale/ }).click();
  const podium = page.getByRole('region', { name: 'Podio finale' });
  await expect(podium).toContainText('Bruno');
  await expect(page.locator('.place-1')).toContainText('Bruno');

  // Close and reopen the app: the official ranking is still there.
  await page.close();
  const reopened = await context.newPage();
  const reopenedGuard = guardNetwork(reopened);
  await reopened.goto(`${tournamentUrl}?tab=ranking`);
  await expect(reopened.locator('caption').first()).toContainText('Qualifica');
  await reopened.getByRole('tab', { name: /^Finale/ }).click();
  await expect(reopened.locator('.place-1')).toContainText('Bruno');
  await expect(reopened.locator('.podium-rest')).toContainText('Dario');
  await reopened.goto('/');
  await expect(reopened.getByRole('list').filter({ hasText: 'BiteTrouble Open' })).toContainText(
    'Vince Bruno',
  );
  await expect(reopened.getByRole('link', { name: /RIPRENDI/ })).toHaveCount(0);
  expect([...guard.api, ...reopenedGuard.api]).toEqual([]);
  expect([...guard.errors, ...reopenedGuard.errors]).toEqual([]);
});

test('group tournament through groups, knockout final and results, then reload', async ({
  page,
}) => {
  const guard = guardNetwork(page);
  await page.goto('/tornei/nuovo');
  await page.getByRole('radio', { name: 'A gironi', exact: true }).click();
  await addPlayers(page, ['Marco', 'Davide', 'Sara', 'Elena']);
  await reduceTurnsTo1(page, 8);
  await page.getByRole('button', { name: 'Riduci Qualificati per girone' }).click();
  await page.getByRole('button', { name: 'AVVIA TORNEO' }).click();
  await page.getByRole('button', { name: 'Conferma e inizia' }).click();
  await expect(page).toHaveURL(/\/tornei\//);
  await page.getByRole('tab', { name: 'Gironi' }).click();
  // Snake distribution: Marco–Elena in group 1, Davide–Sara in group 2.
  await expect(page.getByRole('link', { name: /Gioca l’incontro/ })).toHaveCount(2);
  await page
    .getByRole('link', { name: /Gioca l’incontro/ })
    .first()
    .click();
  await playMatch(page, [
    ['Marco', 120],
    ['Elena', 60],
  ]);
  await page.getByRole('tab', { name: 'Gironi' }).click();
  await page
    .getByRole('link', { name: /Gioca l’incontro/ })
    .first()
    .click();
  await playMatch(page, [
    ['Davide', 80],
    ['Sara', 100],
  ]);
  await page.getByRole('button', { name: 'CONFERMA QUALIFICA' }).click();
  await page.getByRole('button', { name: 'GENERA FINALE' }).click();
  await page.getByRole('tab', { name: 'Finale', exact: true }).click();
  await page.getByRole('link', { name: /Gioca l’incontro/ }).click();
  await playMatch(page, [
    ['Marco', 140],
    ['Sara', 180],
  ]);
  await page.getByRole('button', { name: 'CONFERMA RISULTATO FINALE' }).click();
  await page.getByRole('tab', { name: 'Finale', exact: true }).click();
  await expect(page.locator('.place-1')).toContainText('Sara');
  await page.reload();
  await expect(page.locator('.place-1')).toContainText('Sara');
  await expect(page.locator('.place-2')).toContainText('Marco');
  await page.getByRole('tab', { name: 'Classifica' }).click();
  await expect(page.locator('caption')).toHaveCount(3);
  expect(guard.api).toEqual([]);
  expect(guard.errors).toEqual([]);
});

test('backup export and import onto a new device, with confirmation before replacing data', async ({
  page,
  browser,
}) => {
  await page.goto('/partite/nuova');
  await addPlayers(page, ['Nora', 'Otto']);
  await page.getByRole('button', { name: 'INIZIA PARTITA' }).click();
  await page.getByRole('button', { name: 'Conferma e inizia' }).click();
  await scoreTurn(page, 140, 'Otto');
  await page.goto('/impostazioni');
  await expect(page.getByText('Giocatori · tornei')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Esporta backup' }).click();
  const file = await (await download).path();
  await expect(page.getByRole('status').filter({ hasText: 'Backup salvato' })).toBeVisible();

  // A fresh browser profile is a new device.
  const device = await browser.newContext({ baseURL: 'http://127.0.0.1:3108' });
  const other = await device.newPage();
  await other.goto('/giocatori');
  await other.getByLabel('Nuovo giocatore').fill('Solo qui');
  await other.getByLabel('Nuovo giocatore').press('Enter');
  await expect(other.getByRole('button', { name: /Solo qui/ })).toBeVisible();
  await other.goto('/impostazioni');
  await other.getByLabel('Importa backup').setInputFiles(file);
  const dialog = other.getByRole('dialog', { name: 'Ripristinare questo backup?' });
  await expect(dialog).toContainText('2 giocatori, 1 torneo');
  await expect(dialog).toContainText('Sostituirà tutti i dati attuali');
  await dialog.getByRole('button', { name: 'Sostituisci i dati' }).click();
  await expect(other.getByText('Backup ripristinato')).toBeVisible();
  await other.goto('/');
  await other.getByRole('link', { name: /RIPRENDI PARTITA/ }).click();
  await expect(banner(other)).toHaveText('TURNO DI Otto');
  await other.goto('/giocatori');
  await expect(other.getByRole('button', { name: /Solo qui/ })).toHaveCount(0);
  await device.close();
});

test('a double tap on confirm records one turn only', async ({ page }) => {
  await page.goto('/partite/nuova');
  await addPlayers(page, ['Pia', 'Rino']);
  await page.getByRole('button', { name: 'INIZIA PARTITA' }).click();
  await page.getByRole('button', { name: 'Conferma e inizia' }).click();
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeEnabled();
  await page.keyboard.type('60');
  await page.getByRole('button', { name: 'Conferma turno' }).dblclick();
  await expect(banner(page)).toHaveText('TURNO DI Rino');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.recent li strong').first()).toHaveText('60');
  await expect(page.locator('.recent li strong').nth(1)).toHaveText('-');
});
