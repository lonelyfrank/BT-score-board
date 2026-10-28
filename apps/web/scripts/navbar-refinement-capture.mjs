import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = process.env.GLASS_ORIGIN || 'http://127.0.0.1:5173';
const output = new URL('../../../docs/navbar-refinement/screenshots/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const phase = process.argv[2] || 'after';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  await page.goto(origin + '/');
  await page.locator('.bottom-nav').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: output + `${phase}-home.png` });
  if (phase === 'before') {
    // First change ONLY tint: preserve blur, brightness, scrim and selection.
    for (const alpha of [0.3, 0.2, 0.14]) {
      await page
        .locator('.bottom-nav')
        .evaluate((nav, alpha) => nav.style.setProperty('--bt-nav-tint-alpha', alpha), alpha);
      await page.screenshot({ path: output + `calibration-tint-${alpha}.png` });
    }
    await page.goto(origin + '/glass-lab.html');
    await page.locator('.lab-proposal').waitFor();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByLabel('Scena', { exact: true }).selectOption('photo');
    await page
      .locator('.lab-scene')
      .first()
      .evaluate((el) => (el.scrollTop = 320));
    await page.locator('.lab-proposal').screenshot({ path: output + 'before-photo.png' });
    for (const blur of [16, 12, 10]) {
      await page.locator('.lab-proposal .bt-navigation').evaluate((nav, blur) => {
        nav.style.setProperty('--bt-nav-tint-alpha', '.14');
        nav.style.setProperty('--bt-nav-blur', `${blur}px`);
      }, blur);
      await page
        .locator('.lab-proposal')
        .screenshot({ path: output + `calibration-blur-${blur}.png` });
    }
  } else {
    await page.goto(origin + '/glass-lab.html');
    await page.locator('.lab-proposal').waitFor();
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const scene of ['cards', 'text', 'photo', 'grid']) {
      await page.getByLabel('Scena', { exact: true }).selectOption(scene);
      await page
        .locator('.lab-scene')
        .first()
        .evaluate((el) => (el.scrollTop = 320));
      await page.locator('.lab-proposal').screenshot({ path: output + `after-${scene}.png` });
    }
    await page.getByLabel('Scena', { exact: true }).selectOption('cards');
    await page.getByLabel('Contenuto chiaro').check();
    await page.locator('.lab-proposal').screenshot({ path: output + 'after-light.png' });
    await page.getByLabel('Solo satinatura', { exact: true }).check();
    await page.locator('.lab-proposal').screenshot({ path: output + 'after-satin.png' });
    await page.getByLabel('Forza fallback opaco').check();
    await page.locator('.lab-proposal').screenshot({ path: output + 'after-opaque.png' });
  }
  await writeFile(
    output + `../${phase}-capture.json`,
    JSON.stringify(
      {
        browser: browser.version(),
        viewport: 'Home: 390x844 DPR1; lab: 1440x1000',
        mode: 'Linux Chromium headless; no physical device',
        origin,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await browser.close();
}
