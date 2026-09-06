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

export default defineConfig([
	{ ignores: ['node_modules/**', 'dist/**', '.obsidian/**', 'coverage/**', 'docs/**'] },
	// Some entries in obsidianmd's recommended config are scoped to package.json (JSON
	// language, not a JS/TS parser) to validate plugin metadata; forcing `files: SRC` onto
	// those would run the JSON language over our .ts/.vue sources, so leave them as-is.
	...obsidianmd.configs.recommended.map((c) =>
		Array.isArray(c.files) && c.files.length === 1 && c.files[0] === 'package.json' ? c : { ...c, files: SRC },
	),
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
