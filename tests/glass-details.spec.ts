import { expect, test, type Locator, type Page } from '@playwright/test';

const active = (page: Page, name: string) =>
  page.locator(`.retained-screen[data-screen="${name}"]:not([hidden])`);
const nav = (page: Page) => page.locator('nav.side-nav:visible, nav.bottom-nav:visible').first();

async function openDemo(page: Page, theme: string) {
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
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть деморежим', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function material(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      image: style.backgroundImage,
      fill: style.backgroundColor,
      blur: style.backdropFilter,
      shadow: style.boxShadow,
      radius: parseFloat(style.borderTopLeftRadius),
    };
  });
}

function alpha(color: string) {
  const parts = color.match(/[\d.]+/g)!.map(Number);
  return parts.length === 4 ? parts[3] : 1;
}

async function checkCard(card: Locator) {
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveAttribute('data-glass-card-optic', 'true');
  const style = await material(card);
  expect(style.image).toContain('gradient');
  expect(alpha(style.fill)).toBeLessThan(0.8);
  expect(style.shadow).toContain('inset');
  // Only viewport cards receive backdrop-only refraction, keeping their foreground sharp.
  await expect(card).toHaveAttribute('data-glass-card-optic', 'true');
  await expect(card).toHaveAttribute('data-glass-optic', /vrc-glass-/);
  expect(style.blur).toContain('url(');
  expect(style.blur).not.toContain('blur(10px)');
}

async function checkDialog(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-glass-surface-ready', 'true');
  await expect(dialog).not.toHaveAttribute('data-glass-optic');
  const layer = dialog.locator('..').locator('.glass-modal-surface');
  await expect(layer).toHaveCount(1);
  await expect(page.locator('[data-glass-optic]')).toHaveCount(1);
  await expect(layer).toHaveAttribute('aria-hidden', 'true');
  const state = await dialog.evaluate((element) => {
    const layer = element.parentElement!.querySelector<HTMLElement>('.glass-modal-surface')!;
    const style = getComputedStyle(layer),
      modalStyle = getComputedStyle(element),
      heading = getComputedStyle(element.querySelector('.modal-heading')!);
    const bounds = (node: Element) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    };
    const id = layer.dataset.glassOptic!;
    return {
      surface: bounds(layer),
      modal: bounds(element),
      surfacePosition: style.position,
      surfaceEvents: style.pointerEvents,
      surfaceFilter: style.backdropFilter,
      surfaceFill: style.backgroundColor,
      surfaceRadius: style.borderRadius,
      modalFilter: modalStyle.backdropFilter,
      modalRadius: modalStyle.borderRadius,
      headingFill: heading.backgroundColor,
      headingRadius: parseFloat(heading.borderTopLeftRadius),
      headingFilter: heading.backdropFilter,
      map: document.getElementById(id)?.querySelector('feImage')?.getAttribute('href'),
    };
  });
  for (const coordinate of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(state.surface[coordinate] - state.modal[coordinate])).toBeLessThanOrEqual(1);
  expect(state.surfacePosition).toBe('fixed');
  expect(state.surfaceEvents).toBe('none');
  expect(state.surfaceRadius).toBe(state.modalRadius);
  expect(state.surfaceFilter).toContain('url(');
  expect(state.map).toMatch(/^data:image\/png/);
  expect(alpha(state.surfaceFill)).toBeGreaterThanOrEqual(0.7);
  expect(alpha(state.surfaceFill)).toBeLessThan(1);
  expect(state.modalFilter).toBe('none');
  expect(state.headingFilter).not.toContain('url(');
  expect(state.headingRadius).toBeGreaterThanOrEqual(12);
  expect(alpha(state.headingFill)).toBeLessThan(0.9);

  // Nested world/group dialogs must cover the app chrome as well. A fixed
  // backdrop inside a retained-screen stacking context can otherwise leave
  // the navigation clickable above the bottom half of the dialog.
  const chromeCovered = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.topbar .avatar-button, .bottom-nav button')]
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .every((button) => {
        const rect = button.getBoundingClientRect();
        return !!document
          .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          ?.closest('.modal-backdrop');
      }),
  );
  expect(chromeCovered, 'Open dialogs must cover the header and bottom navigation').toBe(true);

  const buttons = dialog.locator('.button');
  expect(await buttons.count()).toBeGreaterThan(0);
  for (const button of await buttons.all()) {
    if (!(await button.isVisible())) continue;
    const style = await material(button);
    expect(style.image).toContain('gradient');
    expect(style.shadow).toContain('inset');
    expect(style.blur).not.toContain('url(');
  }
  const dimensions = await dialog.evaluate((element) => ({
    width: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  return layer;
}

for (const theme of ['liquid-dark', 'liquid-light']) {
  test(`${theme} detail cards and actions retain their glass material while modal scrolling stays clear`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openDemo(page, theme);
    await nav(page).getByRole('button', { name: 'Друзья', exact: true }).click();
    const friend = active(page, 'friends').locator('.friend-card').first();
    await checkCard(friend);
    await friend.click();
    let dialog = page.getByRole('dialog', { name: 'Профиль', exact: true });
    let layer = await checkDialog(page, dialog);
    const geometry = await layer.boundingBox();
    const filter = await layer.getAttribute('data-glass-optic');
    await dialog.evaluate((element) => element.scrollTo({ top: 400, behavior: 'instant' }));
    await expect.poll(() => dialog.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await layer.boundingBox()).toEqual(geometry);
    await expect(layer).toHaveAttribute('data-glass-optic', filter!);
    await page.screenshot({
      path: `artifacts/regressions/${info.project.name}-${theme}-profile-glass-synthetic-demo.png`,
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(page.locator('.glass-modal-surface')).toHaveCount(0);

    await nav(page).getByRole('button', { name: 'Открыть', exact: true }).click();
    const world = active(page, 'explore').locator('.world-card').first();
    await checkCard(world);
    await world.click();
    dialog = page.getByRole('dialog', { name: 'Мир', exact: true });
    await checkDialog(page, dialog);
    await expect(dialog.locator('.detail-title')).toBeVisible();
    await page.screenshot({
      path: `artifacts/regressions/${info.project.name}-${theme}-world-glass-synthetic-demo.png`,
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(page.locator('.glass-modal-surface')).toHaveCount(0);

    await active(page, 'explore').getByRole('button', { name: 'Группы', exact: true }).click();
    const group = active(page, 'explore').locator('.group-card').first();
    await checkCard(group);
    const name = await group.getByRole('heading').innerText();
    await group.click();
    dialog = page.getByRole('dialog', { name, exact: true });
    layer = await checkDialog(page, dialog);
    await expect(dialog.locator('.group-detail-title')).toBeVisible();
    await page.screenshot({
      path: `artifacts/regressions/${info.project.name}-${theme}-group-glass-synthetic-demo.png`,
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(layer).toHaveCount(0);

    // Turning glass off must remove the backing layer and its map entirely.
    await nav(page).getByRole('button', { name: 'Ещё', exact: true }).click();
    await active(page, 'more')
      .locator('.more-card')
      .filter({ has: page.getByRole('heading', { name: 'Настройки', exact: true }) })
      .click();
    await active(page, 'settings')
      .getByRole('combobox', { name: 'Тема интерфейса', exact: true })
      .selectOption('standard-dark');
    await expect(page.locator('[data-glass-optic]')).toHaveCount(0);
    await expect(page.locator('svg[data-glass-optics-defs] filter')).toHaveCount(0);
    await nav(page).getByRole('button', { name: 'Друзья', exact: true }).click();
    await active(page, 'friends').locator('.friend-card').first().click();
    dialog = page.getByRole('dialog', { name: 'Профиль', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toHaveAttribute('data-glass-surface-host');
    await expect(page.locator('.glass-modal-surface')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
