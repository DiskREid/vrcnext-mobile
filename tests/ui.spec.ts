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
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, 'settings');
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
  expect(errors).toEqual([]);
  expect(network).toEqual([]);
});
