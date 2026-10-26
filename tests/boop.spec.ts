import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
type BoopFixture = { requests: { path: string; method: string; body?: string }[]; unexpected: string[]; rateLimit: boolean; rejectSelection: boolean; denyCustom: boolean; denyAnimated: boolean };
const fixture = (page: Page) => page.evaluate(() => (window as unknown as { __boopTest: BoopFixture }).__boopTest);
const posts = async (page: Page) => (await fixture(page)).requests.filter((request) => request.method === 'POST');
async function open(page: Page) {
  await page.goto('/tests/boop-harness.html');
  const dialog = page.getByRole('dialog', { name: 'Отправить Boop', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('Boop shows real default previews and posts exactly the selected emoji once', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const dialog = await open(page);
  const choices = dialog.getByRole('group', { name: 'Эмодзи Boop', exact: true });
  await expect(choices.getByRole('button')).toHaveCount(16);
  const heart = choices.getByRole('button', { name: 'Выбрать Сердце', exact: true });
  await expect.poll(() => heart.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  expect(await posts(page)).toEqual([]);
  await page.screenshot({ path: `artifacts/regressions/${testInfo.project.name}-boop-emoji-synthetic-fixture.png` });
  await dialog.getByRole('button', { name: 'Отправить Boop', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Boop отправлен: Сердце');
  expect(await posts(page)).toEqual([{ path: '/users/usr_target/boop', method: 'POST', body: '{"emojiId":"default_heart"}' }]);
  await expect(dialog.getByRole('button', { name: 'Отправлено', exact: true })).toBeDisabled();
  expect((await fixture(page)).unexpected).toEqual([]); expect(errors).toEqual([]);
});

test('Boop sends custom file versions and collectible inventory emoji without offering ordinary stickers', async ({ page }) => {
  let dialog = await open(page);
  await dialog.getByRole('button', { name: 'Мои эмодзи', exact: true }).click();
  await dialog.getByRole('button', { name: 'Выбрать Synthetic Custom Emoji', exact: true }).click();
  await dialog.getByRole('button', { name: 'Отправить Boop', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Boop отправлен');
  expect(JSON.parse((await posts(page))[0].body!)).toEqual({ emojiId: 'file_custom', emojiVersion: 4 });
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть выбор Boop', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Отправить Boop', exact: true });
  await dialog.getByRole('button', { name: 'Коллекционные', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Выбрать Synthetic Ordinary Sticker', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Выбрать Synthetic Collectible Emoji', exact: true }).click();
  await dialog.getByRole('button', { name: 'Отправить Boop', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Boop отправлен');
  expect(JSON.parse((await posts(page))[1].body!)).toEqual({ inventoryItemId: 'inv_emoji' });
  expect((await fixture(page)).requests.some((request) => request.path === '/inventory?types=emoji&archived=false&n=100&offset=0')).toBe(true);
  expect((await fixture(page)).unexpected).toEqual([]);
});

test('Boop rate limits keep selected emoji and disable retry without sending a fallback', async ({ page }) => {
  const dialog = await open(page);
  await page.evaluate(() => { (window as unknown as { __boopTest: BoopFixture }).__boopTest.rateLimit = true; });
  await dialog.getByRole('button', { name: 'Выбрать Сердце', exact: true }).click();
  await dialog.getByRole('button', { name: 'Отправить Boop', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Лимит VRChat');
  await expect(dialog.getByRole('button', { name: /Повторить через/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Выбрать Сердце', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await posts(page)).toHaveLength(1);
  expect(JSON.parse((await posts(page))[0].body!)).toEqual({ emojiId: 'default_heart' });
});

test('a rejected selected emoji remains an error rather than a fake successful generic Boop', async ({ page }) => {
  const dialog = await open(page);
  await page.evaluate(() => { (window as unknown as { __boopTest: BoopFixture }).__boopTest.rejectSelection = true; });
  await dialog.getByRole('button', { name: 'Выбрать Сердце', exact: true }).click();
  await dialog.getByRole('button', { name: 'Отправить Boop', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Synthetic emoji rejected');
  await expect(dialog.getByRole('status')).toHaveCount(0);
  expect(await posts(page)).toHaveLength(1);
  await expect(dialog.getByRole('button', { name: 'Отправить Boop', exact: true })).toBeEnabled();
});

test('a failed animated emoji lookup preserves available custom emoji and reports incomplete loading', async ({ page }) => {
  const dialog = await open(page);
  await page.evaluate(() => { (window as unknown as { __boopTest: BoopFixture }).__boopTest.denyAnimated = true; });
  await dialog.getByRole('button', { name: 'Мои эмодзи', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Часть эмодзи не загружена');
  await dialog.getByRole('button', { name: 'Выбрать Synthetic Custom Emoji', exact: true }).click();
  await dialog.getByRole('button', { name: 'Отправить Boop', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Boop отправлен');
  expect(JSON.parse((await posts(page))[0].body!)).toEqual({ emojiId: 'file_custom', emojiVersion: 4 });
  expect((await fixture(page)).unexpected).toEqual([]);
});
