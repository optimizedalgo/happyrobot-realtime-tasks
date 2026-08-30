import { expect, test } from '@playwright/test';

test('dependency completion rule is surfaced without corrupting optimistic state', async ({ page, request }) => {
  const api = process.env.API_URL || 'http://localhost:8080';
  const project = await (await request.post(`${api}/api/projects`, { data: { name: `Rules ${Date.now()}` } })).json();
  const dependency = await (await request.post(`${api}/api/projects/${project.id}/tasks`, { data: { title: 'Dependency' } })).json();
  const dependent = await (await request.post(`${api}/api/projects/${project.id}/tasks`, { data: { title: 'Dependent', dependencies: [dependency.id] } })).json();

  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(project.name) }).click();
  await page.getByText('Dependent', { exact: true }).click();
  await page.getByLabel('Status').selectOption('done');

  await expect(page.getByTestId('app-notice')).toContainText('dependencies must be done');
  await expect(page.getByLabel('Status')).not.toHaveValue('done');
  expect(dependent.status).toBe('todo');
});
