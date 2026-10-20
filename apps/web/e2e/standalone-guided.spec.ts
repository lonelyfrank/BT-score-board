import { expect, test, type Page } from '@playwright/test';
import { addPlayers, enterScore, guardNetwork } from './helpers';

// V1.3 Guided Scoring: the turn at the board, the three darts, the round matrix and the
// official result, end to end on the standalone PWA.

const shots = '../../docs/release/screenshots-v1.3';
const shot = (page: Page, name: string, fullPage = false) =>
  page.screenshot({ path: `${shots}/${name}.png`, fullPage });
const now = (page: Page) => page.locator('.g-now');
const cta = (page: Page) => page.locator('.g-ctas .cta');
const toast = (page: Page) => page.locator('.g-toast');

/** A free match with rounds tracked (tracking chosen in the advanced options). */
async function trackedMatch(
  page: Page,
  players: string[],
  tracking: 'Flessibile' | 'Round per round',
  teams?: (page: Page) => Promise<void>,
) {
  await page.goto('/partite/nuova');
  await addPlayers(page, players);
  if (teams) await teams(page);
  await page.getByText(/^Opzioni avanzate/).click();
  await page.getByRole('radio', { name: tracking }).click();
  await page.getByRole('button', { name: 'INIZIA PARTITA' }).click();
  await page.getByRole('button', { name: 'CONFERMA E INIZIA' }).click();
  await expect(page).toHaveURL(/\/partite\/[0-9a-f-]{36}$/);
  await expect(now(page)).toBeVisible();
}
async function atBoard(page: Page, name: string, round?: number) {
  await expect(now(page).locator('h2')).toHaveText(name);
  if (round) await expect(page.locator('.g-round > b')).toContainText(`Round ${round}`);
}
/** Quick entry: the total of the turn typed on the keypad, Enter confirms. */
async function total(page: Page, name: string, value: number) {
  await atBoard(page, name);
  await page.getByRole('radio', { name: 'Totale' }).click();
  await page.keyboard.type(String(value));
  await expect(page.getByLabel('Valore del turno da confermare')).toHaveText(String(value));
  await cta(page).click();
  await expect(toast(page)).toContainText(name);
}
const dismissInterlude = async (page: Page) => {
  const next = page.locator('.g-next');
  if (await next.isVisible()) await next.click();
};

test('guided Hi-Score: three darts, quick totals, next player, reload, matrix and result', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const guard = guardNetwork(page);
  // Screenshots without transitions caught half way.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await trackedMatch(page, ['Frank', 'Salvo', 'Marco', 'Luca'], 'Flessibile');
  await atBoard(page, 'Frank', 1);
  await expect(now(page)).toContainText('Ora al bersaglio');
  await expect(now(page)).toContainText('Dopo: Salvo');
  await expect(page.getByRole('navigation', { name: 'Navigazione della partita' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toHaveCount(0);
  await shot(page, '01-turno-attivo');

  // Scenario B: single 20, off the board, triple 20 = 80.
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('button', { name: '0', exact: true }).click();
  await page.getByRole('button', { name: 'Singolo' }).click();
  await page.getByRole('button', { name: 'Fuori bersaglio' }).click();
  await page.keyboard.type('20t');
  await expect(page.locator('.dart-cell')).toHaveText([/20.*Singolo/, /Fuori/, /T20.*Triplo/]);
  await expect(page.locator('.g-sum .big strong')).toHaveText('80');
  await expect(page.locator('.g-sum')).toContainText('Totale provvisorio80');
  await expect(cta(page)).toHaveText('CONFERMA ROUND → SALVO');
  await shot(page, '02-tre-freccette');
  await cta(page).dblclick();
  await expect(toast(page)).toContainText('Frank · 80 punti · totale 80');
  await atBoard(page, 'Salvo', 1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(toast(page)).toHaveCount(0, { timeout: 8000 });
  await shot(page, '03-prossimo-giocatore');

  // An unobserved dart is not zero: the total comes from the totem.
  await page.keyboard.type('19s');
  await page.locator('.dart-cell').nth(1).click();
  await page.locator('.dart-cell').nth(1).click();
  await page.getByRole('radio', { name: /Non osservata/ }).click();
  await page.getByRole('button', { name: 'CONFERMA FRECCETTA' }).click();
  await page.keyboard.type('1s');
  await expect(cta(page)).toBeDisabled();
  await expect(page.locator('.g-ctas')).toContainText('Freccetta non osservata');
  await page.getByRole('button', { name: 'Inserisci il totale' }).click();
  await page.keyboard.type('85');
  await cta(page).click();
  await expect(toast(page)).toContainText('Salvo · 85 punti');

  // Scenario C: a quick total, no darts invented.
  await total(page, 'Marco', 60);
  await total(page, 'Luca', 45);
  await expect(page.getByRole('heading', { name: 'Round 1 completato' })).toBeVisible();
  await expect(page.locator('.g-next')).toContainText('Round 2 di 7 · ora tocca aFrank');
  await shot(page, '04-round-completato');
  await page.locator('.g-next').click();

  // Scenario H: closed and reopened, the same turn with its draft digits.
  await page.getByRole('radio', { name: 'Totale' }).click();
  await page.keyboard.type('7');
  await page.reload();
  await atBoard(page, 'Frank', 2);
  await expect(now(page)).toContainText('Dopo: Salvo');
  await expect(page.getByLabel('Valore del turno da confermare')).toHaveText('7');
  await page.keyboard.press('Backspace');

  // Scenario D: Frank's round 1 corrected from the matrix; the turn at the board stays.
  await page.getByRole('link', { name: 'Matrice' }).click();
  await page.getByRole('button', { name: 'Frank, round 1: 80' }).click();
  await expect(page.locator('.g-cell')).toContainText('Dettaglio freccette');
  await expect(page.locator('.g-cell .dart-cell')).toHaveText([/20/, /Fuori/, /T20/]);
  await page.getByRole('button', { name: 'Marco, round 1: 60' }).click();
  await expect(page.locator('.g-cell')).toContainText('Solo totale');
  await page.getByRole('button', { name: 'Frank, round 1: 80' }).click();
  await shot(page, '05-matrice-round');
  await page.getByRole('button', { name: 'Modifica' }).click();
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('100');
  await page.getByRole('button', { name: 'SALVA', exact: true }).click();
  await expect(toast(page)).toContainText('80 → 100');
  await expect(page.locator('.g-cell')).toContainText(
    'Le freccette danno 80, il valore registrato è 100',
  );
  await expect(page.locator('.g-cell .g-hist li')).toHaveCount(2);
  await page.getByRole('link', { name: 'Live' }).click();
  await atBoard(page, 'Frank', 2);

  // The remaining six rounds, quickly.
  for (let r = 2; r <= 7; r++) {
    for (const [name, value] of [
      ['Frank', 70],
      ['Salvo', 60],
      ['Marco', 50],
      ['Luca', 40],
    ] as const) {
      await dismissInterlude(page);
      await total(page, name, value);
    }
  }
  await expect(page.getByRole('heading', { name: 'Partita completata' })).toBeVisible();
  await page.getByRole('link', { name: 'Classifica' }).click();
  await page.getByRole('radio', { name: 'Provvisoria' }).click();
  await expect(page.locator('.g-board li').first()).toContainText('Frank');
  await expect(page.locator('.g-rank')).toContainText('provvisoria e non ufficiale');

  // The official totals come from the totem; the companion only checks them.
  await page.getByRole('link', { name: 'Risultati' }).click();
  await expect(page.locator('.g-res li').first()).toContainText('Companion 520');
  await enterScore(page, 'Frank', 520);
  await enterScore(page, 'Salvo', 445);
  await enterScore(page, 'Marco', 360);
  await page.keyboard.type('290');
  await page.getByRole('button', { name: 'Conferma il punteggio di Luca' }).click();
  const difference = page.getByRole('alertdialog', { name: 'Risultato diverso dai round' });
  await expect(difference).toContainText('Luca: round 285, totem 290 (differenza +5)');
  await difference.getByLabel(/Motivo/).fill('R4 letto male');
  await difference.getByRole('button', { name: 'CONFERMA IL VALORE DEL TOTEM' }).click();
  await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
  await expect(page.locator('.g-res li').first()).toContainText('COINCIDE');
  await expect(page.locator('.g-res li').last()).toContainText('TOTEM CONFERMATO');
  await expect(toast(page)).toHaveCount(0, { timeout: 8000 });
  await shot(page, '06-risultato-finale', true);
  expect(guard.api).toEqual([]);
  expect(guard.errors).toEqual([]);
});

test('uneven teams: the actual thrower rotates, undo takes back a turn without moving twice', async ({
  page,
}) => {
  const guard = guardNetwork(page);
  await trackedMatch(
    page,
    ['Ada', 'Bea', 'Ciro', 'Dino', 'Elio', 'Fede', 'Gino'],
    'Flessibile',
    async (p) => {
      await p.getByRole('radio', { name: 'Squadre' }).click();
      await p.getByRole('radio', { name: 'In ordine' }).click();
      await p.getByRole('button', { name: 'Genera squadre' }).click();
      await expect(p.getByLabel('Componenti squadra 4')).toHaveText(/Gino/);
      await p.getByText(/^Squadre disomogenee \(2 · 2 · 2 · 1 giocatori\)/).click();
    },
  );
  // Four units on four seats: one session, no heats.
  await expect(page.locator('.heat-timeline')).toHaveCount(0);
  await atBoard(page, 'Ada', 1);
  await expect(now(page)).toContainText('Ora al bersaglio · Ada + Bea');
  await expect(now(page)).toContainText('Tiratore 1 di 2 · con Bea');
  await expect(now(page)).toContainText('Dopo: Ciro');
  await total(page, 'Ada', 60);
  await atBoard(page, 'Ciro');
  // Undo from the notice: Ada again, her round taken back, the rotation not moved twice.
  await toast(page).getByRole('button', { name: 'Annulla' }).click();
  await atBoard(page, 'Ada', 1);
  await total(page, 'Ada', 50);
  for (const name of ['Ciro', 'Elio', 'Gino']) await total(page, name, 40);
  await page.locator('.g-next').click();
  // Round 2: the second member of every pair, the single again.
  await atBoard(page, 'Bea', 2);
  await expect(now(page)).toContainText('Dopo: Dino');
  // A double tap on the confirmation saves once.
  await page.getByRole('radio', { name: 'Totale' }).click();
  await page.keyboard.type('33');
  await cta(page).dblclick();
  await atBoard(page, 'Dino', 2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('link', { name: 'Matrice' }).click();
  await expect(page.locator('.g-mx tbody tr').first()).toContainText('5033');
  await page.getByRole('button', { name: 'Ada + Bea, round 1: 50' }).click();
  await expect(page.locator('.g-cell header')).toContainText('Ada + Bea (Ada) · Round 1');
  await expect(page.locator('.g-cell .g-hist')).toContainText('annullato');
  await page.getByRole('button', { name: 'Ada + Bea, round 2: 33' }).click();
  await expect(page.locator('.g-cell header')).toContainText('(Bea)');

  // Controls: pick who is at the board, pause and resume the rotation.
  await page.getByRole('link', { name: 'Live' }).click();
  await page.getByRole('button', { name: 'Controlli del turno' }).click();
  await page.getByRole('button', { name: /Scegli chi è al bersaglio/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Gino/ }).click();
  await atBoard(page, 'Gino', 2);
  await page.getByRole('button', { name: 'Controlli del turno' }).click();
  await page.getByRole('button', { name: /Metti in pausa la rotazione/ }).click();
  await total(page, 'Gino', 20);
  await expect(page.getByRole('heading', { name: 'Chi è al bersaglio?' })).toBeVisible();
  await page.getByRole('button', { name: 'Riprendi la rotazione' }).click();
  // Round 3: the pair's rotation is back to its first thrower.
  await atBoard(page, 'Ada', 3);
  // Dino and Fede were passed in round 2: listed for verification.
  await page.getByRole('link', { name: 'Classifica' }).click();
  await page.getByRole('radio', { name: 'Tutti i round' }).click();
  await expect(page.locator('.g-order > li').nth(1)).toContainText('2 DA INSERIRE');
  expect(guard.api).toEqual([]);
  expect(guard.errors).toEqual([]);
});

test('round by round: skipped turn, correction, official result, difference and history', async ({
  page,
}) => {
  await trackedMatch(page, ['Ivo', 'Lea'], 'Round per round');
  await total(page, 'Ivo', 60);
  await total(page, 'Lea', 40);
  await page.locator('.g-next').click();
  // Ivo's round 2 was not seen: skipped, never zero.
  await atBoard(page, 'Ivo', 2);
  await page.getByRole('button', { name: 'Controlli del turno' }).click();
  await page.getByRole('button', { name: /Salta il turno di Ivo/ }).click();
  await expect(toast(page)).toContainText('saltato');
  await total(page, 'Lea', 40);
  for (let r = 3; r <= 7; r++) {
    await dismissInterlude(page);
    await total(page, 'Ivo', 40);
    await total(page, 'Lea', 40);
  }
  await expect(page.getByRole('heading', { name: 'Partita completata' })).toBeVisible();
  await page.getByRole('link', { name: 'Matrice' }).click();
  await expect(page.getByRole('button', { name: 'Ivo, round 2: salt.' })).toBeVisible();
  await page.getByRole('button', { name: 'Ivo, round 3: 40' }).click();
  await page.getByRole('button', { name: 'Modifica' }).click();
  await page.keyboard.press('Backspace');
  await page.keyboard.type('5');
  await page.getByRole('button', { name: 'SALVA', exact: true }).click();
  await expect(page.locator('.g-mx tbody tr').first().locator('td.tot')).toHaveText('265');

  await page.getByRole('link', { name: 'Risultati' }).click();
  await expect(page.locator('.g-res li').first()).toContainText('Companion 265 parziale');
  await enterScore(page, 'Ivo', 330);
  await page.keyboard.type('300');
  await page.getByRole('button', { name: 'Conferma il punteggio di Lea' }).click();
  const difference = page.getByRole('alertdialog', { name: 'Risultato diverso dai round' });
  await expect(difference).toContainText('Lea: round 280, totem 300 (differenza +20)');
  await expect(
    difference.getByRole('button', { name: 'CONFERMA IL VALORE DEL TOTEM' }),
  ).toBeDisabled();
  await difference.getByLabel(/Motivo/).fill('R5 letto male');
  await difference.getByRole('button', { name: 'CONFERMA IL VALORE DEL TOTEM' }).click();
  await expect(page.getByRole('heading', { name: 'Partita conclusa' })).toBeVisible();
  await expect(page.locator('.final-rows li.first')).toContainText('Ivo');
  await expect(page.getByText('Lea: ufficiale 300, round 280 — R5 letto male')).toBeVisible();
  await expect(page.locator('.g-res li').first()).toContainText('TOTEM REGISTRATO');

  // After a reload the history of every observation is still there.
  await page.reload();
  await expect(page.getByText('Lea: ufficiale 300, round 280 — R5 letto male')).toBeVisible();
  await page.getByRole('link', { name: 'Matrice' }).click();
  await page.getByRole('button', { name: 'Ivo, round 3: 45' }).click();
  await expect(page.locator('.g-cell .g-hist li')).toHaveText([
    /40 · sostituito/,
    /45 · registrato/,
  ]);
});
