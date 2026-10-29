import { expect, test, type Page } from '@playwright/test';

test.use({ timezoneId: 'Europe/Berlin' });
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
  ready: boolean;
  requests: { path: string; method: string }[];
  unexpected: string[];
  launcherCalls: (string | null)[];
  setAppearance: (patch: Record<string, unknown>) => void;
  emitAppState: (isActive: boolean) => void;
  appStateListenerCount: () => number;
};
const fixture = (page: Page) =>
  page.evaluate(() => (window as unknown as { __brandingTest: Fixture }).__brandingTest);
const nav = (page: Page) => page.locator('nav.side-nav:visible, nav.bottom-nav:visible').first();
const active = (page: Page, id: string) =>
  page.locator(`.retained-screen[data-screen="${id}"]:not([hidden])`);
const controls = (page: Page) => active(page, 'settings').locator('.appearance-settings');

async function open(page: Page) {
  await page.goto('/tests/branding-harness.html');
  // The HTML load event can precede the fixture's dynamic App import.
  await page.waitForFunction(
    () => (window as unknown as { __brandingTest?: Fixture }).__brandingTest?.ready === true,
  );
  await expect(
    page.getByRole('heading', { name: 'Привет, Theme Explorer ✦', exact: true }),
  ).toBeVisible();
  await expect.poll(async () => (await fixture(page)).launcherCalls).toEqual([null]);
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
async function logo(page: Page, variant: string, requireVisible = true) {
  const rendered = page.locator('img.brand-logo');
  await expect(rendered.first()).toHaveAttribute('data-brand-variant', variant);
  // Portrait settings intentionally replace the header logo with a Back button.
  if (requireVisible) await expect(rendered.filter({ visible: true }).first()).toBeVisible();
  for (const image of await rendered.all()) {
    await expect(image).toHaveAttribute('data-brand-variant', variant);
    await expect(image).toHaveAttribute('src', `/branding/${variant}.png`);
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
      )
      .toBe(true);
  }
  const calls = (await fixture(page)).launcherCalls;
  await expect
    .poll(async () => (await fixture(page)).launcherCalls.at(-1))
    .toBe(variant === 'standard' ? null : variant);
  expect(calls.length).toBeGreaterThan(0);
}
async function patch(page: Page, value: Record<string, unknown>) {
  await page.evaluate((settings) => {
    (window as unknown as { __brandingTest: Fixture }).__brandingTest.setAppearance(settings);
  }, value);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => 4 });
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, get: () => 8 });
  });
  await page.clock.setFixedTime(new Date('2026-06-20T12:00:00+02:00'));
});

test('all eight local logos decode and app branding follows holiday controls independently of glass themes', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  await logo(page, 'standard');
  const decoded = await page.evaluate(
    async (variants) =>
      Promise.all(
        variants.map(async (variant) => {
          const image = new Image();
          image.src = `/branding/${variant}.png`;
          await image.decode();
          return { variant, width: image.naturalWidth, height: image.naturalHeight };
        }),
      ),
    ['standard', ...holidays],
  );
  for (const image of decoded) {
    expect(image.width, image.variant).toBeGreaterThanOrEqual(256);
    expect(image.width, image.variant).toBe(image.height);
  }
  await settings(page);
  const before = (await fixture(page)).requests;
  const panel = controls(page);
  await panel
    .getByRole('combobox', { name: 'Режим оформления', exact: true })
    .selectOption('manual');
  await logo(page, 'halloween', false);
  for (const holiday of holidays) {
    await panel.getByRole('combobox', { name: 'Праздник', exact: true }).selectOption(holiday);
    await expect(page.locator('html')).toHaveAttribute('data-holiday', holiday);
    await logo(page, holiday, false);
  }
  const themedCalls = (await fixture(page)).launcherCalls;
  for (const theme of ['liquid-dark', 'liquid-light', 'standard-dark']) {
    await panel.getByRole('combobox', { name: 'Тема интерфейса', exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await logo(page, 'christmas', false);
    expect((await fixture(page)).launcherCalls).toEqual(themedCalls);
  }
  await panel.getByRole('switch', { name: 'Праздничное оформление', exact: true }).uncheck();
  await logo(page, 'standard', false);
  await nav(page).locator('button').nth(4).click();
  await expect(active(page, 'more')).toBeVisible();
  await logo(page, 'standard');
  expect((await fixture(page)).requests).toEqual(before);
  expect((await fixture(page)).unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test('manual branding survives reload and remains synchronized on authentication and automatic resume', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  await settings(page);
  await controls(page)
    .getByRole('combobox', { name: 'Режим оформления', exact: true })
    .selectOption('manual');
  await controls(page)
    .getByRole('combobox', { name: 'Праздник', exact: true })
    .selectOption('valentine');
  await logo(page, 'valentine', false);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Привет, Theme Explorer ✦', exact: true }),
  ).toBeVisible();
  await logo(page, 'valentine');
  expect((await fixture(page)).launcherCalls).toEqual(['valentine']);
  await page.goto('/tests/branding-harness.html?auth=0');
  await expect(page.locator('.auth-panel')).toBeVisible();
  await expect(page.locator('.auth-page img.brand-logo')).toHaveCount(2);
  await logo(page, 'valentine');
  expect((await fixture(page)).launcherCalls).toEqual(['valentine']);
  await patch(page, { holidayEnabled: false });
  await logo(page, 'standard');
  await patch(page, { holidayEnabled: true, holidayMode: 'automatic' });
  await logo(page, 'standard');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __brandingTest: Fixture }).__brandingTest.appStateListenerCount(),
      ),
    )
    .toBeGreaterThan(0);
  await page.evaluate(() =>
    (window as unknown as { __brandingTest: Fixture }).__brandingTest.emitAppState(false),
  );
  await page.clock.setFixedTime(new Date('2026-12-15T12:00:00+01:00'));
  await page.evaluate(() =>
    (window as unknown as { __brandingTest: Fixture }).__brandingTest.emitAppState(true),
  );
  await logo(page, 'christmas');
  await patch(page, { holidayMode: 'manual', manualHoliday: 'easter' });
  await logo(page, 'easter');
  await page.clock.setFixedTime(new Date('2027-02-14T12:00:00+01:00'));
  await page.evaluate(() => {
    const fixture = (window as unknown as { __brandingTest: Fixture }).__brandingTest;
    fixture.emitAppState(false);
    fixture.emitAppState(true);
  });
  await logo(page, 'easter');
  expect((await fixture(page)).launcherCalls).toEqual(['valentine', null, 'christmas', 'easter']);
  expect((await fixture(page)).requests).toEqual([]);
  expect((await fixture(page)).unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
