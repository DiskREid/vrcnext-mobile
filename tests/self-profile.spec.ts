import { expect, test, type Page } from '@playwright/test';

type Fixture = {
  ready: boolean;
  requests: { path: string; method: string; body?: Record<string, unknown> }[];
  unexpected: string[];
  clearedSessions: number;
  selfId: string;
  holdSaveResume: boolean;
  saveResumePending: boolean;
};
const data = (page: Page) =>
  page.evaluate(() => (window as unknown as { __selfProfileTest: Fixture }).__selfProfileTest);
const profile = (page: Page) =>
  page.locator('.retained-screen[data-screen="profile"]:not([hidden])');
async function open(page: Page) {
  await page.addInitScript(() => localStorage.setItem('vrcnext.language', 'ru'));
  await page.goto('/tests/self-profile-harness.html');
  await page.waitForFunction(
    () => (window as unknown as { __selfProfileTest?: Fixture }).__selfProfileTest?.ready === true,
  );
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.locator('.avatar-button').click();
  await expect(profile(page).locator('.self-profile-view')).toBeVisible();
  await expect(
    profile(page).getByRole('heading', { name: 'Own Profile Explorer', exact: true }),
  ).toBeVisible();
  return profile(page);
}

async function noOverflow(page: Page) {
  const widths = await page.evaluate(() =>
    [
      document.documentElement,
      document.querySelector('.retained-screen[data-screen="profile"]')!,
    ].map((element) => ({ width: element.clientWidth, scroll: element.scrollWidth })),
  );
  for (const size of widths) expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
}

test('own profile starts with full information and real private groups, worlds and avatars without self-directed friend actions', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const own = await open(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(own).toContainText('Original own biography');
  await expect(own.getByRole('button', { name: 'Пригласить друга', exact: true })).toHaveCount(0);
  await expect(own.getByRole('button', { name: 'Попросить инвайт', exact: true })).toHaveCount(0);
  await expect(own.getByRole('button', { name: 'Boop', exact: true })).toHaveCount(0);
  await expect(own.getByRole('button', { name: 'Заглушить', exact: true })).toHaveCount(0);
  await expect(own.getByRole('button', { name: 'Заблокировать', exact: true })).toHaveCount(0);
  await own.getByRole('button', { name: 'Группы', exact: true }).click();
  const group = own
    .getByRole('button')
    .filter({ has: page.getByText('Own Profile Community', { exact: true }) });
  await expect(group).toBeVisible();
  await group.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `artifacts/regressions/${info.project.name}-own-profile-groups-synthetic.png`,
  });
  await own.getByRole('button', { name: 'Миры', exact: true }).click();
  await expect(own.getByText('Own Private World', { exact: true })).toBeVisible();
  await own.getByText('Own Private World', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `artifacts/regressions/${info.project.name}-own-profile-worlds-synthetic.png`,
  });
  await own.getByRole('button', { name: 'Аватары', exact: true }).click();
  await expect(own.getByText('Own Private Avatar', { exact: true })).toBeVisible();
  await own.getByText('Own Private Avatar', { exact: true }).scrollIntoViewIfNeeded();
  const state = await data(page);
  expect(state.requests.some((request) => request.path === `/users/${state.selfId}/groups`)).toBe(
    true,
  );
  const worlds = state.requests
    .map((request) => new URL(request.path, 'https://synthetic.invalid'))
    .find((url) => url.pathname === '/worlds' && url.searchParams.get('user') === 'me');
  expect(worlds?.searchParams.get('userId')).toBe(state.selfId);
  expect(worlds?.searchParams.get('releaseStatus')).toBe('all');
  const avatars = state.requests
    .map((request) => new URL(request.path, 'https://synthetic.invalid'))
    .find((url) => url.pathname === '/avatars');
  expect(avatars?.searchParams.get('user')).toBe('me');
  expect(avatars?.searchParams.get('releaseStatus')).toBe('all');
  expect(state.requests.some((request) => request.method !== 'GET')).toBe(false);
  expect(state.unexpected).toEqual([]);
  expect(state.clearedSessions).toBe(0);
  expect(errors).toEqual([]);
  await noOverflow(page);
  await page.screenshot({
    path: `artifacts/regressions/${info.project.name}-own-profile-avatars-synthetic.png`,
  });
});

test('own profile editing keeps drafts across view switches and updates the displayed biography after save', async ({
  page,
}) => {
  const own = await open(page);
  await own.getByRole('button', { name: 'Редактировать профиль', exact: true }).click();
  const editor = own.locator('.self-profile-edit');
  await expect(editor.getByRole('textbox', { name: 'О себе', exact: true })).toHaveValue(
    'Original own biography',
  );
  const draft = 'Own profile saved biography / 世界';
  await editor.getByRole('textbox', { name: 'О себе', exact: true }).fill(draft);
  await editor.getByRole('combobox', { name: 'Статус', exact: true }).selectOption('busy');
  await own
    .locator('.self-profile-mode')
    .getByRole('button', { name: 'Профиль', exact: true })
    .click();
  await own.getByRole('button', { name: 'Группы', exact: true }).click();
  await expect(own.getByText('Own Profile Community', { exact: true })).toBeVisible();
  expect((await data(page)).requests.every((request) => request.method === 'GET')).toBe(true);
  await own.getByRole('button', { name: 'Редактировать профиль', exact: true }).click();
  await expect(editor.getByRole('textbox', { name: 'О себе', exact: true })).toHaveValue(draft);
  await expect(editor.getByRole('combobox', { name: 'Статус', exact: true })).toHaveValue('busy');
  await editor.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect
    .poll(
      async () => (await data(page)).requests.filter((request) => request.method === 'PUT').length,
    )
    .toBe(2);
  await expect(
    editor.getByRole('button', { name: 'Сохранить изменения', exact: true }),
  ).toBeEnabled();
  await own
    .locator('.self-profile-mode')
    .getByRole('button', { name: 'Профиль', exact: true })
    .click();
  await own.getByRole('button', { name: 'Информация', exact: true }).click();
  await expect(own.locator('.preserve-lines').first()).toHaveText(draft);
  const state = await data(page);
  expect(
    state.requests.filter((request) => request.method === 'PUT').map((request) => request.path),
  ).toEqual([`/users/${state.selfId}`, `/profile/${state.selfId}`]);
  expect(
    state.requests.some(
      (request) =>
        request.method !== 'GET' &&
        (request.path.includes('/moderations') ||
          request.path.includes('/invite/') ||
          request.path.includes('/friends')),
    ),
  ).toBe(false);
  expect(state.clearedSessions).toBe(0);
  expect(state.unexpected).toEqual([]);
  await noOverflow(page);
});

test('a delayed profile save keeps newer own location received from the live pipeline', async ({
  page,
}) => {
  const own = await open(page);
  await own.getByRole('button', { name: 'Редактировать профиль', exact: true }).click();
  const editor = own.locator('.self-profile-edit');
  await expect(editor.getByRole('textbox', { name: 'О себе', exact: true })).toHaveValue(
    'Original own biography',
  );
  await page.evaluate(() => {
    (window as unknown as { __selfProfileTest: Fixture }).__selfProfileTest.holdSaveResume = true;
  });
  await editor
    .getByRole('textbox', { name: 'О себе', exact: true })
    .fill('Saved during location change');
  await editor.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect.poll(async () => (await data(page)).saveResumePending).toBe(true);
  await page.evaluate(() => {
    (window as unknown as { __emitOwnLocation: (location: string) => void }).__emitOwnLocation(
      'private',
    );
  });
  await expect(editor.locator('.status-dot')).toHaveClass(/presence-game/);
  await page.evaluate(() => {
    (window as unknown as { __releaseProfileSave: () => void }).__releaseProfileSave();
  });
  await expect(
    editor.getByRole('button', { name: 'Сохранить изменения', exact: true }),
  ).toBeEnabled();
  await expect(editor.locator('.status-dot')).toHaveClass(/presence-game/);
  await expect(editor.locator('.status-dot')).toHaveAttribute('aria-label', 'В VRChat');
  expect((await data(page)).unexpected).toEqual([]);
  expect((await data(page)).clearedSessions).toBe(0);
});
