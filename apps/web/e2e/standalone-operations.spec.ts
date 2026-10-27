import { expect, test, type Page } from '@playwright/test';
import {
  addPlayers,
  banner,
  chooseTracking,
  enterScore,
  freeMatch,
  guardNetwork,
  newTournament,
} from './helpers';

// V1.2 operational readiness: the evenings of the acceptance checklist, end to end.

const names = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
const confirmKey = (page: Page) => page.locator('.actionbar .btn.cta');
const finalists = (page: Page) => page.locator('.result-rows .rk .nm b');
const totals = (page: Page) => page.locator('.result-rows .rk strong');
/** Final of a Hi-Score: enters whoever the screen asks for, with the score of that player. */
async function enterAsked(page: Page, scores: Record<string, number>, count: number) {
  for (let i = 0; i < count; i++) {
    const text = (await banner(page).textContent())!.replace('PUNTEGGIO DI ', '');
    await enterScore(page, text, scores[text]!);
  }
}
/** A Hi-Score night recording final totals: it opens on the qualification match. */
async function newHiScoreTournament(page: Page, players: string[]) {
  await newTournament(page, { format: 'Hi-Score rapido', players, tracking: 'Solo finale' });
  await expect(page).toHaveURL(/\/partite\//);
  const back = await page.getByRole('link', { name: 'Indietro' }).getAttribute('href');
  return new URL(back!, page.url()).href;
}

test('Hi-Score night of 19 over five heats: reload between heats, late entry, top 4 and a correction', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const guard = guardNetwork(page);
  const players = names('G', 19);
  // Distinct totals: the four best come from four different heats.
  const scores = Object.fromEntries(players.map((p, i) => [p, 300 + i]));
  Object.assign(scores, { G02: 650, G07: 700, G18: 690, G11: 600 });
  const tournamentUrl = await newHiScoreTournament(page, players);
  const qualificationUrl = page.url();
  await expect(page.getByRole('radio', { name: /^M\d/ })).toHaveCount(5);

  // Heat 1: four totals, then the screen waits for the organizer.
  for (const p of players.slice(0, 4)) await enterScore(page, p, scores[p]!);
  await expect(banner(page)).toHaveText('MANCHE 1 COMPLETATA');
  // Nothing is armed: the next heat's first total cannot overwrite G01.
  await expect(confirmKey(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'AVVIA MANCHE 2' }).click();
  await expect(page.getByRole('radio', { name: /M2.*al bersaglio/ })).toBeChecked();
  for (const p of players.slice(4, 8)) await enterScore(page, p, scores[p]!);

  // Reload between two heats: the next heat is shown, nothing lost or duplicated.
  await page.reload();
  await expect(page.getByRole('radio', { name: /M2.*giocata/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /M3.*prossima/ })).toBeChecked();
  for (const p of players.slice(8, 12)) await enterScore(page, p, scores[p]!);

  // Heat 4 closed with a missing total: an explicit, accessible confirmation.
  await page.getByRole('button', { name: 'AVVIA MANCHE 4' }).click();
  for (const p of players.slice(12, 15)) await enterScore(page, p, scores[p]!);
  await page.getByRole('button', { name: 'Completa manche' }).click();
  const closing = page.getByRole('alertdialog', { name: 'Completare la manche 4?' });
  await expect(closing).toContainText('G16');
  await closing.getByRole('button', { name: 'COMPLETA LA MANCHE' }).click();
  await expect(page.getByRole('radio', { name: /M4.*giocata · 1 da inserire/ })).toBeVisible();
  await page.getByRole('button', { name: 'AVVIA MANCHE 5' }).click();
  for (const p of players.slice(16)) await enterScore(page, p, scores[p]!);
  // The late total goes to its own heat, then the qualification is complete.
  await page.getByRole('radio', { name: /M4/ }).click();
  await enterScore(page, 'G16', scores.G16!);
  await expect(page.getByRole('heading', { name: 'Risultato registrato' })).toBeVisible();

  // One global ranking: the top four, wherever they played.
  await page.goto(tournamentUrl);
  await page.getByRole('button', { name: 'CONFERMA QUALIFICA' }).click();
  await page.getByRole('button', { name: 'VAI ALLA FINALE' }).click();
  await page.getByRole('button', { name: 'GENERA FINALE' }).click();
  await page.getByRole('link', { name: 'GIOCA LA FINALE' }).click();
  // Finalists throw in registration order (the default playing order).
  await expect(finalists(page)).toHaveText(['G02', 'G07', 'G11', 'G18']);
  await enterScore(page, 'G02', 410);

  // A correction of the qualification lists what it invalidates before anything changes.
  await page.goto(qualificationUrl);
  await page.getByRole('button', { name: 'Correggi risultato' }).click();
  await page.getByRole('radio', { name: /M5/ }).click();
  await page.getByRole('radio', { name: /G19/ }).click();
  await page.keyboard.type('720');
  await page.getByRole('button', { name: 'Conferma il punteggio di G19' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Correggere un risultato già usato?' });
  await expect(dialog).toContainText('verrà riaperta');
  await expect(dialog).toContainText('1 incontro delle fasi successive verrà annullato');
  await dialog.getByRole('button', { name: 'CORREGGI E RIAPRI' }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto(tournamentUrl);
  await page.getByRole('button', { name: 'CONFERMA QUALIFICA' }).click();
  await page.getByRole('button', { name: 'VAI ALLA FINALE' }).click();
  await page.getByRole('button', { name: 'GENERA FINALE' }).click();
  await page.getByRole('link', { name: 'GIOCA LA FINALE' }).click();
  // The new final starts from zero with the corrected qualifier in it.
  await expect(finalists(page)).toHaveText(['G02', 'G07', 'G18', 'G19']);
  await expect(totals(page)).toHaveText(['—', '—', '—', '—']);
  await enterAsked(page, { G19: 500, G07: 640, G18: 380, G02: 610 }, 4);
  await page.getByRole('link', { name: 'VAI AL TORNEO' }).click();
  await page.getByRole('button', { name: 'CONFERMA RISULTATO FINALE' }).click();
  await page.getByRole('tab', { name: 'Risultati' }).click();
  await expect(page.locator('.pod .p1')).toContainText('G07');
  expect(guard.api).toEqual([]);
  expect(guard.errors).toEqual([]);
});

test('seven players in uneven teams: rotation kept through an annulled round, ranking by totals', async ({
  page,
}) => {
  const guard = guardNetwork(page);
  await page.goto('/partite/nuova');
  await chooseTracking(page, 'Flessibile');
  await page.getByRole('button', { name: 'Scegli i giocatori' }).click();
  await addPlayers(page, ['Ada', 'Bea', 'Ciro', 'Dino', 'Elio', 'Fede', 'Gino']);
  await page.getByRole('radio', { name: 'Squadre' }).click();
  await page.getByRole('radio', { name: 'In ordine' }).click();
  await page.getByRole('button', { name: 'Genera squadre' }).click();
  await expect(page.getByLabel('Componenti squadra 4')).toHaveText(/Gino/);
  await page.getByText(/^Squadre disomogenee \(2 · 2 · 2 · 1 giocatori\)/).click();
  await page.getByRole('button', { name: 'Avvia partita' }).click();
  await expect(page).toHaveURL(/\/partite\/[0-9a-f-]{36}$/);
  // Four units on four seats: one session, no heats.
  await expect(page.locator('.htabs')).toHaveCount(0);

  // Guided turns: Ada throws for her pair, her round taken back and entered again.
  const now = page.locator('.now');
  const confirm = page.getByRole('button', { name: /^Conferma il turno di/ });
  await expect(now.locator('h2')).toHaveText('Ada');
  await expect(now).toContainText('Ada + Bea · tiratore 1 di 2');
  await page.getByRole('radio', { name: 'Totale' }).click();
  await page.keyboard.type('60');
  await confirm.click();
  await expect(now.locator('h2')).toHaveText('Ciro');
  await page.locator('.toast').getByRole('button', { name: 'Annulla' }).click();
  await expect(now.locator('h2')).toHaveText('Ada');
  await page.keyboard.type('50');
  await confirm.click();
  for (const [name, value] of [
    ['Ciro', '40'],
    ['Elio', '30'],
    ['Gino', '20'],
  ]) {
    await expect(now.locator('h2')).toHaveText(name);
    await page.keyboard.type(value);
    await confirm.click();
  }
  // Round 2: the rotation moved once, to Bea; a double tap on «next thrower» moves it once.
  await expect(now.locator('h2')).toHaveText('Bea');
  await page.getByRole('button', { name: 'Controlli del turno' }).click();
  const rotation = page.getByLabel('Rotazione della squadra');
  await expect(rotation).toContainText('Tira Bea · poi Ada');
  await page.getByRole('button', { name: 'Passa al prossimo tiratore' }).dblclick();
  await expect(rotation).toContainText('Tira Ada · poi Bea');
  await page.getByRole('button', { name: 'Chiudi' }).click();
  await expect(now.locator('h2')).toHaveText('Ada');
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.getByRole('link', { name: 'Risultati' }).click();
  for (const [unit, total] of [
    ['Ada + Bea', 310],
    ['Ciro + Dino', 420],
    ['Elio + Fede', 280],
    ['Gino', 350],
  ] as const)
    await enterScore(page, unit, total);
  await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
  // Ranked by totals: Ciro + Dino, Gino, Ada + Bea on the podium, then Elio + Fede.
  await expect(page.locator('.result-head')).toContainText('Vince Ciro + Dino!');
  await expect(page.locator('.pod .p1')).toContainText(/Ciro \+ Dino.*420/);
  await expect(page.locator('.pod .p2')).toContainText(/Gino.*350/);
  await expect(page.locator('.pod .p3')).toContainText(/Ada \+ Bea.*310/);
  await expect(page.locator('.result-done .list .rk')).toContainText(/Elio \+ Fede.*280/);
  await page.reload();
  await expect(page.locator('.pod .p1')).toContainText('Ciro + Dino');
  expect(guard.api).toEqual([]);
  expect(guard.errors).toEqual([]);
});

// Round by round (skipped turn, correction, difference, history): standalone-guided.spec.ts.

test('recovery: a reload keeps the score and the digits of the right player, a double tap saves once', async ({
  page,
}) => {
  await freeMatch(page, 'Hi-Score', ['Remo', 'Sara', 'Tino']);
  await enterScore(page, 'Remo', 600);
  await page.reload();
  await expect(banner(page)).toHaveText('PUNTEGGIO DI Sara');
  // Digits typed for a player chosen by hand come back with that player only, never under
  // the name of the next player in order.
  await page.getByRole('radio', { name: /Tino/ }).click();
  await page.keyboard.type('35');
  await page.reload();
  await expect(banner(page)).toHaveText('PUNTEGGIO DI Tino');
  await expect(page.getByLabel('Punteggio finale da confermare')).toHaveText('35');
  // Choosing someone else drops them.
  await page.getByRole('radio', { name: /Sara/ }).click();
  await expect(page.getByLabel('Punteggio finale da confermare')).toHaveText('–');
  await page.getByRole('radio', { name: /Sara/ }).click();
  await page.keyboard.type('350');
  await page.getByRole('button', { name: 'Conferma il punteggio di Sara' }).dblclick();
  await expect(banner(page)).toHaveText('PUNTEGGIO DI Tino');
  await expect(page.locator('.paper-tag')).toContainText('Salvato: Sara 350');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.goto('/');
  await page.getByRole('link', { name: /RIPRENDI/ }).click();
  await expect(totals(page)).toHaveText(['600', '350', '—']);
});

test('backup transfer of a 12-player tournament in progress, then the evening goes on', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const players = names('B', 12);
  const scores = Object.fromEntries(players.map((p, i) => [p, 400 + i * 11]));
  await newHiScoreTournament(page, players);
  for (const p of players.slice(0, 4)) await enterScore(page, p, scores[p]!);
  await page.getByRole('button', { name: 'AVVIA MANCHE 2' }).click();
  for (const p of players.slice(4, 6)) await enterScore(page, p, scores[p]!);
  const recorded = await totals(page).allTextContents();

  await page.goto('/impostazioni');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Esporta backup' }).click();
  const file = await download;

  // An isolated profile is another phone.
  const device = await browser.newContext({ baseURL: 'http://127.0.0.1:3108' });
  const other = await device.newPage();
  const guard = guardNetwork(other);
  await other.goto('/impostazioni');
  await other.getByLabel('Importa backup').setInputFiles((await file.path())!);
  const dialog = other.getByRole('dialog', { name: 'Ripristinare questo backup?' });
  await expect(dialog).toContainText('12 giocatori, 1 torneo');
  await expect(dialog).toContainText('Il dispositivo non contiene dati');
  await dialog.getByRole('button', { name: 'Importa' }).click();
  await expect(other.getByText('Backup ripristinato')).toBeVisible();

  await other.goto('/');
  await other.getByRole('link', { name: /IN CORSO · RIPRENDI/ }).click();
  await expect(other.getByRole('radio', { name: /M1.*giocata/ })).toBeVisible();
  await expect(
    other.getByRole('radio', { name: /M2.*al bersaglio · 2 da inserire/ }),
  ).toBeChecked();
  await expect(totals(other)).toHaveText(recorded);
  await expect(banner(other)).toHaveText('PUNTEGGIO DI B07');
  for (const p of players.slice(6, 8)) await enterScore(other, p, scores[p]!);
  await other.getByRole('button', { name: 'AVVIA MANCHE 3' }).click();
  for (const p of players.slice(8)) await enterScore(other, p, scores[p]!);
  await other.getByRole('link', { name: 'VAI AL TORNEO' }).click();
  await other.getByRole('button', { name: 'CONFERMA QUALIFICA' }).click();
  await other.getByRole('button', { name: 'VAI ALLA FINALE' }).click();
  await other.getByRole('button', { name: 'GENERA FINALE' }).click();
  await other.getByRole('link', { name: 'GIOCA LA FINALE' }).click();
  await expect(finalists(other)).toHaveText(['B09', 'B10', 'B11', 'B12']);
  await enterAsked(other, { B12: 500, B11: 520, B10: 610, B09: 480 }, 4);
  await other.getByRole('link', { name: 'VAI AL TORNEO' }).click();
  await other.getByRole('button', { name: 'CONFERMA RISULTATO FINALE' }).click();
  await other.getByRole('tab', { name: 'Risultati' }).click();
  await expect(other.locator('.pod .p1')).toContainText('B10');
  expect(guard.api).toEqual([]);
  expect(guard.errors).toEqual([]);
  await device.close();
});
