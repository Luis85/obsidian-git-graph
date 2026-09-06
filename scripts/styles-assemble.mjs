import { readFileSync, readdirSync } from 'node:fs';

/**
 * Assemble `styles/index.css` and its partials into the single stylesheet Obsidian loads.
 *
 * Obsidian injects a plugin's `styles.css` as one blob, so an `@import` surviving into the
 * shipped file would resolve against the app rather than the plugin folder. The imports in
 * the entry file are therefore a build instruction, and this is the build: concatenation
 * in the stated order, which is the whole of it because the order is the only thing CSS
 * assembly has to get right.
 *
 * Two callers put a stylesheet somewhere and both go through here: `vite.config.ts`, which
 * writes `dist/styles.css` on every build and re-writes it when a partial changes under
 * `--watch`, and `tests/build/styles.test.ts`, which calls this function directly — so the
 * suite needs no build to have run first and cannot assert against a stale artifact.
 * `scripts/test-build.mjs` copies vite's output rather than calling this again.
 *
 * The browser harness does NOT come through here. It imports `styles/index.css` and lets
 * vite resolve the `@import`s itself, which it does at dev-server and build time alike —
 * so the harness renders the partials as they are on disk, with no build step between.
 * That is the same order this function produces; vite is not a second definition of it.
 */

// Relative to the WORKING DIRECTORY, not to this file — which is worth saying now that
// this file lives in `scripts/` and `styles/` does not. npm scripts, vite and vitest all
// run from the repository root, as every other build script here assumes (`dist/`,
// `manifest.json`).
const DIR = 'styles/';

// The same cap `scripts/loc.mjs` enforces on every other file it counts. Splitting a
// stylesheet that nothing measures leaves it split only until someone appends to it.
const MAX_LINES = 400;

const IMPORT = /^@import\s+"\.\/([\w.]+\.css)";$/gm;

/**
 * @param {string} [dir] - the directory to assemble, with a trailing slash. Defaults to the
 *   real `styles/`; the tests pass a fixture so the two failure modes below can be
 *   exercised rather than restated, which is the only reason this is a parameter.
 * @returns {string} every partial the entry file imports, concatenated in its order, under
 *   a banner naming the source.
 */
export function assembleStyles(dir = DIR) {
	const entry = readFileSync(`${dir}index.css`, 'utf8');
	const imported = [...entry.matchAll(IMPORT)].map((match) => match[1]);

	// An unimported partial is silently absent from the shipped sheet — the one failure
	// mode of a split that a stylesheet cannot report and a screenshot barely can, since
	// the rules it loses are exactly the ones nobody thought to look at.
	const present = readdirSync(dir).filter((name) => name.endsWith('.css') && name !== 'index.css');
	const missing = present.filter((name) => !imported.includes(name));
	if (missing.length > 0) {
		throw new Error(`${dir}index.css does not import: ${missing.join(', ')}`);
	}

	const parts = imported.map((name) => {
		const body = readFileSync(dir + name, 'utf8');
		const lines = body.split('\n').length;
		if (lines > MAX_LINES) throw new Error(`${dir}${name} is ${lines} lines, over the ${MAX_LINES}-line cap`);
		return `/* === ${dir}${name} === */\n\n${body.trim()}\n`;
	});

	return `/*
THIS FILE IS GENERATED from styles/ by scripts/styles-assemble.mjs — edit the partial, not
this. The import order in styles/index.css is load-bearing and states why.
*/\n\n${parts.join('\n')}`;
}
