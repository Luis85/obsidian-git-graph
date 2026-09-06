import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
	plugins: [vue()],
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL('./tests/helpers/obsidian-mock.ts', import.meta.url)),
		},
	},
	test: {
		testTimeout: 20000,
		// The git fixture beforeAll hooks in tests/plugin and tests/git each spawn ~15 git
		// processes and have exceeded the 10s default hookTimeout under machine load.
		hookTimeout: 30000,
		coverage: {
			provider: 'v8',
			include: ['src/**/*.{ts,vue}'],
			exclude: ['src/view/vue-shim.d.ts'],
			reporter: ['text', 'html', 'lcov'],
			reportsDirectory: 'coverage',
			// Baseline (npx vitest run --coverage, no thresholds, src/**/*.{ts,vue} only):
			// statements 92.04%, branches 81.37%, functions 92.85%, lines 94.07%. Each rounded
			// down to a multiple of 5, then floored at 80/80/80/70 (all four are above their
			// floor, so the rounded-down baseline is used as-is).
			thresholds: {
				statements: 90,
				branches: 80,
				functions: 90,
				lines: 90,
			},
		},
		projects: [
			{
				extends: true,
				test: {
					name: 'dom',
					include: ['tests/view/**', 'tests/plugin/**', 'tests/settings/**', 'tests/watch/**'],
					environment: 'jsdom',
				},
			},
			{
				extends: true,
				test: {
					name: 'node',
					include: ['tests/**/*.test.ts'],
					exclude: ['tests/view/**', 'tests/plugin/**', 'tests/settings/**', 'tests/watch/**'],
					environment: 'node',
				},
			},
		],
	},
});
