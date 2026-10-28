import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox, webkit } from '@playwright/test';
const engine = process.argv[2] || 'chromium';
const output = process.env.GLASS_REPORT_DIR
  ? resolve(process.env.GLASS_REPORT_DIR) + '/'
  : new URL('../../../docs/liquid-glass-material/', import.meta.url).pathname;
await mkdir(output + 'screenshots', { recursive: true });
const report = {
  engine,
  checks: [],
  performance: {},
  mode: 'headless desktop, mobile viewport/touch emulated; no physical device',
};
let browser;
try {
  browser = await { chromium, firefox, webkit }[engine].launch();
  report.version = browser.version();
  const origin = process.env.GLASS_ORIGIN || 'http://127.0.0.1:5173';
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.glassMapWrites = 0;
    const original = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      window.glassMapWrites++;
      return original.apply(this, args);
    };
  });
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(origin + '/giocatori');
    await page.locator('.bottom-nav').waitFor();
    assert.ok(
      await page.locator('.bottom-nav').evaluate(
        (nav) =>
          document.documentElement.scrollWidth <= innerWidth &&
          [...nav.querySelectorAll('a')].every((a) => {
            const r = a.getBoundingClientRect();
            return (
              r.width >= 44 &&
              r.height >= 44 &&
              a.querySelector('span').scrollWidth <= a.clientWidth
            );
          }),
      ),
    );
    report.checks.push(`layout and targets ${viewport.width}x${viewport.height}`);
  }
  for (const [name, path] of [
    ['Home', '/'],
    ['Partite', '/partite/nuova'],
    ['Tornei', '/tornei'],
    ['Hi-Score', '/hiscore'],
    ['Giocatori', '/giocatori'],
  ]) {
    await page.locator('.bottom-nav').getByRole('link', { name, exact: true }).click();
    await page.waitForURL(origin + path);
    assert.equal(await page.locator('.bottom-nav [aria-current="page"]').count(), 1);
  }
  report.checks.push('five routes and active state');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Nuovo giocatore' }).click();
  await page.getByLabel('Nome', { exact: true }).focus();
  assert.equal(await page.locator('.bottom-nav').isVisible(), false);
  await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
  assert.equal(await page.locator('.bottom-nav').isVisible(), true);
  report.checks.push('touch input focus hides bar; closing restores it (not a real keyboard)');
  const active = page.locator('.bottom-nav [aria-current="page"]');
  const iconBefore = await active.locator('svg').boundingBox();
  const barBefore = await page.locator('.bottom-nav').boundingBox();
  const mapWrites = await page.evaluate(() => window.glassMapWrites);
  await page.mouse.move(iconBefore.x + iconBefore.width / 2, iconBefore.y + iconBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    iconBefore.x + iconBefore.width / 2 + 3,
    iconBefore.y + iconBefore.height / 2,
  );
  assert.deepEqual(await active.locator('svg').boundingBox(), iconBefore);
  assert.deepEqual(await page.locator('.bottom-nav').boundingBox(), barBefore);
  assert.equal(await page.evaluate(() => window.glassMapWrites), mapWrites);
  await page.mouse.up();
  report.checks.push('pointer pressure preserves icon/hit-area geometry and reuses the map');
  if (engine === 'chromium') {
    const media = await page.context().newCDPSession(page);
    await media.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
    });
    assert.equal(
      await page.locator('.bottom-nav').evaluate((el) => getComputedStyle(el).backdropFilter),
      'none',
    );
    assert.equal(
      await page
        .locator('.bottom-nav .bt-nav-lens')
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      'rgba(16, 16, 19, 0.96)',
    );
    await media.send('Emulation.setEmulatedMedia', { features: [] });
    await media.detach();
    report.checks.push('reduced transparency emulated through Chromium CDP');
  }

  await page.emulateMedia({ contrast: 'more' });
  // Firefox automation reports the new media match before invalidating stylesheet rules.
  if (engine === 'firefox') {
    await page.reload();
    await page.locator('.bottom-nav').waitFor();
  }
  if (await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches)) {
    assert.equal(
      await page.locator('.bottom-nav').evaluate((el) => getComputedStyle(el).backdropFilter),
      'none',
    );
  } else report.checks.push('contrast emulation unavailable in this engine');
  await page.emulateMedia({ contrast: 'no-preference', forcedColors: 'active' });
  // Firefox automation reports the new media match before invalidating stylesheet rules.
  if (engine === 'firefox') {
    await page.reload();
    await page.locator('.bottom-nav').waitFor();
  }
  if (await page.evaluate(() => matchMedia('(forced-colors: active)').matches)) {
    assert.equal(
      await page.locator('.bottom-nav').evaluate((el) => getComputedStyle(el).backdropFilter),
      'none',
    );
    assert.equal(await page.locator('.bt-nav-tint').isVisible(), false);
  } else report.checks.push('forced colors emulation unavailable in this engine');
  await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'reduce' });
  // Firefox automation reports the new media match before invalidating stylesheet rules.
  if (engine === 'firefox') {
    await page.reload();
    await page.locator('.bottom-nav').waitFor();
  }
  await page.locator('.bottom-nav a').first().focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page
      .locator('.bottom-nav a')
      .nth(1)
      .evaluate((el) => getComputedStyle(el).outlineStyle),
    'solid',
  );
  assert.equal(
    await page
      .locator('.bt-nav-selection')
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    '0s',
  );
  report.checks.push('contrast, forced colors, keyboard focus, reduced motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(origin + '/glass-lab.html');
  await page.locator('.lab-proposal .bt-navigation').waitFor();
  await page.getByRole('button', { name: 'Giocatori', exact: true }).first().click();
  assert.equal(await page.locator('[aria-pressed="true"]').count(), 3);
  await page.getByLabel('Forza fallback opaco').check();
  assert.equal(
    await page
      .locator('.lab-proposal .bt-navigation')
      .evaluate((el) => getComputedStyle(el).backdropFilter),
    'none',
  );
  assert.equal(
    await page
      .locator('.lab-proposal .bt-nav-lens')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgba(16, 16, 19, 0.96)',
  );
  await page.getByLabel('Forza fallback opaco').uncheck();
  await page.getByLabel('Solo satinatura', { exact: true }).check();
  assert.equal(await page.locator('.lab-proposal [data-refraction]').count(), 0);
  assert.match(
    await page
      .locator('.lab-proposal .bt-navigation')
      .evaluate((el) => getComputedStyle(el).backdropFilter),
    new RegExp(
      `blur\\(${await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bt-nav-blur').trim())}\\)`,
    ),
  );
  await page.getByLabel('Solo satinatura', { exact: true }).uncheck();
  report.checks.push('lab synchronized selection, opaque and satin fallback');

  // Actual raster comparison, not CSS.supports. Screenshots are test evidence only.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Scena', { exact: true }).selectOption('grid');
  await page.locator('summary').click();
  for (const name of ['Satinatura', 'Tinta', 'Riflessi'])
    await page.getByRole('slider', { name, exact: true }).fill('0');
  await page.addStyleTag({
    content: '.lab-proposal :is(.bt-nav-item,.bt-nav-selection){visibility:hidden}',
  });
  const nav = page.locator('.lab-proposal .bt-navigation');
  const enhanced = await nav.getAttribute('data-refraction');
  const warped = await nav.screenshot({
    path: output + `screenshots/${engine}-grid-refraction.png`,
  });
  await page.getByLabel('Solo satinatura', { exact: true }).check();
  const flat = await nav.screenshot({ path: output + `screenshots/${engine}-grid-satin.png` });
  report.raster = await page.evaluate(
    async ([a, b]) => {
      const decode = async (data) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + data;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
      };
      const x = await decode(a),
        y = await decode(b);
      let rim = 0,
        center = 0,
        nr = 0,
        nc = 0;
      for (let j = 3; j < x.h - 3; j++)
        for (let i = 30; i < x.w - 30; i++) {
          const k = (j * x.w + i) * 4;
          const d =
            (Math.abs(x.data[k] - y.data[k]) +
              Math.abs(x.data[k + 1] - y.data[k + 1]) +
              Math.abs(x.data[k + 2] - y.data[k + 2])) /
            3;
          if (j < 12 || j > x.h - 12) {
            rim += d;
            nr++;
          } else if (j > 18 && j < x.h - 18) {
            center += d;
            nc++;
          }
        }
      return { rimMeanDifference: rim / nr, centerMeanDifference: center / nc };
    },
    [warped.toString('base64'), flat.toString('base64')],
  );
  if (enhanced) {
    assert.ok(report.raster.rimMeanDifference > 2, 'Refraction must visibly move the real grid');
    assert.ok(report.raster.centerMeanDifference < 2.5, 'Centre must stay stable');
    report.checks.push('pixel-verified geometric refraction on real backdrop');
  } else {
    assert.ok(report.raster.rimMeanDifference < 0.1);
    report.checks.push('unverified engine retains identical satin fallback');
  }
  // Verify CSS blur really changes the grid, including engines without refraction.
  await page.getByRole('slider', { name: 'Satinatura', exact: true }).fill('16');
  await page.waitForTimeout(100);
  report.satinStyle = await nav.evaluate((el) => ({
    backdrop: getComputedStyle(el).backdropFilter,
    contrast: matchMedia('(prefers-contrast: more)').matches,
    forced: matchMedia('(forced-colors: active)').matches,
    transparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
    token: el.style.getPropertyValue('--bt-nav-blur'),
  }));
  const blurred = await nav.screenshot({ path: output + `screenshots/${engine}-grid-blurred.png` });
  assert.ok(
    !blurred.equals(flat),
    'CSS blur must alter the grid raster; inspect minimalBackdropChangesRaster if this fails',
  );
  report.checks.push('satin blur changes raster');

  await page.goto(origin + '/glass-lab.html');
  await page.locator('.lab-proposal').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const variant of ['current', 'cable', 'proposal']) {
    await page.locator(`.lab-${variant} .bt-navigation`).scrollIntoViewIfNeeded();
    const cdp = engine === 'chromium' ? await page.context().newCDPSession(page) : null;
    if (cdp) await cdp.send('Performance.enable');
    const before = cdp ? await cdp.send('Performance.getMetrics') : null;
    report.performance[variant] = await page.evaluate(async (variant) => {
      const scene = document.querySelector(`.lab-${variant} .lab-scene`);
      const nav = document.querySelector(`.lab-${variant} .bt-navigation`);
      const writes = window.glassMapWrites;
      const samples = [];
      let last;
      for (let i = 0; i < 120; i++) {
        const t = await new Promise(requestAnimationFrame);
        if (last !== undefined) samples.push(t - last);
        last = t;
        scene.scrollTop = i * 3;
        if (i % 24 === 0) nav.querySelectorAll('button')[i / 24].click();
      }
      samples.sort((a, b) => a - b);
      return {
        frames: samples.length,
        medianMs: samples[59],
        p95Ms: samples[113],
        over32ms: samples.filter((n) => n > 32).length,
        mapRegenerations: window.glassMapWrites - writes,
      };
    }, variant);
    if (cdp) {
      const after = await cdp.send('Performance.getMetrics');
      for (const key of ['TaskDuration', 'LayoutDuration', 'RecalcStyleDuration'])
        report.performance[variant][key + 'Ms'] =
          1000 *
          (after.metrics.find((m) => m.name === key).value -
            before.metrics.find((m) => m.name === key).value);
      await cdp.detach();
    }
    assert.equal(report.performance[variant].mapRegenerations, 0);
  }
  report.checks.push('390x844 scroll/tab timing and zero map regeneration during scroll');
  await page.screenshot({ path: output + `screenshots/${engine}-mobile-lab.png` });
  // Remove enhancement rules, simulating a browser that cannot use backdrop-filter.
  await page.evaluate(() => {
    for (const sheet of document.styleSheets)
      for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
        const r = sheet.cssRules[i];
        if (r instanceof CSSSupportsRule && r.conditionText.includes('backdrop-filter'))
          sheet.deleteRule(i);
      }
  });
  assert.equal(
    await page
      .locator('.lab-proposal .bt-nav-lens')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgba(16, 16, 19, 0.96)',
  );
  report.checks.push('no-backdrop CSS fallback remains opaque');
  assert.deepEqual(errors, []);
  report.status = 'passed';
} catch (error) {
  if (engine === 'firefox' && browser) {
    const probe = await browser.newPage({ viewport: { width: 400, height: 200 } });
    await probe.setContent(
      '<style>body{background:repeating-linear-gradient(90deg,#fff 0 8px,#000 8px 16px)}nav{position:fixed;inset:60px 20px;border-radius:30px;backdrop-filter:blur(16px)}</style><nav></nav>',
    );
    const a = await probe.screenshot();
    await probe.locator('nav').evaluate((el) => (el.style.backdropFilter = 'none'));
    const b = await probe.screenshot();
    report.minimalBackdropChangesRaster = !a.equals(b);
    await probe.close();
  }
  report.status = 'failed or unavailable';
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  await browser?.close();
  await writeFile(output + `${engine}-verification.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
