import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { pngPixels } from './glass-pixels';

type Fixture = {
  ready: boolean;
  requests: { path: string; method: string }[];
  unexpected: string[];
  setAppearance(patch: Record<string, unknown>): void;
  emitAppState(active: boolean): void;
};
const state = (page: Page) =>
  page.evaluate(() => (window as unknown as { __cardGlassTest: Fixture }).__cardGlassTest);
const nav = (page: Page) => page.locator('nav.side-nav:visible, nav.bottom-nav:visible').first();
const screen = (page: Page, name: string) =>
  page.locator(`.retained-screen[data-screen="${name}"]:not([hidden])`);
const cards = (page: Page) => page.locator('[data-glass-card-optic]');

async function open(page: Page, theme = 'liquid-dark') {
  await page.addInitScript((theme) => {
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => 4 });
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, get: () => 8 });
    localStorage.setItem('vrcnext.language', 'ru');
    localStorage.setItem(
      'vrcnext.appearance.v1',
      JSON.stringify({
        theme,
        glassIntensity: 'high',
        holidayEnabled: true,
        holidayMode: 'manual',
        manualHoliday: 'halloween',
        holidayAnimations: false,
      }),
    );
  }, theme);
  await page.goto('/tests/glass-cards-harness.html');
  await page.waitForFunction(
    () => (window as unknown as { __cardGlassTest?: Fixture }).__cardGlassTest?.ready === true,
  );
  await expect(
    page.getByRole('heading', { name: 'Привет, Glass Explorer ✦', exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-glass-refraction', 'on');
}
async function appearance(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(
    (patch) =>
      (window as unknown as { __cardGlassTest: Fixture }).__cardGlassTest.setAppearance(patch),
    patch,
  );
}
async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
}
async function cardReady(card: Locator) {
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveAttribute('data-glass-card-optic', 'true');
  await expect(card).toHaveAttribute('data-glass-optic', /vrc-glass-/);
  await expect
    .poll(() => card.evaluate((element) => getComputedStyle(element).backdropFilter))
    .toContain('url(');
  for (const image of await card.locator('img').all()) {
    await expect
      .poll(() =>
        image.evaluate(
          (element: HTMLImageElement) =>
            element.complete && element.naturalWidth > 1 && element.naturalHeight > 1,
        ),
      )
      .toBe(true);
  }
}

async function pixelProof(page: Page, card: Locator, kind: 'friend' | 'world', prefix: string) {
  await cardReady(card);
  await settle(page);
  const details = await card.evaluate((element, kind) => {
    const bounds = element.getBoundingClientRect();
    const title = element.querySelector('h3')!;
    const picture = element.querySelector(kind === 'friend' ? '.avatar' : '.media-cover')!;
    const box = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x - bounds.x, y: rect.y - bounds.y, width: rect.width, height: rect.height };
    };
    return {
      title: box(title),
      titleColor: getComputedStyle(title).color,
      picture: box(picture),
      titleText: title.textContent,
      filterId: (element as HTMLElement).dataset.glassOptic!,
    };
  }, kind);
  const activePng = await card.screenshot({ animations: 'disabled' });
  const scale = await card.evaluate((element) => {
    const map = document
      .getElementById((element as HTMLElement).dataset.glassOptic!)!
      .querySelector('feDisplacementMap')!;
    const scale = Number(map.getAttribute('scale'));
    map.setAttribute('scale', '0');
    return scale;
  });
  expect(scale).toBeGreaterThan(0);
  await settle(page);
  const neutralPng = await card.screenshot({ animations: 'disabled' });
  const active = pngPixels(activePng),
    neutral = pngPixels(neutralPng);
  expect([active.width, active.height, active.channels]).toEqual([
    neutral.width,
    neutral.height,
    neutral.channels,
  ]);
  const textColor = details.titleColor
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number);
  const inBox = (
    x: number,
    y: number,
    box: { x: number; y: number; width: number; height: number },
    inset = 0,
  ) =>
    x > box.x + inset &&
    x < box.x + box.width - inset &&
    y > box.y + inset &&
    y < box.y + box.height - inset;
  const inkDistance = (x: number, y: number) => {
    if (!inBox(x, y, details.title, 1)) return Infinity;
    const i = (y * neutral.width + x) * neutral.channels;
    return (
      Math.abs(neutral.pixels[i] - textColor[0]) +
      Math.abs(neutral.pixels[i + 1] - textColor[1]) +
      Math.abs(neutral.pixels[i + 2] - textColor[2])
    );
  };
  // Antialiased glyph edges blend with the changing backdrop. Sample exact
  // opaque ink with a same-ink stroke neighborhood, eroding those edge pixels.
  const isOpaqueInk = (x: number, y: number) =>
    inkDistance(x, y) === 0 &&
    ((inkDistance(x - 1, y) < 4 && inkDistance(x + 1, y) < 4) ||
      (inkDistance(x, y - 1) < 4 && inkDistance(x, y + 1) < 4));
  let bentPixels = 0,
    glyphPixels = 0,
    changedGlyph = 0,
    imagePixels = 0,
    changedImage = 0;
  for (let y = 0; y < active.height; y++)
    for (let x = 0; x < active.width; x++) {
      const i = (y * active.width + x) * active.channels;
      const difference =
        Math.abs(active.pixels[i] - neutral.pixels[i]) +
        Math.abs(active.pixels[i + 1] - neutral.pixels[i + 1]) +
        Math.abs(active.pixels[i + 2] - neutral.pixels[i + 2]);
      const textPixel = isOpaqueInk(x, y);
      const imagePixel = inBox(x, y, details.picture, kind === 'friend' ? 16 : 12);
      if (textPixel) {
        glyphPixels++;
        if (difference > 3) changedGlyph++;
      }
      if (imagePixel) {
        imagePixels++;
        if (difference > 3) changedImage++;
      }
      // Sample visible background near the curved rim, excluding opaque art and ink.
      const edge = Math.min(x, y, active.width - 1 - x, active.height - 1 - y);
      if (!textPixel && !inBox(x, y, details.picture) && edge > 5 && edge < 40 && difference > 18)
        bentPixels++;
    }
  const proof = {
    kind,
    theme: await page.locator('html').getAttribute('data-theme'),
    title: details.titleText,
    bentPixels,
    glyphPixels,
    changedGlyph,
    imagePixels,
    changedImage,
    foregroundPixels: glyphPixels + imagePixels,
    changedForeground: changedGlyph + changedImage,
    displacementScale: scale,
    width: active.width,
    height: active.height,
    foregroundMask:
      'Exact RGB ink with an eroded three-pixel stroke neighborhood; opaque image interior',
  };
  await writeFile(
    `artifacts/regressions/${prefix}-${kind}-card-refraction-proof.json`,
    JSON.stringify(proof, null, 2) + '\n',
  );
  await writeFile(`artifacts/regressions/${prefix}-${kind}-card-refraction-active.png`, activePng);
  await writeFile(
    `artifacts/regressions/${prefix}-${kind}-card-refraction-neutral.png`,
    neutralPng,
  );
  expect(bentPixels, `${kind} card must actually bend the grid behind it`).toBeGreaterThan(120);
  expect(glyphPixels, 'Real title glyphs must be present in the comparison').toBeGreaterThan(30);
  expect(
    imagePixels,
    'Real avatar or world image must be present in the comparison',
  ).toBeGreaterThan(200);
  expect(changedGlyph, 'Card title ink must not be displaced').toBe(0);
  expect(changedImage, 'The foreground avatar/world picture must not be displaced').toBe(0);
  await card.evaluate(
    (element, scale) =>
      document
        .getElementById((element as HTMLElement).dataset.glassOptic!)!
        .querySelector('feDisplacementMap')!
        .setAttribute('scale', String(scale)),
    scale,
  );
  await settle(page);
  return proof;
}

for (const theme of ['liquid-dark', 'liquid-light']) {
  test(`${theme} friend and world cards really refract the backdrop while actual names and pictures stay sharp`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await open(page, theme);
    await page.addStyleTag({
      content: `
      html[data-theme] .workspace>.main-content {
        background:repeating-linear-gradient(90deg,transparent 0 10px,#1bdfb0 11px 14px,transparent 15px 27px),
        repeating-linear-gradient(0deg,transparent 0 13px,#d51ca4 14px 17px,transparent 18px 31px),#14314e!important;
      }
      .workspace>.holiday-decor { visibility:hidden!important; }
    `,
    });
    await nav(page).getByRole('button', { name: 'Друзья', exact: true }).click();
    const friend = screen(page, 'friends').locator('.friend-card').first();
    await expect(screen(page, 'friends').locator('.friend-card')).toHaveCount(338);
    const proofs = [await pixelProof(page, friend, 'friend', `${info.project.name}-${theme}`)];
    const name = await friend.locator('h3').innerText();
    await friend.click();
    const profile = page.getByRole('dialog', { name: 'Профиль', exact: true });
    await expect(profile.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    await expect(page.locator('[data-glass-optic]')).toHaveCount(1);
    await profile.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await nav(page).getByRole('button', { name: 'Открыть', exact: true }).click();
    const world = screen(page, 'explore').locator('.world-card').first();
    proofs.push(await pixelProof(page, world, 'world', `${info.project.name}-${theme}`));
    const worldName = await world.locator('h3').innerText();
    await world.click();
    const dialog = page.getByRole('dialog', { name: 'Мир', exact: true });
    await expect(dialog.locator('.detail-title')).toHaveText(worldName);
    await expect(cards(page)).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await info.attach('actual-card-pixel-proofs', {
      body: JSON.stringify(proofs),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
    expect((await state(page)).unexpected).toEqual([]);
  });
}

test('338 friend rows allocate lenses only for visible cards and release them on scroll, rotation, background and theme changes', async ({
  page,
}, info) => {
  await open(page);
  await nav(page).getByRole('button', { name: 'Друзья', exact: true }).click();
  await expect(screen(page, 'friends').locator('.friend-card')).toHaveCount(338);
  const first = screen(page, 'friends').locator('.friend-card').first();
  await cardReady(first);
  const requestCount = (await state(page)).requests.length;
  async function viewportState() {
    return page.evaluate(() => {
      const main = document.querySelector('.main-content')!.getBoundingClientRect();
      const selected = [...document.querySelectorAll<HTMLElement>('[data-glass-card-optic]')];
      return {
        cards: selected.length,
        total: document.querySelectorAll('[data-glass-optic]').length,
        filters: document.querySelectorAll('svg[data-glass-optics-defs] filter').length,
        entries: selected.map((element) => {
          const r = element.getBoundingClientRect();
          return {
            id: element.dataset.glassOptic!,
            map: document
              .getElementById(element.dataset.glassOptic!)
              ?.querySelector('feImage')
              ?.getAttribute('href'),
            visible:
              r.bottom > Math.max(0, main.top) &&
              r.top < Math.min(innerHeight, main.bottom) &&
              r.right > Math.max(0, main.left) &&
              r.left < Math.min(innerWidth, main.right),
          };
        }),
      };
    });
  }
  async function bounded() {
    await expect.poll(() => cards(page).count()).toBeGreaterThan(0);
    await settle(page);
    const current = await viewportState();
    expect(current.cards).toBeLessThanOrEqual(12);
    expect(current.total).toBeLessThanOrEqual(17);
    expect(current.filters).toBe(current.total);
    expect(current.entries.every((card) => card.visible)).toBe(true);
    return current;
  }
  const before = await bounded();
  await settle(page);
  const idle = await page.evaluate(async () => {
    const original = requestAnimationFrame;
    let requests = 0;
    window.requestAnimationFrame = (callback) => {
      requests++;
      return original(callback);
    };
    await new Promise((done) => setTimeout(done, 650));
    window.requestAnimationFrame = original;
    return requests;
  });
  expect(idle, 'Cards must not install a continuous animation loop').toBe(0);
  expect(await viewportState()).toEqual(before);
  await page
    .locator('.main-content')
    .evaluate((element) =>
      element.scrollTo({ top: element.scrollHeight / 2, behavior: 'instant' }),
    );
  await expect(first).not.toHaveAttribute('data-glass-optic');
  const middle = await bounded();
  expect(middle.entries.some((card) => before.entries.some((old) => old.id === card.id))).toBe(
    false,
  );
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.height, height: viewport.width });
  const rotated = await bounded();
  expect(
    (await state(page)).requests.length,
    'Scrolling and rotation must not fetch account data',
  ).toBe(requestCount);
  await page.evaluate(() =>
    (window as unknown as { __cardGlassTest: Fixture }).__cardGlassTest.emitAppState(false),
  );
  await expect(page.locator('[data-glass-optic]')).toHaveCount(0);
  await expect(page.locator('svg[data-glass-optics-defs] filter')).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { __cardGlassTest: Fixture }).__cardGlassTest.emitAppState(true),
  );
  await bounded();
  // Returning to the foreground legitimately refreshes the self snapshot and
  // two calendar months; group labels remain cached. This is separate from
  // appearance-only changes below.
  await expect.poll(async () => (await state(page)).requests.length).toBe(requestCount + 3);
  const resumed = await state(page);
  const resumeRefreshPaths = resumed.requests
    .slice(requestCount)
    .map((request) => new URL(request.path, 'https://synthetic.invalid').pathname);
  expect([...resumeRefreshPaths].sort()).toEqual(['/auth/user', '/calendar', '/calendar']);
  expect(resumed.requests.slice(requestCount).every((request) => request.method === 'GET')).toBe(
    true,
  );
  const afterResumeRequests = resumed.requests.length;
  await appearance(page, { theme: 'standard-dark' });
  await expect(page.locator('[data-glass-optic]')).toHaveCount(0);
  await expect(page.locator('svg[data-glass-optics-defs] filter')).toHaveCount(0);
  await appearance(page, { theme: 'liquid-light' });
  await bounded();
  expect(
    (await state(page)).requests.length,
    'Changing only the theme must not fetch account data',
  ).toBe(afterResumeRequests);
  expect((await state(page)).unexpected).toEqual([]);
  await writeFile(
    `artifacts/regressions/${info.project.name}-glass-cards-viewport-proof.json`,
    JSON.stringify(
      {
        rows: 338,
        cardBudget: 12,
        totalBudget: 17,
        before,
        middle,
        rotated,
        idleAnimationFrameRequests: idle,
        backgroundReleasedAllMaps: true,
        standardReleasedAllMaps: true,
        appearanceOnlyRequestsAdded: 0,
        resumeRefreshPaths,
      },
      null,
      2,
    ) + '\n',
  );
});
