import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

test.use({ timezoneId: 'Europe/Berlin' });
const storageKey = 'vrcnext.appearance.v1';
const holidays = [
  'valentine',
  'womens-day',
  'st-patrick',
  'easter',
  'earth-day',
  'halloween',
  'christmas',
];
type Fixture = {
  requests: { path: string; method: string }[];
  unexpected: string[];
  clearedSessions: number;
  emitAppState: (isActive: boolean) => void;
  appStateListenerCount: () => number;
  setAppearance: (patch: Record<string, unknown>) => void;
};
const fixture = (page: Page) =>
  page.evaluate(() => (window as unknown as { __appearanceTest: Fixture }).__appearanceTest);
const nav = (page: Page) => page.locator('nav.side-nav:visible, nav.bottom-nav:visible').first();
const active = (page: Page, id: string) =>
  page.locator(`.retained-screen[data-screen="${id}"]:not([hidden])`);
const controls = (page: Page) => active(page, 'settings').locator('.appearance-settings');

async function device(page: Page, weak = false) {
  await page.addInitScript(
    ({ weak }) => {
      Object.defineProperty(navigator, 'deviceMemory', {
        configurable: true,
        get: () => (weak ? 2 : 8),
      });
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        configurable: true,
        get: () => (weak ? 2 : 8),
      });
    },
    { weak },
  );
}
async function open(page: Page) {
  await page.goto('/tests/appearance-harness.html');
  await expect(
    page.getByRole('heading', { name: 'Привет, Theme Explorer ✦', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { __appearanceTest: Fixture }
        ).__appearanceTest.appStateListenerCount(),
      ),
    )
    .toBeGreaterThan(0);
}
async function settings(page: Page) {
  await nav(page).locator('button').nth(4).click();
  await active(page, 'more')
    .locator('.more-card')
    .filter({ has: page.getByRole('heading', { name: 'Настройки', exact: true }) })
    .click();
  await expect(
    controls(page).getByRole('combobox', { name: 'Тема интерфейса', exact: true }),
  ).toBeVisible();
}
async function manual(page: Page, holiday: string) {
  const panel = controls(page);
  await panel.getByRole('switch', { name: 'Праздничное оформление', exact: true }).check();
  await panel
    .getByRole('combobox', { name: 'Режим оформления', exact: true })
    .selectOption('manual');
  await panel.getByRole('combobox', { name: 'Праздник', exact: true }).selectOption(holiday);
  await expect(page.locator('html')).toHaveAttribute('data-holiday', holiday);
}
async function noOverflow(page: Page) {
  const dimensions = await page.evaluate(() =>
    [
      document.documentElement,
      document.querySelector('.main-content'),
      document.querySelector('.retained-screen:not([hidden])'),
      document.querySelector('.modal'),
    ]
      .filter((node): node is HTMLElement => node instanceof HTMLElement)
      .map((node) => ({ width: node.clientWidth, scroll: node.scrollWidth })),
  );
  for (const box of dimensions) expect(box.scroll).toBeLessThanOrEqual(box.width + 1);
}
async function screenshotHome(page: Page, info: TestInfo, name: string) {
  await nav(page).locator('button').first().click();
  await active(page, 'home').locator('.hero').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `artifacts/regressions/${info.project.name}-appearance-${name}-synthetic-fixture.png`,
    animations: 'disabled',
  });
  await settings(page);
}
function contrast(foreground: string, background: string) {
  const luminance = (value: string) => {
    const parts = value
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((c) => c / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return parts[0] * 0.2126 + parts[1] * 0.7152 + parts[2] * 0.0722;
  };
  const [bright, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}
async function style(locator: Locator) {
  return locator.evaluate((element) => {
    const css = getComputedStyle(element);
    return {
      background: css.backgroundColor,
      image: css.backgroundImage,
      color: css.color,
      blur: css.backdropFilter,
      animation: css.animationName,
      events: css.pointerEvents,
    };
  });
}
async function settledStyle(locator: Locator) {
  await locator.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished.catch(() => {})),
    );
  });
  return style(locator);
}

test('all base themes combine with all seven holidays without network refreshes, excessive blur or decoration hitboxes', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await device(page);
  await page.clock.setFixedTime(new Date('2026-06-20T12:00:00+02:00'));
  await open(page);
  await settings(page);
  const panel = controls(page),
    html = page.locator('html');
  await panel.getByRole('switch', { name: 'Праздничное оформление', exact: true }).uncheck();
  await screenshotHome(page, info, 'standard-dark');
  const before = (await fixture(page)).requests.length;
  await manual(page, 'halloween');
  const palettes = new Set<string>();
  for (const theme of ['standard-dark', 'liquid-dark', 'liquid-light']) {
    await panel.getByRole('combobox', { name: 'Тема интерфейса', exact: true }).selectOption(theme);
    await expect(html).toHaveAttribute('data-theme', theme);
    const intensity = panel.getByRole('combobox', {
      name: 'Интенсивность стекла',
      exact: true,
    });
    if (theme === 'standard-dark') await expect(intensity).toBeDisabled();
    else await expect(intensity).toBeEnabled();
    for (const holiday of holidays) {
      await panel.getByRole('combobox', { name: 'Праздник', exact: true }).selectOption(holiday);
      await expect(html).toHaveAttribute('data-holiday', holiday);
      await expect(page.locator('.holiday-decor--ambient')).toHaveCount(1);
      const colors = await html.evaluate((element) => {
        const css = getComputedStyle(element);
        return {
          color: css.color,
          background: css.backgroundColor,
          accent: css.getPropertyValue('--accent').trim(),
        };
      });
      expect(contrast(colors.color, colors.background)).toBeGreaterThanOrEqual(4.5);
      if (theme === 'standard-dark') palettes.add(colors.accent);
      expect((await style(page.locator('.holiday-decor--ambient'))).events).toBe('none');
      expect((await style(panel)).blur).toBe('none');
      await noOverflow(page);
      if ((theme === 'standard-dark' || theme === 'liquid-dark') && holiday === 'halloween')
        await screenshotHome(page, info, `${theme}-halloween`);
      if (theme === 'liquid-light' && holiday === 'christmas')
        await screenshotHome(page, info, 'liquid-light-christmas');
    }
  }
  expect(palettes.size).toBe(7);
  await expect(html).toHaveAttribute('data-effects', 'full');
  const blurred = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((element) => {
        const rect = element.getBoundingClientRect(),
          css = getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          css.visibility !== 'hidden' &&
          css.backdropFilter !== 'none'
        );
      })
      .map((element) => element.className),
  );
  expect(blurred.length).toBeLessThanOrEqual(2);
  const homeButton = nav(page).locator('button').first();
  expect(
    await homeButton.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return (
        document
          .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          ?.closest('button') === button
      );
    }),
  ).toBe(true);
  expect((await fixture(page)).requests.length).toBe(before);
  expect((await fixture(page)).unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test('glass intensity and holiday controls persist independently while profile edits and the signed-in account survive', async ({
  page,
}) => {
  await device(page);
  await page.clock.setFixedTime(new Date('2026-06-20T12:00:00+02:00'));
  await open(page);
  await page.locator('.avatar-button').click();
  const profile = active(page, 'profile'),
    draft = 'Theme draft / 世界';
  await expect(profile.getByRole('textbox', { name: 'О себе', exact: true })).toHaveValue(
    'Original self biography',
  );
  await profile.getByRole('textbox', { name: 'О себе', exact: true }).fill(draft);
  await settings(page);
  const panel = controls(page);
  await manual(page, 'christmas');
  await panel
    .getByRole('combobox', { name: 'Тема интерфейса', exact: true })
    .selectOption('liquid-light');
  await panel
    .getByRole('combobox', { name: 'Интенсивность стекла', exact: true })
    .selectOption('low');
  const low = await settledStyle(panel),
    lowChrome = await settledStyle(page.locator('.topbar'));
  await panel
    .getByRole('combobox', { name: 'Интенсивность стекла', exact: true })
    .selectOption('high');
  const high = await settledStyle(panel),
    highChrome = await settledStyle(page.locator('.topbar'));
  expect(high.background).not.toBe(low.background);
  expect(highChrome.blur).not.toBe(lowChrome.blur);
  await panel.getByRole('switch', { name: 'Праздничные анимации', exact: true }).uncheck();
  await expect(page.locator('html')).toHaveAttribute('data-holiday-animations', 'false');
  expect((await style(page.locator('.holiday-decor-piece').first())).animation).toBe('none');
  await panel.getByRole('button', { name: 'Цвет #83bbef', exact: true }).click();
  const holidayAccent = await page
    .locator('html')
    .evaluate((element) => getComputedStyle(element).getPropertyValue('--accent'));
  await panel.getByRole('switch', { name: 'Праздничное оформление', exact: true }).uncheck();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'liquid-light');
  await expect(page.locator('html')).toHaveAttribute('data-holiday', 'none');
  await expect(page.locator('.holiday-decor')).toHaveCount(0);
  expect(
    await page
      .locator('html')
      .evaluate((element) => getComputedStyle(element).getPropertyValue('--accent')),
  ).not.toBe(holidayAccent);
  await panel.getByRole('switch', { name: 'Праздничное оформление', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-holiday', 'christmas');
  await page.locator('.avatar-button').click();
  await expect(profile.locator('textarea').first()).toHaveValue(draft);
  const snapshot = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
  expect(snapshot).toMatchObject({
    theme: 'liquid-light',
    glassIntensity: 'high',
    holidayEnabled: true,
    holidayMode: 'manual',
    manualHoliday: 'christmas',
    holidayAnimations: false,
    accent: '#83bbef',
  });
  expect((await fixture(page)).clearedSessions).toBe(0);
  expect((await fixture(page)).requests.some((request) => request.method !== 'GET')).toBe(false);
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'liquid-light');
  await expect(page.locator('html')).toHaveAttribute('data-holiday', 'christmas');
  await settings(page);
  await expect(
    controls(page).getByRole('combobox', { name: 'Интенсивность стекла', exact: true }),
  ).toHaveValue('high');
  await expect(
    controls(page).getByRole('switch', { name: 'Праздничные анимации', exact: true }),
  ).not.toBeChecked();
  expect((await fixture(page)).clearedSessions).toBe(0);
  expect((await fixture(page)).unexpected).toEqual([]);
});

test('automatic holidays start at local midnight and refresh after native resume across year and Easter boundaries', async ({
  page,
}) => {
  await device(page);
  const start = new Date('2026-10-14T23:55:00+02:00');
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start);
  await open(page);
  await settings(page);
  const panel = controls(page),
    html = page.locator('html');
  await panel
    .getByRole('combobox', { name: 'Тема интерфейса', exact: true })
    .selectOption('liquid-dark');
  await expect(html).toHaveAttribute('data-holiday', 'none');
  await page.clock.fastForward(6 * 60_000);
  await expect(html).toHaveAttribute('data-holiday', 'halloween');
  await expect(html).toHaveAttribute('data-theme', 'liquid-dark');
  for (const [date, holiday] of [
    ['2026-11-03T12:00:00+01:00', 'none'],
    ['2026-12-15T12:00:00+01:00', 'christmas'],
    ['2027-01-10T23:55:00+01:00', 'christmas'],
  ]) {
    await page.evaluate(() =>
      (window as unknown as { __appearanceTest: Fixture }).__appearanceTest.emitAppState(false),
    );
    await expect(html).toHaveAttribute('data-app-active', 'false');
    await page.clock.setSystemTime(new Date(date));
    await page.evaluate(() =>
      (window as unknown as { __appearanceTest: Fixture }).__appearanceTest.emitAppState(true),
    );
    await expect(html).toHaveAttribute('data-holiday', holiday);
  }
  await page.clock.fastForward(6 * 60_000);
  await expect(html).toHaveAttribute('data-holiday', 'none');
  for (const date of [
    '2026-04-06T12:00:00+02:00',
    '2026-04-07T12:00:00+02:00',
    '2026-04-14T12:00:00+02:00',
  ]) {
    await page.clock.setSystemTime(new Date(date));
    await page.evaluate(() =>
      (window as unknown as { __appearanceTest: Fixture }).__appearanceTest.emitAppState(true),
    );
    await expect(html).toHaveAttribute('data-holiday', 'easter');
  }
  await page.clock.setSystemTime(new Date('2026-04-15T12:00:00+02:00'));
  await page.evaluate(() =>
    (window as unknown as { __appearanceTest: Fixture }).__appearanceTest.emitAppState(true),
  );
  await expect(html).toHaveAttribute('data-holiday', 'none');
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
  expect(saved).toMatchObject({
    theme: 'liquid-dark',
    holidayEnabled: true,
    holidayMode: 'automatic',
  });
  expect((await fixture(page)).clearedSessions).toBe(0);
  expect((await fixture(page)).unexpected).toEqual([]);
});

test('weak WebViews and reduced-motion preferences keep static decorations with no expensive blur', async ({
  page,
}) => {
  await device(page, true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await settings(page);
  const panel = controls(page);
  await manual(page, 'christmas');
  await panel
    .getByRole('combobox', { name: 'Тема интерфейса', exact: true })
    .selectOption('liquid-dark');
  await panel
    .getByRole('combobox', { name: 'Интенсивность стекла', exact: true })
    .selectOption('high');
  await expect(page.locator('html')).toHaveAttribute('data-effects', 'reduced');
  await expect(
    panel.getByText('На этом устройстве используются облегчённые эффекты.', { exact: true }),
  ).toBeVisible();
  expect((await style(page.locator('.topbar'))).blur).toBe('none');
  await expect(page.locator('.holiday-decor--ambient .holiday-decor-piece')).toHaveCount(2);
  expect((await style(page.locator('.holiday-decor-piece').first())).animation).toBe('none');
  await panel.getByRole('switch', { name: 'Праздничные анимации', exact: true }).uncheck();
  await expect(page.locator('.holiday-decor--ambient')).toHaveCount(1);
  await noOverflow(page);
  expect((await fixture(page)).unexpected).toEqual([]);
});

test('light glass preserves network panning, profile opening and fullscreen rendering without graph blur', async ({
  page,
}) => {
  await device(page);
  await open(page);
  await settings(page);
  await manual(page, 'christmas');
  await controls(page)
    .getByRole('combobox', { name: 'Тема интерфейса', exact: true })
    .selectOption('liquid-light');
  await nav(page).locator('button').nth(4).click();
  await active(page, 'more')
    .locator('.more-card')
    .filter({ has: page.getByRole('heading', { name: 'Диаграммы', exact: true }) })
    .click();
  await page.getByRole('button', { name: 'Mutual Friend Network', exact: true }).click();
  await page.getByRole('button', { name: 'Граф', exact: true }).click();
  const svg = page.getByRole('img', { name: 'Граф общих друзей', exact: true });
  await expect(svg.locator('.network-node')).toHaveCount(2);
  await svg.scrollIntoViewIfNeeded();
  expect((await style(page.locator('.network-frame'))).blur).toBe('none');
  expect((await style(svg)).blur).toBe('none');
  const result = await svg.evaluate(async (element) => {
    const scene = element.querySelector('.network-scene')!,
      start = scene.getAttribute('transform');
    let changes = 0;
    const observer = new MutationObserver((records) => {
      changes += records.filter((record) => record.target !== scene).length;
    });
    observer.observe(scene, { attributes: true, childList: true, subtree: true });
    const rect = element.getBoundingClientRect(),
      x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2;
    const pointer = (type: string, dx: number) =>
      element.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 71,
          pointerType: 'touch',
          clientX: x + dx,
          clientY: y,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
        }),
      );
    pointer('pointerdown', 0);
    for (let i = 1; i <= 6; i++) {
      pointer('pointermove', i * 6);
      await new Promise(requestAnimationFrame);
    }
    const end = scene.getAttribute('transform');
    pointer('pointerup', 36);
    observer.disconnect();
    return { start, end, changes };
  });
  expect(result.end).not.toBe(result.start);
  expect(result.changes).toBe(0);
  await page.getByRole('button', { name: 'На весь экран', exact: true }).click();
  const fullscreen = page.getByRole('dialog', {
    name: 'Граф общих друзей на весь экран',
    exact: true,
  });
  expect((await style(fullscreen)).blur).toBe('none');
  await fullscreen
    .getByRole('button', { name: 'Открыть профиль Theme Friend', exact: true })
    .press('Enter');
  const profile = page.getByRole('dialog', { name: 'Профиль', exact: true });
  await expect(profile.getByRole('heading', { name: 'Theme Friend', exact: true })).toBeVisible();
  expect((await style(profile)).blur).toContain('blur(');
  await profile.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(fullscreen).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(fullscreen).toHaveCount(0);
  await noOverflow(page);
  expect((await fixture(page)).unexpected).toEqual([]);
});

test('light glass keeps selected calendar days and current-avatar artwork labels readable on hover', async ({
  page,
}) => {
  await device(page);
  await open(page);
  await settings(page);
  await manual(page, 'christmas');
  await controls(page)
    .getByRole('combobox', { name: 'Тема интерфейса', exact: true })
    .selectOption('liquid-light');
  await nav(page).locator('button').nth(4).click();
  await active(page, 'more')
    .locator('.more-card')
    .filter({ has: page.getByRole('heading', { name: 'Календарь', exact: true }) })
    .click();
  const day = active(page, 'calendar').locator('.calendar-day').first();
  await day.click();
  await expect(day).toHaveAttribute('aria-pressed', 'true');
  await day.hover();
  const selected = await settledStyle(day);
  expect(contrast(selected.color, selected.background)).toBeGreaterThanOrEqual(4.5);
  await nav(page).locator('button').nth(2).click();
  await page
    .getByRole('group', { name: 'Разделы поиска', exact: true })
    .getByRole('button', { name: 'Аватары', exact: true })
    .click();
  const label = page.locator('.current-avatar');
  await expect(label).toBeVisible();
  const artworkLabel = await settledStyle(label);
  expect(contrast(artworkLabel.color, artworkLabel.background)).toBeGreaterThanOrEqual(4.5);
  const alpha = artworkLabel.background.match(/[\d.]+/g)!;
  expect(alpha.length === 3 || Number(alpha[3]) >= 0.95).toBe(true);
  expect((await fixture(page)).unexpected).toEqual([]);
});
