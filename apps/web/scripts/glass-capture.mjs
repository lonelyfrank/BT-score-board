import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = process.env.GLASS_ORIGIN || 'http://127.0.0.1:5173';
const output = new URL('../../../docs/liquid-glass-material/screenshots/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(origin + '/glass-lab.html');
  await page.locator('.lab-proposal .bt-navigation').waitFor();
  for (const scene of ['cards', 'text', 'photo', 'grid']) {
    await page.getByLabel('Scena', { exact: true }).selectOption(scene);
    await page
      .locator('.lab-scene')
      .first()
      .evaluate((el) => {
        el.scrollTop = 160;
      });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${output.pathname}comparison-${scene}.png`, fullPage: true });
  }
  await page.getByLabel('Scena', { exact: true }).selectOption('cards');
  await page.getByLabel('Contenuto chiaro').check();
  await page.screenshot({ path: `${output.pathname}comparison-light.png`, fullPage: true });
  await page.getByLabel('Forza fallback opaco').check();
  await page.screenshot({ path: `${output.pathname}comparison-opaque.png`, fullPage: true });
  await page.getByLabel('Forza fallback opaco').uncheck();
  await page.getByLabel('Contenuto chiaro').uncheck();
  await page.getByLabel('Scena', { exact: true }).selectOption('grid');
  await page.locator('summary').click();
  for (const name of ['Satinatura', 'Tinta', 'Riflessi'])
    await page.getByRole('slider', { name, exact: true }).fill('0');
  const nav = page.locator('.lab-proposal .bt-navigation');
  // No labels in the optical diagnostic: isolate movement of the actual grid.
  await page.addStyleTag({
    content: '.lab-proposal :is(.bt-nav-item,.bt-nav-selection) {visibility:hidden}',
  });
  await nav.screenshot({ path: `${output.pathname}grid-refraction.png` });
  await page.getByLabel('Solo satinatura', { exact: true }).check();
  await nav.screenshot({ path: `${output.pathname}grid-satin.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/');
  await page.locator('.bottom-nav').waitFor();
  await page.screenshot({ path: `${output.pathname}after-home.png` });
  await writeFile(
    new URL('../capture-info.json', output),
    JSON.stringify(
      {
        version: browser.version(),
        origin,
        mode: 'Chromium headless desktop; mobile viewport 390x844, not a physical device',
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await browser.close();
}
