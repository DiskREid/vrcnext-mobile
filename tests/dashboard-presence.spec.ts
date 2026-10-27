import { test, expect, type Page } from '@playwright/test';

type DashboardFixture = {
  requests: { path: string; method: string }[];
  unexpected: string[];
  connected: boolean;
  held: boolean;
  holdRefresh: () => void;
  releaseRefresh: () => void;
  emit: (mode: 'website' | 'game' | 'offline', location?: string) => void;
};
const fixture = (page: Page) => page.evaluate(() =>
  (window as unknown as { __dashboardPresenceTest: DashboardFixture }).__dashboardPresenceTest);
const bubble = (page: Page, name: string) => page.locator('.friend-bubble')
  .filter({ has: page.locator('strong', { hasText: name }) });
const gameCounter = (page: Page) => page.locator('.dashboard-stats button')
  .filter({ hasText: 'друзей в VRChat' }).locator('strong');

async function openDashboard(page: Page) {
  await page.goto('/tests/dashboard-presence-harness.html');
  await expect(page.getByRole('heading', { name: 'Привет, Synthetic Self ✦', exact: true })).toBeVisible();
  await expect.poll(async () => (await fixture(page)).connected).toBe(true);
}

test('dashboard counts game friends and shows the same presence as their full profiles', async ({ page }, testInfo) => {
  const errors: string[] = [], network: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/(?:api|pipeline)\.vrchat\.(?:cloud|com)/.test(request.url())) network.push(request.url()); });
  await openDashboard(page);
  await expect(bubble(page, 'Synthetic Game Friend').locator('span').last()).toContainText('В приватном мире');
  await expect(bubble(page, 'Synthetic Traveling Friend').locator('span').last()).toContainText('В VRChat');
  await expect(bubble(page, 'Synthetic Disclosed Friend').locator('span').last()).toContainText('В VRChat');
  await expect(bubble(page, 'Synthetic Website Friend').locator('span').last()).toContainText('На сайте');
  await expect(page.locator('.friend-bubble')).toHaveCount(4);
  await expect(bubble(page, 'Synthetic Offline Friend')).toHaveCount(0);
  await expect(gameCounter(page)).toHaveText('3');
  await expect(page.locator('.hero-content p')).toContainText('3 друзей в VRChat');
  expect((await fixture(page)).requests.some(request => /^\/users\/[^/]+$/.test(request.path))).toBe(false);
  for (const [name, mode] of [
    ['Synthetic Game Friend', 'game'], ['Synthetic Traveling Friend', 'game'],
    ['Synthetic Disclosed Friend', 'game'], ['Synthetic Website Friend', 'website'],
  ]) {
    const friend = bubble(page, name);
    await expect(friend.locator('.status-dot')).toHaveAttribute('data-presence', mode);
    await friend.click();
    const dialog = page.getByRole('dialog', { name: 'Профиль', exact: true });
    await expect(dialog.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(dialog.locator('.profile-identity .status-dot')).toHaveAttribute('data-presence', mode);
    await expect(dialog.locator('.status-line')).toContainText(mode === 'game' ? 'В VRChat' : 'На сайте');
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  }
  await page.locator('.friends-strip').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `artifacts/regressions/${testInfo.project.name}-dashboard-presence-synthetic-fixture.png` });
  expect(errors).toEqual([]); expect(network).toEqual([]);
  expect((await fixture(page)).unexpected).toEqual([]);
});

test('dashboard updates game, website and offline states without loading every profile or accepting an old refresh', async ({ page }) => {
  await openDashboard(page);
  const friend = bubble(page, 'Synthetic Website Friend');
  await expect(friend).toBeVisible();
  await expect(gameCounter(page)).toHaveText('3');
  // A friend-online event without a disclosed location still proves game presence.
  await page.evaluate(() => (window as unknown as { __dashboardPresenceTest: DashboardFixture }).__dashboardPresenceTest.emit('game', ''));
  await expect(friend.locator('span').last()).toContainText('В VRChat');
  await expect(friend.locator('.status-dot')).toHaveAttribute('data-presence', 'game');
  await expect(gameCounter(page)).toHaveText('4');
  await friend.click();
  const dialog = page.getByRole('dialog', { name: 'Профиль', exact: true });
  await expect(dialog.locator('.profile-identity .status-dot')).toHaveAttribute('data-presence', 'game');
  await page.evaluate(() => (window as unknown as { __dashboardPresenceTest: DashboardFixture }).__dashboardPresenceTest.emit('website'));
  await expect(dialog.locator('.profile-identity .status-dot')).toHaveAttribute('data-presence', 'website');
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(friend.locator('span').last()).toContainText('На сайте');
  await expect(gameCounter(page)).toHaveText('3');
  await page.evaluate(() => (window as unknown as { __dashboardPresenceTest: DashboardFixture }).__dashboardPresenceTest.holdRefresh());
  await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
  await expect.poll(async () => (await fixture(page)).held).toBe(true);
  await page.evaluate(() => (window as unknown as { __dashboardPresenceTest: DashboardFixture }).__dashboardPresenceTest.emit('offline'));
  await expect(friend).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __dashboardPresenceTest: DashboardFixture }).__dashboardPresenceTest.releaseRefresh());
  await expect.poll(async () => (await fixture(page)).held).toBe(false);
  await expect(page.locator('.friend-bubble')).toHaveCount(3);
  await expect(friend).toHaveCount(0);
  await expect(gameCounter(page)).toHaveText('3');
  expect((await fixture(page)).requests.filter(request => /^\/users\/[^/]+$/.test(request.path))).toHaveLength(1);
  expect((await fixture(page)).unexpected).toEqual([]);
});
