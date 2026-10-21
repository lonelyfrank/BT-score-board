import { expect, test } from '@playwright/test';
import {
  addEntrants,
  addPlayers,
  banner,
  chooseTracking,
  enterScore,
  freeMatch,
  gameRadio,
  guardNetwork,
  newTournament,
  nextStep,
  openFinalResult,
} from './helpers';

const rows = (page: import('@playwright/test').Page) => page.locator('.result-rows .rk');
const verdict = (page: import('@playwright/test').Page) => page.locator('.result-head');

test('Hi-Score night for 8 players: totals from the totem, tie decided, final and results', async ({
  page,
  context,
}) => {
  const guard = guardNetwork(page);
  const players = ['Ada', 'Bruno', 'Carla', 'Dario', 'Elsa', 'Fabio', 'Gaia', 'Ivo'];
  const scores = [700, 640, 610, 555, 555, 420, 380, 300];
  await page.goto('/');
  await page.getByRole('link', { name: /NUOVO TORNEO/ }).click();
  await page.getByRole('radio', { name: /^Hi-Score rapido/ }).click();
  // The quick format compares totals: the game is Hi-Score, not a choice.
  await expect(page.getByText('Gioco sul totem:')).toContainText('Hi-Score');
  await page.getByLabel('Nome', { exact: true }).fill('Bite the Trouble Open');
  await nextStep(page);
  await addEntrants(page, players);
  await nextStep(page);
  await nextStep(page);
  await chooseTracking(page, 'Flessibile');
  await nextStep(page);
  await page.getByRole('button', { name: 'Avvia torneo' }).click();
  // The night starts at the board: the first heat is open.
  await expect(page).toHaveURL(/\/partite\//);
  for (let i = 0; i < 3; i++) await enterScore(page, players[i]!, scores[i]!);

  // Eight players on a four-seat totem: two heats, the first one at the board.
  await expect(page.getByRole('radio', { name: /M1.*al bersaglio/ })).toBeChecked();
  // Refresh mid-heat: the next player is still in entry, nothing lost or duplicated.
  await page.reload();
  await expect(banner(page)).toHaveText('PUNTEGGIO DI Dario');
  await expect(page.getByRole('radio', { name: /Ada.*700/ })).toBeVisible();
  await page.goto('/');
  const resume = page.getByRole('link', { name: /IN CORSO · RIPRENDI/ });
  await expect(resume).toContainText(
    'Bite the Trouble Open · manche 1/2: Ada, Bruno, Carla, Dario',
  );
  await resume.click();
  await enterScore(page, players[3]!, scores[3]!);
  // Heat 1 is played and stays on screen; the organizer sends heat 2 to the board.
  await expect(page.getByRole('radio', { name: /M1.*giocata/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /M2.*prossima/ })).toBeVisible();
  await page.getByRole('button', { name: 'AVVIA MANCHE 2' }).click();
  await expect(page.getByRole('radio', { name: /M2.*al bersaglio/ })).toBeChecked();
  for (let i = 4; i < 8; i++) await enterScore(page, players[i]!, scores[i]!);
  await expect(page.getByRole('heading', { name: 'Risultato registrato' })).toBeVisible();
  await page.getByRole('link', { name: 'VAI AL TORNEO' }).click();
  const tournamentUrl = page.url().split('?')[0]!;

  // Dario and Elsa tie for the fourth place: the organizer decides, with a reason.
  await expect(page.getByRole('alert')).toContainText('Parità sulla soglia');
  await expect(page.getByRole('button', { name: 'CONFERMA QUALIFICA' })).toBeDisabled();
  await expect(page.locator('.cut')).toContainText('FINALE · TOP 4');
  await page.getByRole('button', { name: 'Decido io' }).click();
  const sheet = page.getByRole('dialog', { name: 'Decisione · Qualifica' });
  // Tied players have no order of their own: put Elsa first if she is not already.
  const elsaFirst = sheet.getByRole('button', { name: 'Anticipa Elsa' });
  if (await elsaFirst.isEnabled()) await elsaFirst.click();
  await sheet.getByLabel('Motivo (obbligatorio)').fill('Dario ha lasciato il locale');
  await sheet.getByRole('button', { name: 'CONFERMA DECISIONE' }).click();
  await page.getByRole('button', { name: 'CONFERMA QUALIFICA' }).click();
  await page.getByRole('button', { name: 'VAI ALLA FINALE' }).click();
  await page.getByRole('button', { name: 'GENERA FINALE' }).click();
  await page.getByRole('link', { name: 'GIOCA LA FINALE' }).click();
  await openFinalResult(page);
  // The final starts from zero between the four qualifiers.
  await expect(rows(page).locator('strong')).toHaveText(['—', '—', '—', '—']);
  for (const [name, score] of [
    ['Ada', 400],
    ['Bruno', 720],
    ['Carla', 610],
    ['Elsa', 380],
  ] as const)
    await enterScore(page, name, score);
  await page.getByRole('link', { name: 'VAI AL TORNEO' }).click();
  await page.getByRole('button', { name: 'CONFERMA RISULTATO FINALE' }).click();
  await page.getByRole('tab', { name: 'Risultati' }).click();
  const podium = page.getByRole('region', { name: 'Risultato ufficiale' });
  await expect(podium).toContainText('Vince Bruno!');
  await expect(page.locator('.pod .p1')).toContainText('Bruno');

  // Close and reopen the app: the official ranking is still there.
  await page.close();
  const reopened = await context.newPage();
  const reopenedGuard = guardNetwork(reopened);
  await reopened.goto(`${tournamentUrl}?tab=results`);
  await expect(reopened.locator('.pod .p1')).toContainText('Bruno');
  await expect(reopened.getByRole('list', { name: 'Piazzamenti finali' })).toContainText('Dario');
  await reopened.goto('/');
  await expect(
    reopened.getByRole('list').filter({ hasText: 'Bite the Trouble Open' }),
  ).toContainText('Vince Bruno');
  await expect(reopened.getByRole('link', { name: /RIPRENDI/ })).toHaveCount(0);
  expect([...guard.api, ...reopenedGuard.api]).toEqual([]);
  expect([...guard.errors, ...reopenedGuard.errors]).toEqual([]);
});

test('501 groups with winners only, final, then a correction that asks before reopening', async ({
  page,
}) => {
  const guard = guardNetwork(page);
  await newTournament(page, {
    format: 'Gironi',
    game: '501',
    players: ['Marco', 'Davide', 'Sara'],
    tracking: 'Flessibile',
    groups: (p) => p.getByRole('button', { name: 'Riduci Numero gironi' }).click(),
    rules: (p) => expect(p.getByText('il totem indica sempre un vincitore')).toBeVisible(),
  });
  await expect(page).toHaveURL(/\/tornei\//);
  // Three players, one group: three matches with a rest each round.
  await page.getByRole('tab', { name: 'Gironi' }).click();
  await expect(page.locator('a.mrow.match')).toHaveCount(3);
  await page.getByRole('tab', { name: 'Panoramica' }).click();
  await page.getByRole('link', { name: 'Gioca l’incontro' }).click();
  // Marco wins both his matches, Sara beats Davide.
  for (let i = 0; i < 3; i++) {
    await openFinalResult(page);
    const cards = page.locator('.result-rows [role="radio"]');
    await expect(cards).toHaveCount(2);
    const names = await cards.locator('.nm b').allTextContents();
    const winner = names.includes('Marco') ? 'Marco' : 'Sara';
    await page.getByRole('radio', { name: new RegExp(winner) }).click();
    await page.getByRole('button', { name: 'CONFERMA RISULTATO' }).click();
    await expect(page.getByRole('heading', { name: 'Risultato registrato' })).toBeVisible();
    if (i < 2) await page.getByRole('link', { name: 'PROSSIMO INCONTRO' }).click();
  }
  await page.getByRole('link', { name: 'VAI AL TORNEO' }).click();
  await page.getByRole('tab', { name: 'Gironi' }).click();
  // Points and wins, no score difference outside Hi-Score.
  await expect(page.locator('thead')).not.toContainText('Diff');
  await expect(page.locator('tbody tr').first()).toContainText('Marco');
  await page.getByRole('tab', { name: 'Panoramica' }).click();
  await page.getByRole('button', { name: 'CONFERMA QUALIFICA' }).click();
  await page.getByRole('button', { name: 'GENERA TABELLONE' }).click();
  await page.getByRole('link', { name: 'Gioca l’incontro' }).click();
  await openFinalResult(page);
  await page.getByRole('radio', { name: /Sara/ }).click();
  await page.getByLabel('Punti rimasti di Marco').fill('32');
  await page.getByRole('button', { name: 'CONFERMA RISULTATO' }).click();
  await page.getByRole('link', { name: 'VAI AL TORNEO' }).click();
  await page.getByRole('button', { name: 'CONFERMA RISULTATO FINALE' }).click();
  await expect(page.locator('.pod .p1')).toContainText('Sara');
  await page.reload();
  await expect(page.locator('.pod .p2')).toContainText('Marco');

  // Correcting a group match after the tournament ended lists what it invalidates first.
  await page.getByRole('tab', { name: 'Gironi' }).click();
  await page.locator('a.mrow.match', { hasText: 'Davide' }).filter({ hasText: 'Sara' }).click();
  await openFinalResult(page);
  await page.getByRole('button', { name: 'Correggi risultato' }).click();
  await page.getByRole('radio', { name: /Davide/ }).click();
  await page.getByRole('button', { name: 'SALVA CORREZIONE' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Correggere un risultato già usato?' });
  await expect(dialog).toContainText('verrà riaperta');
  await expect(dialog).toContainText('risultato ufficiale del torneo verrà ritirato');
  await dialog.getByRole('button', { name: 'Lascia com’è' }).click();
  await expect(page.locator('.result-rows [aria-checked="true"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'SALVA CORREZIONE' }).click();
  await page.getByRole('button', { name: 'CORREGGI E RIAPRI' }).click();
  await expect(page.getByRole('heading', { name: 'Risultato registrato' })).toBeVisible();
  await page.getByRole('link', { name: 'VAI AL TORNEO' }).click();
  await expect(page.getByRole('button', { name: 'CONFERMA QUALIFICA' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Risultato ufficiale' })).toHaveCount(0);
  expect(guard.api).toEqual([]);
  expect(guard.errors).toEqual([]);
});

test('free matches of the totem: Odd & Even sides, Exacta target and Shanghai win', async ({
  page,
}) => {
  await page.goto('/partite/nuova');
  await gameRadio(page, 'Odd & Even').click();
  await chooseTracking(page, 'Solo finale');
  await page.getByRole('button', { name: 'Scegli i giocatori' }).click();
  await addPlayers(page, ['Tea', 'Ugo']);
  await expect(page.getByRole('button', { name: 'Aggiungi giocatore' })).toHaveCount(0);
  const order = page.getByRole('list', { name: 'Ordine di tiro' });
  await expect(order).toContainText('Dispari');
  await expect(order).toContainText('Pari');
  await page.getByRole('button', { name: 'Avvia partita' }).click();
  await expect(page.getByRole('button', { name: 'CONFERMA RISULTATO' })).toBeDisabled();
  await page.getByRole('radio', { name: /Ugo/ }).click();
  await page.getByRole('button', { name: 'CONFERMA RISULTATO' }).click();
  await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();

  await freeMatch(page, 'Exacta', ['Tea', 'Ugo'], true);
  await openFinalResult(page);
  await page.getByLabel(/Obiettivo del totem/).fill('400');
  await expect(page.getByText('Obiettivo tra 250 e 350.')).toBeVisible();
  await page.getByLabel(/Obiettivo del totem/).fill('310');
  await page.getByLabel('Totale finale di Tea').fill('290');
  await page.getByLabel('Totale finale di Ugo').fill('318');
  await expect(page.getByText('Dai punteggi vince Ugo.')).toBeVisible();
  await page.getByRole('button', { name: 'CONFERMA RISULTATO' }).click();
  await expect(verdict(page)).toContainText('Vince Ugo!');

  await freeMatch(page, 'Shanghai', ['Tea', 'Ugo', 'Vito'], true);
  await openFinalResult(page);
  await page.getByLabel('Punti di Tea').fill('120');
  await page.getByLabel('Punti di Ugo').fill('40');
  await page.getByRole('switch', { name: 'Vittoria con Shanghai' }).click();
  await expect(page.getByText('Tocca chi ha fatto Shanghai.')).toBeVisible();
  await page.getByRole('radio', { name: /Ugo/ }).click();
  await page.getByRole('button', { name: 'CONFERMA RISULTATO' }).click();
  await expect(page.getByText('Vittoria con Shanghai')).toBeVisible();
  await expect(verdict(page)).toContainText('Vince Ugo!');

  // Statistics per game: the player's profile keeps the games apart.
  await page.goto('/giocatori');
  await page.getByRole('button', { name: /Ugo/ }).click();
  const profile = page.getByRole('dialog');
  for (const game of ['Odd & Even', 'Exacta', 'Shanghai'])
    await expect(profile.locator('.mode-stats', { hasText: game })).toBeVisible();
  await expect(profile.locator('.stat3')).toContainText(/Tornei\s*3\s*Vittorie\s*3/);
});

test('game night with a tournament and players with nicknames', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Game Night' }).click();
  await page.getByRole('button', { name: 'Nuova serata' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Halloween Darts');
  await page.getByRole('button', { name: 'CREA SERATA' }).click();
  const night = page.locator('article.event', { hasText: 'Halloween Darts' });
  await expect(night).toContainText('IN PROGRAMMA');
  await night.getByRole('button', { name: 'Apri la serata' }).click();
  await expect(night).toContainText('STASERA');
  await night.getByRole('link', { name: 'Aggiungi torneo' }).click();
  await expect(page.getByLabel('Serata (facoltativa)')).toHaveValue(/.+/);
  await page.getByLabel('Nome', { exact: true }).fill('Bite the Trouble Open');
  await nextStep(page);
  await addEntrants(page, ['Vito', 'Zoe']);
  await nextStep(page);
  await nextStep(page);
  await expect(
    page.getByText('non c’è qualifica: tutti giocano direttamente la finale'),
  ).toBeVisible();
  await nextStep(page);
  await page.getByRole('button', { name: 'Salva come bozza (iscrizioni aperte)' }).click();
  await expect(page.getByRole('heading', { name: 'Iscrizioni aperte' })).toBeVisible();
  // A registration can be removed before the start.
  await page.getByRole('button', { name: 'Togli Zoe dagli iscritti' }).click();
  await expect(page.getByRole('button', { name: /^Togli .* dagli iscritti$/ })).toHaveCount(1);
  await page.goto('/serate');
  await expect(page.locator('article.event', { hasText: 'Halloween Darts' })).toContainText(
    'Bite the Trouble Open',
  );

  await page.goto('/giocatori');
  await page.getByRole('button', { name: 'Nuovo giocatore' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Vito');
  await expect(page.getByText('Esiste già un “Vito”')).toBeVisible();
  await page.getByLabel('Soprannome (facoltativo)').fill('Il Prof');
  await page.getByRole('button', { name: 'CREA GIOCATORE' }).click();
  await expect(page.getByRole('button', { name: /“Il Prof”/ })).toBeVisible();
  await page.getByRole('button', { name: /“Il Prof”/ }).click();
  // A colour is saved as soon as it is chosen.
  await page.getByRole('radio', { name: 'oro' }).click();
  await expect(page.getByRole('radio', { name: 'oro' })).toBeChecked();
  await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await page.getByRole('button', { name: /“Il Prof”/ }).click();
  await expect(page.getByRole('radio', { name: 'oro' })).toBeChecked();
  await page.getByRole('button', { name: 'Disattiva' }).click();
  await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await expect(page.getByRole('button', { name: /“Il Prof”/ })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Disattivati' }).click();
  await expect(page.getByRole('button', { name: /“Il Prof”/ })).toContainText('disattivato');
});

test('backup export and import onto a new device, with confirmation before replacing data', async ({
  page,
  browser,
}) => {
  await freeMatch(page, 'Hi-Score', ['Nora', 'Otto'], true);
  await enterScore(page, 'Nora', 640);
  await page.goto('/impostazioni');
  await expect(page.getByText('Giocatori · tornei')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Esporta backup' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^bt-darts-backup-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByRole('status').filter({ hasText: 'Backup salvato' })).toBeVisible();

  // A fresh browser profile is a new device.
  const device = await browser.newContext({ baseURL: 'http://127.0.0.1:3108' });
  const other = await device.newPage();
  await other.goto('/giocatori');
  await other.getByRole('button', { name: 'Nuovo giocatore' }).click();
  await other.getByLabel('Nome', { exact: true }).fill('Solo qui');
  await other.getByLabel('Nome', { exact: true }).press('Enter');
  await expect(other.getByRole('button', { name: /Solo qui/ })).toBeVisible();
  await other.goto('/impostazioni');
  await other.getByLabel('Importa backup').setInputFiles((await file.path())!);
  const dialog = other.getByRole('dialog', { name: 'Ripristinare questo backup?' });
  await expect(dialog).toContainText('2 giocatori, 1 torneo');
  await expect(dialog).toContainText('Sostituirà tutti i dati attuali');
  await dialog.getByRole('button', { name: 'Sostituisci i dati' }).click();
  await expect(other.getByText('Backup ripristinato')).toBeVisible();
  await other.goto('/');
  await other.getByRole('link', { name: /RIPRENDI/ }).click();
  await openFinalResult(other);
  await expect(banner(other)).toHaveText('PUNTEGGIO DI Otto');
  await expect(rows(other).locator('strong').first()).toHaveText('640');
  await other.goto('/giocatori');
  await expect(other.getByRole('button', { name: /Solo qui/ })).toHaveCount(0);
  await device.close();
});

test('a double tap on confirm records one score only', async ({ page }) => {
  await freeMatch(page, 'Hi-Score', ['Pia', 'Rino'], true);
  await openFinalResult(page);
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeEnabled();
  await page.keyboard.type('560');
  await page.getByRole('button', { name: 'Conferma il punteggio di Pia' }).dblclick();
  await expect(banner(page)).toHaveText('PUNTEGGIO DI Rino');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(rows(page).locator('strong')).toHaveText(['560', '—']);
});

test('X01 records every round and an excess keeps the remaining points', async ({ page }) => {
  await freeMatch(page, '301', ['Tina', 'Ugo'], 'Round per round');
  const now = page.locator('.now h2');
  const turn = async (name: string, value: string) => {
    await expect(now).toHaveText(name);
    await page.getByRole('radio', { name: 'Totale' }).click();
    await page.keyboard.type(value);
    await page.getByRole('button', { name: `Conferma il turno di ${name}` }).click();
    await expect(page.locator('.toast')).toContainText(name);
  };
  await turn('Tina', '160');
  await turn('Ugo', '0');
  await turn('Tina', '131');
  await turn('Ugo', '0');
  // Tina goes past zero: the excess keeps her 10 points left.
  await expect(now).toHaveText('Tina');
  await page.getByRole('radio', { name: 'Totale' }).click();
  await page.getByRole('button', { name: /BUST/ }).click();
  await expect(page.locator('.toast')).toContainText('bust');
  await page.getByRole('link', { name: 'Matrice' }).click();
  await expect(page.getByRole('button', { name: 'Tina, round 3: bust' })).toBeVisible();
  await expect(page.locator('.mx tbody tr').first().locator('td.tot')).toHaveText('10');

  await openFinalResult(page);
  await page.getByLabel('Punti rimasti di Tina').fill('10');
  await page.getByLabel('Punti rimasti di Ugo').fill('301');
  await page.getByRole('button', { name: 'CONFERMA RISULTATO' }).click();
  await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
  await expect(verdict(page)).toContainText('Vince Tina!');
});

test('pairs composed by hand, rounds tracked with rotation, official result from the totem', async ({
  page,
}) => {
  const guard = guardNetwork(page);
  await page.goto('/partite/nuova');
  await chooseTracking(page, 'Flessibile');
  await page.getByRole('button', { name: 'Scegli i giocatori' }).click();
  await addPlayers(page, ['Ada', 'Bea', 'Ciro', 'Dino']);
  await page.getByRole('radio', { name: 'Squadre' }).click();
  await page.getByRole('radio', { name: 'In ordine' }).click();
  await page.getByRole('button', { name: 'Genera squadre' }).click();
  // Two taps swap Bea and Ciro between the pairs.
  await page.getByRole('button', { name: /^2 Bea$/ }).click();
  await page.getByRole('button', { name: /^1 Ciro$/ }).click();
  await expect(page.getByLabel('Componenti squadra 1')).toHaveText(/Ada.*Ciro/);
  await expect(page.getByLabel('Componenti squadra 2')).toHaveText(/Bea.*Dino/);
  await expect(page.locator('.actionbar .ctx')).toContainText('primo: Ada + Ciro');
  await page.getByRole('button', { name: 'Avvia partita' }).click();
  await expect(page).toHaveURL(/\/partite\/[0-9a-f-]{36}$/);

  // Guided turns: Ada throws first for her pair; a turn not seen is skipped, never zero.
  const now = page.locator('.now');
  await expect(now.locator('h2')).toHaveText('Ada');
  await expect(now).toContainText('Ada + Ciro');
  await page.getByRole('radio', { name: 'Totale' }).click();
  await page.keyboard.type('60');
  await page.getByRole('button', { name: 'Conferma il turno di Ada' }).click();
  await expect(now.locator('h2')).toHaveText('Bea');
  await page.getByRole('button', { name: 'Controlli del turno' }).click();
  await page.getByRole('button', { name: /Salta il turno di Bea/ }).click();
  await expect(now.locator('h2')).toHaveText('Ciro');
  await page.getByRole('link', { name: 'Matrice' }).click();
  await expect(page.getByRole('button', { name: 'Ada + Ciro, round 1: 60' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bea + Dino, round 1: saltato' })).toBeVisible();

  // The official totals come from the totem.
  await page.getByRole('link', { name: 'Risultati' }).click();
  await enterScore(page, 'Ada + Ciro', 300);
  await enterScore(page, 'Bea + Dino', 250);
  await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
  await expect(verdict(page)).toContainText('Vince Ada + Ciro!');
  // After a reload the rounds and the rotation are still there.
  await page.reload();
  await expect(page.locator('.result-done .rk.gold')).toContainText('300');
  expect(guard.api).toEqual([]);
  expect(guard.errors).toEqual([]);
});

test('seven players in a free Hi-Score match play two heats with one ranking', async ({ page }) => {
  await page.goto('/partite/nuova');
  await chooseTracking(page, 'Solo finale');
  await page.getByRole('button', { name: 'Scegli i giocatori' }).click();
  await addPlayers(page, ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
  await expect(page.getByRole('region', { name: '2 manche' })).toContainText('4 + 3');
  await page.getByRole('button', { name: 'Avvia partita' }).click();
  await expect(page.getByRole('radio', { name: /M1/ })).toBeChecked();
  for (const [i, score] of [300, 410, 250, 390].entries())
    await enterScore(page, `P${i + 1}`, score);
  await page.getByRole('button', { name: 'AVVIA MANCHE 2' }).click();
  for (const [i, score] of [505, 120, 380].entries()) await enterScore(page, `P${i + 5}`, score);
  await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
  // The winner played in the second heat: the ranking is one, across the heats.
  await expect(verdict(page)).toContainText('Vince P5!');
});
