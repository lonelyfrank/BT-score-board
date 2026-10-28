import { expect, test } from '@playwright/test';
import { addPlayers, atBt, gameRadio, guardNetwork } from './helpers';

test('the wizard asks where the match counts, keeps the draft, and scoreboards stay apart', async ({
  page,
}) => {
  const guard = guardNetwork(page);
  await page.goto('/partite/nuova');
  await expect(page.getByRole('heading', { name: 'Dove giocate?' })).toBeVisible();
  // Nothing is chosen for them.
  await expect(page.getByRole('button', { name: 'Scegli il gioco' })).toBeDisabled();

  await page.getByRole('radio', { name: /Altrove/ }).click();
  await page.getByRole('button', { name: /Nuovo punto di incontro/ }).click();
  await expect(page.getByRole('button', { name: 'Scegli il gioco' })).toBeDisabled();
  await page.getByLabel('Nome del punto').fill('Da Gino');
  await page.getByLabel(/^Luogo/).fill('sala sul retro');
  await page.getByLabel(/^Dov’è il bersaglio/).fill('vicino al bancone');

  // Switching locations keeps all the new point's fields and restores the selection.
  await page.getByRole('radio', { name: /Al Bite the Trouble/ }).check();
  await expect(page.getByLabel('Nome del punto')).toBeHidden();
  await expect(page.getByRole('status')).toHaveText(
    'I risultati saranno conteggiati nella scoreboard Bite the Trouble.',
  );
  await page.getByRole('radio', { name: /Altrove/ }).check();
  await expect(page.getByLabel('Nome del punto')).toHaveValue('Da Gino');
  await expect(page.getByLabel(/^Luogo/)).toHaveValue('sala sul retro');
  await expect(page.getByLabel(/^Dov’è il bersaglio/)).toHaveValue('vicino al bancone');
  await page.getByRole('button', { name: 'Scegli il gioco' }).click();
  await gameRadio(page, 'Hi-Score').click();
  await page.getByRole('button', { name: 'Scegli i giocatori' }).click();
  await addPlayers(page, ['Frank', 'Salvo']);

  // Going back keeps the other fields of the draft.
  await page.getByRole('button', { name: 'Indietro' }).click();
  await page.getByRole('link', { name: 'Torna al punto di incontro' }).click();
  await expect(page.getByLabel('Nome del punto')).toHaveValue('Da Gino');
  await expect(page.getByLabel(/^Luogo/)).toHaveValue('sala sul retro');
  await page.getByRole('button', { name: 'Scegli il gioco' }).click();
  await page.getByRole('button', { name: 'Scegli i giocatori' }).click();
  await expect(page.getByRole('list', { name: 'Ordine di tiro' })).toContainText('Frank');
  await expect(page.getByText('I risultati contano nella scoreboard Da Gino')).toBeVisible();
  await page.getByRole('button', { name: 'Avvia partita' }).click();
  await expect(page).toHaveURL(/\/partite\/[0-9a-f-]{36}$/);

  // The new space exists with its own scoreboard; the BT one is untouched.
  await page.goto('/punti');
  await expect(page.getByRole('link', { name: /Da Gino/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Bite the Trouble/ })).toBeVisible();
  await page.getByRole('link', { name: /Bite the Trouble/ }).click();
  await expect(page.getByText('Ancora nessuna partita')).toBeVisible();

  // "Yes, at the BT" skips the list and counts there.
  await atBtMatch(page);
  expect(guard.api).toEqual([]);
  expect(guard.errors).toEqual([]);
});

async function atBtMatch(page: import('@playwright/test').Page) {
  await page.goto('/partite/nuova');
  await atBt(page);
  await expect(page.getByRole('button', { name: 'Scegli i giocatori' })).toBeVisible();
  await expect(page.getByText('Passo 2 di 3')).toBeVisible();
}
