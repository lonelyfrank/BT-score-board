import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
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
  await page.getByLabel('Token organizzatore').fill(token);
  await page.getByRole('button', { name: 'Collega applicativo' }).click();
  await expect(page.getByText('Accesso organizzatore attivo')).toBeVisible();
}
async function addPlayer(page: Page, name: string) {
  await page.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await page.getByLabel('Nuovo giocatore').fill(name);
  await page.getByRole('button', { name: 'Crea', exact: true }).click();
  await expect(page.getByLabel('Nuovo giocatore')).toHaveValue('');
  await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
}
test('home, real scoring, reload, undo, qualification and final', async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await shot(page, '01-home');
  expect((await page.request.get('/api/v1/players')).status()).toBe(401);
  expect((await page.request.get('/assets/../../.env')).status()).not.toBe(200);
  await page.getByRole('link', { name: /NUOVA PARTITA/ }).click();
  await expect(page.getByRole('button', { name: 'INIZIA PARTITA' })).toBeDisabled();
  await login(page);
  await page.goto('/partite/nuova');
  await addPlayer(page, 'Frank');
  await addPlayer(page, 'Giulia');
  await page.getByRole('button', { name: 'Riduci Turni per giocatore' }).click();
  await page.getByRole('button', { name: 'Riduci Turni per giocatore' }).click();
  await shot(page, '02-nuova-partita');
  await page.getByRole('button', { name: 'INIZIA PARTITA' }).click();
  await page.getByRole('button', { name: 'Conferma e inizia' }).click();
  await expect(page.getByText('TURNO DI Frank')).toBeVisible();
  await page.keyboard.type('181');
  await expect(page.getByLabel('Punteggio da confermare')).toHaveText('18');
  await page.getByRole('button', { name: 'Cancella ultima cifra' }).click();
  await expect(page.getByLabel('Punteggio da confermare')).toHaveText('1');
  await page.getByRole('button', { name: 'Azzera input' }).click();
  await page.getByRole('button', { name: '140', exact: true }).click();
  await shot(page, '03-partita-live');
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole('button', { name: 'Conferma turno' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(844);
  await shot(page, '06-live-landscape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Conferma turno', exact: true }).click();
  await expect(page.getByText('TURNO DI Giulia')).toBeVisible();
  await page.reload();
  await expect(page.getByText('TURNO DI Giulia')).toBeVisible();
  await page.getByRole('button', { name: 'Annulla ultimo turno' }).click();
  await page.getByRole('button', { name: 'Conferma annullamento' }).click();
  await expect(page.getByText('TURNO DI Frank')).toBeVisible();
  await page.getByRole('button', { name: '140', exact: true }).click();
  await page.getByRole('button', { name: 'Conferma turno' }).click();
  await expect(page.getByText('TURNO DI Giulia')).toBeVisible();
  await page.getByRole('button', { name: '100', exact: true }).click();
  await page.getByRole('button', { name: 'Conferma turno' }).click();
  await expect(page.getByRole('heading', { name: 'Incontro terminato' })).toBeVisible();
  await page.getByRole('link', { name: 'VAI ALLA CLASSIFICA' }).click();
  await shot(page, '05-hiscore-nights');
  await page.getByRole('button', { name: 'CONFERMA QUALIFICA' }).click();
  await page.getByRole('button', { name: 'GENERA FINALE' }).click();
  await page.getByRole('button', { name: /VAI ALLA FINALE/ }).click();
  await page.getByRole('link', { name: /Gioca l’incontro/ }).click();
  await page.getByRole('button', { name: 'Inizia incontro' }).click();
  await expect(page.getByText('TURNO DI Frank')).toBeVisible();
  await page.getByRole('button', { name: '180', exact: true }).click();
  await page.getByRole('button', { name: 'Conferma turno' }).click();
  await expect(page.getByText('TURNO DI Giulia')).toBeVisible();
  await page.getByRole('button', { name: '120', exact: true }).click();
  await page.getByRole('button', { name: 'Conferma turno' }).click();
  await page.getByRole('link', { name: 'VAI ALLA CLASSIFICA' }).click();
  await page.getByRole('button', { name: 'CONFERMA RISULTATO FINALE' }).click();
  await page.getByRole('tab', { name: /^Finale/ }).click();
  await expect(page.getByRole('heading', { name: 'Podio finale' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('group setup and responsive views', async ({ page }) => {
  await login(page);
  await page.goto('/tornei/nuovo');
  await page.getByRole('radio', { name: 'A gironi', exact: true }).click();
  await addPlayer(page, 'Marco');
  await addPlayer(page, 'Davide');
  await addPlayer(page, 'Sara');
  await addPlayer(page, 'Elena');
  for (let i = 0; i < 7; i++)
    await page.getByRole('button', { name: 'Riduci Turni per giocatore' }).click();
  await shot(page, '04-torneo');
  await page.getByRole('button', { name: 'AVVIA TORNEO' }).click();
  await page.getByRole('button', { name: 'Conferma e inizia' }).click();
  await page.getByRole('tab', { name: 'Gironi' }).click();
  await expect(page.getByRole('link', { name: /Gioca l’incontro/ })).toHaveCount(2);
  async function playNext() {
    await page
      .getByRole('link', { name: /Gioca l’incontro/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Inizia incontro' }).click();
    await expect(page.getByRole('button', { name: '180', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '180', exact: true }).click();
    const before = await page.locator('.turn-banner').textContent();
    await page.getByRole('button', { name: 'Conferma turno' }).click();
    await expect(page.locator('.turn-banner')).not.toHaveText(before!);
    await page.getByRole('button', { name: '100', exact: true }).click();
    await page.getByRole('button', { name: 'Conferma turno' }).click();
    await page.getByRole('link', { name: 'VAI ALLA CLASSIFICA' }).click();
  }
  await playNext();
  await playNext();
  await page.getByRole('button', { name: 'CONFERMA QUALIFICA' }).click();
  await page.getByRole('button', { name: 'GENERA FINALE' }).click();
  await playNext();
  await playNext();
  await playNext();
  await page.getByRole('button', { name: 'CONFERMA RISULTATO FINALE' }).click();
  await page.getByRole('tab', { name: /^Finale/ }).click();
  await expect(page.getByRole('heading', { name: 'Podio finale' })).toBeVisible();
  for (const width of [360, 430, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ['/', '/partite/nuova', '/tornei/nuovo', '/giocatori']) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
  }
});

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
  await page.getByRole('button', { name: 'CONFERMA RISULTATO FINALE' }).click();
  await expect(page.getByRole('alert')).toContainText('Parità decisiva');
  await page.getByRole('button', { name: 'Organizza spareggio' }).click();
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
  await page.getByRole('button', { name: 'Crea incontro di spareggio' }).click();
  await page.getByRole('link', { name: /Gioca l’incontro/ }).click();
  await page.getByRole('button', { name: 'Inizia incontro' }).click();
  await expect(page.locator('.turn-banner')).toBeVisible();
  const firstPlayoffTurn = await page.locator('.turn-banner').textContent();
  await page.getByRole('button', { name: '140', exact: true }).click();
  await page.getByRole('button', { name: 'Conferma turno' }).click();
  await expect(page.locator('.turn-banner')).not.toHaveText(firstPlayoffTurn!);
  await page.getByRole('button', { name: '100', exact: true }).click();
  await page.getByRole('button', { name: 'Conferma turno' }).click();
  await page.getByRole('link', { name: 'VAI ALLA CLASSIFICA' }).click();
  await page.getByRole('button', { name: 'CONFERMA RISULTATO FINALE' }).click();
  await page.getByRole('tab', { name: /^Finale/ }).click();
  await expect(page.getByRole('heading', { name: 'Podio finale' })).toBeVisible();
});
