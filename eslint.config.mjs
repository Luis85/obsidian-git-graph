import { fileURLToPath } from 'node:url';
import tsparser from '@typescript-eslint/parser';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';

const SRC = ['src/**/*.ts', 'src/**/*.vue'];
const TESTS = ['tests/**/*.ts'];
const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url));
// obsidianmd's recommended config pulls in typescript-eslint's type-checked rules for
// src/**/*.ts, which need type information; point the parser at this project's tsconfig.
const typeAwareParserOptions = { projectService: true, tsconfigRootDir };

// A glob pattern like '**/*.ts' or '**/*.{ts,tsx}' targets TypeScript if its extension
// (the plain suffix after the last '.', or the comma-separated list inside a trailing
// '.{...}' brace group) includes one of ts/tsx/cts/mts.
const TS_EXTENSIONS = ['ts', 'tsx', 'cts', 'mts'];
function patternTargetsTypeScript(pattern) {
	const extensionList = pattern.match(/\.\{([^}]+)\}$/) ?? pattern.match(/\.([A-Za-z]+)$/);
	if (!extensionList) return false;
	return extensionList[1]
		.split(',')
		.map((ext) => ext.trim())
		.some((ext) => TS_EXTENSIONS.includes(ext));
}

// obsidianmd's recommended config array mixes four shapes of entry:
//   1. `files` targeting TypeScript (directly, or as nested arrays produced when obsidianmd's
//      own `extends` intersects an outer files list with a TS-scoped sub-config, e.g.
//      [['**/*.{js,cjs,mjs,jsx}', '**/*.ts'], ...]) — rescope these to SRC, since that's the
//      TypeScript/Vue source this project actually lints.
//   2. `files: ['package.json']` — validates the real package.json at the project root; leave
//      completely untouched, anchoring it under src/ would make it stop matching the file it
//      exists to check.
//   3. `files` targeting only JavaScript (e.g. `**/*.{js,cjs,mjs,jsx}`) — these globs are
//      unanchored, so left verbatim they'd also match this repo's *root* tooling
//      (eslint.config.mjs, scripts/**/*.mjs), which obsidianmd's plugin-guideline rules were
//      never meant to lint (that surfaced as real rule violations, e.g. flagging our own
//      scripts' console.log calls, when this was tried). Anchor them under src/ instead, so
//      they stay ready for any .js source that lands in src/ without leaking rules onto
//      unrelated project tooling; today src/ is all .ts/.vue, so this matches nothing.
//   4. no `files` at all (bare rule/plugin registrations, or linterOptions/languageOptions
//      entries) — narrow to SRC like case 1, EXCEPT a *pure* plugin registration (only a
//      `plugins` key, e.g. `{ plugins: { obsidianmd } }`): the JS-scoped rule block from case 3
//      references `obsidianmd/*` rules and needs the plugin resolvable wherever it matches, so
//      that registration must stay global rather than be narrowed to SRC.
function scopeObsidianConfigEntry(c) {
	if (c.files !== undefined) {
		const patterns = c.files.flat(Infinity);
		if (patterns.some(patternTargetsTypeScript)) return { ...c, files: SRC };
		if (patterns.every((p) => p === 'package.json')) return c;
		return { ...c, files: c.files.map((p) => `src/${p}`) };
	}
	const isPluginRegistrationOnly = Object.keys(c).every((key) => key === 'plugins');
	return isPluginRegistrationOnly ? c : { ...c, files: SRC };
}

export default defineConfig([
	{ ignores: ['node_modules/**', 'dist/**', '.obsidian/**', 'coverage/**', 'docs/**'] },
	...obsidianmd.configs.recommended.map(scopeObsidianConfigEntry),
	...pluginVue.configs['flat/recommended'].map((c) => ({ ...c, files: ['src/**/*.vue'] })),
	{
		files: ['src/**/*.vue'],
		languageOptions: {
			parser: vueParser,
			parserOptions: { parser: tsparser, extraFileExtensions: ['.vue'], sourceType: 'module', ...typeAwareParserOptions },
		},
		rules: { 'vue/multi-word-component-names': 'off' },
	},
	{
		files: ['src/**/*.ts'],
		extends: [tseslint.configs.recommended],
		languageOptions: { parser: tsparser, parserOptions: typeAwareParserOptions },
	},
	{
		files: TESTS,
		extends: [tseslint.configs.recommended],
		languageOptions: { parser: tsparser },
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
		},
	},
	{
		files: ['*.ts', '*.mjs', 'scripts/**/*.mjs'],
		extends: [tseslint.configs.recommended],
		languageOptions: { parser: tsparser },
	},
]);
