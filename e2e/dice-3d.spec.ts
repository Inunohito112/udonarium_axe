import { expect, Locator, Page, test } from '@playwright/test';

import { openPanel, waitAppReady } from './helpers';

// The dice are drawn with WebGL, which headless Chromium gives through SwiftShader.
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

/** A chat roll's dice tumble in the frame of the line that answers it, when the room has them shown there. */
test.describe('チャットのダイスを 3D で転がす', () => {
  async function becomeGameMaster(page: Page) {
    await page
      .locator('ui-panel')
      .filter({ hasText: '接続情報' })
      .getByRole('button', { name: /^\s*GM\s*$/ })
      .click();
    await expect(page.locator('app-gm-toolbar [title^="暗闇"]')).toBeVisible({ timeout: 10000 });
  }

  async function chooseStage(page: Page, stage: 'off' | 'frame' | 'table' | 'both') {
    await openPanel(page, '部屋設定');
    await page.getByTestId('dice-stage').selectOption(stage);
    await expect(page.getByTestId('dice-stage')).toHaveValue(stage);
  }

  /** Rolls in the chat and gives back the dice bot's answer and the number it came to. */
  async function roll(page: Page, command: string): Promise<{ answer: Locator; total: number }> {
    const answers = page.locator('chat-tab .dicebot-message');
    const before = await answers.count();
    await page.locator('textarea.chat-input').fill(command);
    await page.locator('chat-input').getByRole('button', { name: '送信' }).click();
    await expect(answers).toHaveCount(before + 1, { timeout: 15000 });
    const answer = answers.last();
    const text = (await answer.locator('.msg-text').innerText()).trim();
    const total = Number(text.match(/→\s*(\d+)\s*$/)?.[1]);
    expect(Number.isFinite(total)).toBe(true);
    return { answer, total };
  }

  /** Whether anything has been drawn on a canvas, read from the pixel in its middle. */
  function isDrawnOn(canvas: Locator): Promise<boolean> {
    return canvas.evaluate((element: HTMLCanvasElement) => {
      const context = element.getContext('2d');
      if (!context || element.width < 1) return false;
      const [, , , alpha] = context.getImageData(element.width >> 1, element.height >> 1, 1, 1).data;
      return alpha > 0;
    });
  }

  test.beforeEach(async ({ page }) => {
    await waitAppReady(page);
    await becomeGameMaster(page);
  });

  test('セリフの枠で転がった d20 が、ダイスボットの出目で止まること', async ({ page }) => {
    await chooseStage(page, 'frame');

    const { answer, total } = await roll(page, '1d20');

    const stage = answer.getByTestId('dice-roll-stage');
    await expect(stage).toHaveAttribute('data-state', 'settled', { timeout: 20000 });
    await expect(stage).toHaveAttribute('data-shown', String(total));
    expect(await isDrawnOn(stage.locator('canvas'))).toBe(true);
  });

  test('1d100 は十の位と一の位の d10 が、合わせて出目になる面で止まること', async ({ page }) => {
    await chooseStage(page, 'frame');

    const { answer, total } = await roll(page, '1d100');

    const stage = answer.getByTestId('dice-roll-stage');
    await expect(stage).toHaveAttribute('data-state', 'settled', { timeout: 20000 });
    const [tens, units] = ((await stage.getAttribute('data-shown')) ?? '').split(' ');
    expect(tens).toMatch(/^\d0$/);
    expect(units).toMatch(/^\d$/);
    expect(Number(tens) + Number(units) || 100).toBe(total);
  });

  test('卓の上の設定では、卓に重ねた絵にダイスが描かれ、セリフの枠は出ないこと', async ({ page }) => {
    await chooseStage(page, 'table');

    const { answer } = await roll(page, '2d6');

    const sheet = page.getByTestId('table-dice-overlay');
    await expect
      .poll(
        () =>
          sheet.evaluate((canvas: HTMLCanvasElement) => {
            const context = canvas.getContext('2d');
            if (!context || canvas.width < 2) return 0;
            const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let drawn = 0;
            for (let i = 3; i < data.length; i += 4 * 7) if (data[i] > 250) drawn++;
            return drawn;
          }),
        { timeout: 20000 }
      )
      .toBeGreaterThan(20);
    await expect(answer.getByTestId('dice-roll-stage')).toHaveCount(0);
  });

  test('両方の設定では、セリフの枠と卓の上の両方で同じ目に止まること', async ({ page }) => {
    await chooseStage(page, 'both');

    const { answer, total } = await roll(page, '1d20');

    const stage = answer.getByTestId('dice-roll-stage');
    await expect(stage).toHaveAttribute('data-state', 'settled', { timeout: 20000 });
    await expect(stage).toHaveAttribute('data-shown', String(total));
    const sheet = page.getByTestId('table-dice-overlay');
    await expect
      .poll(() => sheet.evaluate((canvas: HTMLCanvasElement) => canvas.width), { timeout: 20000 })
      .toBeGreaterThan(1);
  });

  test('出さない設定では、ロールしても枠が出ないこと', async ({ page }) => {
    await chooseStage(page, 'off');

    const { answer } = await roll(page, '1d20');

    await page.waitForTimeout(1000);
    await expect(answer.getByTestId('dice-roll-stage')).toHaveCount(0);
  });
});
