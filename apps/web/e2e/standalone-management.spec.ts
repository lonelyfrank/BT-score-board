import { expect, test } from '@playwright/test';
import { addPlayers, atBt, chooseTracking, guardNetwork } from './helpers';

test.beforeEach(({ page }) => guardNetwork(page));

test('Gestione lists a live match, opens its management page and pauses it', async ({ page }) => {
  await page.goto('/partite/nuova');
  await atBt(page);
  await chooseTracking(page, 'Solo finale');
  await page.getByRole('button', { name: 'Scegli i giocatori' }).click();
  await addPlayers(page, ['P1', 'P2']);
  await page.getByRole('button', { name: 'Avvia partita' }).click();

  await page.goto('/impostazioni');
  await page.getByRole('link', { name: /Gestione/ }).click();
  await expect(page.getByRole('heading', { name: 'Gestione', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: /In corso · 1/ })).toBeChecked();
  await page.getByRole('radio', { name: 'Partite' }).click();
  await page.getByRole('link', { name: /^Gestisci/ }).click();

  // The private owner sees every command; pausing is one tap, without leaving the page.
  await expect(page.getByText('Crei, segni e correggi i tuoi tornei')).toBeVisible();
  await page.getByRole('button', { name: /Metti in pausa/ }).click();
  await expect(page.getByRole('button', { name: /Riprendi il torneo/ })).toBeVisible();
  await page.getByRole('button', { name: /Riprendi il torneo/ }).click();
  await expect(page.getByRole('button', { name: /Metti in pausa/ })).toBeVisible();
});

test('Accesso e permessi shows the role table for the private owner', async ({ page }) => {
  await page.goto('/permessi');
  await expect(page.getByRole('heading', { name: 'Accesso e permessi' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Permessi per ruolo' })).toContainText(
    'Creare partite e tornei',
  );
  await expect(page.getByText('ATTIVO')).toBeVisible();
});

test('Livelli e XP shows the ladder and how the XP are earned', async ({ page }) => {
  await page.goto('/livelli');
  await expect(page.getByRole('heading', { name: 'Livelli e XP' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Scala dei livelli' })).toContainText(
    'Master Birraio',
  );
  await page.getByRole('tab', { name: 'Come si sale' }).click();
  await expect(page.getByText('+50 XP')).toBeVisible();
});
