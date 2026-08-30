import { expect, test } from '@playwright/test';

test('project, task and comment changes synchronize between two clients', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await Promise.all([pageA.goto('/'), pageB.goto('/')]);

  const stamp = Date.now();
  const project = `Realtime E2E ${stamp}`;
  const task = `Cross-client task ${stamp}`;
  const comment = `Synced comment ${stamp}`;

  await pageA.getByPlaceholder('Project name').fill(project);
  await pageA.getByPlaceholder('Short description').fill('Created by Playwright');
  await pageA.getByRole('button', { name: 'Create project' }).click();

  await expect(pageB.getByRole('button', { name: new RegExp(project) })).toBeVisible({ timeout: 8_000 });
  await pageB.getByRole('button', { name: new RegExp(project) }).click();

  await pageA.getByPlaceholder('Add a task and press Enter').fill(task);
  await pageA.getByRole('button', { name: 'Add task' }).click();
  await expect(pageB.getByText(task, { exact: true })).toBeVisible({ timeout: 8_000 });

  await pageB.getByText(task, { exact: true }).click();
  await pageA.getByPlaceholder('Write a comment…').fill(comment);
  await pageA.getByRole('button', { name: 'Comment' }).click();
  await expect(pageB.getByText(comment, { exact: true })).toBeVisible({ timeout: 8_000 });

  await contextA.close();
  await contextB.close();
});
