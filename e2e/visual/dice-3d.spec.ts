import { expect, Locator, Page, test } from '@playwright/test';

import { openPanel } from '../helpers';
import { becomeGm, closePanels, prepare } from './fixtures';

// The dice are drawn with WebGL, which headless Chromium gives through SwiftShader.
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

/*
 * The clock is left running: the dice bot's numbers and the identifier of its answer, which seeds
 * the throw, both come of the seeded randomness, so the dice come to rest the same way every time
 * and the picture of them at rest is what is compared. Holding Math.random to one number, as the
 * dice symbol scene does, would hand every new line the same identifier.
 */

async function chooseStage(page: Page, stage: 'frame' | 'table') {
  await becomeGm(page);
  await openPanel(page, '部屋設定');
  await page.getByTestId('dice-stage').selectOption(stage);
  await expect(page.getByTestId('dice-stage')).toHaveValue(stage);
  const settings = page.locator('ui-panel').filter({ has: page.getByTestId('dice-stage') });
  await settings.locator('.bg-ui-titlebar button', { hasText: 'close' }).dispatchEvent('click');
  await page.getByRole('button', { name: /メニューを閉じる/ }).click();
}

async function roll(page: Page, command: string) {
  await page.locator('textarea.chat-input').fill(command);
  await page.locator('chat-input').getByRole('button', { name: '送信' }).click();
}

/** Waits until a canvas holds dice and stops changing, which is when they have come to rest. */
async function atRest(canvas: Locator) {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = await canvas.evaluate((element: HTMLCanvasElement) => {
          const context = element.getContext('2d');
          if (!context || element.width < 2) return '';
          const data = context.getImageData(0, 0, element.width, element.height).data;
          let hash = 0;
          let drawn = 0;
          for (let i = 3; i < data.length; i += 4 * 5) {
            hash = (hash * 31 + data[i] + data[i - 1]) | 0;
            if (data[i] > 250) drawn++;
          }
          return drawn > 20 ? String(hash) : '';
        });
        const still = now !== '' && now === last;
        last = now;
        return still;
      },
      { timeout: 30_000, intervals: [300] }
    )
    .toBe(true);
}

test('the dice of a chat roll come to rest in the frame of its answer', async ({ page }) => {
  test.setTimeout(120_000);
  await prepare(page);
  await chooseStage(page, 'frame');

  await roll(page, '2d6+1d20');

  const stage = page.locator('chat-tab [data-testid="dice-roll-stage"]').last();
  await expect(stage).toHaveAttribute('data-state', 'settled', { timeout: 30_000 });
  await atRest(stage.locator('canvas'));
  await expect(stage).toHaveScreenshot('dice-3d-frame.png', { maxDiffPixels: 40 });
});

test('the dice of a chat roll come to rest on the table', async ({ page }) => {
  test.setTimeout(120_000);
  await prepare(page);
  await chooseStage(page, 'table');

  await roll(page, '2d6+1d20');
  // The dice come down in the middle of the screen, under the windows, which also tell the time.
  await closePanels(page);

  await atRest(page.getByTestId('table-dice-overlay'));
  await page.mouse.move(1279, 799);
  await expect(page).toHaveScreenshot('dice-3d-table.png', { maxDiffPixels: 60 });
});
