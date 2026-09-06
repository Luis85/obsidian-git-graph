import { defineConfig, devices } from '@playwright/test';

// Chromium only, on purpose: the harness exists so an agent can look at the pane, and one
// engine is enough for that. The webServer runs the harness dev server (vite.harness.config.ts);
// `reuseExistingServer` lets a developer keep `npm run harness` running while tests execute.
export const HARNESS_PORT = 5174;
export const HARNESS_URL = `http://localhost:${HARNESS_PORT}`;

export default defineConfig({
	testDir: 'harness',
	testMatch: '*.spec.ts',
	fullyParallel: true,
	forbidOnly: Boolean(process.env['CI']),
	retries: 0,
	reporter: [['list']],
	use: {
		baseURL: HARNESS_URL,
		trace: 'off',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'npx vite --config vite.harness.config.ts',
		url: HARNESS_URL,
		reuseExistingServer: true,
		stdout: 'ignore',
		stderr: 'pipe',
		timeout: 120_000,
	},
});
