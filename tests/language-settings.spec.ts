import { test, expect, type Page } from '@playwright/test';

type Fixture = {
  requests: { path: string; method: string }[];
  unexpected: string[];
  links: string[];
  clearedSessions: number;
};
const fixture = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __languageSettingsTest: Fixture }).__languageSettingsTest,
  );
const activeScreen = (page: Page, screen: string) =>
  page.locator(`.retained-screen[data-screen="${screen}"]:not([hidden])`);
const nav = (page: Page) => page.locator('nav.side-nav:visible, nav.bottom-nav:visible').first();
async function openSettings(page: Page) {
  await page.goto('/tests/language-settings-harness.html');
  await expect(page.locator('.app-shell')).toBeVisible();
  await nav(page).locator('button').nth(4).click();
  await activeScreen(page, 'more')
    .locator('.more-card')
    .filter({ has: page.getByRole('heading', { name: 'Настройки', exact: true }) })
    .click();
  await expect(activeScreen(page, 'settings')).toBeVisible();
}
async function noOverflow(page: Page) {
  const sizes = await page.evaluate(() =>
    [
      document.documentElement,
      document.querySelector('.main-content'),
      document.querySelector('.retained-screen:not([hidden])'),
    ]
      .filter((node): node is HTMLElement => node instanceof HTMLElement)
      .map((node) => ({ width: node.clientWidth, scroll: node.scrollWidth })),
  );
  for (const { width, scroll } of sizes) expect(scroll).toBeLessThanOrEqual(width + 1);
}

test('all eleven languages switch immediately, retain the account and persist after reload', async ({
  page,
}, testInfo) => {
  const errors: string[] = [],
    externalRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/(?:api|pipeline)\.vrchat\.(?:cloud|com)|boosty\.to/.test(request.url()))
      externalRequests.push(request.url());
  });
  await openSettings(page);
  const languageSelect = activeScreen(page, 'settings').locator('select').first();
  const codes = ['ru', 'en', 'ja', 'de', 'fr', 'es', 'pt', 'pl', 'it', 'tr', 'uk'];
  const homeLabels: Record<string, string> = {
    ru: 'Главная',
    en: 'Home',
    ja: 'ホーム',
    de: 'Start',
    fr: 'Accueil',
    es: 'Inicio',
    pt: 'Início',
    pl: 'Strona główna',
    it: 'Home',
    tr: 'Ana Sayfa',
    uk: 'Головна',
  };
  await expect(languageSelect.locator('option')).toHaveCount(12);
  for (const code of codes) {
    await languageSelect.selectOption(code);
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('vrcnext.language')))
      .toBe(code);
    await expect(page.locator('.account-button strong')).toHaveText('Настройки');
    await expect(activeScreen(page, 'settings')).toBeVisible();
    const home = nav(page).locator('button').first();
    await expect(home).toHaveAttribute('aria-label', homeLabels[code]);
    if (code !== 'ru') {
      await expect(page.locator('.breadcrumb strong')).not.toHaveText('Настройки');
    }
    if (code === 'ja')
      await expect(home).toHaveAttribute('aria-label', /[\u3040-\u30ff\u3400-\u9fff]/);
    if (code === 'uk') await expect(home).toHaveAttribute('aria-label', /Головна|Домівка/);
    await noOverflow(page);
  }
  expect((await fixture(page)).clearedSessions).toBe(0);
  expect(
    (await fixture(page)).requests.some((request) => /^\/users\/[^/]+$/.test(request.path)),
  ).toBe(false);
  await languageSelect.selectOption('ja');
  await page.screenshot({
    path: `artifacts/regressions/${testInfo.project.name}-language-settings-japanese-synthetic-fixture.png`,
  });
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(nav(page).locator('button').first()).toHaveAttribute(
    'aria-label',
    /[\u3040-\u30ff\u3400-\u9fff]/,
  );
  await expect(page.locator('.account-button strong')).toHaveText('Настройки');
  expect((await fixture(page)).clearedSessions).toBe(0);
  expect((await fixture(page)).unexpected).toEqual([]);
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('project page is available from More without a Settings duplicate, opens Boosty only on tap and preserves credits and user text', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSettings(page);
  await activeScreen(page, 'settings').locator('select').first().selectOption('en');
  await expect(activeScreen(page, 'settings').getByRole('heading', { name: /about/i })).toHaveCount(
    0,
  );
  await expect(
    activeScreen(page, 'settings').getByRole('button', {
      name: /project page|about the project|about project/i,
    }),
  ).toHaveCount(0);
  await nav(page).locator('button').nth(4).click();
  const aboutLink = activeScreen(page, 'more')
    .locator('.more-card')
    .filter({ has: page.getByRole('heading', { name: /about/i }) });
  await expect(aboutLink).toHaveCount(1);
  await aboutLink.click();
  const about = activeScreen(page, 'about');
  await expect(about).toBeVisible();
  await expect(about).toContainText('DiskREid');
  await expect(about).toContainText('shinyflvre');
  await expect(about).toContainText('VRChat Inc.');
  const boosty = about.locator('a[href="https://boosty.to/mr.diskreid"]');
  await expect(boosty).toHaveCount(1);
  expect((await fixture(page)).links).toEqual([]);
  await boosty.click();
  await expect
    .poll(async () => (await fixture(page)).links)
    .toEqual(['https://boosty.to/mr.diskreid']);
  await about.locator('summary').click();
  await expect(about.locator('.license-text')).toContainText('VNCOL');
  await expect(about.locator('a[href="https://github.com/DiskREid/vrcnext-mobile"]')).toBeVisible();
  await expect(about.locator('a[href="https://github.com/shinyflvre/VRCNext"]')).toBeVisible();
  await noOverflow(page);
  await about.locator('summary').click();
  await about.locator('.about-hero').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `artifacts/regressions/${testInfo.project.name}-about-project-english-synthetic-fixture.png`,
  });
  await nav(page).locator('button').nth(1).click();
  const friend = activeScreen(page, 'friends').locator('.friend-card');
  await expect(friend.getByRole('heading', { name: 'Миры', exact: true })).toBeVisible();
  await expect(friend).toContainText('На сайте');
  await friend.click();
  const profile = page.getByRole('dialog', { name: 'Profile', exact: true });
  await expect(profile.getByRole('heading', { name: 'Миры', exact: true })).toBeVisible();
  await expect(profile.locator('.user-profile-panel p.preserve-lines').first()).toHaveText(
    'Настройки',
  );
  expect((await fixture(page)).unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test('switching the interface language preserves unsaved profile edits without writing to the account', async ({
  page,
}) => {
  await openSettings(page);
  await page.locator('.avatar-button').click();
  const profile = activeScreen(page, 'profile');
  await expect(profile.getByRole('textbox', { name: 'О себе', exact: true })).toHaveValue(
    'Original self biography',
  );
  const editedBio = 'Настройки / 世界 — unsaved';
  await profile.getByRole('textbox', { name: 'О себе', exact: true }).fill(editedBio);
  await profile.getByRole('textbox', { name: 'Местоимения', exact: true }).fill('they / them');
  await profile.getByRole('combobox', { name: 'Статус', exact: true }).selectOption('busy');
  await nav(page).locator('button').nth(4).click();
  await activeScreen(page, 'more')
    .locator('.more-card')
    .filter({ has: page.getByRole('heading', { name: 'Настройки', exact: true }) })
    .click();
  await activeScreen(page, 'settings').locator('select').first().selectOption('ja');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await page.locator('.avatar-button').click();
  await expect(profile.locator('textarea').first()).toHaveValue(editedBio);
  await expect(profile.locator('input').first()).toHaveValue('they / them');
  await expect(profile.locator('select').first()).toHaveValue('busy');
  await expect(profile.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  const state = await fixture(page);
  expect(
    state.requests.filter(
      (request) => request.path.startsWith('/profile/') && request.path.endsWith('aaaaaaaaaaaa'),
    ),
  ).toHaveLength(1);
  expect(state.requests.some((request) => request.method !== 'GET')).toBe(false);
  expect(state.clearedSessions).toBe(0);
  expect(state.unexpected).toEqual([]);
});

test.describe('first launch follows a supported phone language', () => {
  test.use({ locale: 'ja-JP' });
  test('uses Japanese before any saved preference, then applies an explicit Russian choice', async ({
    page,
  }) => {
    await page.goto('/tests/language-settings-harness.html');
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(nav(page).locator('button').first()).toHaveAttribute(
      'aria-label',
      /[\u3040-\u30ff\u3400-\u9fff]/,
    );
    expect(await page.evaluate(() => localStorage.getItem('vrcnext.language'))).toBeNull();
    await nav(page).locator('button').nth(4).click();
    await activeScreen(page, 'more')
      .locator('.more-card')
      .filter({ has: page.getByRole('heading', { name: /設定/ }) })
      .click();
    const language = activeScreen(page, 'settings').locator('select').first();
    await expect(language).toHaveValue('system');
    await language.selectOption('ru');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(nav(page).locator('button').first()).toHaveAttribute('aria-label', 'Главная');
    await language.selectOption('system');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(language).toHaveValue('system');
    expect((await fixture(page)).clearedSessions).toBe(0);
  });
});
