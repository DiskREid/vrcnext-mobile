import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { pngPixels } from './glass-pixels';

const screen = (page: Page, id: string) =>
  page.locator(`.retained-screen[data-screen="${id}"]:not([hidden])`);
const navigation = (page: Page) =>
  page.locator('nav.side-nav:visible, nav.bottom-nav:visible').first();

async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
}

async function proof(page: Page, surface: Locator, kind: string, prefix: string, persist = true) {
  await surface.scrollIntoViewIfNeeded();
  await expect(surface).toHaveAttribute('data-glass-surface-optic', 'true');
  await expect
    .poll(() => surface.evaluate((element) => getComputedStyle(element).backdropFilter))
    .toContain('url(');
  await settle(page);
  const details = await surface.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const title = element.querySelector('h2, h3, strong');
    const bounds = title?.getBoundingClientRect();
    return {
      text: title?.textContent,
      ink: title
        ? getComputedStyle(title)
            .color.match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
        : [],
      title: bounds
        ? { x: bounds.x - rect.x, y: bounds.y - rect.y, w: bounds.width, h: bounds.height }
        : undefined,
      id: (element as HTMLElement).dataset.glassOptic!,
    };
  });
  const activePng = await surface.screenshot({ animations: 'disabled' });
  const scale = await page.evaluate((id) => {
    const map = document.getElementById(id)!.querySelector('feDisplacementMap')!;
    const value = Number(map.getAttribute('scale'));
    map.setAttribute('scale', '0');
    return value;
  }, details.id);
  await settle(page);
  const neutralPng = await surface.screenshot({ animations: 'disabled' });
  const active = pngPixels(activePng),
    neutral = pngPixels(neutralPng);
  expect([active.width, active.height, active.channels]).toEqual([
    neutral.width,
    neutral.height,
    neutral.channels,
  ]);
  const ink = (x: number, y: number) => {
    const b = details.title;
    if (!b || x < b.x + 1 || x > b.x + b.w - 1 || y < b.y + 1 || y > b.y + b.h - 1) return false;
    const offset = (y * neutral.width + x) * neutral.channels;
    return details.ink.every((value, index) => neutral.pixels[offset + index] === value);
  };
  let bentPixels = 0,
    opaqueInkPixels = 0,
    changedInkPixels = 0;
  for (let y = 1; y < active.height - 1; y++)
    for (let x = 1; x < active.width - 1; x++) {
      const offset = (y * active.width + x) * active.channels;
      const difference = [0, 1, 2].reduce(
        (sum, index) =>
          sum + Math.abs(active.pixels[offset + index] - neutral.pixels[offset + index]),
        0,
      );
      const opaqueInk =
        ink(x, y) && ((ink(x - 1, y) && ink(x + 1, y)) || (ink(x, y - 1) && ink(x, y + 1)));
      if (opaqueInk) {
        opaqueInkPixels++;
        if (difference > 3) changedInkPixels++;
      }
      const edge = Math.min(x, y, active.width - 1 - x, active.height - 1 - y);
      if (!opaqueInk && edge > 4 && edge < 40 && difference > 18) bentPixels++;
    }
  const result = {
    kind,
    text: details.text,
    width: active.width,
    height: active.height,
    displacementScale: scale,
    bentPixels,
    opaqueInkPixels,
    changedInkPixels,
  };
  if (persist) {
    await writeFile(
      `artifacts/regressions/${prefix}-${kind}-surface-refraction-proof.json`,
      JSON.stringify(result, null, 2) + '\n',
    );
    await writeFile(
      `artifacts/regressions/${prefix}-${kind}-surface-refraction-active.png`,
      activePng,
    );
    await writeFile(
      `artifacts/regressions/${prefix}-${kind}-surface-refraction-neutral.png`,
      neutralPng,
    );
  }
  expect(scale).toBeGreaterThan(0);
  expect(bentPixels, `${kind} must bend its actual backdrop`).toBeGreaterThan(35);
  if (details.title) expect(opaqueInkPixels).toBeGreaterThan(20);
  expect(changedInkPixels, `${kind} foreground title must stay sharp`).toBe(0);
  await page.evaluate(
    ({ id, scale }) =>
      document
        .getElementById(id)!
        .querySelector('feDisplacementMap')!
        .setAttribute('scale', String(scale)),
    { id: details.id, scale },
  );
  await settle(page);
  return result;
}

for (const theme of ['liquid-dark', 'liquid-light'])
  test(`${theme} More, settings and search share actual refractive glass with sharp foreground`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((theme) => {
      Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => 4 });
      Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, get: () => 8 });
      localStorage.setItem('vrcnext.language', 'ru');
      localStorage.setItem(
        'vrcnext.appearance.v1',
        JSON.stringify({
          theme,
          glassIntensity: 'high',
          holidayEnabled: true,
          holidayMode: 'manual',
          manualHoliday: 'halloween',
          holidayAnimations: false,
        }),
      );
    }, theme);
    await page.goto('/tests/glass-cards-harness.html');
    await expect(page.locator('html')).toHaveAttribute('data-glass-refraction', 'on');
    await page.addStyleTag({
      content: `
    html[data-theme] .workspace>.main-content {background:repeating-linear-gradient(90deg,transparent 0 10px,#1bdfb0 11px 14px,transparent 15px 27px),repeating-linear-gradient(0deg,transparent 0 13px,#d51ca4 14px 17px,transparent 18px 31px),#14314e!important;}
    .workspace>.holiday-decor {visibility:hidden!important;}
  `,
    });
    const prefix = `${info.project.name}-${theme}`;
    await navigation(page).getByRole('button', { name: 'Ещё', exact: true }).click();
    const results = [
      await proof(page, screen(page, 'more').locator('.more-profile'), 'more-profile', prefix),
    ];
    results.push(
      await proof(page, screen(page, 'more').locator('.more-card').first(), 'more-card', prefix),
    );
    await screen(page, 'more')
      .locator('.more-card')
      .filter({ has: page.getByRole('heading', { name: 'Настройки', exact: true }) })
      .click();
    results.push(
      await proof(
        page,
        screen(page, 'settings').locator('.settings-section').first(),
        'settings',
        prefix,
      ),
    );
    // Nested controls retain the common material without another live SVG layer.
    const settings = screen(page, 'settings').locator('.settings-section').first();
    await expect(settings.locator('[data-glass-optic]')).toHaveCount(0);
    const selectStyle = await settings
      .locator('select')
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundImage,
          shadow: style.boxShadow,
          border: style.borderTopStyle,
        };
      });
    expect(selectStyle.background).toContain('linear-gradient');
    expect(selectStyle.shadow).toContain('inset');
    expect(selectStyle.border).toBe('solid');
    await navigation(page).getByRole('button', { name: 'Друзья', exact: true }).click();
    results.push(await proof(page, screen(page, 'friends').locator('.search'), 'search', prefix));
    expect(await page.locator('[data-glass-card-optic]').count()).toBeLessThanOrEqual(12);
    expect(await page.locator('[data-glass-surface-optic]').count()).toBeLessThanOrEqual(12);
    expect(await page.locator('[data-glass-optic]').count()).toBeLessThanOrEqual(29);
    await page.evaluate(() =>
      (
        window as unknown as {
          __cardGlassTest: { setAppearance(patch: Record<string, unknown>): void };
        }
      ).__cardGlassTest.setAppearance({ theme: 'standard-dark' }),
    );
    await expect(page.locator('[data-glass-optic]')).toHaveCount(0);
    await expect(page.locator('svg[data-glass-optics-defs] filter')).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __cardGlassTest: { unexpected: string[] } }).__cardGlassTest
            .unexpected,
      ),
    ).toEqual([]);
    await info.attach('all-surface-pixel-proofs', {
      body: JSON.stringify(results),
      contentType: 'application/json',
    });
  });

test('the real profile save action keeps readable ink on every glass holiday accent', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => 4 });
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, get: () => 8 });
    localStorage.setItem('vrcnext.language', 'ru');
    localStorage.setItem(
      'vrcnext.appearance.v1',
      JSON.stringify({
        theme: 'liquid-light',
        glassIntensity: 'high',
        holidayEnabled: false,
        holidayAnimations: false,
      }),
    );
  });
  await page.goto('/tests/self-profile-harness.html');
  await expect(page.locator('.avatar-button')).toBeVisible();
  await page.locator('.avatar-button').click();
  const own = screen(page, 'profile');
  await own.getByRole('button', { name: 'Редактировать профиль', exact: true }).click();
  const save = own.getByRole('button', { name: 'Сохранить изменения', exact: true });
  await expect(save).toBeEnabled();
  await save.scrollIntoViewIfNeeded();
  await expect(save).toHaveAttribute('data-glass-surface-optic', 'true');
  for (const theme of ['liquid-dark', 'liquid-light'])
    for (const holiday of [
      null,
      'valentine',
      'womens-day',
      'st-patrick',
      'easter',
      'earth-day',
      'halloween',
      'christmas',
    ]) {
      await page.evaluate(
        async ({ theme, holiday }) => {
          const modulePath = '/src/data/appearance.ts';
          const { appearanceStore } = await import(modulePath);
          appearanceStore.updateSettings({
            theme,
            holidayEnabled: !!holiday,
            holidayMode: 'manual',
            ...(holiday ? { manualHoliday: holiday } : {}),
          });
        },
        { theme, holiday },
      );
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('html')).toHaveAttribute('data-holiday', holiday || 'none');
      const value = await save.evaluate(async (element) => {
        await Promise.all(
          element.getAnimations().map((animation) => animation.finished.catch(() => {})),
        );
        const style = getComputedStyle(element);
        const foreground = style.color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
        const background = style.backgroundColor.match(/[\d.]+/g)!.map(Number);
        const luminance = (rgb: number[]) => {
          const values = rgb.map((channel) => {
            const v = channel / 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          });
          return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
        };
        // Test the least favourable opaque backdrop for the selected ink: white
        // behind white ink, black behind dark ink. Reflection darkens the light fill.
        const backdrop = luminance(foreground) > 0.5 ? 255 : 0;
        const alpha = background[3] ?? 1;
        const composite = background
          .slice(0, 3)
          .map((channel) => channel * alpha + backdrop * (1 - alpha));
        const a = luminance(foreground),
          b = luminance(composite);
        return {
          contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          color: style.color,
          background: style.backgroundColor,
          blur: style.backdropFilter,
        };
      });
      expect(
        value.contrast,
        `${theme}/${holiday}: ${value.color} on ${value.background}`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(value.blur).toContain('url(');
    }
});

test('all three actual home tiles refract at a wide viewport and release hidden optics after rotation', async ({
  page,
}, info) => {
  const initialViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => 4 });
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, get: () => 8 });
    localStorage.setItem('vrcnext.language', 'ru');
    localStorage.setItem(
      'vrcnext.appearance.v1',
      JSON.stringify({
        theme: 'liquid-dark',
        glassIntensity: 'high',
        holidayEnabled: true,
        holidayMode: 'manual',
        manualHoliday: 'halloween',
        holidayAnimations: false,
      }),
    );
  });
  await page.goto('/tests/glass-cards-harness.html');
  const home = screen(page, 'home');
  const tiles = home.locator('.dashboard-stats > button');
  await expect(tiles).toHaveCount(3);
  await tiles.nth(2).scrollIntoViewIfNeeded();
  for (const index of [0, 1, 2]) {
    await expect(tiles.nth(index)).toBeVisible();
    await expect(tiles.nth(index)).toHaveAttribute('data-glass-optic', /vrc-glass-/);
    await expect
      .poll(() => tiles.nth(index).evaluate((element) => getComputedStyle(element).backdropFilter))
      .toContain('url(');
  }
  await expect(tiles.nth(0)).not.toHaveAttribute('data-glass-surface-optic');
  await expect(tiles.nth(1)).not.toHaveAttribute('data-glass-surface-optic');
  await page.addStyleTag({
    content: `
    html[data-theme] .workspace>.main-content {background:repeating-linear-gradient(90deg,transparent 0 10px,#1bdfb0 11px 14px,transparent 15px 27px),repeating-linear-gradient(0deg,transparent 0 13px,#d51ca4 14px 17px,transparent 18px 31px),#14314e!important;}
    .workspace>.holiday-decor {visibility:hidden!important;}
  `,
  });
  const result = await proof(page, tiles.nth(2), 'dashboard-calendar', info.project.name, false);
  await info.attach('actual-third-dashboard-pixel-proof', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  await page.screenshot({
    path: `artifacts/regressions/${info.project.name}-wide-third-dashboard-glass-synthetic.png`,
    animations: 'disabled',
  });
  await page.setViewportSize(initialViewport);
  await settle(page);
  if (await tiles.nth(2).isVisible()) {
    await tiles.nth(2).scrollIntoViewIfNeeded();
    await expect(tiles.nth(2)).toHaveAttribute('data-glass-surface-optic', 'true');
  } else {
    await expect(tiles.nth(2)).not.toHaveAttribute('data-glass-optic');
  }
  expect(await page.locator('[data-glass-surface-optic]').count()).toBeLessThanOrEqual(12);
  expect(await page.locator('[data-glass-optic]').count()).toBeLessThanOrEqual(29);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __cardGlassTest: { unexpected: string[] } }).__cardGlassTest
          .unexpected,
    ),
  ).toEqual([]);
});
