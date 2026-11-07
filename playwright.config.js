import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'preview-desktop', grep: /unsaved preview/, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5181' } },
    { name: 'preview-mobile', grep: /unsaved preview/, use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', baseURL: 'http://127.0.0.1:5181' } },
    { name: 'sync-desktop', grepInvert: /unsaved preview/, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5182' } },
    { name: 'sync-mobile', grepInvert: /unsaved preview/, use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', baseURL: 'http://127.0.0.1:5182' } },
  ],
  webServer: [
    {
      command: 'npm run dev -- --port 5181 --strictPort',
      url: 'http://127.0.0.1:5181',
      env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --port 5182 --strictPort',
      url: 'http://127.0.0.1:5182',
      env: { VITE_SUPABASE_URL: 'https://monthline.test', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' },
      reuseExistingServer: false,
    },
  ],
});
