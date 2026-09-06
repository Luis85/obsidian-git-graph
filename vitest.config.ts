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
