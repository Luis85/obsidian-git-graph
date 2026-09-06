import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { builtinModules } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
// @ts-expect-error - plain .mjs build script, no type declarations
import { assembleStyles } from './scripts/styles-assemble.mjs';

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

/**
 * Emits `dist/styles.css` — the second of the three files Obsidian loads, and the one vite
 * would not otherwise produce: nothing in `src/` imports CSS, because a plugin's styles are
 * injected by Obsidian as a file rather than by the bundle at runtime.
 *
 * `emitFile` rather than a write: the asset then belongs to the bundle, so `emptyOutDir`
 * cannot clear it after the fact and `--watch` re-emits it with everything else.
 *
 * `addWatchFile` on every partial is what makes `npm run dev` react to editing one. Without
 * it the graph vite watches contains no CSS at all — the partials reach the build only
 * through `assembleStyles()` reading them itself, which no bundler can see.
 */
function pluginStylesheet(): Plugin {
	return {
		name: 'git-graph-styles',
		buildStart() {
			// Absolute paths: rollup's watcher keys on what it is given, and a relative path
			// registers a file it then never sees change.
			for (const file of readdirSync('styles')) this.addWatchFile(resolve('styles', file));
		},
		generateBundle() {
			this.emitFile({ type: 'asset', fileName: 'styles.css', source: assembleStyles() });
		},
	};
}

export default defineConfig(({ mode }) => ({
	plugins: [vue(), pluginStylesheet()],
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
