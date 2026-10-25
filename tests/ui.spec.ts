import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

async function navigate(page: Page, name: string) {
  await page
    .locator('nav[aria-label="Основная навигация"]:visible')
    .getByRole('button', { name, exact: true })
    .click();
}
async function noHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    document: {
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    },
    main: (() => {
      const main = document.querySelector<HTMLElement>('.main-content');
      return main ? { width: main.clientWidth, scroll: main.scrollWidth } : null;
    })(),
    modal: (() => {
      const modal = document.querySelector<HTMLElement>('.modal');
      return modal ? { width: modal.clientWidth, scroll: modal.scrollWidth } : null;
    })(),
  }));
  expect(widths.document.scroll, 'document horizontal overflow').toBeLessThanOrEqual(
    widths.document.width + 1,
  );
  if (widths.main)
    expect(widths.main.scroll, 'main content horizontal overflow').toBeLessThanOrEqual(
      widths.main.width + 1,
    );
  if (widths.modal)
    expect(widths.modal.scroll, 'modal horizontal overflow').toBeLessThanOrEqual(
      widths.modal.width + 1,
    );
}
async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-${name}.png`,
    fullPage: true,
  });
}
async function demo(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Открыть деморежим' })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть деморежим' }).click();
  await expect(
    page.getByText('Вы в деморежиме. Данные примеров не связаны с VRChat.'),
  ).toBeVisible();
}

test.describe('VRCNext Mobile browser demo', () => {
  let browserErrors: string[];
  let credentialRequests: string[];
  test.beforeEach(async ({ page }) => {
    browserErrors = [];
    credentialRequests = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error')
        browserErrors.push(`${message.text()} [${message.location().url}]`);
    });
    page.on('request', (request) => {
      if (/(?:api|pipeline)\.vrchat\.(?:cloud|com)|avtrdb\.com/.test(request.url()))
        credentialRequests.push(request.url());
    });
  });
  test.afterEach(async () => {
    expect(browserErrors, 'browser errors').toEqual([]);
    expect(credentialRequests, 'demo must never contact VRChat or public avatar search').toEqual(
      [],
    );
  });

  test('explicit browser demo, home, friends, notification and demo mutation guard', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await expect(page.getByLabel('Имя пользователя VRChat')).toBeDisabled();
    await expect(page.getByLabel('Пароль', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Войти в VRChat', exact: true })).toBeDisabled();
    await page
      .getByRole('button', { name: 'Аккаунт Google или другой способ входа', exact: true })
      .click();
    await expect(
      page.getByText('Вход в браузере не переносит сессию в это приложение автоматически.'),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await page
      .getByRole('button', { name: 'Аккаунт Google или другой способ входа', exact: true })
      .click();
    await screenshot(page, testInfo, 'auth');
    await page.getByRole('button', { name: 'Открыть деморежим' }).click();
    await expect(
      page.getByText('Вы в деморежиме. Данные примеров не связаны с VRChat.'),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, 'home');
    await navigate(page, 'Друзья');
    await expect(page.getByRole('heading', { name: 'Друзья', exact: true })).toBeVisible();
    await expect(page.locator('.friend-card')).toHaveCount(6);
    await page.getByRole('searchbox', { name: 'Поиск по друзьям' }).fill('Luna');
    await expect(page.locator('.friend-card')).toHaveCount(1);
    await page.locator('.friend-card').click();
    const dialog = page.getByRole('dialog', { name: 'Профиль', exact: true });
    await expect(dialog.getByRole('heading', { name: 'Luna', exact: true })).toBeVisible();
    await dialog.getByLabel('Личная заметка').fill('UI test must not send data');
    await dialog.getByRole('button', { name: 'Сохранить заметку', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Деморежим: для этого действия' }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, 'friend-detail');
    for (const tab of ['Mutual Friends', 'Группы', 'Миры', 'Избранные миры', 'Аватары', 'Activity', 'JSON']) {
      await dialog.getByRole('button', { name: tab, exact: true }).click();
      await noHorizontalOverflow(page);
    }
    await expect(dialog.getByLabel('JSON пользователя')).toBeVisible();
    const downloading = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Экспорт JSON', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^VRCNext-usr_.*\.json$/);
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await navigate(page, 'События');
    await expect(page.getByRole('heading', { name: 'Уведомления', exact: true })).toBeVisible();
    await expect(page.getByText('Присоединяйся, мы на крыше! ✦')).toBeVisible();
    await page.getByRole('button', { name: 'Скрыть', exact: true }).click();
    await expect(page.getByText('Присоединяйся, мы на крыше! ✦')).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('worlds, group posts/gallery and avatars remain responsive', async ({ page }, testInfo) => {
    await demo(page);
    await navigate(page, 'Открыть');
    await expect(page.getByRole('heading', { name: 'Исследовать', exact: true })).toBeVisible();
    await expect(page.locator('.explore-world-grid .world-card')).toHaveCount(3);
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, 'explore-worlds');
    await page.locator('.explore-world-grid .world-card').first().click();
    let dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Midnight Rooftop', exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Создать инстанс', exact: true }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, 'world-detail');
    const originalViewport = page.viewportSize()!;
    await page.setViewportSize({ width: originalViewport.height, height: originalViewport.width });
    await expect(
      dialog.getByRole('heading', { name: 'Midnight Rooftop', exact: true }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, 'world-detail-rotated');
    await page.setViewportSize(originalViewport);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page
      .locator('.explore-main-tabs')
      .getByRole('button', { name: 'Группы', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Evening Explorers', exact: true }),
    ).toBeVisible();
    await page.locator('.group-card').click();
    dialog = page.getByRole('dialog', { name: 'Evening Explorers', exact: true });
    await expect(
      dialog.getByText('Новые миры и тёплая компания. Собираемся по вечерам.'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Публикации', exact: true }).click();
    await expect(
      dialog.getByRole('heading', { name: 'Добро пожаловать, исследователь!', exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Галерея', exact: true }).click();
    await expect(
      dialog.getByRole('heading', { name: 'Галереи пока нет', exact: true }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, 'group-detail');
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page
      .locator('.explore-main-tabs')
      .getByRole('button', { name: 'Аватары', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Cloud Walker', exact: true })).toBeVisible();
    await page.locator('.explore-avatar-grid .avatar-card').click();
    dialog = page.getByRole('dialog', { name: 'Cloud Walker', exact: true });
    await expect(dialog.getByText('Демонстрационная карточка аватара')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Уже выбран', exact: true })).toBeDisabled();
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, 'avatar-detail');
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByRole('button', { name: 'Публичные', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Название аватара в публичной базе' }).fill('Cloud');
    await expect(
      page.getByText(
        'Поиск в публичной базе avtrdb.com. Поисковый запрос передаётся её оператору.',
      ),
    ).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('calendar, inventory, messenger and settings are navigable', async ({ page }, testInfo) => {
    await demo(page);
    await navigate(page, 'Ещё');
    await expect(page.getByRole('button', { name: /OSC|SteamVR|Запуск ПК/ })).toHaveCount(0);
    await page.getByRole('button', { name: /^Календарь События и встречи/ }).click();
    await expect(page.getByRole('heading', { name: 'Календарь', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Вечер новых миров/ })).toBeVisible();
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, 'calendar');
    await page.getByRole('button', { name: /Вечер новых миров/ }).click();
    await expect(
      page.getByRole('dialog', { name: 'Вечер новых миров', exact: true }),
    ).toBeVisible();
    await noHorizontalOverflow(page);
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await navigate(page, 'Ещё');
    await page.getByRole('button', { name: /^Медиатека Фото, emoji и инвентарь/ }).click();
    await expect(page.getByRole('heading', { name: 'Инвентарь', exact: true })).toBeVisible();
    await expect(page.locator('.inventory-grid .media-card')).toHaveCount(3);
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, 'inventory');
    await page.locator('.inventory-grid .media-card').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await noHorizontalOverflow(page);
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await navigate(page, 'Ещё');
    await page.getByRole('button', { name: /^Сообщения Короткое сообщение другу/ }).click();
    await expect(page.getByRole('heading', { name: 'Сообщения', exact: true })).toBeVisible();
    await page.locator('.messenger-friend').first().click();
    await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Привет!');
    await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Деморежим: для этого действия' }),
    ).toBeVisible();
    await expect(page.locator('.message-receipt')).toHaveCount(0);
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, 'messenger');
    await navigate(page, 'Ещё');
    await page.getByRole('button', { name: /^Настройки Внешний вид и приложение/ }).click();
    await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
    const screenProtection = page.getByRole('switch', { name: 'Защита от снимка экрана', exact: true });
    await expect(screenProtection).toBeVisible();
    await expect(screenProtection).toBeDisabled();
    await expect(screenProtection).not.toBeChecked();
    await expect(page.getByText('Доступна в Android-приложении. Браузер не позволяет управлять снимками экрана.')).toBeVisible();
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, 'settings');
  });

  test('friends retain scroll, filters, search and row order across navigation and explicit refresh', async ({ page }) => {
    await demo(page);
    await navigate(page, 'Друзья');
    const friends = page.locator('[data-screen="friends"]');
    const cards = friends.locator('.friend-card');
    await expect(cards).toHaveCount(6);
    const order = await cards.locator('h3').allTextContents();
    const main = page.locator('.main-content');
    const scroll = await main.evaluate((element) => {
      element.scrollTo({ top: Math.min(120, element.scrollHeight - element.clientHeight), behavior: 'instant' });
      return element.scrollTop;
    });
    expect(scroll, 'friend list should have actual scrollable content').toBeGreaterThan(30);
    await navigate(page, 'Главная');
    await navigate(page, 'Друзья');
    await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeCloseTo(scroll, 0);
    expect(await cards.locator('h3').allTextContents()).toEqual(order);

    await page.getByRole('button', { name: 'В VRChat', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Поиск по друзьям' }).fill('Luna');
    await expect(cards).toHaveCount(1);
    await navigate(page, 'Ещё');
    await navigate(page, 'Друзья');
    await expect(page.getByRole('searchbox', { name: 'Поиск по друзьям' })).toHaveValue('Luna');
    await expect(page.getByRole('button', { name: 'В VRChat', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.getByRole('heading', { name: 'Luna', exact: true })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Поиск по друзьям' })).toHaveValue('Luna');

    // Dispatch a touch sequence through Chromium, hitting the real page heading at the top.
    await main.evaluate((element) => { element.scrollTo({ top: 0, behavior: 'instant' }); });
    const heading = await friends.getByRole('heading', { name: 'Друзья', exact: true }).boundingBox();
    expect(heading).not.toBeNull();
    const client = await page.context().newCDPSession(page);
    const x = heading!.x + Math.min(30, heading!.width / 2);
    const y = heading!.y + heading!.height / 2;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 150 }] });
    await expect(page.getByRole('status').filter({ hasText: 'Отпустите для обновления' })).toBeVisible();
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.pull-refresh')).toHaveCount(0);
    await expect(cards).toHaveCount(1);
    await expect(page.getByRole('searchbox', { name: 'Поиск по друзьям' })).toHaveValue('Luna');
    await noHorizontalOverflow(page);
  });

  test('Explore retains favorite category and search through inner tabs and screen changes', async ({ page }) => {
    await demo(page);
    await navigate(page, 'Открыть');
    await page.getByRole('button', { name: 'Избранное', exact: true }).click();
    await page.getByLabel('Коллекция избранного').selectOption('worlds2');
    const search = page.getByRole('searchbox', { name: 'Название мира или wrld_…' });
    await search.fill('Sakura');
    const worlds = page.locator('.explore-world-grid:visible .world-card');
    await expect(worlds).toHaveCount(1);
    const original = await worlds.locator('h3').allTextContents();
    await page.locator('.explore-main-tabs').getByRole('button', { name: 'Группы', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Evening Explorers', exact: true })).toBeVisible();
    await page.locator('.explore-main-tabs').getByRole('button', { name: 'Миры', exact: true }).click();
    await expect(search).toHaveValue('Sakura');
    await expect(page.getByLabel('Коллекция избранного')).toHaveValue('worlds2');
    await expect(page.getByRole('button', { name: 'Избранное', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await navigate(page, 'Главная');
    await navigate(page, 'Открыть');
    await expect(search).toHaveValue('Sakura');
    await expect(page.getByLabel('Коллекция избранного')).toHaveValue('worlds2');
    await page.getByRole('button', { name: 'Обновить миры', exact: true }).click();
    await expect(worlds).toHaveCount(1);
    expect(await worlds.locator('h3').allTextContents()).toEqual(original);
    await expect(search).toHaveValue('Sakura');
    await noHorizontalOverflow(page);
  });
});

test('new feed, locations, favorites and Social use real empty states or explicit demo data', async ({ page }) => {
  const errors: string[] = [];
  const network: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/(?:api|pipeline)\.vrchat\.(?:cloud|com)|avtrdb\.com/.test(request.url())) network.push(request.url()); });
  await demo(page);
  await navigate(page, 'Ещё');
  await page.getByRole('button', { name: /^Лента История наблюдаемых/ }).click();
  await expect(page.getByRole('heading', { name: 'Лента', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Новая история', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'GPS', exact: true }).click();
  await noHorizontalOverflow(page);
  await navigate(page, 'Ещё');
  await page.getByRole('button', { name: /^Friends Locations Друзья по мирам/ }).click();
  await expect(page.getByRole('heading', { name: 'Friends Locations', exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  await navigate(page, 'Ещё');
  await page.getByRole('button', { name: /^Избранное Друзья, миры/ }).click();
  await expect(page.getByRole('heading', { name: 'Избранное', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Миры', exact: true }).click();
  await expect(page.getByLabel('Коллекция избранного')).toBeVisible();
  await page.getByLabel('Коллекция избранного').selectOption('worlds2');
  await expect(page.getByLabel('Коллекция избранного')).toHaveValue('worlds2');
  await noHorizontalOverflow(page);
  await navigate(page, 'Ещё');
  await page.getByRole('button', { name: /^Social Друзья, журнал/ }).click();
  await expect(page.getByRole('heading', { name: 'Social', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Friends List', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Поиск друзей по имени или ID' }).fill('Luna');
  await expect(page.getByRole('button', { name: 'Подробности Luna', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Подробности Luna', exact: true }).click();
  await noHorizontalOverflow(page);
  await navigate(page, 'Ещё');
  await page.getByRole('button', { name: /^Журнал игры Наблюдения миров/ }).click();
  await expect(page.getByRole('heading', { name: 'Журнал игры', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Посещения ещё не наблюдались', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Сессии', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Игровых сессий пока нет', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Видео', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Источник видео недоступен', exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]);
  expect(network).toEqual([]);
});

test('IndexedDB upgrades old activity without losing records and restores visits per account', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('vrcnext-mobile-history', 1);
      request.onupgradeneeded = () => {
        const events = request.result.createObjectStore('events', { keyPath: ['account', 'id'] });
        events.createIndex('accountTime', ['account', 'time']);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = old.transaction('events', 'readwrite');
      tx.objectStore('events').put({ account: 'usr_ui_migration', id: 'fixture_activity', time: '2026-10-25T10:00:00.000Z', kind: 'online', userId: 'usr_ui_friend', displayName: 'Test fixture', detail: 'Synthetic test fixture', source: 'pipeline' });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    old.close();
  });
  const saved = await page.evaluate(async () => {
    const { IndexedHistoryStore } = await import('/src/data/history-storage.ts');
    const store = new IndexedHistoryStore();
    const before = await store.read('usr_ui_migration');
    await store.saveGame('usr_ui_migration', {
      visits: [{ id: 'fixture_visit', sessionId: 'fixture_session', location: 'wrld_fixture:1', worldId: 'wrld_fixture', start: '2026-10-25T10:00:00.000Z', lastObserved: '2026-10-25T10:02:00.000Z', end: '2026-10-25T10:02:00.000Z', reason: 'observation-gap', source: 'api', participants: [] }],
      sessions: [{ id: 'fixture_session', start: '2026-10-25T10:00:00.000Z', lastObserved: '2026-10-25T10:02:00.000Z', end: '2026-10-25T10:02:00.000Z' }],
    });
    return before.map((event) => event.id);
  });
  expect(saved).toEqual(['fixture_activity']);
  await page.reload();
  const restored = await page.evaluate(async () => {
    const { IndexedHistoryStore } = await import('/src/data/history-storage.ts');
    const store = new IndexedHistoryStore();
    const activity = await store.read('usr_ui_migration');
    const game = await store.readGame('usr_ui_migration');
    const other = await store.readGame('usr_ui_other');
    await store.clear('usr_ui_migration');
    return { activity: activity.map((event) => event.id), visits: game.visits.map((visit) => visit.id), sessions: game.sessions.map((session) => session.id), other, cleared: await store.readGame('usr_ui_migration') };
  });
  expect(restored).toEqual({ activity: ['fixture_activity'], visits: ['fixture_visit'], sessions: ['fixture_session'], other: {visits: [], sessions: []}, cleared: {visits: [], sessions: []} });
});

test('timeline renders known intervals, opens encounter details and keeps unknown gaps out of totals', async ({ page }) => {
  const errors: string[] = [], network: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/(?:api|pipeline)\.vrchat\.(?:cloud|com)|avtrdb\.com/.test(request.url())) network.push(request.url()); });
  await page.goto('/tests/charts-harness.html');
  await expect(page.getByRole('heading', { name: 'Диаграммы', exact: true })).toBeVisible();
  await page.getByLabel('Дата диаграммы', { exact: true }).fill('2026-10-25');
  await expect(page.locator('.instance-chart-row')).toHaveCount(2);
  await expect(page.locator('.chart-metrics').getByText('1 ч 30 мин', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Увеличить масштаб времени', exact: true }).click();
  await expect(page.getByLabel('Масштаб времени', { exact: true })).not.toHaveValue('1');
  await page.getByRole('button', { name: 'Весь день', exact: true }).click();
  await page.getByRole('button', { name: /^Подробности посещения wrld_demo1/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Подробности посещения', exact: true });
  await expect(dialog.getByText('30 мин', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Открыть мир', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as {__chartTest:{actions:unknown[]}}).__chartTest.actions)).toContainEqual({type:'world',id:'wrld_demo1'});
  await page.getByRole('button', { name: 'Аналитика', exact: true }).click();
  await expect(page.locator('.chart-metrics:visible').getByText('1 ч 30 мин', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Совместные встречи', exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]); expect(network).toEqual([]);
});

test('known friend network supports zoom, two-finger gestures and profile navigation without invented mutuals', async ({ page }) => {
  const errors: string[] = [], network: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/(?:api|pipeline)\.vrchat\.(?:cloud|com)|avtrdb\.com/.test(request.url())) network.push(request.url()); });
  await demo(page);
  await navigate(page, 'Ещё');
  await page.getByRole('button', { name: /^Диаграммы Время, встречи/ }).click();
  await page.getByRole('button', { name: 'Mutual Friend Network', exact: true }).click();
  const graph = page.getByRole('img', { name: 'Граф общих друзей', exact: true });
  await expect(graph).toBeVisible();
  await expect(graph.locator('.network-node')).toHaveCount(7);
  const scene = graph.locator('.network-scene');
  const original = await scene.getAttribute('transform');
  await page.getByRole('button', { name: 'Увеличить граф', exact: true }).click();
  await expect(scene).not.toHaveAttribute('transform', original!);
  await page.getByRole('button', { name: 'Сбросить граф', exact: true }).click();
  await expect(scene).toHaveAttribute('transform', original!);
  await graph.evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const point = (type: string, id: number, px: number, py: number) => svg.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', clientX: px, clientY: py, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
    point('pointerdown', 41, x - 30, y); point('pointerdown', 42, x + 30, y);
    point('pointermove', 41, x - 70, y); point('pointermove', 42, x + 70, y);
    point('pointerup', 41, x - 70, y); point('pointerup', 42, x + 70, y);
  });
  await expect(scene).not.toHaveAttribute('transform', original!);
  await page.getByRole('button', { name: 'Сбросить граф', exact: true }).click();
  await graph.getByRole('button', { name: 'Открыть профиль Luna', exact: true }).press('Enter');
  await expect(page.getByRole('dialog', { name: 'Профиль', exact: true }).getByRole('heading', { name: 'Luna', exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]); expect(network).toEqual([]);
});

type RegressionState = {
  actions: { type: string; id: string }[];
  requests: { path: string; method: string }[];
  worldA: string;
  worldB: string;
  friendId: string;
  ownerId: string;
  location: string;
};
const regressionState = (page: Page) => page.evaluate(() => (window as unknown as { __regressionTest: RegressionState }).__regressionTest);

test('current instance resolves literal-colon URL and exposes creator and exact-location friends independently of instance access', async ({ page }) => {
  const errors: string[] = [], network: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/(?:api|pipeline)\.vrchat\.(?:cloud|com)|avtrdb\.com/.test(request.url())) network.push(request.url()); });
  await page.goto('/tests/regressions-harness.html');
  const region = page.getByRole('region', { name: 'Текущий инстанс', exact: true });
  await expect(region.getByRole('button', { name: 'Открыть мир Fixture Forest', exact: true })).toBeVisible();
  await expect(region).toContainText(/2\s*\/\s*20/);
  await expect(region.getByText('PC: 1', { exact: true })).toBeVisible();
  await expect(region.getByText('Android: 1', { exact: true })).toBeVisible();
  // Exercise the actual profile-panel ancestor: its generic list rules must not stretch avatars.
  const avatarSizes = await region.locator('.instance-person > .avatar').evaluateAll((avatars) => avatars.map((avatar) => {
    const box = avatar.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  expect(avatarSizes).toHaveLength(2);
  for (const size of avatarSizes) {
    expect(size.width).toBeGreaterThanOrEqual(36);
    expect(Math.abs(size.width - size.height)).toBeLessThanOrEqual(1);
  }
  const creator = region.getByLabel('Создатель инстанса', { exact: true });
  await creator.getByRole('button', { name: 'Открыть профиль Fixture Creator', exact: true }).click();
  const friends = region.getByLabel('Друзья в инстансе', { exact: true });
  await expect(friends.getByRole('button')).toHaveCount(1);
  await friends.getByRole('button', { name: 'Открыть профиль Fixture Friend', exact: true }).click();
  await expect(region.getByText('Fixture Elsewhere', { exact: true })).toHaveCount(0);
  await expect(region.getByText('Fixture Same World Other Instance', { exact: true })).toHaveCount(0);
  let recorded = await regressionState(page);
  expect(recorded.actions).toContainEqual({ type: 'user', id: recorded.ownerId });
  expect(recorded.actions).toContainEqual({ type: 'user', id: recorded.friendId });
  const instanceRequests = recorded.requests.filter((request) => request.path.startsWith('/instances/'));
  expect(instanceRequests).toHaveLength(1);
  expect(instanceRequests[0].path).toBe(`/instances/${recorded.worldB}:${encodeURIComponent(recorded.location.split(':')[1])}`);
  expect(instanceRequests[0].path).not.toContain('%3A');
  await noHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Fixture unavailable', exact: true }).click();
  await expect(region.getByText('Fixture instance access unavailable', { exact: true })).toBeVisible();
  await expect(region.getByRole('button', { name: 'Открыть мир Fixture Forest', exact: true })).toBeVisible();
  await expect(region.getByLabel('Создатель инстанса', { exact: true }).getByRole('button', { name: 'Открыть профиль Fixture Creator', exact: true })).toBeVisible();
  await expect(region.getByLabel('Друзья в инстансе', { exact: true }).getByRole('button', { name: 'Открыть профиль Fixture Friend', exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  recorded = await regressionState(page);
  const requestsBeforePrivate = recorded.requests.length;
  await page.getByRole('button', { name: 'Fixture private', exact: true }).click();
  await expect(page.getByText('Пользователь скрыл местоположение.', { exact: false })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Текущий инстанс', exact: true })).toHaveCount(0);
  expect((await regressionState(page)).requests).toHaveLength(requestsBeforePrivate);
  expect(errors).toEqual([]); expect(network).toEqual([]);
});

test('saved and session activity open real profiles and named source and destination worlds', async ({ page }) => {
  const errors: string[] = [], network: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/(?:api|pipeline)\.vrchat\.(?:cloud|com)|avtrdb\.com/.test(request.url())) network.push(request.url()); });
  await page.goto('/tests/regressions-harness.html');
  for (const view of ['feed', 'timeline']) {
    await page.getByRole('button', { name: `Fixture ${view}`, exact: true }).click();
    const change = page.getByLabel('Изменение местоположения', { exact: true });
    await expect(change.getByText('Было', { exact: true })).toBeVisible();
    await expect(change.getByText('Стало', { exact: true })).toBeVisible();
    await change.getByRole('button', { name: 'Открыть мир Fixture Moon', exact: true }).click();
    await change.getByRole('button', { name: 'Открыть мир Fixture Forest', exact: true }).click();
    await page.getByRole('button', { name: 'Открыть профиль Fixture Friend', exact: true }).click();
    const recorded = await regressionState(page);
    expect(recorded.actions).toContainEqual({ type: 'user', id: recorded.friendId });
    expect(recorded.actions).toContainEqual({ type: 'world', id: recorded.worldA });
    expect(recorded.actions).toContainEqual({ type: 'world', id: recorded.worldB });
    await noHorizontalOverflow(page);
  }
  expect(errors).toEqual([]); expect(network).toEqual([]);
});

test('favorite avatars load and search the selected real category instead of every category', async ({ page }) => {
  const errors: string[] = [], network: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/(?:api|pipeline)\.vrchat\.(?:cloud|com)|avtrdb\.com/.test(request.url())) network.push(request.url()); });
  await page.goto('/tests/regressions-harness.html');
  await page.getByRole('button', { name: 'Fixture avatars', exact: true }).click();
  await page.getByRole('button', { name: 'Избранные', exact: true }).click();
  const category = page.getByLabel('Коллекция избранного', { exact: true });
  await expect(category).toBeVisible();
  await expect(category.getByRole('option', { name: 'Fixture Animals', exact: true })).toHaveCount(1);
  await expect(category.getByRole('option', { name: 'Fixture Robots', exact: true })).toHaveCount(1);
  const cards = page.locator('.explore-avatar-grid:visible .avatar-card');
  await expect(cards).toHaveCount(2);
  await category.selectOption('avatars2');
  await expect(cards).toHaveCount(1);
  await expect(cards.getByRole('heading', { name: 'Fixture Cat', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fixture Fox', exact: true })).toHaveCount(0);
  const query = page.getByRole('searchbox', { name: 'Поиск в избранных аватарах или avtr_…', exact: true });
  await query.fill('Alpha');
  await expect(cards).toHaveCount(0);
  await query.fill('Beta');
  await expect(cards).toHaveCount(1);
  await category.selectOption('avatars1');
  await expect(cards).toHaveCount(0);
  await query.fill('');
  await expect(cards).toHaveCount(1);
  await expect(cards.getByRole('heading', { name: 'Fixture Fox', exact: true })).toBeVisible();
  const countBeforeRefresh = (await regressionState(page)).requests.length;
  await page.getByRole('button', { name: 'Обновить аватары', exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(category).toHaveValue('avatars1');
  await expect.poll(async () => (await regressionState(page)).requests.slice(countBeforeRefresh).filter((request) => request.path.startsWith('/avatars/favorites')).length).toBeGreaterThan(0);
  const reloaded = (await regressionState(page)).requests.slice(countBeforeRefresh).filter((request) => request.path.startsWith('/avatars/favorites'));
  expect(reloaded.every((request) => new URL(request.path, 'https://fixture.invalid').searchParams.get('tag') === 'avatars1')).toBe(true);
  await noHorizontalOverflow(page);
  expect(errors).toEqual([]); expect(network).toEqual([]);
});

type WorldInstanceFixture = {
  actions: { type: string; id: string }[];
  requests: { path: string; method: string; body?: string }[];
  unexpected: string[];
  worldId: string;
  groupId: string;
  nearId: string;
  groupFriendId: string;
  locationA: string;
  locationB: string;
  hiddenLocation: string;
  groupLocation: string;
  moveFriend: () => void;
  moveGroupFriend: () => void;
  restoreGroupFriend: () => void;
};
const worldInstanceFixture = (page: Page) => page.evaluate(() => (window as unknown as { __worldInstanceTest: WorldInstanceFixture }).__worldInstanceTest);

test('world instance list groups disclosed friends and opens their real profiles without refetching lists for status changes', async ({ page }, testInfo) => {
  const errors: string[] = [], network: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/(?:api|pipeline)\.vrchat\.(?:cloud|com)|avtrdb\.com/.test(request.url())) network.push(request.url()); });
  await page.goto('/tests/world-instances-harness.html');
  const world = page.getByRole('dialog', { name: 'Мир', exact: true });
  await expect(world.getByRole('heading', { name: 'Fixture Harbor', exact: true })).toBeVisible();
  const region = world.getByRole('region', { name: 'Инстансы мира', exact: true });
  const rows = region.locator('.world-instance');
  await expect(rows).toHaveCount(4);
  const fixture = await worldInstanceFixture(page);
  const at = (location: string) => region.locator(`[data-location="${location}"]`);
  const publicA = at(fixture.locationA), publicB = at(fixture.locationB);
  const hidden = at(fixture.hiddenLocation), group = at(fixture.groupLocation);
  const originalOrder = await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-location')));
  expect(originalOrder).toEqual([fixture.locationA, fixture.locationB, fixture.hiddenLocation, fixture.groupLocation]);
  await expect(publicA.locator('.world-instance-friend')).toHaveCount(2);
  await expect(publicA.getByText('Друзья · 2', { exact: true })).toBeVisible();
  await expect(publicA.getByRole('button', { name: 'Открыть профиль Fixture Nearby', exact: true })).toBeVisible();
  await expect(publicA.getByRole('button', { name: 'Открыть профиль Fixture Pair', exact: true })).toBeVisible();
  await expect(publicB.getByRole('button', { name: 'Открыть профиль Fixture Other Instance', exact: true })).toBeVisible();
  await expect(hidden.getByRole('button', { name: 'Открыть профиль Fixture Hidden', exact: true })).toBeVisible();
  await expect(hidden.getByText('Число игроков не передано', { exact: true })).toBeVisible();
  await expect(group.getByRole('button', { name: 'Открыть профиль Fixture Group Friend', exact: true })).toBeVisible();
  for (const excluded of ['Fixture Masked', 'Fixture Other World', 'Fixture Offline'])
    await expect(region.getByRole('button', { name: `Открыть профиль ${excluded}`, exact: true })).toHaveCount(0);
  const sizes = await region.locator('.world-instance-friend').evaluateAll((buttons) => buttons.map((button) => {
    const hit = button.getBoundingClientRect(), avatar = button.querySelector('.avatar')!.getBoundingClientRect();
    return { width: hit.width, height: hit.height, avatarWidth: avatar.width, avatarHeight: avatar.height };
  }));
  expect(sizes).toHaveLength(5);
  for (const size of sizes) {
    expect(size.width).toBeGreaterThanOrEqual(44); expect(size.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(size.avatarWidth - size.avatarHeight)).toBeLessThanOrEqual(1);
  }
  expect(fixture.requests.map((request) => request.path)).toEqual([`/worlds/${fixture.worldId}`]);
  await noHorizontalOverflow(page);
  await region.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `artifacts/regressions/${testInfo.project.name}-world-instance-friends-synthetic-fixture.png` });

  await publicA.getByRole('button', { name: 'Инвайт себе', exact: true }).click();
  await expect.poll(async () => (await worldInstanceFixture(page)).requests.filter((request) => request.method === 'POST').length).toBe(1);
  expect((await worldInstanceFixture(page)).requests.find((request) => request.method === 'POST')).toMatchObject({ path: `/instances/${fixture.locationA}/invite`, body: '{}' });
  const requestsBeforeMove = (await worldInstanceFixture(page)).requests.length;
  await page.evaluate(() => (window as unknown as { __worldInstanceTest: WorldInstanceFixture }).__worldInstanceTest.moveFriend());
  await expect(publicA.locator('.world-instance-friend')).toHaveCount(1);
  await expect(publicB.locator('.world-instance-friend')).toHaveCount(2);
  const moved = publicB.getByRole('button', { name: 'Открыть профиль Fixture Nearby', exact: true });
  await expect(moved).toContainText('Не беспокоить');
  expect(await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-location')))).toEqual(originalOrder);
  expect((await worldInstanceFixture(page)).requests).toHaveLength(requestsBeforeMove);
  await moved.click();
  const profile = page.getByRole('dialog', { name: 'Профиль', exact: true });
  await expect(profile.getByRole('heading', { name: 'Fixture Nearby', exact: true })).toBeVisible();
  await expect(world).toHaveCount(0);
  expect((await worldInstanceFixture(page)).actions).toContainEqual({ type: 'user', id: fixture.nearId });
  await noHorizontalOverflow(page);
  expect((await worldInstanceFixture(page)).unexpected).toEqual([]);
  expect(errors).toEqual([]); expect(network).toEqual([]);
});

test('group instance friends follow current presence instead of an old roster and open the profile', async ({ page }, testInfo) => {
  const errors: string[] = [], network: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/(?:api|pipeline)\.vrchat\.(?:cloud|com)|avtrdb\.com/.test(request.url())) network.push(request.url()); });
  await page.goto('/tests/world-instances-harness.html');
  await page.getByRole('dialog', { name: 'Мир', exact: true }).getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Fixture group', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Fixture Group', exact: true });
  await dialog.getByRole('button', { name: 'Инстансы', exact: true }).click();
  const row = dialog.locator('.group-instance');
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Друзья · 1', { exact: true })).toBeVisible();
  const friend = row.getByRole('button', { name: 'Открыть профиль Fixture Group Friend', exact: true });
  await expect(friend).toBeVisible();
  await expect(row.getByRole('button', { name: 'Открыть профиль Fixture Nearby', exact: true })).toHaveCount(0);
  await expect(row.locator('button button')).toHaveCount(0);
  await noHorizontalOverflow(page);
  const beforeMove = (await worldInstanceFixture(page)).requests.length;
  await page.evaluate(() => (window as unknown as { __worldInstanceTest: WorldInstanceFixture }).__worldInstanceTest.moveGroupFriend());
  await expect(friend).toHaveCount(0);
  await expect(row.getByText('Друзья · 0', { exact: true })).toBeVisible();
  expect((await worldInstanceFixture(page)).requests).toHaveLength(beforeMove);
  await page.evaluate(() => (window as unknown as { __worldInstanceTest: WorldInstanceFixture }).__worldInstanceTest.restoreGroupFriend());
  await expect(friend).toContainText('Заходите');
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `artifacts/regressions/${testInfo.project.name}-group-instance-friends-synthetic-fixture.png` });
  await friend.click();
  await expect(page.getByRole('dialog', { name: 'Профиль', exact: true }).getByRole('heading', { name: 'Fixture Group Friend', exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  const fixture = await worldInstanceFixture(page);
  expect(fixture.actions).toContainEqual({ type: 'user', id: fixture.groupFriendId });
  expect(fixture.unexpected).toEqual([]);
  expect(errors).toEqual([]); expect(network).toEqual([]);
});
