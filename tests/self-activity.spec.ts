import { expect, test, type Page } from '@playwright/test';
import type { GameData } from '../src/data/game-history';
import type { HistoryEvent } from '../src/data/history';

type Fixture = {
  ready: boolean;
  selfId: string;
  locations: { a: string; b: string };
  requests: { path: string; method: string }[];
  unexpected: string[];
  pipelineReady: () => boolean;
  holdNextResume: boolean;
  resumePending: boolean;
  emitAppState: (isActive: boolean) => void;
  emit: (event: { type: string; content: Record<string, unknown> }) => void;
  readHistory: () => Promise<GameData & { events: HistoryEvent[] }>;
};
const active = (page: Page, id: string) =>
  page.locator(`.retained-screen[data-screen="${id}"]:not([hidden])`);
const nav = (page: Page) => page.locator('nav.side-nav:visible, nav.bottom-nav:visible').first();
const fixture = (page: Page) =>
  page.evaluate(() => {
    const f = (window as unknown as { __selfActivityTest: Fixture }).__selfActivityTest;
    return {
      selfId: f.selfId,
      locations: f.locations,
      requests: f.requests,
      unexpected: f.unexpected,
    };
  });
const stored = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __selfActivityTest: Fixture }).__selfActivityTest.readHistory(),
  );
async function open(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-29T12:00:00Z'));
  await page.addInitScript(() => localStorage.setItem('vrcnext.language', 'ru'));
  await page.goto('/tests/self-activity-harness.html');
  await page.waitForFunction(() => {
    const f = (window as unknown as { __selfActivityTest?: Fixture }).__selfActivityTest;
    return f?.ready && f.pipelineReady();
  });
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect
    .poll(
      async () =>
        (await fixture(page)).requests.filter((r) => r.path.startsWith('/auth/user/friends'))
          .length,
    )
    .toBe(2);
  await expect.poll(async () => (await stored(page)).visits.length).toBe(1);
}
async function more(page: Page) {
  await nav(page).locator('button').nth(4).click();
  await expect(active(page, 'more').locator('.more-profile')).toBeVisible();
  return active(page, 'more');
}
async function section(page: Page, title: string, id: string) {
  const menu = await more(page);
  await menu
    .locator('.more-card')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .click();
  await expect(active(page, id)).toBeVisible();
  return active(page, id);
}
async function emit(page: Page, seconds: number, type: string, content: Record<string, unknown>) {
  await page.clock.setFixedTime(new Date(Date.parse('2026-10-29T12:00:00Z') + seconds * 1000));
  await page.evaluate(
    ({ type, content }) =>
      (window as unknown as { __selfActivityTest: Fixture }).__selfActivityTest.emit({
        type,
        content,
      }),
    { type, content },
  );
}

test('own currentLocation and no-ID location messages drive the same More and full-profile presence without friend scans', async ({
  page,
}, info) => {
  await open(page);
  const state = await fixture(page);
  const menu = await more(page);
  await expect(menu.locator('.more-profile [data-presence]')).toHaveAttribute(
    'data-presence',
    'game',
  );
  await expect(menu.locator('.more-profile')).toContainText('В VRChat');
  await page.screenshot({
    path: `artifacts/regressions/${info.project.name}-own-presence-synthetic.png`,
  });
  await menu.locator('.more-profile').click();
  await expect(
    active(page, 'profile').locator('.profile-identity [data-presence]'),
  ).toHaveAttribute('data-presence', 'game');
  await emit(page, 10, 'user-location', { location: 'offline' });
  await more(page);
  await expect(active(page, 'more').locator('.more-profile [data-presence]')).toHaveAttribute(
    'data-presence',
    'offline',
  );
  await expect(active(page, 'more').locator('.more-profile')).toContainText('Не в сети');
  await emit(page, 20, 'user-location', { location: state.locations.b });
  await expect(active(page, 'more').locator('.more-profile [data-presence]')).toHaveAttribute(
    'data-presence',
    'game',
  );
  const feed = await section(page, 'Лента', 'feed');
  await expect(feed.locator('.history-row').filter({ hasText: 'Activity Explorer' })).toHaveCount(
    3,
  );
  await expect(feed).toContainText('Вышел из VRChat');
  await expect(feed).toContainText('Зашёл в VRChat');
  for (const link of await feed.locator('.activity-world-link').all())
    await link.scrollIntoViewIfNeeded();
  await expect(feed).toContainText('Observed Rooftop');
  const result = await fixture(page);
  expect(result.unexpected).toEqual([]);
  expect(result.requests.filter((r) => /^\/users\/usr_[^/?]+(?:\?|$)/.test(r.path))).toEqual([]);
  expect(result.requests.every((r) => r.method === 'GET')).toBe(true);
});

test('actual repeated self samples persist visits, encounter intervals and usable Instance Activity and analytics', async ({
  page,
}, info) => {
  await open(page);
  const state = await fixture(page);
  await emit(page, 30, 'user-location', { location: state.locations.a });
  await emit(page, 90, 'user-location', { location: state.locations.a });
  await emit(page, 120, 'user-location', { location: state.locations.b });
  await emit(page, 180, 'user-location', { location: state.locations.b });
  await expect.poll(async () => (await stored(page)).visits.length).toBe(2);
  const history = await stored(page);
  expect(history.events).toHaveLength(1);
  expect(history.events[0]).toMatchObject({
    userId: state.selfId,
    kind: 'world',
    before: state.locations.a,
    after: state.locations.b,
    source: 'pipeline',
  });
  const first = history.visits.find((v) => v.location === state.locations.a)!;
  const second = history.visits.find((v) => v.location === state.locations.b)!;
  expect(Date.parse(first.lastObserved) - Date.parse(first.start)).toBe(90_000);
  expect(Date.parse(second.lastObserved) - Date.parse(second.start)).toBe(60_000);
  expect(first.participants).toHaveLength(1);
  expect(first.participants[0].displayName).toBe('Observed Friend');
  expect(
    Date.parse(first.participants[0].lastObserved) - Date.parse(first.participants[0].start),
  ).toBe(60_000);
  expect(second.participants).toEqual([]);
  const charts = await section(page, 'Диаграммы', 'charts');
  await expect(charts.locator('.instance-chart-row')).toHaveCount(2);
  await expect(charts.locator('.chart-metrics')).toContainText('2 миров');
  await expect(charts.locator('.chart-metrics')).toContainText('2 посещений');
  for (const row of await charts.locator('.instance-chart-row').all())
    await row.scrollIntoViewIfNeeded();
  await expect(charts).toContainText('Observed Sakura');
  await expect(charts).toContainText('Observed Rooftop');
  await page.screenshot({
    path: `artifacts/regressions/${info.project.name}-own-instance-activity-synthetic.png`,
  });
  await charts.getByRole('button', { name: 'Аналитика', exact: true }).click();
  const analytics = charts.locator('.charts-panel:not([hidden])');
  await expect(analytics.locator('.chart-ranking-person')).toHaveCount(1);
  await expect(analytics).toContainText('Observed Friend');
  await expect(analytics.locator('.chart-metrics')).toContainText('1 встреченных друзей');
  await expect(analytics.locator('.chart-ranking-person')).toContainText('1 мин');
  await page.screenshot({
    path: `artifacts/regressions/${info.project.name}-own-analytics-synthetic.png`,
  });
  const feed = await section(page, 'Лента', 'feed');
  await expect(feed.locator('.history-row')).toHaveCount(1);
  await expect(feed).toContainText('Activity Explorer');
  for (const link of await feed.locator('.activity-world-link').all())
    await link.scrollIntoViewIfNeeded();
  await expect(feed).toContainText('Observed Sakura');
  for (const link of await feed.locator('.activity-world-link').all())
    await link.scrollIntoViewIfNeeded();
  await expect(feed).toContainText('Observed Rooftop');
  await page.screenshot({
    path: `artifacts/regressions/${info.project.name}-own-feed-synthetic.png`,
  });
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  const restored = await section(page, 'Лента', 'feed');
  await expect(restored.locator('.history-row')).toHaveCount(1);
  await expect(restored).toContainText('Activity Explorer');
  const persisted = await stored(page);
  expect(
    persisted.visits.some((v) => v.id === first.id && v.lastObserved === first.lastObserved),
  ).toBe(true);
  const result = await fixture(page);
  expect(result.unexpected).toEqual([]);
  expect(result.requests.filter((r) => /^\/users\/usr_[^/?]+(?:\?|$)/.test(r.path))).toEqual([]);
  expect(result.requests.every((r) => r.method === 'GET')).toBe(true);
});

test('a delayed own REST sample cannot roll back a newer pipeline location or manufacture a return visit', async ({
  page,
}) => {
  await open(page);
  const state = await fixture(page);
  await page.evaluate(() =>
    (window as unknown as { __selfActivityTest: Fixture }).__selfActivityTest.emitAppState(false),
  );
  await expect.poll(async () => (await stored(page)).visits[0]?.end !== undefined).toBe(true);
  await page.evaluate(() => {
    const f = (window as unknown as { __selfActivityTest: Fixture }).__selfActivityTest;
    f.holdNextResume = true;
    f.emitAppState(true);
  });
  await page.waitForFunction(
    () => (window as unknown as { __selfActivityTest: Fixture }).__selfActivityTest.resumePending,
  );
  await emit(page, 30, 'user-location', { location: state.locations.b });
  await page.evaluate(() =>
    (window as unknown as { __releaseSelfResume: () => void }).__releaseSelfResume(),
  );
  await page.waitForFunction(
    () => !(window as unknown as { __selfActivityTest: Fixture }).__selfActivityTest.resumePending,
  );
  const menu = await more(page);
  await expect(menu.locator('.more-profile [data-presence]')).toHaveAttribute(
    'data-presence',
    'game',
  );
  await expect.poll(async () => (await stored(page)).visits.length).toBe(2);
  const history = await stored(page);
  expect(history.visits.find((v) => !v.end)?.location).toBe(state.locations.b);
  expect(history.events).toHaveLength(1);
  expect(history.events[0]).toMatchObject({ before: state.locations.a, after: state.locations.b });
  expect((await fixture(page)).unexpected).toEqual([]);
});

test('a delayed first own-profile response preserves a newer pipeline location and the next feed transition origin', async ({
  page,
}) => {
  await open(page);
  const state = await fixture(page);
  const menu = await more(page);
  await page.evaluate(() => {
    (window as unknown as { __selfActivityTest: Fixture }).__selfActivityTest.holdNextResume = true;
  });
  await menu.locator('.more-profile').click();
  await page.waitForFunction(
    () => (window as unknown as { __selfActivityTest: Fixture }).__selfActivityTest.resumePending,
  );
  await emit(page, 30, 'user-location', { location: state.locations.b });
  await page.evaluate(() =>
    (window as unknown as { __releaseSelfResume: () => void }).__releaseSelfResume(),
  );
  const own = active(page, 'profile');
  await expect(own.locator('.profile-identity [data-presence]')).toHaveAttribute(
    'data-presence',
    'game',
  );
  await expect(own.locator('.user-location-world')).toContainText('Observed Rooftop');
  await expect(own.locator('.user-location .id-text').first()).toContainText('67890');
  await expect(own.locator('.user-location-world')).not.toContainText('Observed Sakura');

  // The delayed view read also must not reset the journal's newer GPS baseline.
  await emit(page, 60, 'user-location', { location: state.locations.a });
  await expect(own.locator('.user-location-world')).toContainText('Observed Sakura');
  await expect.poll(async () => (await stored(page)).events.length).toBe(2);
  const history = await stored(page);
  expect(history.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        before: state.locations.a,
        after: state.locations.b,
        source: 'pipeline',
      }),
      expect.objectContaining({
        before: state.locations.b,
        after: state.locations.a,
        source: 'pipeline',
      }),
    ]),
  );
  expect(
    history.events.every((event) => event.kind === 'world' && event.userId === state.selfId),
  ).toBe(true);
  expect((await fixture(page)).unexpected).toEqual([]);
});
