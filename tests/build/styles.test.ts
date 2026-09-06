import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs build script, no type declarations
import { assembleStyles } from '../../scripts/styles-assemble.mjs';

const assemble = assembleStyles as (dir?: string) => string;

function vueFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? vueFiles(join(dir, e.name)) : e.name.endsWith('.vue') ? [join(dir, e.name)] : [],
	);
}

/**
 * The stylesheet is assembled from `styles/` rather than written as one file, so these
 * assertions are about the assembly rather than the CSS.
 *
 * They call `assembleStyles()` directly instead of reading `dist/styles.css`, which is what
 * lets the suite run with no build having happened — and, more usefully, stops it asserting
 * against a stale artifact from some earlier build, which is the failure mode that would
 * make this file worse than nothing.
 */
describe('the assembled stylesheet', () => {
	const entry = readFileSync('styles/index.css', 'utf8');
	const partials = readdirSync('styles').filter((n) => n.endsWith('.css') && n !== 'index.css');
	const css = assemble();

	it('has partials to assemble, so the checks below are not vacuous', () => {
		expect(partials.length).toBeGreaterThan(1);
	});

	it('contains every partial', () => {
		for (const name of partials) {
			expect(css, name).toContain(readFileSync(join('styles', name), 'utf8').trim());
		}
	});

	it('concatenates them in the order styles/index.css imports them', () => {
		const imported = [...entry.matchAll(/^@import\s+"\.\/([\w.]+\.css)";$/gm)].map((m) => m[1]);
		const positions = imported.map((name) => css.indexOf(`/* === styles/${name} === */`));
		expect(positions).not.toContain(-1);
		// Strictly increasing, asserted directly rather than against a sorted copy: two
		// partials at the same offset is impossible here, and a sorted comparison would
		// quietly accept it.
		expect(positions.filter((at, i) => i > 0 && at <= (positions[i - 1] ?? -1))).toEqual([]);
	});

	it('imports base.css first, since it declares the lane variables lanes.css resolves', () => {
		expect(css.indexOf('--git-graph-lane-0:')).toBeLessThan(css.indexOf('.git-graph-lane-0'));
	});

	it('carries no @import of its own, which Obsidian would resolve against the app', () => {
		expect(css).not.toMatch(/^@import/m);
	});

	it('says it is generated, so nobody edits the output', () => {
		expect(css).toContain('THIS FILE IS GENERATED');
	});

	/**
	 * A class a component names and the sheet does not define is either a typo or a rule
	 * that went missing — including, now that the sheet is assembled, a whole partial that
	 * stopped being imported. `assembleStyles` throws on an unimported partial before this
	 * would notice, so this is the second line rather than the first.
	 *
	 * The exemptions below are classes that are deliberately unstyled, checked one by one
	 * rather than assumed. Adding to this list is a decision: a class belongs here only if
	 * something OTHER than CSS uses it, and the comment has to say what.
	 */
	const UNSTYLED = new Set([
		// querySelector targets for createMeasuredHeight (src/view/CommitList.vue).
		'git-graph-dirty-host',
		'git-graph-details-host',
		// Test and query handles on buttons whose appearance is Obsidian's clickable-icon.
		'git-graph-copy',
		'git-graph-refresh',
	]);

	it('defines every git-graph- class the components use, bar the deliberately unstyled', () => {
		const defined = new Set([...css.matchAll(/\.(git-graph-[\w-]+)/g)].map((m) => m[1]));
		const used = new Set<string>();
		for (const file of vueFiles('src')) {
			for (const m of readFileSync(file, 'utf8').matchAll(/(?<![:\w-])class="([^"]+)"/g)) {
				for (const cls of (m[1] ?? '').split(/\s+/).filter(Boolean)) {
					if (cls.startsWith('git-graph-')) used.add(cls);
				}
			}
		}
		expect(used.size).toBeGreaterThan(0);
		expect([...used].filter((cls) => !defined.has(cls) && !UNSTYLED.has(cls))).toEqual([]);
	});

	it('keeps the unstyled list honest — an entry that gained a rule is stale', () => {
		const defined = new Set([...css.matchAll(/\.(git-graph-[\w-]+)/g)].map((m) => m[1]));
		expect([...UNSTYLED].filter((cls) => defined.has(cls))).toEqual([]);
	});
});

function fixture(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), 'git-graph-styles-'));
	for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
	return `${dir}/`;
}

describe('assembleStyles refuses a directory it cannot assemble faithfully', () => {
	it('throws naming the partial the entry file does not import', () => {
		const dir = fixture({
			'index.css': '@import "./a.css";\n',
			'a.css': '.a { color: red; }\n',
			'b.css': '.b { color: blue; }\n',
		});
		expect(() => assemble(dir)).toThrow(/does not import: b\.css/);
	});

	it('throws when a partial is over the line cap', () => {
		const dir = fixture({
			'index.css': '@import "./big.css";\n',
			'big.css': '.x { color: red; }\n'.repeat(401),
		});
		expect(() => assemble(dir)).toThrow(/over the 400-line cap/);
	});

	it('assembles a directory whose partials are all imported', () => {
		const dir = fixture({ 'index.css': '@import "./a.css";\n', 'a.css': '.a { color: red; }\n' });
		expect(assemble(dir)).toContain('.a { color: red; }');
	});
});
