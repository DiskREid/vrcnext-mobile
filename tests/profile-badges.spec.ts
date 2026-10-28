import { test, expect } from '@playwright/test';

test('profile awards follow every selected language without translating user content or changing raw badge data', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/language-settings-harness.html?badges=1');
  const nav = page.locator('nav.side-nav:visible, nav.bottom-nav:visible').first();
  await expect(page.locator('.app-shell')).toBeVisible();
  await nav.locator('button').nth(1).click();
  await page
    .locator('.friend-card')
    .filter({ has: page.getByRole('heading', { name: 'Миры', exact: true }) })
    .click();
  const profile = page.getByRole('dialog');
  const badges = profile.locator('.user-badge');
  await expect(badges).toHaveCount(3);
  const original = await page.evaluate(() =>
    JSON.stringify((window as any).__languageSettingsTest.badges),
  );
  const requests = await page.evaluate(
    () => (window as any).__languageSettingsTest.requests.length,
  );
  for (const code of ['ru', 'en', 'ja', 'de', 'fr', 'es', 'pt', 'pl', 'it', 'tr', 'uk']) {
    await page.evaluate(
      (locale) => (window as any).__languageSettingsTest.chooseLanguage(locale),
      code,
    );
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    await expect(profile.getByRole('heading', { name: 'Миры', exact: true })).toBeVisible();
    await expect(profile.locator('.user-profile-panel p.preserve-lines').first()).toHaveText(
      'Настройки',
    );
    if (code === 'en') {
      await expect(badges.nth(0).locator('strong')).toHaveText('Early Supporter');
      await expect(badges.nth(0).locator('p')).toHaveText('Thank you for your support!');
    } else {
      await expect(badges.nth(0).locator('strong')).not.toHaveText('Early Supporter');
      await expect(badges.nth(0).locator('p')).not.toHaveText('Thank you for your support!');
    }
    if (code === 'ru') await expect(badges.nth(0).locator('strong')).toHaveText('Ранняя поддержка');
    if (code === 'ja') await expect(badges.nth(0).locator('strong')).toHaveText('初期サポーター');
    await expect(badges.nth(1).locator('p')).toHaveText('Awarded after 37 gifts; tier 4.');
    await expect(badges.nth(2).locator('strong')).toHaveText('Настройки');
    await expect(badges.nth(2).locator('p')).toHaveText('Миры');
  }
  expect(await page.evaluate(() => (window as any).__languageSettingsTest.requests.length)).toBe(
    requests,
  );
  expect(
    await page.evaluate(() => JSON.stringify((window as any).__languageSettingsTest.badges)),
  ).toBe(original);
  await page.evaluate(() => (window as any).__languageSettingsTest.chooseLanguage('ru'));
  await profile.locator('.user-badges').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `artifacts/regressions/${testInfo.project.name}-profile-badges-russian-synthetic-fixture.png`,
  });
  await profile.getByRole('button', { name: 'JSON', exact: true }).click();
  await profile.getByRole('button', { name: 'Копировать JSON', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__languageSettingsTest.copiedText.length))
    .toBe(1);
  const copied = await page.evaluate(() => (window as any).__languageSettingsTest.copiedText[0]);
  expect(copied).toContain('Early Supporter');
  expect(copied).not.toContain('Ранняя поддержка');
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as any).__languageSettingsTest.unexpected)).toEqual([]);
});
