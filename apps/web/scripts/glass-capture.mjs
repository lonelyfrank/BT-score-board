import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const origin = process.env.GLASS_ORIGIN || 'http://127.0.0.1:5173';
const output = new URL('../../../docs/liquid-glass-v3/screenshots/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
await page.goto(`${origin}/glass-lab.html`);
await page.getByRole('heading', { name: 'Glass Laboratory', exact: true }).waitFor();
await page.screenshot({ path: `${output.pathname}laboratory-dark.png`, fullPage: true });
await page.getByLabel('Contenuto chiaro').check();
await page.getByRole('button', { name: 'Tornei', exact: true }).first().click();
await page.screenshot({
  path: `${output.pathname}laboratory-light.png`,
  fullPage: true,
  animations: 'disabled',
});
await page.getByLabel('Forza fallback opaco').check();
await page.screenshot({ path: `${output.pathname}laboratory-fallback.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
for (const [name, path] of [
  ['home', '/'],
  ['players', '/giocatori'],
]) {
  await page.goto(origin + path);
  await page.locator('.bottom-nav').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${output.pathname}after-${name}.png`, scale: 'css' });
}
await writeFile(
  new URL('../capture-info.json', output),
  JSON.stringify(
    {
      browser: browser.version(),
      viewport: '390x844 after; 1440x900 laboratory',
      origin,
      note: 'Before: initial commit af78c9d, captured before edits at 390x844, DPR 2.',
    },
    null,
    2,
  ) + '\n',
);
await browser.close();
