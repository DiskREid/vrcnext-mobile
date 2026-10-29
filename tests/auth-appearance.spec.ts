import { expect, test, type Page } from '@playwright/test';

type AuthFixture = {
  ready: boolean;
  requests: { path: string; method: string; hasAuthorization: boolean }[];
  clears: number;
  sessionReads: number;
  unexpected: string[];
  externalLinks: string[];
  setAppearance(patch: Record<string, unknown>): void;
};
const fixture = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __authAppearanceTest: AuthFixture }).__authAppearanceTest,
  );
const holidays = [
  'valentine',
  'womens-day',
  'st-patrick',
  'easter',
  'earth-day',
  'halloween',
  'christmas',
];
async function open(page: Page, weak = false, saved = '') {
  await page.addInitScript((weak) => {
    Object.defineProperty(navigator, 'deviceMemory', {
      configurable: true,
      get: () => (weak ? 2 : 4),
    });
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      configurable: true,
      get: () => (weak ? 2 : 8),
    });
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
  }, weak);
  await page.goto(`/tests/auth-appearance-harness.html${saved ? '?saved=' + saved : ''}`);
  await page.waitForFunction(
    () =>
      (window as unknown as { __authAppearanceTest?: AuthFixture }).__authAppearanceTest?.ready ===
      true,
  );
  await expect(page.locator('.auth-panel')).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Проверяем сохранённый вход' }),
  ).toHaveCount(0);
}
async function patch(page: Page, settings: Record<string, unknown>) {
  await page.evaluate(
    (settings) =>
      (
        window as unknown as { __authAppearanceTest: AuthFixture }
      ).__authAppearanceTest.setAppearance(settings),
    settings,
  );
}
async function noOverflow(page: Page) {
  const widths = await page.evaluate(() =>
    [
      document.documentElement,
      document.querySelector('.auth-page')!,
      document.querySelector('.auth-panel')!,
    ].map((element) => ({ width: element.clientWidth, scroll: element.scrollWidth })),
  );
  for (const box of widths) expect(box.scroll).toBeLessThanOrEqual(box.width + 1);
}

test('authentication uses all seven full holiday scenes and glass without losing the credential draft or opening browser login', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  await expect(page.getByRole('button', { name: /Google|официальный вход/ })).toHaveCount(0);
  await expect(page.locator('.auth-page a')).toHaveCount(0);
  await page.getByLabel('Имя пользователя VRChat').fill('synthetic.account');
  await page.getByLabel('Пароль', { exact: true }).fill('synthetic.password');
  for (const theme of ['liquid-dark', 'liquid-light', 'standard-dark']) {
    await patch(page, { theme });
    for (const holiday of holidays) {
      await patch(page, { manualHoliday: holiday });
      await expect(page.locator('html')).toHaveAttribute('data-holiday', holiday);
      await expect(page.locator('.auth-scene img.brand-logo').first()).toHaveAttribute(
        'data-brand-variant',
        holiday,
      );
      await expect
        .poll(() =>
          page
            .locator('.auth-scene-bg')
            .evaluate((element) => getComputedStyle(element).backgroundImage),
        )
        .toContain(`/appearance/hero-${holiday}.svg`);
      const image = await page.locator('.auth-scene-bg').evaluate(async (element) => {
        const url = getComputedStyle(element).backgroundImage.match(
          /url\(["']?([^"')]+)["']?\)/,
        )![1];
        const image = new Image();
        image.src = url;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      });
      expect(image.width).toBeGreaterThan(0);
      expect(image.height).toBeGreaterThan(0);
      await noOverflow(page);
    }
    if (theme !== 'standard-dark') {
      await expect(page.locator('.auth-panel')).toHaveAttribute('data-glass-optic');
      expect(
        await page
          .locator('.auth-panel')
          .evaluate((element) => getComputedStyle(element).backdropFilter),
      ).toContain('url(');
      for (const input of await page.locator('.auth-panel input').all()) {
        const value = await input.evaluate((element) => ({
          fill: getComputedStyle(element).backgroundImage,
          radius: parseFloat(getComputedStyle(element).borderTopLeftRadius),
        }));
        expect(value.fill).toContain('gradient');
        expect(value.radius).toBeGreaterThanOrEqual(8);
      }
    } else await expect(page.locator('.auth-panel')).not.toHaveAttribute('data-glass-optic');
    await page.screenshot({
      path: `artifacts/regressions/${info.project.name}-auth-${theme}-holiday-synthetic-fixture.png`,
      animations: 'disabled',
    });
  }
  await expect(page.getByLabel('Имя пользователя VRChat')).toHaveValue('synthetic.account');
  await expect(page.getByLabel('Пароль', { exact: true })).toHaveValue('synthetic.password');
  await patch(page, { holidayEnabled: false });
  await expect(page.locator('.auth-scene img.brand-logo').first()).toHaveAttribute(
    'data-brand-variant',
    'standard',
  );
  await expect(page.locator('.auth-scene .holiday-decor')).toHaveCount(0);
  const state = await fixture(page);
  expect(state.requests).toEqual([]);
  expect(state.clears).toBe(0);
  expect(state.externalLinks).toEqual([]);
  expect(state.unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test('holiday authentication preserves email confirmation, invalid-code retry and restored pending login', async ({
  page,
}) => {
  await open(page);
  await page.getByLabel('Имя пользователя VRChat').fill('synthetic.account');
  await page.getByLabel('Пароль', { exact: true }).fill('synthetic.password');
  await page.getByRole('button', { name: 'Войти в VRChat', exact: true }).click();
  await expect(page.getByLabel('Способ подтверждения')).toHaveValue('totp');
  await page.getByLabel('Способ подтверждения').selectOption('emailotp');
  await expect(page.getByLabel('Способ подтверждения')).toHaveValue('emailotp');
  await page.getByLabel('Код из письма', { exact: true }).fill('111111');
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('VRChat не принял код');
  expect((await fixture(page)).clears).toBe(1);
  await patch(page, { manualHoliday: 'christmas', theme: 'liquid-light' });
  await expect(page.getByLabel('Код из письма', { exact: true })).toHaveValue('111111');
  await page.getByLabel('Код из письма', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Привет, Auth Explorer ✦', exact: true }),
  ).toBeVisible();
  const state = await fixture(page);
  expect(state.requests.filter((request) => request.hasAuthorization)).toHaveLength(1);
  expect(state.clears).toBe(1);
  expect(state.externalLinks).toEqual([]);
  expect(state.unexpected).toEqual([]);
  await page.goto('/tests/auth-appearance-harness.html?saved=pending');
  await expect(
    page.getByText('Предыдущий вход ожидает подтверждения. Временная сессия восстановлена.'),
  ).toBeVisible();
  await expect(page.getByLabel('Способ подтверждения')).toHaveValue('totp');
  await page.getByLabel('Способ подтверждения').selectOption('emailotp');
  await expect(page.getByLabel('Способ подтверждения')).toHaveValue('emailotp');
  await page.getByRole('button', { name: 'Начать вход заново', exact: true }).click();
  await expect(page.getByLabel('Имя пользователя VRChat')).toBeVisible();
  expect((await fixture(page)).clears).toBe(1);
});

test('reduced effects keep the full holiday artwork and readable authentication without live lens filters', async ({
  page,
}, info) => {
  await open(page, true);
  await expect(page.locator('html')).toHaveAttribute('data-effects', 'reduced');
  await expect(page.locator('.auth-scene-bg')).toBeVisible();
  await expect(page.locator('.auth-panel')).not.toHaveAttribute('data-glass-optic');
  await expect(page.locator('.auth-scene .holiday-decor-piece')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Войти в VRChat', exact: true })).toBeEnabled();
  await noOverflow(page);
  await page.screenshot({
    path: `artifacts/regressions/${info.project.name}-auth-reduced-holiday-synthetic-fixture.png`,
    animations: 'disabled',
  });
  expect((await fixture(page)).requests).toEqual([]);
});
