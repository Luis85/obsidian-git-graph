import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Obsidian provides these at runtime; bundling them would duplicate or break them.
const OBSIDIAN_PROVIDED = [
	'obsidian',
	'electron',
	'@codemirror/autocomplete',
	'@codemirror/collab',
	'@codemirror/commands',
	'@codemirror/language',
	'@codemirror/lint',
	'@codemirror/search',
	'@codemirror/state',
	'@codemirror/view',
	'@lezer/common',
	'@lezer/highlight',
	'@lezer/lr',
	...builtinModules,
	...builtinModules.map((name) => `node:${name}`),
];

export default defineConfig(({ mode }) => ({
	plugins: [vue()],
	define: {
		// Vue reads this at runtime; a library build does not set it.
		'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production'),
	},
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		target: 'es2020',
		minify: mode !== 'development',
		sourcemap: mode === 'development' ? 'inline' : false,
		lib: {
			entry: 'src/main.ts',
			formats: ['cjs'],
			fileName: () => 'main.js',
		},
		rollupOptions: {
			external: OBSIDIAN_PROVIDED,
			output: { exports: 'named' },
		},
	},
}));
