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
export type Tracking = 'Solo finale' | 'Round per round' | 'Flessibile';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A game of the totem in a grid or a chip row: «301 chiusura esatta», not «301 Masters …». */
export const gameRadio = (page: Page, game: string) =>
  page.getByRole('radio', { name: new RegExp(`^${escape(game)}( [a-z0-9]|$)`) }).first();

/** New match, step 2: type a name, Enter, the search field is ready for the next player. */
export async function addPlayers(page: Page, names: string[]) {
  await page.getByRole('button', { name: 'Aggiungi giocatore' }).click();
  const field = page.getByLabel('Cerca tra i giocatori del locale');
  for (const name of names) {
    await field.fill(name);
    await field.press('Enter');
    // Read atomically: the sheet can unmount between count() and inputValue().
    await expect
      .poll(() =>
        field.evaluateAll(
          (inputs) => inputs.length === 0 || (inputs[0] as HTMLInputElement).value === '',
        ),
      )
      .toBe(true);
  }
  const close = page.getByRole('button', { name: 'Chiudi', exact: true });
  if (await close.isVisible()) await close.click();
}
/** New tournament, step 2: players created from the sheet are registered in order (seed). */
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
/** The «Continua» of the tournament wizard, or «Riepilogo» on the rules step. */
export async function nextStep(page: Page) {
  await page.getByRole('button', { name: /^(Continua|Riepilogo)/ }).click();
}
/**
 * Nuovo torneo through the five steps. `configure` runs on the steps 3 and 4 (heats or groups,
 * then rules) before moving on; the summary starts the tournament unless `start` is false.
 */
export async function newTournament(
  page: Page,
  options: {
    format: 'Hi-Score rapido' | 'Gironi' | 'Partita singola';
    name?: string;
    game?: string;
    players: string[];
    tracking?: Tracking;
    groups?: (page: Page) => Promise<void>;
    rules?: (page: Page) => Promise<void>;
    start?: boolean;
  },
) {
  await page.goto('/tornei/nuovo');
  await atBt(page);
  await page.getByRole('radio', { name: new RegExp(`^${options.format}`) }).click();
  if (options.name) await page.getByLabel('Nome', { exact: true }).fill(options.name);
  if (options.game) await gameRadio(page, options.game).click();
  await nextStep(page);
  await addEntrants(page, options.players);
  await nextStep(page);
  await options.groups?.(page);
  await nextStep(page);
  if (options.tracking)
    await page.getByRole('radio', { name: new RegExp(`^${options.tracking}`) }).click();
  await options.rules?.(page);
  await nextStep(page);
  await expect(page.getByRole('heading', { name: 'Pronti a lanciare' })).toBeVisible();
  if (options.start === false) return;
  await page.getByRole('button', { name: 'Avvia torneo' }).click();
}
/** Tracking of a new match (step 1) or of a tournament (rules step). */
export async function chooseTracking(page: Page, label: Tracking) {
  await page.getByRole('radio', { name: new RegExp(`^${label}`) }).click();
}
export const banner = (page: Page) => page.locator('.turn-banner');
/** The official result: the Risultati tab of a guided match, or the result screen itself. */
export async function openFinalResult(page: Page) {
  // Wait for the match screen: the guided one or the result screen.
  await expect(page.locator('.match-screen, .result-screen').first()).toBeVisible();
  const tab = page.getByRole('link', { name: 'Risultati', exact: true });
  if (await tab.isVisible()) await tab.click();
}
/** Hi-Score: the totem's final total of the player in entry, typed on the keypad. */
export async function enterScore(page: Page, player: string, score: number) {
  await openFinalResult(page);
  await expect(banner(page)).toHaveText(`PUNTEGGIO DI ${player}`);
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeEnabled();
  await page.keyboard.type(String(score));
  await expect(page.getByLabel('Punteggio finale da confermare')).toHaveText(String(score));
  await page.getByRole('button', { name: `Conferma il punteggio di ${player}` }).click();
  // Saved only once the commit completed: the player's row (or podium step, once the match
  // is over) then shows the official total.
  const row = page
    .locator('.result-rows .rk, .result-done .rk, .pod li')
    .filter({ has: page.getByText(player, { exact: true }) })
    .first();
  await expect(row.locator(':scope > strong, :scope > b')).toHaveText(String(score));
}
/** A free match of the totem, started from its two steps. */
export async function freeMatch(
  page: Page,
  game: string,
  names: string[],
  tracking: boolean | Tracking = false,
) {
  await page.goto('/partite/nuova');
  await atBt(page);
  await gameRadio(page, game).click();
  await chooseTracking(
    page,
    tracking === true ? 'Flessibile' : tracking === false ? 'Solo finale' : tracking,
  );
  await page.getByRole('button', { name: 'Scegli i giocatori' }).click();
  await addPlayers(page, names);
  await page.getByRole('button', { name: 'Avvia partita' }).click();
  await expect(page).toHaveURL(/\/partite\/[0-9a-f-]{36}$/);
}

/**
 * Answers the first question of the new match and new tournament wizards: «Sì, siamo al BT».
 * A new match then moves on to the game; a tournament keeps the same step.
 */
export async function atBt(page: Page) {
  // The shared server has a single play space: the question is not asked and the wizard starts
  // at the game (or, for a tournament, at its format).
  await page
    .getByRole('heading', {
      name: /State giocando al Bite the Trouble\?|A cosa giocate\?|Che serata è\?/,
    })
    .first()
    .waitFor();
  const yes = page.getByRole('radio', { name: /Sì, siamo al BT/ });
  if (!(await yes.isVisible())) return;
  await yes.click();
  const next = page.getByRole('button', { name: 'Scegli il gioco' });
  if (await next.isVisible()) await next.click();
}
