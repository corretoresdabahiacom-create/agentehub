import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'correct-horse-battery';
const uniqueEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

async function signup(page: Page, email: string) {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test('signup lands on dashboard, survives reload, and logout ends the session', async ({
  page,
}) => {
  const email = uniqueEmail();
  await signup(page, email);
  await expect(page.getByTestId('welcome')).toContainText(email.split('@')[0]!);
  await expect(page.getByTestId('workspaces').getByRole('listitem')).toHaveCount(1);

  await page.reload();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId('welcome')).toBeVisible();

  // Cookie de sessão: HttpOnly, nada de credencial em localStorage.
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === '__Host-agenthub_session');
  expect(session?.httpOnly).toBe(true);
  expect(session?.secure).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(storage).not.toMatch(/session|token|password/i);

  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login$/);
});

test('login with wrong password shows an error; correct password signs in', async ({ page }) => {
  const email = uniqueEmail();
  await signup(page, email);
  await page.getByRole('button', { name: 'Sign out' }).first().click();

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('wrong-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('form-error')).toHaveText('Invalid email or password.');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app$/);
});

test('protected route redirects anonymous users to login', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login$/);
});

test('duplicate signup is rejected with a clear message', async ({ page }) => {
  const email = uniqueEmail();
  await signup(page, email);
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('form-error')).toHaveText('This email is already registered.');
});

test('language switch to Portuguese persists across reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Language').first().selectOption('pt');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Agentes que executam tarefas',
  );
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Agentes que executam tarefas',
  );
});

test('honest service status is shown on the landing page', async ({ page }) => {
  await page.goto('/');
  const status = page.getByTestId('service-status');
  await expect(status).toContainText('Not configured'); // IA
  await expect(status).toContainText('in-app notifications only');
  await expect(status).toContainText('no payments exist');
});

test('offline banner appears and blocks the login form', async ({ page, context }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('x@example.test');
  await page.getByLabel('Password', { exact: true }).fill('whatever-123');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await context.setOffline(true);
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByTestId('offline-banner')).toBeHidden();
});

test('PWA: manifest is valid and a service worker takes control', async ({ page }) => {
  await page.goto('/');
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
});
