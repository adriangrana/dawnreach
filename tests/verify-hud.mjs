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
      if (aldenImages.includes(`H001${key}.webp`)) {
        assert.equal(await image.count(), 1, `${key}: missing hero ability image`);
        const source = await image.getAttribute('src');
        assert.match(source, new RegExp(`/H001${key}(?:-[^/]+)?\\.webp$`), `${key}: wrong ability image`);
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
        abilities: [...document.querySelectorAll('.ability-row .ability-control')].map(element => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        }),
        icon: bounds('[data-ability="R"] .ability-slot'),
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
    assert.ok(layout.deck.width <= 721, `${width}: deck exceeds its content-sized maximum`);
    const combatPanel = layout.sections[1];
    assert.ok(layout.abilities[0].left - combatPanel.left <= 24, `${width}: excessive space before abilities`);
    assert.ok(combatPanel.right - layout.abilities.at(-1).right <= 24, `${width}: excessive space after abilities`);
    for (let index = 1; index < layout.abilities.length; index++) {
      const gap = layout.abilities[index].left - layout.abilities[index - 1].right;
      assert.ok(gap >= 4 && gap <= 9, `${width}: ability spacing must stay compact, got ${gap}px`);
    }
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
    assert.deepEqual(await page.locator('[data-ability] .ability-rank b').allTextContents(), ['2/4', '2/4', '1/4', '1/4']);
    const tooltipTrigger = page.locator('[data-ability="W"] button');
    await tooltipTrigger.hover();
    const tooltip = page.getByRole('tooltip');
    await tooltip.waitFor({ state: 'visible' });
    assert.equal(await tooltip.locator('.ability-tooltip-title').textContent(), (await tooltipTrigger.getAttribute('aria-label')).split(', rango')[0]);
    assert.match(await tooltip.textContent(), /Rango 2 \/ 4/);
    assert.match(await tooltip.textContent(), /Siguiente rango: nivel 17/);
    const tooltipBounds = await tooltip.boundingBox();
    assert.ok(tooltipBounds.x >= 0 && tooltipBounds.y >= 0 && tooltipBounds.x + tooltipBounds.width <= width && tooltipBounds.y + tooltipBounds.height <= height, `${width}: tooltip outside viewport`);
    if ([1440, 390, 844].includes(width)) await page.screenshot({ path: `${output}/tooltip-${width}x${height}.png` });
    const tooltipInteraction = await tooltip.evaluate(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        pointerEvents: style.pointerEvents,
        userSelect: style.userSelect,
        capturesPointer: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
      };
    });
    assert.deepEqual(tooltipInteraction, { pointerEvents: 'none', userSelect: 'none', capturesPointer: false }, `${width}: tooltip must not be interactive`);
    await page.mouse.move(tooltipBounds.x + tooltipBounds.width / 2, tooltipBounds.y + tooltipBounds.height - 4);
    await tooltip.waitFor({ state: 'hidden' });
    await tooltipTrigger.hover();
    await tooltip.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await tooltip.waitFor({ state: 'hidden' });
    await page.mouse.move(0, 0);
    if (width === 1440) {
      await page.locator('.command-deck').screenshot({ path: `${output}/command-deck.png` });
      await page.locator('.scoreboard').screenshot({ path: `${output}/scoreboard.png` });
      const before = await page.locator('.minimap-hero-icon').getAttribute('style');
      await page.mouse.click(width * 0.65, height * 0.43, { button: 'right' });
      await page.waitForFunction(previous => document.querySelector('.minimap-hero-icon')?.getAttribute('style') !== previous, before);
    }
    console.log(`${width}x${height}: panels, text, artwork, canvas OK`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
  await page.goto(process.env.ALDEN_URL ?? 'http://127.0.0.1:1420/', { waitUntil: 'networkidle' });
  const abilityButton = key => page.locator(`[data-ability="${key}"] button`);
  const mana = async () => Number(await page.locator('.resource--mana').getAttribute('data-current'));
  const cooldown = async key => Number(await abilityButton(key).getAttribute('data-cooldown'));
  const manaBefore = await mana();
  const qCost = Number(await abilityButton('Q').getAttribute('data-cost'));
  await abilityButton('Q').click();
  assert.ok(await cooldown('Q') > 0, 'click must cast Q');
  assert.ok(Math.abs(await mana() - (manaBefore - qCost)) < 2, 'cast must spend the gameplay mana cost');
  const manaAfter = await mana();
  const clickedTooltip = page.getByRole('tooltip');
  const clickedTooltipBounds = await clickedTooltip.boundingBox();
  await page.mouse.move(clickedTooltipBounds.x + clickedTooltipBounds.width / 2, clickedTooltipBounds.y + clickedTooltipBounds.height - 4);
  await clickedTooltip.waitFor({ state: 'hidden' });
  assert.equal(await abilityButton('Q').evaluate(element => element === document.activeElement), true, 'leaving a focused ability must still close its tooltip');
  await abilityButton('Q').click({ force: true });
  await page.keyboard.press('q');
  assert.ok(Math.abs(await mana() - manaAfter) < 2, 'click/keyboard during cooldown must not spend mana twice');
  const cooldownBefore = await cooldown('Q');
  await page.clock.fastForward(1500);
  assert.ok(await cooldown('Q') < cooldownBefore, 'cooldown must count down');
  await page.clock.fastForward(10000);
  assert.equal(await cooldown('Q'), 0, 'cooldown must end');
  assert.equal(await abilityButton('Q').getAttribute('aria-disabled'), 'false');

  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'hud-test-input';
    input.style.cssText = 'position:fixed;top:100px;left:300px;z-index:1000';
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press('q');
  assert.equal(await cooldown('Q'), 0, 'typing must not cast');
  await page.evaluate(() => {
    document.querySelector('#hud-test-input').remove();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', repeat: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', ctrlKey: true }));
  });
  assert.equal(await cooldown('Q'), 0, 'repeat/modified keys must not cast');
  await page.keyboard.press('Shift+Q');
  assert.ok(await cooldown('Q') > 0, 'uppercase shortcut must cast');
  for (const key of ['W', 'E', 'R']) {
    await page.keyboard.press(key.toLowerCase());
    assert.ok(await cooldown(key) > 0, `${key}: keyboard must cast`);
    assert.equal(await abilityButton(key).getAttribute('aria-disabled'), 'true');
  }
  const passive = page.locator('.hero-sigil .ability-control');
  assert.equal(await passive.locator('button').isDisabled(), true, 'innate passive must be disabled');
  const manaBeforePassive = await mana();
  await passive.focus();
  await page.keyboard.press('Enter');
  assert.ok(Math.abs(await mana() - manaBeforePassive) < 2, 'passive must not consume mana');
  assert.match(await page.getByRole('tooltip').textContent(), /Pasiva innata/);
  await passive.evaluate(element => element.blur());
  await page.getByRole('tooltip').waitFor({ state: 'hidden' });
  await passive.hover();
  const passiveTooltipBounds = await page.getByRole('tooltip').boundingBox();
  await page.mouse.move(passiveTooltipBounds.x + passiveTooltipBounds.width / 2, passiveTooltipBounds.y + passiveTooltipBounds.height - 4);
  await page.getByRole('tooltip').waitFor({ state: 'hidden' });
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${output}/abilities-active.png` });
  console.log('Abilities: click, keyboard, ranks, cooldown expiry, mana, passive and tooltips OK');
  assert.deepEqual(failures, [], 'Browser errors');
  console.log(`HUD verified; captures in ${output}`);
} finally {
  await browser.close();
}