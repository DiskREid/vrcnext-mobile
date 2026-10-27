import { test, expect } from '@playwright/test';

const state = (page: import('@playwright/test').Page) => page.evaluate(() =>
  (window as unknown as { __avatarHistorySearch: { searches: { query: string; page: number }[]; requests: string[]; actions: unknown[] } }).__avatarHistorySearch);

test('an avatar name starts AvatarDB search on demand and preserves results on a failed next page', async ({ page }) => {
  await page.goto('/tests/avatar-history-search-harness.html?mode=paging');
  expect((await state(page)).searches).toEqual([]);
  await page.getByRole('button', { name: 'Найти аватар Reilynn The Werewolf в AvatarDB', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Поиск аватара в AvatarDB', exact: true });
  await expect(search.getByRole('listitem')).toHaveCount(20);
  expect((await state(page)).searches).toEqual([{ query: 'Reilynn The Werewolf', page: 0 }]);
  expect((await state(page)).requests).toEqual([]);
  await expect(search.getByRole('listitem').first()).toContainText('Synthetic Exact Avatar');
  await expect(search.getByText('ID совпадает', { exact: true })).toHaveCount(1);
  await search.getByRole('button', { name: 'Загрузить ещё', exact: true }).click();
  await expect(search.getByRole('alert')).toContainText('временно недоступна');
  await expect(search.getByRole('listitem')).toHaveCount(20);
  await expect(search.getByText('В AvatarDB нет совпадений', { exact: true })).toHaveCount(0);
  await search.getByRole('button', { name: 'Повторить поиск', exact: true }).click();
  await expect(search.getByRole('listitem')).toHaveCount(21);
  expect((await state(page)).searches.map(item => item.page)).toEqual([0, 1, 1]);
  await search.getByRole('button', { name: 'Открыть аватар Synthetic Exact Avatar', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Synthetic Exact Avatar', exact: true })).toBeVisible();
  await expect.poll(async () => (await state(page)).requests).toContain('/avatars/avtr_exact');
});

test('nested profile search escapes the scrolling container and author navigation closes its search layer', async ({ page }) => {
  await page.goto('/tests/avatar-history-search-harness.html?parent=1');
  const parent = page.getByRole('dialog', { name: 'Профиль: родитель', exact: true });
  await parent.getByRole('button', { name: 'Найти аватар Reilynn The Werewolf в AvatarDB', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Поиск аватара в AvatarDB', exact: true });
  await expect(search.getByRole('button', { name: 'Открыть аватар Synthetic Exact Avatar', exact: true })).toBeVisible();
  await expect.poll(() => search.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  await search.getByRole('button', { name: 'Открыть аватар Synthetic Exact Avatar', exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'Synthetic Exact Avatar', exact: true });
  await expect(detail).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(search).toBeVisible();
  await search.getByRole('button', { name: 'Открыть аватар Synthetic Exact Avatar', exact: true }).click();
  await detail.getByRole('button', { name: 'Synthetic Creator', exact: true }).click();
  await expect(search).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Профиль автора', exact: true })).toBeVisible();
  expect((await state(page)).actions).toEqual([{ type: 'user', id: 'usr_avatar-author' }]);
});

test('closing a pending search ignores its late result, and a 429 exposes a real retry pause', async ({ page }) => {
  await page.goto('/tests/avatar-history-search-harness.html?mode=delay');
  await page.getByRole('button', { name: 'Найти аватар Reilynn The Werewolf в AvatarDB', exact: true }).click();
  await expect.poll(async () => (await state(page)).searches.length).toBe(1);
  const search = page.getByRole('dialog', { name: 'Поиск аватара в AvatarDB', exact: true });
  await search.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.evaluate(() => (window as unknown as { __avatarHistorySearch: { resolveSearch: () => void } }).__avatarHistorySearch.resolveSearch());
  await expect(search).toHaveCount(0);
  await page.goto('/tests/avatar-history-search-harness.html?mode=rate');
  await page.getByRole('button', { name: 'Найти аватар Reilynn The Werewolf в AvatarDB', exact: true }).click();
  await expect(search.getByRole('alert')).toContainText('Лимит поиска');
  await expect(search.getByRole('button', { name: /Повторить через/ })).toBeDisabled();
  expect((await state(page)).searches).toHaveLength(1);
  await search.getByRole('button', { name: 'Повторить поиск', exact: true }).click();
  await expect(search.getByRole('listitem')).toHaveCount(1);
  expect((await state(page)).searches).toHaveLength(2);
});

test('demo searches stay local and an overlong name uses a known avatar ID without truncation', async ({ page }) => {
  await page.goto('/tests/avatar-history-search-harness.html?demo=1');
  await expect(page.getByRole('button', { name: 'Найти аватар Reilynn The Werewolf в AvatarDB', exact: true })).toBeDisabled();
  expect((await state(page)).searches).toEqual([]);
  await page.goto('/tests/avatar-history-search-harness.html?long=1');
  await page.locator('.history-avatar-search-trigger').click();
  await expect.poll(async () => (await state(page)).searches).toEqual([{ query: 'avtr_exact', page: 0 }]);
  await page.goto('/tests/avatar-history-search-harness.html?long=1&noid=1');
  await expect(page.locator('.history-avatar-search-trigger')).toBeDisabled();
  expect((await state(page)).searches).toEqual([]);
});
