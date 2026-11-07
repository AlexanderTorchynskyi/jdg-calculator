import { test, expect } from '@playwright/test';
import { settingsEqual } from '../../src/calculator.js';

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.test', aud: 'authenticated', role: 'authenticated' };
const token = [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub: account.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url'),
  'test-signature',
].join('.');

async function mockBackend(context) {
  const state = { revision: 0, records: [], defaults: [] };
  const control = { failSave: false, failLoad: false, signupEmail: '', resetEmail: '', updatedPassword: '', loadCount: 0 };
  await context.route('https://monthline.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const payload = route.request().postDataJSON();
    const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/token')) return respond({ access_token: token, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user: account });
    if (path.endsWith('/logout')) return respond({});
    if (path.endsWith('/signup')) {
      control.signupEmail = payload.email;
      return respond({ user: account, session: null });
    }
    if (path.endsWith('/recover')) {
      control.resetEmail = payload.email;
      return respond({});
    }
    if (path.endsWith('/user')) {
      if (route.request().method() === 'PUT') control.updatedPassword = payload.password;
      return respond(account);
    }
    if (path.endsWith('/load_workspace')) {
      control.loadCount++;
      if (control.failLoad) return respond({ message: 'Database unavailable' }, 503);
      return respond(state);
    }
    if (path.endsWith('/save_month')) {
      if (control.failSave) return route.abort('failed');
      if (payload.p_revision !== state.revision) {
        return respond({ code: '40001', message: 'Your records changed on another device. Refresh before saving again.' }, 409);
      }
      const month = payload.p_month.slice(0, 7);
      const record = { month };
      for (const key of ['hours', 'rate', 'tax', 'accounting', 'card', 'zus']) record[key] = payload[`p_${key}`];
      const prior = state.records.find((entry) => entry.month === month) ??
        [...state.defaults].filter((entry) => entry.month <= month).sort((a, b) => b.month.localeCompare(a.month))[0];
      state.records = state.records.filter((entry) => entry.month !== month).concat(record);
      if (!prior || !settingsEqual(prior, record)) {
        state.defaults = state.defaults.filter((entry) => entry.month !== month).concat({ ...record });
      }
      state.revision++;
      return respond(state);
    }
    return respond({ message: `Unexpected mocked request: ${path}` }, 400);
  });
  return { state, control };
}

async function login(page) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('#app-status')).toHaveText('Up to date.');
}

async function month(page, value) {
  await page.locator('#month').fill(value);
  await page.locator('#month').press('Tab');
  await expect(page.locator('#month')).toHaveValue(value);
  await expect(page.locator('#save')).toBeEnabled();
}

async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('unsaved preview is responsive, accessible and calculates the exact formula', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('preview'));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#setup-notice')).toBeVisible();
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#rate')).toHaveValue('');
  await expect(page.locator('#tax')).toHaveValue('10.25');
  await page.getByLabel('Working hours').fill('160');
  await expect(page.locator('#brutto')).toHaveText('—');
  await expect(page.locator('#netto')).toHaveText('—');
  await page.getByLabel('Hourly rate').fill('100');
  await expect(page.locator('#brutto')).toContainText('19,680.00 PLN');
  await expect(page.locator('#netto')).toContainText('11,433.00 PLN');
  await page.getByLabel('ZUS', { exact: true }).fill('3000');
  await expect(page.locator('#netto')).toContainText('11,052.00 PLN');
  await page.getByLabel('Working hours').fill('0');
  await expect(page.locator('#netto')).toContainText('-3,308.00 PLN');
  await page.getByLabel('Hourly rate').fill('-1');
  await expect(page.locator('#rate-error')).toContainText('non-negative');
  await expect(page.locator('#brutto')).toHaveText('—');
  await expect(page.locator('#rate')).toHaveAttribute('aria-invalid', 'true');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('monthly snapshots survive reload and sync to another device; defaults preserve history', async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('sync'));
  const { state } = await mockBackend(context);
  await login(page);
  await month(page, '2026-01');
  await expect(page.locator('#rate')).toHaveValue('');
  await expect(page.locator('#save-state')).toHaveText('Not saved yet');
  await page.getByLabel('Working hours').fill('160');
  await page.getByLabel('Hourly rate').fill('100');
  await page.getByRole('button', { name: 'Save month' }).click();
  await expect(page.locator('#app-status')).toContainText('January 2026 saved');
  await expect(page.locator('#save-state')).toHaveText('Saved snapshot');
  await page.reload();
  await expect(page.locator('#app-status')).toHaveText('Up to date.');
  await page.getByRole('button', { name: /January 2026/ }).click();
  await expect(page.locator('#hours')).toHaveValue('160.00');
  await month(page, '2026-02');
  await expect(page.locator('#rate')).toHaveValue('100.00');
  await page.getByLabel('Working hours').fill('120');
  await page.getByLabel('ZUS', { exact: true }).fill('3000');
  await page.getByRole('button', { name: 'Save month' }).click();
  await expect(page.locator('#app-status')).toContainText('February 2026 saved');
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.locator('#app-status')).toHaveText('Up to date.');
  await month(second, '2026-03');
  await expect(second.locator('#zus')).toHaveValue('3000.00');
  await second.getByRole('button', { name: /January 2026/ }).click();
  await expect(second.locator('#zus')).toHaveValue('2619.00');
  expect(state.records.length).toBe(2);
  await noOverflow(page);
  await noOverflow(second);
});

test('failed and conflicting saves keep edits; explicit refresh and discard are required', async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('sync'));
  const { state, control } = await mockBackend(context);
  await login(page);
  await month(page, '2026-01');
  await page.getByLabel('Working hours').fill('160');
  await page.getByLabel('Hourly rate').fill('100');
  control.failSave = true;
  await page.getByRole('button', { name: 'Save month' }).click();
  await expect(page.locator('#app-status')).toContainText('Save could not be confirmed');
  await expect(page.locator('#hours')).toHaveValue('160');
  await expect(page.locator('#save-state')).toHaveText('Unsaved changes');
  expect(state.records.length).toBe(0);
  control.failSave = false;
  state.revision++;
  await page.getByRole('button', { name: 'Save month' }).click();
  await expect(page.locator('#app-status')).toContainText('another device');
  await expect(page.locator('#rate')).toHaveValue('100');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await expect(page.locator('#month')).toHaveValue('2026-01');
  control.failLoad = true;
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('#app-status')).toContainText('Could not load');
  await expect(page.locator('#rate')).toHaveValue('100');
  control.failLoad = false;
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('#app-status')).toHaveText('Up to date.');
  await expect(page.locator('#rate')).toHaveValue('');
});

test('authentication supports signup, reset requests, sign-in and clean sign-out', async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('sync'));
  const { control } = await mockBackend(context);
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill('new-password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.locator('#auth-status')).toContainText('Check your email');
  expect(control.signupEmail).toBe(account.email);
  await page.getByRole('button', { name: 'Already registered? Sign in' }).click();
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.locator('#auth-status')).toContainText('reset link has been sent');
  expect(control.resetEmail).toBe(account.email);
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill('new-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#app-status')).toHaveText('Up to date.');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('#auth-panel')).toBeVisible();
  await expect(page.locator('#dashboard')).toBeHidden();
  await expect(page.locator('#account-email')).toHaveText('');
});

test('password recovery links expose a new-password form and update the account', async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('sync'));
  const { control } = await mockBackend(context);
  await page.goto(`/#access_token=${token}&refresh_token=test-refresh&expires_in=3600&token_type=bearer&type=recovery`);
  await expect(page.locator('#auth-title')).toHaveText('Choose a new password.');
  await page.getByLabel('New password', { exact: true }).fill('replacement-password');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.locator('#app-status')).toHaveText('Password updated.');
  expect(control.updatedPassword).toBe('replacement-password');
  await expect(page.locator('#dashboard')).toBeVisible();
});
