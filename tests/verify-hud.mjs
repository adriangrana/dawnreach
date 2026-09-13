import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'node_modules/.cache/hud-visual';
const aldenImages = await readdir(new URL('../src/game/heroes/alden/images/', import.meta.url));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const failures = [];
await mkdir(output, { recursive: true });

try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
      failures.push(`${response.status()} ${response.url()}`);
    }
  });
  for (const [width, height] of [[1440, 900], [1176, 768], [1024, 768], [800, 600], [390, 844], [320, 640], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.goto(process.env.ALDEN_URL ?? 'http://127.0.0.1:1420/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => {
      const marker = document.querySelector('.minimap-hero-icon');
      return marker?.style.left && [...document.images].every(image => image.complete && image.naturalWidth > 0);
    });

    for (const key of ['Q', 'W', 'E', 'R']) {
      const slot = page.locator(`[data-ability="${key}"]`);
      const image = slot.locator('.ability-image');
      if (aldenImages.includes(`H001${key}.png`)) {
        assert.equal(await image.count(), 1, `${key}: missing hero ability image`);
        const source = await image.getAttribute('src');
        assert.match(source, new RegExp(`/H001${key}(?:-[^/]+)?\\.png$`), `${key}: wrong ability image`);
        assert.ok(await image.isVisible(), `${key}: image is hidden`);
      } else {
        assert.equal(await image.count(), 0, `${key}: missing file must not produce a broken image`);
        assert.equal(await slot.locator('svg.hud-art').count(), 1, `${key}: missing fallback`);
      }
    }

    const layout = await page.evaluate(() => {
      const bounds = selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      };
      const textOverflows = [...document.querySelectorAll('.hero-identity strong, .hero-identity > span, .hero-attributes b, .ability-slot i, .ability-cooldown, .resource b, .gold-row strong, .match-clock b, .score')].filter(element => {
        if (!element.getClientRects().length) return false;
        const range = document.createRange();
        range.selectNodeContents(element);
        const text = range.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return text.left < rect.left - 2 || text.right > rect.right + 2 || text.top < rect.top - 2 || text.bottom > rect.bottom + 2;
      }).map(element => element.className || element.textContent);
      return {
        panels: ['.scoreboard', '.command-deck', '.minimap-shell'].map(bounds),
        deck: bounds('.command-deck'),
        sections: ['.hero-panel', '.combat-panel', '.inventory-panel'].map(bounds),
        icon: bounds('.ability-slot--sun'),
        textOverflows,
        canvas: bounds('.game-canvas'),
        art: [...document.querySelectorAll('.hud-art')].filter(icon => icon.getClientRects().length > 0).map(icon => icon.getBBox().width),
      };
    });
    for (const rect of layout.panels) {
      assert.ok(rect.left >= 0 && rect.top >= 0 && rect.right <= width + 1 && rect.bottom <= height + 1, `${width}: panel outside viewport ${JSON.stringify(rect)}`);
    }
    const intersects = (first, second) => first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
    assert.ok(!intersects(layout.panels[1], layout.panels[2]), `${width}: deck overlaps minimap`);
    for (const rect of layout.sections) {
      assert.ok(rect.left >= layout.deck.left && rect.right <= layout.deck.right && rect.bottom <= layout.deck.bottom, `${width}: section exceeds deck`);
    }
    for (const [index, rect] of layout.sections.entries()) {
      for (const other of layout.sections.slice(index + 1)) assert.ok(!intersects(rect, other), `${width}: HUD sections overlap`);
    }
    assert.deepEqual(layout.textOverflows, [], `${width}: text overflows`);
    assert.ok(layout.art.every(size => size > 0), `${width}: missing SVG symbol`);
    assert.equal(layout.canvas.width, width);
    assert.equal(layout.canvas.height, height);

    const capture = await page.screenshot({ path: `${output}/hud-${width}x${height}.png` });
    const pixels = await page.evaluate(async ({ encoded, icon }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const colors = (left, top, width, height, step) => {
        const data = context.getImageData(left, top, width, height).data;
        const unique = new Set();
        for (let offset = 0; offset < data.length; offset += step * 4) unique.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`);
        return unique.size;
      };
      return {
        game: colors(40, 70, canvas.width - 80, Math.max(40, canvas.height - 280), 31),
        icon: colors(Math.ceil(icon.left + 4), Math.ceil(icon.top + 4), Math.floor(icon.width - 8), Math.floor(icon.height - 8), 1),
      };
    }, { encoded: capture.toString('base64'), icon: layout.icon });
    assert.ok(pixels.game > 30, `${width}: blank game canvas`);
    assert.ok(pixels.icon > 40, `${width}: icon artwork not rendered`);
    if (width === 1440) {
      await page.locator('.command-deck').screenshot({ path: `${output}/command-deck.png` });
      await page.locator('.scoreboard').screenshot({ path: `${output}/scoreboard.png` });
      const before = await page.locator('.minimap-hero-icon').getAttribute('style');
      await page.mouse.click(width * 0.65, height * 0.43, { button: 'right' });
      await page.waitForFunction(previous => document.querySelector('.minimap-hero-icon')?.getAttribute('style') !== previous, before);
    }
    console.log(`${width}x${height}: panels, text, artwork, canvas OK`);
  }
  assert.deepEqual(failures, [], 'Browser errors');
  console.log(`HUD verified; captures in ${output}`);
} finally {
  await browser.close();
}