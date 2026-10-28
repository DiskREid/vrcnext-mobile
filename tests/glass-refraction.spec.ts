import { expect, test, type Page } from '@playwright/test';
import { inflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';

type Fixture = {
  requests: { path: string; method: string }[];
  unexpected: string[];
  clearedSessions: number;
  setAppearance: (patch: Record<string, unknown>) => void;
};
const fixture = (page: Page) =>
  page.evaluate(() => (window as unknown as { __appearanceTest: Fixture }).__appearanceTest);
const active = (page: Page, name: string) =>
  page.locator(`.retained-screen[data-screen="${name}"]:not([hidden])`);
const nav = (page: Page) => page.locator('nav.side-nav:visible, nav.bottom-nav:visible').first();

async function device(page: Page, mode: 'full' | 'weak' | 'unsupported' = 'full') {
  await page.addInitScript((mode) => {
    Object.defineProperty(navigator, 'deviceMemory', {
      configurable: true,
      get: () => (mode === 'weak' ? 2 : 4),
    });
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      configurable: true,
      get: () => (mode === 'weak' ? 2 : 8),
    });
    if (mode === 'unsupported') {
      const supports = CSS.supports.bind(CSS);
      CSS.supports = ((property: string, value?: string) =>
        `${property} ${value || ''}`.includes('url(')
          ? false
          : value === undefined
            ? supports(property)
            : supports(property, value)) as typeof CSS.supports;
    }
  }, mode);
}
async function open(page: Page) {
  await page.goto('/tests/appearance-harness.html');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Привет, Theme Explorer ✦', exact: true }),
  ).toBeVisible();
}
async function appearance(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(
    (patch) =>
      (window as unknown as { __appearanceTest: Fixture }).__appearanceTest.setAppearance(patch),
    patch,
  );
}
async function settled(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}
async function ready(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-glass-refraction', 'on');
  await expect(page.locator('.hero')).toHaveAttribute('data-glass-optic', /vrc-glass-/);
  await expect
    .poll(() =>
      page.locator('.hero').evaluate((element) => {
        const id = (element as HTMLElement).dataset.glassOptic!;
        return document.getElementById(id)?.querySelector('feImage')?.getAttribute('href') || '';
      }),
    )
    .toMatch(/^data:image\/png/);
  await settled(page);
}

/** Decode Chromium's ordinary non-interlaced RGB/RGBA PNG without adding an app dependency. */
function pngPixels(png: Buffer) {
  expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
  let width = 0,
    height = 0,
    channels = 0;
  const chunks: Buffer[] = [];
  for (let position = 8; position < png.length; ) {
    const length = png.readUInt32BE(position),
      type = png.toString('ascii', position + 4, position + 8);
    const data = png.subarray(position + 8, position + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      expect(data[12]).toBe(0);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      expect(channels).toBeGreaterThan(0);
    }
    if (type === 'IDAT') chunks.push(data);
    position += length + 12;
  }
  const packed = inflateSync(Buffer.concat(chunks)),
    stride = width * channels;
  const pixels = new Uint8Array(width * height * channels);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1),
      filter = packed[start];
    expect(filter).toBeLessThanOrEqual(4);
    for (let x = 0; x < stride; x++) {
      const offset = y * stride + x,
        left = x >= channels ? pixels[offset - channels] : 0;
      const above = y ? pixels[offset - stride] : 0;
      const diagonal = y && x >= channels ? pixels[offset - stride - channels] : 0;
      const prediction =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : paeth(left, above, diagonal);
      pixels[offset] = (packed[start + 1 + x] + prediction) & 255;
    }
  }
  return { width, height, channels, pixels };
}

test('real lens maps bend a contrast grid while the foreground stays sharp and clickable', async ({
  page,
}, info) => {
  await device(page);
  await open(page);
  await appearance(page, { theme: 'liquid-dark', glassIntensity: 'high', holidayEnabled: false });
  await ready(page);
  await page.addStyleTag({
    content: `
    .hero { width:336px!important;height:230px!important;min-height:230px!important;
      border-radius:36px!important;border:0!important;box-shadow:none!important;
      background:repeating-linear-gradient(90deg,transparent 0 17px,#fff 18px 20px,transparent 21px 40px),
      repeating-linear-gradient(0deg,transparent 0 17px,#ff66cc 18px 20px,transparent 21px 40px),
      linear-gradient(120deg,#152854,#225d75)!important; }
    .hero .hero-content,.hero .hero-shade,.hero .hero-world,.hero .holiday-decor--hero { visibility:hidden!important; }
    .hero .optics-probe-button { position:absolute!important;left:16px!important;top:88px!important;
      width:92px!important;height:36px!important;z-index:4!important;background:#142139!important;
      color:#fff!important;font:600 14px Arial!important;border:0!important;border-radius:5px!important;
      padding:0!important;text-shadow:none!important;box-shadow:none!important; }
  `,
  });
  await page.locator('.hero').evaluate((hero) => {
    const button = document.createElement('button');
    button.className = 'optics-probe-button';
    button.textContent = 'Sharp text';
    button.onclick = () => {
      button.dataset.clicked = 'yes';
    };
    hero.appendChild(button);
  });
  await page.locator('.hero').scrollIntoViewIfNeeded();
  await ready(page);
  const hero = page.locator('.hero'),
    button = hero.locator('.optics-probe-button');
  const activePng = await hero.screenshot({ animations: 'disabled' });
  await page.screenshot({
    path: `artifacts/regressions/${info.project.name}-glass-refraction-grid-synthetic-fixture.png`,
    animations: 'disabled',
  });
  const original = await hero.evaluate((element) => {
    const filter = document.getElementById((element as HTMLElement).dataset.glassOptic!)!;
    const displacement = filter.querySelector('feDisplacementMap')!;
    const scale = displacement.getAttribute('scale')!;
    displacement.setAttribute('scale', '0');
    return scale;
  });
  expect(Number(original)).toBeGreaterThan(0);
  await settled(page);
  const neutralPng = await hero.screenshot({ animations: 'disabled' });
  const a = pngPixels(activePng),
    b = pngPixels(neutralPng);
  expect([a.width, a.height, a.channels]).toEqual([b.width, b.height, b.channels]);
  const boxes = await hero.evaluate((element) => {
    const r = element.getBoundingClientRect(),
      foreground = element.querySelector('.optics-probe-button')!.getBoundingClientRect();
    return {
      x: foreground.x - r.x,
      y: foreground.y - r.y,
      width: foreground.width,
      height: foreground.height,
    };
  });
  let bentPixels = 0,
    foregroundPixels = 0,
    changedForeground = 0;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const offset = (y * a.width + x) * a.channels;
      const difference =
        Math.abs(a.pixels[offset] - b.pixels[offset]) +
        Math.abs(a.pixels[offset + 1] - b.pixels[offset + 1]) +
        Math.abs(a.pixels[offset + 2] - b.pixels[offset + 2]);
      const foreground =
        x > boxes.x + 2 &&
        x < boxes.x + boxes.width - 2 &&
        y > boxes.y + 2 &&
        y < boxes.y + boxes.height - 2;
      if (foreground) {
        foregroundPixels++;
        if (difference > 3) changedForeground++;
      } else if (
        Math.min(x - 12, y - 12, a.width - 13 - x, a.height - 13 - y) >= 0 &&
        Math.min(x - 12, y - 12, a.width - 13 - x, a.height - 13 - y) < 34 &&
        difference > 18
      )
        bentPixels++;
    }
  expect(
    bentPixels,
    'The backdrop must really move, with opacity and highlights held constant',
  ).toBeGreaterThan(120);
  expect(
    changedForeground / foregroundPixels,
    'The edge text is painted after the lens, without displacement',
  ).toBeLessThan(0.002);
  await info.attach('refraction-pixel-proof', {
    body: JSON.stringify({
      bentPixels,
      foregroundPixels,
      changedForeground,
      displacementScale: Number(original),
    }),
    contentType: 'application/json',
  });
  await writeFile(
    `artifacts/regressions/${info.project.name}-glass-refraction-pixel-proof.json`,
    JSON.stringify(
      { bentPixels, foregroundPixels, changedForeground, displacementScale: Number(original) },
      null,
      2,
    ) + '\n',
  );
  await button.click();
  await expect(button).toHaveAttribute('data-clicked', 'yes');
  await hero.evaluate(
    (element, scale) =>
      document
        .getElementById((element as HTMLElement).dataset.glassOptic!)!
        .querySelector('feDisplacementMap')!
        .setAttribute('scale', scale),
    original,
  );
  expect((await fixture(page)).unexpected).toEqual([]);
});

test('lens intensity changes the optical maps and base-theme switching cleans up without refreshing the account', async ({
  page,
}, info) => {
  await device(page);
  await open(page);
  const requests = (await fixture(page)).requests.length;
  const scales: number[] = [],
    maps: string[] = [];
  for (const glassIntensity of ['low', 'medium', 'high']) {
    await appearance(page, {
      theme: 'liquid-dark',
      holidayMode: 'manual',
      manualHoliday: 'halloween',
      glassIntensity,
    });
    await ready(page);
    const result = await page.locator('.hero').evaluate((element) => {
      const filter = document.getElementById((element as HTMLElement).dataset.glassOptic!)!;
      return {
        scale: Number(filter.querySelector('feDisplacementMap')!.getAttribute('scale')),
        map: filter.querySelector('feImage')!.getAttribute('href')!,
      };
    });
    scales.push(result.scale);
    maps.push(result.map);
  }
  expect(scales[1]).toBeGreaterThan(scales[0]);
  expect(scales[2]).toBeGreaterThan(scales[1]);
  expect(new Set(maps).size).toBe(3);
  expect(await page.locator('[data-glass-optic]').count()).toBeLessThanOrEqual(5);
  await page.screenshot({
    path: `artifacts/regressions/${info.project.name}-glass-refraction-dark-synthetic-fixture.png`,
    animations: 'disabled',
  });
  await appearance(page, { theme: 'liquid-light', manualHoliday: 'christmas' });
  await ready(page);
  await page.screenshot({
    path: `artifacts/regressions/${info.project.name}-glass-refraction-light-synthetic-fixture.png`,
    animations: 'disabled',
  });
  await appearance(page, { theme: 'standard-dark' });
  await expect(page.locator('[data-glass-optic]')).toHaveCount(0);
  await expect(page.locator('svg[data-glass-optics-defs] filter')).toHaveCount(0);
  await appearance(page, { theme: 'liquid-light' });
  await ready(page);
  expect((await fixture(page)).requests.length).toBe(requests);
  expect((await fixture(page)).clearedSessions).toBe(0);
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'liquid-light');
  await expect(page.locator('.workspace')).toHaveAttribute('data-glass-underlay', 'on');
  const underlay = () =>
    page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('.main-content')!,
        header = document.querySelector<HTMLElement>('.topbar')!,
        footer = document.querySelector<HTMLElement>('.bottom-nav')!,
        world = document.querySelector<HTMLElement>('.hero')!;
      const m = main.getBoundingClientRect(),
        h = header.getBoundingClientRect(),
        f = footer.getBoundingClientRect(),
        w = world.getBoundingClientRect();
      const button = header.querySelector<HTMLElement>('.avatar-button')!,
        b = button.getBoundingClientRect();
      return {
        mainTop: m.top,
        mainBottom: m.bottom,
        headerTop: h.top,
        headerBottom: h.bottom,
        footerBottom: f.bottom,
        footerVisible: getComputedStyle(footer).display !== 'none',
        heroTop: w.top,
        heroBottom: w.bottom,
        avatarHit:
          document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('button') ===
          button,
      };
    });
  let geometry = await underlay();
  expect(geometry.mainTop).toBeLessThanOrEqual(geometry.headerTop + 1);
  if (geometry.footerVisible)
    expect(geometry.mainBottom).toBeGreaterThanOrEqual(geometry.footerBottom - 1);
  expect(geometry.avatarHit).toBe(true);
  await page.locator('.main-content').evaluate((element) => {
    element.scrollTo({ top: 250, behavior: 'instant' });
  });
  await settled(page);
  geometry = await underlay();
  expect(geometry.heroTop).toBeLessThan(geometry.headerBottom);
  expect(geometry.heroBottom).toBeGreaterThan(geometry.headerTop);
  expect(geometry.avatarHit).toBe(true);
  await page.locator('.main-content').evaluate((element) => {
    element.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.locator('.offline-banner')).toBeVisible();
  await expect
    .poll(async () => (await underlay()).mainTop)
    .toBeLessThanOrEqual(geometry.headerTop + 1);
  expect((await underlay()).avatarHit).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.offline-banner')).toHaveCount(0);
  await nav(page).locator('button').nth(4).click();
  await active(page, 'more')
    .locator('.more-card')
    .filter({ has: page.getByRole('heading', { name: 'Диаграммы', exact: true }) })
    .click();
  await page.getByRole('button', { name: 'Mutual Friend Network', exact: true }).click();
  await page.getByRole('button', { name: 'Граф', exact: true }).click();
  const graph = page.locator('.network-frame');
  await expect(graph).toBeVisible();
  expect(await graph.evaluate((element) => getComputedStyle(element).backdropFilter)).toBe('none');
  await expect(graph.locator('[data-glass-optic]')).toHaveCount(0);
  await page.getByRole('button', { name: 'На весь экран', exact: true }).click();
  const fullscreen = page.getByRole('dialog', {
    name: 'Граф общих друзей на весь экран',
    exact: true,
  });
  await expect(fullscreen).toBeVisible();
  await expect(page.locator('[data-glass-optic]')).toHaveCount(0);
  expect(await fullscreen.evaluate((element) => getComputedStyle(element).backdropFilter)).toBe(
    'none',
  );
  await fullscreen
    .getByRole('button', { name: 'Открыть профиль Theme Friend', exact: true })
    .press('Enter');
  const profile = page.getByRole('dialog', { name: 'Профиль', exact: true });
  await expect(profile.getByRole('heading', { name: 'Theme Friend', exact: true })).toBeVisible();
  await expect(profile).toHaveAttribute('data-glass-surface-host', 'true');
  await expect(profile).toHaveAttribute('data-glass-surface-ready', 'true');
  // The fixed backing layer owns the lens; filtering the scrolling dialog
  // itself leaves rectangular compositor tiles in Android WebView.
  await expect(profile).not.toHaveAttribute('data-glass-optic');
  const profileSurface = profile.locator('..').locator('.glass-modal-surface');
  await expect(profileSurface).toHaveAttribute('data-glass-optic', /vrc-glass-/);
  expect(await profile.evaluate((element) => getComputedStyle(element).backdropFilter)).toBe(
    'none',
  );
  await expect(page.locator('[data-glass-optic]')).toHaveCount(1);
  await profile.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(fullscreen).toBeVisible();
  await expect(page.locator('[data-glass-optic]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(fullscreen).toHaveCount(0);
  expect((await fixture(page)).unexpected).toEqual([]);
});

for (const mode of ['weak', 'unsupported'] as const) {
  test(`${mode} WebViews keep their usable fallback without creating optical filter maps`, async ({
    page,
  }) => {
    await device(page, mode);
    await open(page);
    const requests = (await fixture(page)).requests.length;
    await appearance(page, {
      theme: 'liquid-dark',
      glassIntensity: 'high',
      holidayMode: 'manual',
      manualHoliday: 'halloween',
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'liquid-dark');
    await settled(page);
    await expect(page.locator('[data-glass-optic]')).toHaveCount(0);
    await expect(page.locator('svg[data-glass-optics-defs] filter')).toHaveCount(0);
    expect((await fixture(page)).requests.length).toBe(requests);
    await active(page, 'home').locator('.hero .button').click();
    await expect(active(page, 'friends')).toBeVisible();
    expect((await fixture(page)).unexpected).toEqual([]);
    expect((await fixture(page)).clearedSessions).toBe(0);
  });
}
