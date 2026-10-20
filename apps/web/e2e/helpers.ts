import { expect, type Page } from '@playwright/test';

// Standalone mode: static build, no backend. Any request to /api would be a regression.
export function guardNetwork(page: Page) {
  const api: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api')) api.push(request.url());
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { api, errors };
}
/** New match: type a name, Enter, the search field is ready for the next player. */
export async function addPlayers(page: Page, names: string[]) {
  await page.getByRole('button', { name: 'Aggiungi giocatore' }).click();
  const field = page.getByLabel('Cerca tra i giocatori del locale');
  for (const name of names) {
    await field.fill(name);
    await field.press('Enter');
    // Ready for the next name, or closed because the last free place was taken.
    await expect
      .poll(async () => (await field.count()) === 0 || (await field.inputValue()) === '')
      .toBe(true);
  }
  const close = page.getByRole('button', { name: 'Chiudi', exact: true });
  if (await close.isVisible()) await close.click();
}
/** New tournament: players created from the sheet are registered in order (seed). */
export async function addEntrants(page: Page, names: string[]) {
  await page.getByRole('button', { name: 'Nuovo giocatore' }).click();
  const field = page.getByLabel('Nome', { exact: true });
  for (const name of names) {
    await field.fill(name);
    await field.press('Enter');
    await expect(field).toHaveValue('');
    await expect(field).toBeFocused();
  }
  await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
  for (const name of names)
    await expect(page.getByRole('button', { name: new RegExp(name), pressed: true })).toBeVisible();
}
export const banner = (page: Page) => page.locator('.turn-banner');
/** Tracking of a new match or tournament, from its advanced options. */
export async function chooseTracking(
  page: Page,
  label: 'Solo finale' | 'Round per round' | 'Flessibile',
) {
  await page.locator('details.advanced summary').click();
  await page.getByRole('radio', { name: label, exact: true }).click();
}
export const useFlexibleTracking = (page: Page) => chooseTracking(page, 'Flessibile');
/** The official result: the Risultati tab of a guided match, or the result screen itself. */
export async function openFinalResult(page: Page) {
  // Wait for the match screen: the guided one or the result screen.
  await expect(page.locator('.guided-page, .result-page').first()).toBeVisible();
  const tab = page.getByRole('link', { name: 'Risultati', exact: true });
  if (await tab.isVisible()) await tab.click();
  const final = page.getByRole('radio', { name: 'Risultato finale' });
  if (await final.isVisible()) await final.click();
}
/** Hi-Score: the totem's final total of the player in entry, typed on the keypad. */
export async function enterScore(page: Page, player: string, score: number) {
  await openFinalResult(page);
  await expect(banner(page)).toHaveText(`PUNTEGGIO DI ${player}`);
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeEnabled();
  await page.keyboard.type(String(score));
  await expect(page.getByLabel('Punteggio finale da confermare')).toHaveText(String(score));
  await page.getByRole('button', { name: `Conferma il punteggio di ${player}` }).click();
  // Saved only once the commit completed: the player's row then shows the total.
  await expect(
    page
      .locator('.result-list li, .score-card, .final-rows li')
      .filter({ hasText: player })
      .first(),
  ).toContainText(String(score));
}
/** A free match recording the final result only, or with flexible rounds. */
export async function freeMatch(
  page: Page,
  game: string,
  names: string[],
  tracking: boolean | 'Solo finale' | 'Round per round' | 'Flessibile' = false,
) {
  await page.goto('/partite/nuova');
  // The label then the players («301 2–4 giocatori»), not «301 Double In/Out».
  await page.getByRole('radio', { name: new RegExp(`^${game} \\d`) }).click();
  await addPlayers(page, names);
  await chooseTracking(
    page,
    tracking === true ? 'Flessibile' : tracking === false ? 'Solo finale' : tracking,
  );
  await page.getByRole('button', { name: 'INIZIA PARTITA' }).click();
  await page.getByRole('button', { name: 'CONFERMA E INIZIA' }).click();
  await expect(page).toHaveURL(/\/partite\/[0-9a-f-]{36}$/);
}
