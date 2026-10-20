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
/** New match: type a name, Enter, the search field is ready for the next player. */
async function addPlayers(page: Page, names: string[]) {
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
async function addEntrants(page: Page, names: string[]) {
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
async function useFlexibleTracking(page: Page) {
  await page.locator('details.advanced summary').click();
  await page.getByRole('radio', { name: 'Flessibile', exact: true }).click();
}
const banner = (page: Page) => page.locator('.turn-banner');
/** Hi-Score: the totem's final total of the player in entry, typed on the keypad. */
async function enterScore(page: Page, player: string, score: number) {
  const finalEntry = page.getByRole('radio', { name: 'Risultato finale' });
  if (await finalEntry.isVisible()) await finalEntry.click();
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
async function freeMatch(page: Page, game: string, names: string[], flexible = false) {
  await page.goto('/partite/nuova');
  await page.getByRole('radio', { name: new RegExp(`^${game}`) }).click();
  await addPlayers(page, names);
  if (flexible) await useFlexibleTracking(page);
  await page.getByRole('button', { name: 'INIZIA PARTITA' }).click();
  await page.getByRole('button', { name: 'CONFERMA E INIZIA' }).click();
  await expect(page).toHaveURL(/\/partite\/[0-9a-f-]{36}$/);
}

test('Hi-Score night for 8 players: totals from the totem, tie decided, final and results', async ({
  page,
  context,
}) => {
  const guard = guardNetwork(page);
  const players = ['Ada', 'Bruno', 'Carla', 'Dario', 'Elsa', 'Fabio', 'Gaia', 'Ivo'];
  const scores = [700, 640, 610, 555, 555, 420, 380, 300];
  await page.goto('/');
  await page.getByRole('link', { name: /NUOVO TORNEO/ }).click();
  await page.getByRole('radio', { name: 'Hi-Score rapido' }).click();
  await expect(page.getByText('Una qualifica unica: i migliori totali')).toBeVisible();
  // The quick format compares totals: only Hi-Score can be chosen.
  await expect(page.getByRole('radio', { name: '501', exact: true })).toBeDisabled();
  await addEntrants(page, players);
  await useFlexibleTracking(page);
  await page.getByRole('button', { name: 'AVVIA TORNEO' }).click();
  await expect(page).toHaveURL(/\/hiscore\//);
  const tournamentUrl = page.url();
  await page.getByRole('link', { name: 'Gioca l’incontro' }).click();
  for (let i = 0; i < 3; i++) await enterScore(page, players[i]!, scores[i]!);

  // Eight players on a four-seat totem: two heats, the first one at the board.
  await expect(page.getByRole('radio', { name: /M1.*al bersaglio/ })).toBeChecked();
  // Refresh mid-heat: the next player is still in entry, nothing lost or duplicated.
  await page.reload();
  await expect(banner(page)).toHaveText('PUNTEGGIO DI Dario');
  await expect(page.getByRole('radio', { name: /^Ada 700/ })).toBeVisible();
  await page.goto('/');
  const resume = page.getByRole('link', { name: /IN CORSO · RIPRENDI/ });
  await expect(resume).toContainText(
    'Bite the Trouble Open · Hi-Score · 8 in gara · manche 1/2: Ada, Bruno, Carla, Dario',
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

  // Dario and Elsa tie for the fourth place: the organizer decides, with a reason.
  await expect(page.getByRole('alert')).toContainText('Parità sulla soglia');
  await expect(page.getByRole('button', { name: 'CONFERMA QUALIFICA' })).toBeDisabled();
  await expect(page.locator('.cut-line')).toContainText('LINEA FINALE · TOP 4');
  await page.getByRole('button', { name: 'DECIDE L’ORGANIZZATORE' }).click();
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
  // The final starts from zero between the four qualifiers.
  await expect(page.locator('.score-card strong')).toHaveText(['—', '—', '—', '—']);
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
  await expect(podium).toContainText('Bruno');
  await expect(page.locator('.place-1')).toContainText('Bruno');

  // Close and reopen the app: the official ranking is still there.
  await page.close();
  const reopened = await context.newPage();
  const reopenedGuard = guardNetwork(reopened);
  await reopened.goto(`${tournamentUrl}?tab=results`);
  await expect(reopened.locator('.place-1')).toContainText('Bruno');
  await expect(reopened.locator('table')).toContainText('Dario');
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
  await page.goto('/tornei/nuovo');
  await page.getByRole('radio', { name: 'A gironi', exact: true }).click();
  await page.getByRole('radio', { name: '501', exact: true }).click();
  await expect(page.getByText('il totem indica sempre un vincitore')).toBeVisible();
  await addEntrants(page, ['Marco', 'Davide', 'Sara']);
  await useFlexibleTracking(page);
  await page.getByRole('button', { name: 'Riduci Numero gironi' }).click();
  await page.getByRole('button', { name: 'AVVIA TORNEO' }).click();
  await expect(page).toHaveURL(/\/tornei\//);
  // Three players, one group: three matches with a rest each round.
  await page.getByRole('tab', { name: 'Gironi' }).click();
  await expect(page.locator('a.match-row')).toHaveCount(3);
  await page.getByRole('tab', { name: 'Panoramica' }).click();
  await page.getByRole('link', { name: 'Gioca l’incontro' }).click();
  // Marco wins both his matches, Sara beats Davide.
  for (let i = 0; i < 3; i++) {
    const cards = page.locator('.scoreboard [role="radio"]');
    await expect(cards).toHaveCount(2);
    const names = await cards.locator('.player-name').allTextContents();
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
  await page.getByRole('radio', { name: /Sara/ }).click();
  await page.getByLabel('Punti rimasti di Marco').fill('32');
  await page.getByRole('button', { name: 'CONFERMA RISULTATO' }).click();
  await page.getByRole('link', { name: 'VAI AL TORNEO' }).click();
  await page.getByRole('button', { name: 'CONFERMA RISULTATO FINALE' }).click();
  await expect(page.locator('.place-1')).toContainText('Sara');
  await page.reload();
  await expect(page.locator('.place-2')).toContainText('Marco');

  // Correcting a group match after the tournament ended lists what it invalidates first.
  await page.getByRole('tab', { name: 'Gironi' }).click();
  await page.locator('a.match-row', { hasText: 'Davide' }).filter({ hasText: 'Sara' }).click();
  await page.getByRole('button', { name: 'Correggi risultato' }).click();
  await page.getByRole('radio', { name: /Davide/ }).click();
  await page.getByRole('button', { name: 'SALVA CORREZIONE' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Correggere un risultato già usato?' });
  await expect(dialog).toContainText('verrà riaperta');
  await expect(dialog).toContainText('risultato ufficiale del torneo verrà ritirato');
  await dialog.getByRole('button', { name: 'Lascia com’è' }).click();
  await expect(page.locator('.score-card.selected')).toHaveCount(1);
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
  await page.getByRole('radio', { name: /^Odd & Even/ }).click();
  await addPlayers(page, ['Tea', 'Ugo']);
  await expect(page.getByRole('button', { name: 'Aggiungi giocatore' })).toHaveCount(0);
  await expect(page.locator('.order-list')).toContainText('Dispari');
  await expect(page.locator('.order-list')).toContainText('Pari');
  await page.getByRole('button', { name: 'INIZIA PARTITA' }).click();
  await page.getByRole('button', { name: 'CONFERMA E INIZIA' }).click();
  await expect(page.getByRole('button', { name: 'CONFERMA RISULTATO' })).toBeDisabled();
  await page.getByRole('radio', { name: /Ugo/ }).click();
  await page.getByRole('button', { name: 'CONFERMA RISULTATO' }).click();
  await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();

  await freeMatch(page, 'Exacta', ['Tea', 'Ugo'], true);
  await page.getByLabel(/Obiettivo del totem/).fill('400');
  await expect(page.getByText('Obiettivo tra 250 e 350.')).toBeVisible();
  await page.getByLabel(/Obiettivo del totem/).fill('310');
  await page.getByLabel('Totale finale di Tea').fill('290');
  await page.getByLabel('Totale finale di Ugo').fill('318');
  await expect(page.getByText('Dai punteggi vince Ugo.')).toBeVisible();
  await page.getByRole('button', { name: 'CONFERMA RISULTATO' }).click();
  await expect(page.locator('.final-rows li.first')).toContainText('Ugo');

  await freeMatch(page, 'Shanghai', ['Tea', 'Ugo', 'Vito'], true);
  await page.getByLabel('Punti di Tea').fill('120');
  await page.getByLabel('Punti di Ugo').fill('40');
  await page.getByRole('switch', { name: 'Vittoria con Shanghai' }).click();
  await expect(page.getByText('Tocca chi ha fatto Shanghai.')).toBeVisible();
  await page.getByRole('radio', { name: /Ugo/ }).click();
  await page.getByRole('button', { name: 'CONFERMA RISULTATO' }).click();
  await expect(page.getByText('Vittoria con Shanghai')).toBeVisible();
  await expect(page.locator('.final-rows li.first')).toContainText('Ugo');

  // Statistics per game: the player's profile keeps the games apart.
  await page.goto('/giocatori');
  await page.getByRole('button', { name: /Ugo/ }).click();
  const profile = page.getByRole('dialog');
  for (const game of ['Odd & Even', 'Exacta', 'Shanghai'])
    await expect(profile.locator('.config-stats h3', { hasText: game })).toBeVisible();
  await expect(profile.locator('.stat-tiles')).toContainText('3/3');
});

test('game night with a tournament and players with nicknames', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /GAME NIGHT/ }).click();
  await page.getByRole('button', { name: 'Nuova serata' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Halloween Darts');
  await page.getByRole('button', { name: 'CREA SERATA' }).click();
  const night = page.locator('article.event', { hasText: 'Halloween Darts' });
  await expect(night).toContainText('IN PROGRAMMA');
  await night.getByRole('button', { name: 'Apri la serata' }).click();
  await expect(night).toContainText('IN CORSO');
  await night.getByRole('link', { name: 'Aggiungi torneo' }).click();
  await expect(page.getByLabel('Serata (facoltativa)')).toHaveValue(/.+/);
  await addEntrants(page, ['Vito', 'Zoe']);
  await page.getByRole('radio', { name: 'Hi-Score rapido' }).click();
  await expect(
    page.getByText('non c’è qualifica: tutti giocano direttamente la finale'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Salva come bozza (iscrizioni aperte)' }).click();
  await expect(page.getByRole('heading', { name: 'Iscrizioni aperte' })).toBeVisible();
  // A registration can be removed before the start.
  await page.getByRole('button', { name: 'Togli Zoe dagli iscritti' }).click();
  await expect(page.locator('.entry-list li')).toHaveCount(1);
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
  await page.getByRole('radio', { name: 'oro' }).click();
  await page.getByRole('button', { name: 'Salva' }).click();
  await page.getByRole('button', { name: /“Il Prof”/ }).click();
  await expect(page.getByRole('radio', { name: 'oro' })).toBeChecked();
  await page.getByRole('button', { name: 'Disattiva' }).click();
  await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await expect(page.getByRole('button', { name: /“Il Prof”/ })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Disattivati' }).click();
  await expect(page.getByRole('button', { name: /“Il Prof”/ })).toContainText('DISATTIVATO');
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
  await expect(banner(other)).toHaveText('PUNTEGGIO DI Otto');
  await expect(other.locator('.score-card strong').first()).toHaveText('640');
  await other.goto('/giocatori');
  await expect(other.getByRole('button', { name: /Solo qui/ })).toHaveCount(0);
  await device.close();
});

test('a double tap on confirm records one score only', async ({ page }) => {
  await freeMatch(page, 'Hi-Score', ['Pia', 'Rino'], true);
  await page.getByRole('radio', { name: 'Risultato finale' }).click();
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeEnabled();
  await page.keyboard.type('560');
  await page.getByRole('button', { name: 'Conferma il punteggio di Pia' }).dblclick();
  await expect(banner(page)).toHaveText('PUNTEGGIO DI Rino');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.score-card strong')).toHaveText(['560', '—']);
});

test('X01 records every round and an excess keeps the remaining points', async ({ page }) => {
  await freeMatch(page, '301', ['Tina', 'Ugo']);
  const bustButton = page.getByRole('button', {
    name: 'Eccesso: mantieni i punti rimasti',
  });
  await expect(bustButton).toBeVisible();

  await page.keyboard.type('160');
  await page.getByRole('button', { name: 'Conferma il round 1' }).click();
  await page.keyboard.type('131');
  await page.getByRole('button', { name: 'Conferma il round 2' }).click();
  await bustButton.click();

  await expect(page.getByRole('radio', { name: 'R3 ECCESSO' })).toBeVisible();
  await expect(page.locator('.round-summary')).toContainText('Punti rimasti 10 (parziale)');

  await page.getByRole('radio', { name: /^Ugo/ }).click();
  await page.keyboard.type('0');
  await page.getByRole('button', { name: 'Conferma il round 1' }).click();
  await page.getByRole('radio', { name: 'Risultato finale' }).click();
  await page.getByLabel('Punti rimasti di Tina').fill('10');
  await page.getByLabel('Punti rimasti di Ugo').fill('301');
  await page.getByRole('button', { name: 'CONFERMA RISULTATO' }).click();
  await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
  await expect(page.locator('.final-rows li.first')).toContainText('Tina');
});

test('pairs composed by hand, rounds tracked with rotation, official result from the totem', async ({
  page,
}) => {
  const guard = guardNetwork(page);
  await page.goto('/partite/nuova');
  await addPlayers(page, ['Ada', 'Bea', 'Ciro', 'Dino']);
  await page.getByRole('radio', { name: 'Squadre' }).click();
  await page.getByRole('radio', { name: 'In ordine' }).click();
  await page.getByRole('button', { name: 'Genera squadre' }).click();
  // Two taps swap Bea and Ciro between the pairs.
  await page.getByRole('button', { name: /^2 Bea$/ }).click();
  await page.getByRole('button', { name: /^1 Ciro$/ }).click();
  await expect(page.getByLabel('Componenti squadra 1')).toHaveText(/Ada.*Ciro/);
  await expect(page.getByLabel('Componenti squadra 2')).toHaveText(/Bea.*Dino/);
  await page.getByText(/^Opzioni avanzate/).click();
  await page.getByRole('radio', { name: 'Flessibile' }).click();
  await page.getByRole('button', { name: 'INIZIA PARTITA' }).click();
  await expect(page.getByRole('dialog')).toContainText('Ada + Ciro');
  await page.getByRole('button', { name: 'CONFERMA E INIZIA' }).click();
  await expect(page).toHaveURL(/\/partite\/[0-9a-f-]{36}$/);

  await page.getByRole('radio', { name: 'Round per round' }).click();
  const rotation = page.getByLabel('Rotazione della squadra');
  await expect(rotation).toContainText('Tira Ada · poi Ciro');
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeEnabled();
  await page.keyboard.type('60');
  await page.getByRole('button', { name: 'Conferma il round 1' }).click();
  await expect(page.getByRole('radio', { name: 'R1 60' })).toBeVisible();
  await expect(page.locator('.round-target')).toContainText('Bea + Dino');
  const nextRotation = page.getByLabel('Rotazione della squadra');
  await expect(nextRotation).toContainText('Tira Bea · poi Dino');
  await page.keyboard.type('60');
  await page.getByRole('button', { name: 'Conferma il round 1' }).click();
  await expect(page.locator('.round-target')).toContainText('Ada + Ciro');
  await expect(rotation).toContainText('Tira Ciro · poi Ada');
  // A round not seen is skipped, never counted as zero.
  await page.getByRole('button', { name: 'Salta R2 (non visto)' }).click();
  await expect(page.locator('.round-target')).toContainText('Bea + Dino');
  await page.getByRole('radio', { name: /^Ada \+ Ciro/ }).click();
  await expect(page.getByRole('radio', { name: 'R2 saltato' })).toBeVisible();
  await expect(page.locator('.round-summary')).toContainText('Totale round 60 (parziale)');
  await expect(page.locator('.round-summary')).toContainText('saltati R2');

  // The official totals come from the totem.
  await page.getByRole('radio', { name: 'Risultato finale' }).click();
  await enterScore(page, 'Ada + Ciro', 300);
  await enterScore(page, 'Bea + Dino', 250);
  await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
  await expect(page.locator('.final-rows li.first')).toContainText('Ada + Ciro');
  // After a reload the rounds and the rotation are still there.
  await page.reload();
  await expect(page.locator('.final-rows li.first')).toContainText('300');
  expect(guard.api).toEqual([]);
  expect(guard.errors).toEqual([]);
});

test('seven players in a free Hi-Score match play two heats with one ranking', async ({ page }) => {
  await page.goto('/partite/nuova');
  await addPlayers(page, ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
  await expect(page.locator('.settings-row', { hasText: '2 manche da 4 posti' })).toContainText(
    '4 · 3',
  );
  await page.getByRole('button', { name: 'INIZIA PARTITA' }).click();
  await page.getByRole('button', { name: 'CONFERMA E INIZIA' }).click();
  await expect(page.getByRole('radio', { name: /M1/ })).toBeChecked();
  for (const [i, score] of [300, 410, 250, 390].entries())
    await enterScore(page, `P${i + 1}`, score);
  await page.getByRole('button', { name: 'AVVIA MANCHE 2' }).click();
  for (const [i, score] of [505, 120, 380].entries()) await enterScore(page, `P${i + 5}`, score);
  await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
  // The winner played in the second heat: the ranking is one, across the heats.
  await expect(page.locator('.final-rows li.first')).toContainText('P5');
});
