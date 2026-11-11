import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 45_000,
  expect: {
	timeout: 10_000
  },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
	baseURL: 'http://127.0.0.1:4200',
	trace: 'on-first-retry',
	screenshot: 'only-on-failure',
	video: 'retain-on-failure'
  },
  projects: [
	{
	  name: 'chromium',
	  use: { ...devices['Desktop Chrome'] }
	}
  ],
  webServer: {
	command: 'npm run start -- --host 127.0.0.1 --port 4200',
	url: 'http://127.0.0.1:4200',
	reuseExistingServer: !process.env.CI,
	timeout: 120_000
  }
});
