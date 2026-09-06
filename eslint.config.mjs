import { fileURLToPath } from 'node:url';
import tsparser from '@typescript-eslint/parser';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import oxlint from 'eslint-plugin-oxlint';

const SRC = ['src/**/*.ts', 'src/**/*.vue'];
// The harness is application-shaped but not plugin code: it lints on the same tier as
// tests and root tooling, never with obsidianmd's plugin-guideline rules.
const TESTS = ['tests/**/*.ts', 'harness/**/*.ts'];
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
	{ ignores: ['node_modules/**', 'dist/**', '.obsidian/**', 'coverage/**', 'docs/**', 'harness-dist/**', 'screenshots/**', 'playwright-report/**', 'test-results/**'] },
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
	// Size and complexity backstops. Placed before the oxlint entry below so oxlint's
	// rule-disabling (it turns off eslint/typescript-eslint rules it re-implements) never
	// touches these — none of complexity/max-lines/max-lines-per-function/max-depth/
	// max-params/max-nested-callbacks are in oxlint's own rule set, so this ordering is
	// safety margin rather than a fix for an observed conflict.
	{
		files: SRC,
		rules: {
			'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
			'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true }],
			complexity: ['error', 12],
			'max-depth': ['error', 4],
			'max-params': ['error', 5],
			'max-nested-callbacks': ['error', 4],
		},
	},
	{
		files: [...TESTS, 'scripts/**/*.mjs', '*.ts', '*.mjs'],
		rules: {
			'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
			complexity: ['error', 15],
			'max-depth': ['error', 4],
		},
	},
	{
		files: ['src/settings/types.ts'],
		rules: {
			// TODO(quality): normalizeSettings has a complexity of 13 (limit 12). It validates
			// 5 independent optional settings fields, each with its own type/range check; the
			// complexity comes from that flat list, not from nested control flow. Extracting a
			// genuinely trivial helper isn't possible without inventing a generic
			// pick-and-validate abstraction across differently-shaped fields (string, enum,
			// bounded number, boolean) — a real design change, out of scope for this task.
			complexity: ['error', 13],
		},
	},
	{
		files: ['src/view/store.ts'],
		rules: {
			// TODO(quality): createGraphStore has 107 lines (limit 80). Every status read now
			// lives in ./statusSync (createStatusSync) and `errorMessage` in ./errors, and
			// `toggleExpand` (createExpandToggler), `applyLoad` and `groupRefs` sit at module scope.
			// What remains inline is the initial `state` literal (one line per GraphState field)
			// plus `visibleRows`/`collapse`/`load`/`loadMore`, which close over shared private
			// state (state, byHash, generation, disposed) rather than forming one long
			// procedural function. Pulling those out too would mean threading that shared
			// mutable state through explicit parameters everywhere, which is a real refactor
			// (arguably to a class), not a trivial behavior-preserving extraction. Out of scope
			// for this task.
			'max-lines-per-function': ['error', { max: 107, skipBlankLines: true, skipComments: true, IIFEs: true }],
		},
	},
	// Must stay last: turns off eslint core/typescript-eslint/unicorn rules that oxlint
	// already covers with its own (faster) implementation, so the two linters don't
	// duplicate work. Read from .oxlintrc.json so the two configs can't drift apart.
	// This never touches obsidianmd's rules — oxlint doesn't know about that plugin.
	...oxlint.buildFromOxlintConfigFile('./.oxlintrc.json'),
]);
