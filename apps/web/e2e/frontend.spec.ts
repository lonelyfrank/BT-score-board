import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { newTournament } from './helpers';
const token = 'browser-test-only-token-at-least-32-characters';
const artifacts = '../../docs/frontend/screenshots';
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/${name}.png` });
  await page.screenshot({ path: `${artifacts}/${name}-full.png`, fullPage: true });
}
async function login(page: Page) {
  await page.goto('/impostazioni');
  await page.getByLabel('Token', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'VERIFICA E USA' }).click();
  await expect(page.getByText('Connesso · comandi abilitati')).toBeVisible();
}
async function addPlayer(page: Page, name: string) {
  await page.getByRole('button', { name: 'Aggiungi giocatore' }).click();
  await page.getByLabel('Cerca tra i giocatori del locale').fill(name);
  await page.getByRole('button', { name: `Crea “${name}” e aggiungi` }).click();
  await expect(page.getByLabel('Cerca tra i giocatori del locale')).toHaveValue('');
  await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
}
const confirmTurn = (page: Page) =>
  page.getByRole('button', { name: 'Conferma totale e chiudi il turno' });
/** The official result: the Risultati tab of a guided match, or the result screen itself. */
async function openFinalResult(page: Page) {
  // Wait for the match screen: the guided one or the result screen.
  await expect(page.locator('.match-screen, .result-screen').first()).toBeVisible();
  const tab = page.getByRole('link', { name: 'Risultati', exact: true });
  if (await tab.isVisible()) await tab.click();
}
/** The official total in a player's row, or on the podium once the match is over. */
const recorded = (page: Page, player: string) =>
  page
    .locator('.result-rows .rk, .result-done .rk, .pod li')
    .filter({ has: page.getByText(player, { exact: true }) })
    .first()
    .locator(':scope > strong, :scope > b');
async function enterScore(page: Page, player: string, score: number) {
  await openFinalResult(page);
  await expect(page.locator('.turn-banner')).toHaveText(`PUNTEGGIO DI ${player}`);
  await page.keyboard.type(String(score));
  await page.getByRole('button', { name: `Conferma il punteggio di ${player}` }).click();
  await expect(recorded(page, player)).toHaveText(String(score));
}
test('home, result entry, reload, correction, qualification and final', async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Accesso richiesto' })).toBeVisible();
  await shot(page, '01-home');
  expect((await page.request.get('/api/v1/players')).status()).toBe(401);
  expect((await page.request.get('/assets/../../.env')).status()).not.toBe(200);
  await page.getByRole('link', { name: /NUOVA PARTITA/ }).click();
  await page.getByRole('button', { name: 'Scegli i giocatori' }).click();
  await expect(page.getByRole('button', { name: 'Avvia partita' })).toBeDisabled();
  await login(page);
  // A Hi-Score night with three players: fewer than four, so the final is played directly.
  await newTournament(page, {
    format: 'Hi-Score rapido',
    players: ['Frank', 'Giulia', 'Hugo'],
    tracking: 'Flessibile',
  });
  await expect(page.getByRole('heading', { name: 'Hi-Score Night', exact: false })).toBeVisible();
  await openFinalResult(page);
  // Typing before the keypad is ready would be lost.
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeEnabled();
  await page.keyboard.type('1270');
  // The keypad refuses more than 7 rounds × 180.
  await expect(page.getByLabel('Punteggio finale da confermare')).toHaveText('127');
  await page.getByRole('button', { name: 'Cancella ultima cifra' }).click();
  await page.getByRole('button', { name: 'Azzera' }).click();
  await page.keyboard.type('640');
  await shot(page, '03-partita-live');
  // The result screen fits the phone; the guided Risultati tab scrolls by design.
  if (!(await page.locator('.match-screen').count()))
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      844,
    );
  await page.setViewportSize({ width: 844, height: 390 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(844);
  await shot(page, '06-live-landscape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Conferma il punteggio di Frank' }).click();
  await expect(recorded(page, 'Frank')).toHaveText('640');
  await page.reload();
  await enterScore(page, 'Giulia', 580);
  // A wrong total is corrected by selecting the player again before the match ends.
  await page.getByRole('radio', { name: /Giulia/ }).click();
  await enterScore(page, 'Giulia', 590);
  await enterScore(page, 'Hugo', 700);
  await expect(page.getByRole('heading', { name: 'Risultato registrato' })).toBeVisible();
  await page.getByRole('link', { name: 'VAI AL TORNEO' }).click();
  await shot(page, '05-hiscore-nights');
  await page.getByRole('button', { name: 'CONFERMA RISULTATO FINALE' }).click();
  await page.getByRole('tab', { name: 'Risultati' }).click();
  await expect(page.locator('.pod .p1')).toContainText('Hugo');
  await page.goto('/partite/nuova');
  await page.getByRole('button', { name: 'Scegli i giocatori' }).click();
  await addPlayer(page, 'Ivo');
  await addPlayer(page, 'Lea');
  await shot(page, '02-nuova-partita');
  await page.goto('/impostazioni');
  await expect(page.getByText('Raggiungibile')).toBeVisible();
  await expect(page.locator('.row', { hasText: 'Letture pubbliche' }).locator('.v')).toHaveText(
    'Disattivate',
  );
  expect(errors).toEqual([]);
});
test('group setup and responsive views', async ({ page }) => {
  await login(page);
  await newTournament(page, {
    format: 'Gironi',
    game: '301 Masters',
    players: ['Marco', 'Davide', 'Sara', 'Elena'],
    tracking: 'Flessibile',
    start: false,
  });
  await shot(page, '04-torneo');
  await page.getByRole('button', { name: 'Avvia torneo' }).click();
  await page.getByRole('tab', { name: 'Gironi' }).click();
  await expect(page.locator('a.mrow.match')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Panoramica' }).click();
  async function playNext() {
    await page.getByRole('link', { name: 'Gioca l’incontro' }).click();
    await openFinalResult(page);
    const first = page.locator('.result-rows [role="radio"]').first();
    await first.click();
    await page.getByRole('button', { name: 'CONFERMA RISULTATO' }).click();
    await expect(page.getByRole('heading', { name: 'Risultato registrato' })).toBeVisible();
    await page.getByRole('link', { name: /VAI AL TORNEO|Classifica del torneo/ }).click();
  }
  await playNext();
  await playNext();
  await page.getByRole('button', { name: 'CONFERMA QUALIFICA' }).click();
  await page.getByRole('button', { name: 'GENERA TABELLONE' }).click();
  await page.getByRole('tab', { name: 'Tabellone' }).click();
  await expect(page.locator('.bracket-match')).toHaveCount(2);
  await page.getByRole('tab', { name: 'Panoramica' }).click();
  await playNext();
  await playNext();
  await playNext();
  await page.getByRole('button', { name: 'CONFERMA RISULTATO FINALE' }).click();
  await expect(page.getByRole('heading', { name: 'Risultato ufficiale' })).toBeVisible();
  for (const width of [360, 430, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ['/', '/partite/nuova', '/tornei/nuovo', '/giocatori', '/serate']) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
  }
});

// A tournament created before final results existed keeps the turn-by-turn screen.
test('resolves a tied final with a real playoff', async ({ page, request }) => {
  const headers = { Authorization: `Bearer ${token}` };
  async function post(path: string, data: unknown) {
    const response = await request.post(`/api/v1${path}`, {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const a = await post('/players', { displayName: 'Anna playoff' });
  const b = await post('/players', { displayName: 'Luca playoff' });
  let t = await post('/tournaments', {
    name: 'Parità finale',
    mode: 'QUICK_HIGH_SCORE',
    recording: 'turns',
    scoringConfiguration: { turns: 1 },
    tournamentConfiguration: { qualifiers: 2 },
  });
  for (const p of [a, b])
    t = await post(`/tournaments/${t.id}/players`, { expectedVersion: t.version, playerId: p.id });
  t = await post(`/tournaments/${t.id}/start`, { expectedVersion: t.version });
  async function seedMatch(matchId: string, scores: number[]) {
    let m = t.matches.find((match: { id: string }) => match.id === matchId);
    t = await post(`/matches/${matchId}/start`, {
      expectedVersion: t.version,
      expectedMatchVersion: m.version,
    });
    for (const score of scores) {
      m = await (await request.get(`/api/v1/matches/${matchId}`, { headers })).json();
      t = await post(`/matches/${matchId}/scores`, {
        expectedVersion: m.tournamentVersion,
        expectedMatchVersion: m.version,
        turnId: m.turnState.currentTurn.id,
        score,
      });
      const updated = t.matches.find((match: { id: string }) => match.id === matchId);
      t = await post(`/matches/${matchId}/turns/complete`, {
        expectedVersion: t.version,
        expectedMatchVersion: updated.version,
        turnId: m.turnState.currentTurn.id,
      });
    }
  }
  await seedMatch(t.matches[0].id, [140, 100]);
  t = await post(`/tournaments/${t.id}/qualification/finalize`, { expectedVersion: t.version });
  t = await post(`/tournaments/${t.id}/finals/generate`, { expectedVersion: t.version });
  await seedMatch(t.matches.at(-1).id, [100, 100]);
  await login(page);
  await page.goto(`/hiscore/${t.id}?tab=final`);
  await expect(page.getByRole('alert')).toContainText('Parità decisiva');
  await expect(page.getByRole('button', { name: 'CONFERMA RISULTATO FINALE' })).toBeDisabled();
  await page.getByRole('button', { name: 'Spareggio sul totem' }).click();
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
  await page.getByRole('button', { name: 'CREA INCONTRO DI SPAREGGIO' }).click();
  await page.getByRole('link', { name: 'Gioca lo spareggio' }).click();
  await page.getByRole('button', { name: 'Inizia incontro' }).click();
  await expect(page.locator('.turn-banner')).toBeVisible();
  const firstPlayoffTurn = await page.locator('.turn-banner').textContent();
  await page.keyboard.type('140');
  await confirmTurn(page).click();
  await expect(page.locator('.turn-banner')).not.toHaveText(firstPlayoffTurn!);
  await page.keyboard.type('100');
  await confirmTurn(page).click();
  await page.getByRole('link', { name: 'VAI ALLA CLASSIFICA' }).click();
  await page.getByRole('button', { name: 'CONFERMA RISULTATO FINALE' }).click();
  await page.getByRole('tab', { name: 'Risultati' }).click();
  await expect(page.getByRole('heading', { name: 'Risultato ufficiale' })).toBeVisible();
});
