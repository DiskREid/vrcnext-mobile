import { test, expect } from '@playwright/test';

test('profile replaces raw platform labels with accessible current and last platform icons', async ({
  page,
}, testInfo) => {
  await page.goto('/tests/platform-harness.html');
  const profile = page.getByRole('dialog', { name: 'Профиль', exact: true });
  await expect(
    profile.getByRole('heading', { name: 'Synthetic Platform Friend', exact: true }),
  ).toBeVisible();
  await expect(
    profile.getByRole('img', { name: 'Последняя платформа: ПК', exact: true }),
  ).toBeVisible();
  await expect(
    profile.getByRole('img', { name: 'Текущая платформа: Android', exact: true }),
  ).toBeVisible();
  await expect(
    profile.locator('.user-meta-row').filter({ hasText: 'Последняя платформа' }).locator('dd'),
  ).toHaveText('');
  await expect(
    profile.locator('.user-meta-row').filter({ hasText: 'Текущая платформа' }).locator('dd'),
  ).toHaveText('');
  await expect(profile.getByText('Не в сети', { exact: true })).toBeVisible();
  await expect(profile.locator('.user-platform-vr')).toHaveCount(0);
  await profile.locator('.user-platform-icon').last().scrollIntoViewIfNeeded();
  await expect(profile.locator('.user-platform-icon').first()).toBeInViewport();
  await expect(profile.locator('.user-platform-icon').last()).toBeInViewport();
  await page.screenshot({
    path: `artifacts/regressions/${testInfo.project.name}-platform-icons-synthetic-fixture.png`,
  });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __platformTest: { unexpected: string[] } }).__platformTest
          .unexpected,
    ),
  ).toEqual([]);
});

test('profile distinguishes iOS, explicit VR and website values while leaving unknown platforms honest', async ({
  page,
}) => {
  for (const [value, label, css] of [
    ['ios', 'iOS', 'ios'],
    ['vr', 'VR', 'vr'],
    ['web', 'Сайт', 'web'],
    ['unknownplatform', 'Платформа неизвестна', 'unknown'],
  ]) {
    await page.goto('/tests/platform-harness.html?last=&current=' + encodeURIComponent(value));
    const profile = page.getByRole('dialog', { name: 'Профиль', exact: true });
    const icon = profile.getByRole('img', { name: `Текущая платформа: ${label}`, exact: true });
    await expect(icon).toBeVisible();
    await expect(icon).toHaveClass(new RegExp(`user-platform-${css}`));
    await expect(profile.locator('.user-platform-icon')).toHaveCount(1);
    await expect(
      profile.locator('.user-meta-row').filter({ hasText: 'Текущая платформа' }).locator('dd'),
    ).toHaveText('');
    if (value === 'unknownplatform') await expect(icon).toHaveAttribute('title', /unknownplatform/);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __platformTest: { unexpected: string[] } }).__platformTest
            .unexpected,
      ),
    ).toEqual([]);
  }
});
