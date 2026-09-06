import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// The browser harness: a plain web app whose root is harness/, mounting src/view/GraphRoot.vue.
// It never builds the plugin — vite.config.ts owns that — and it is not part of `npm run check`.
// `obsidian` is aliased to a browser stub because src/view/Icon.vue imports setIcon from it.
export default defineConfig(({ mode }) => ({
	root: 'harness',
	plugins: [vue()],
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL('./harness/obsidian-stub.ts', import.meta.url)),
		},
	},
	define: {
		// Vue reads this at runtime, same as the plugin build.
		'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production'),
	},
	server: { port: 5174, strictPort: true },
	preview: { port: 5174, strictPort: true },
	build: {
		outDir: '../harness-dist',
		emptyOutDir: true,
		target: 'es2020',
		sourcemap: true,
	},
}));
