import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium, firefox, webkit } from '@playwright/test';

const engine = process.argv[2] || 'chromium';
const browser = await { chromium, firefox, webkit }[engine].launch();
const origin = process.env.GLASS_ORIGIN || 'http://127.0.0.1:5173';
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const report = { engine, version: browser.version(), checks: [], performance: {} };
try {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(origin + '/giocatori');
    await page.locator('.bottom-nav').waitFor();
    const geometry = await page.locator('.bottom-nav').evaluate((nav) => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      targets: [...nav.querySelectorAll('a')].map((a) => {
        const r = a.getBoundingClientRect();
        return (
          r.width >= 44 && r.height >= 44 && a.querySelector('span').scrollWidth <= a.clientWidth
        );
      }),
    }));
    assert.equal(geometry.overflow, false);
    assert.ok(geometry.targets.every(Boolean));
    report.checks.push(`layout ${viewport.width}x${viewport.height}`);
  }
  for (const [label, path] of [
    ['Home', '/'],
    ['Partite', '/partite/nuova'],
    ['Tornei', '/tornei'],
    ['Hi-Score', '/hiscore'],
    ['Giocatori', '/giocatori'],
  ]) {
    await page.locator('.bottom-nav').getByRole('link', { name: label, exact: true }).click();
    await page.waitForURL(origin + path);
    assert.equal(await page.locator('.bottom-nav [aria-current="page"]').count(), 1);
  }
  report.checks.push('five routes');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Nuovo giocatore' }).click();
  await page.getByLabel('Nome', { exact: true }).focus();
  assert.equal(await page.locator('.bottom-nav').isVisible(), false);
  await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
  assert.equal(await page.locator('.bottom-nav').isVisible(), true);
  report.checks.push('touch input focus hides navigation and closing restores it');

  await page.goto(origin + '/glass-lab.html');
  await page.getByRole('heading', { name: 'Glass Laboratory', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Giocatori', exact: true }).first().click();
  assert.equal(await page.locator('[aria-pressed="true"]').count(), 3);
  assert.equal(await page.locator('[aria-pressed="true"]').first().innerText(), 'Giocatori');
  await page.getByLabel('Contenuto chiaro').check();
  await page.getByLabel('Forza fallback opaco').check();
  for (const nav of await page.locator('.bt-navigation').all()) {
    assert.deepEqual(
      await nav.evaluate((el) => ({
        bg: getComputedStyle(el).backgroundColor,
        blur: getComputedStyle(el).backdropFilter,
      })),
      { bg: 'rgb(32, 33, 38)', blur: 'none' },
    );
  }
  await page.getByLabel('Forza fallback opaco').uncheck();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page
      .locator('.bt-nav-selection')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    '0s',
  );
  report.checks.push(
    'laboratory synchronized selection, light backdrop, opaque fallback, reduced motion',
  );
  await page.screenshot({
    path: `docs/liquid-glass-v3/screenshots/${engine}-lab-mobile.png`,
    fullPage: true,
  });

  // Simulate a browser that rejects backdrop-filter: discard only the enhancement rules.
  await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
        const rule = sheet.cssRules[i];
        if (rule instanceof CSSSupportsRule && rule.conditionText.includes('backdrop-filter'))
          sheet.deleteRule(i);
      }
    }
  });
  assert.equal(
    await page
      .locator('.bt-navigation')
      .last()
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgb(32, 33, 38)',
  );
  report.checks.push('unsupported backdrop-filter keeps opaque base');

  if (engine === 'chromium') {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(origin + '/glass-lab.html');
    await page.locator('.lab-native').waitFor();
    for (const variant of ['frosted', 'optical', 'native']) {
      report.performance[variant] = await page.evaluate(async (variant) => {
        for (const el of document.querySelectorAll('.lab-variant'))
          el.style.visibility = el.classList.contains(`lab-${variant}`) ? 'visible' : 'hidden';
        const scene = document.querySelector(`.lab-${variant} .lab-scene`);
        const samples = [];
        let last;
        for (let i = 0; i < 120; i++) {
          const time = await new Promise(requestAnimationFrame);
          if (last !== undefined) samples.push(time - last);
          last = time;
          scene.scrollTop = i * 5;
          if (i % 24 === 0) document.querySelectorAll(`.lab-${variant} button`)[i / 24].click();
        }
        samples.sort((a, b) => a - b);
        return {
          frames: samples.length,
          medianMs: +samples[59].toFixed(2),
          p95Ms: +samples[113].toFixed(2),
          over32ms: samples.filter((n) => n > 32).length,
        };
      }, variant);
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `docs/liquid-glass-v3/${engine}-verification.json`,
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
