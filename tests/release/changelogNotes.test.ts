import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs script, no type declarations
import { changelogNotes, headings } from '../../scripts/changelog-notes.mjs';

const notes = changelogNotes as (changelog: string, version: string) => string;
const scan = headings as (text: string) => { text: string; index: number }[];

/**
 * The extractor the release workflow pipes into `gh release create --notes-file`. Tested
 * against strings rather than the real `CHANGELOG.md`, so the boundary cases below exist
 * here whether or not the repository's own changelog currently has one.
 */
describe('changelogNotes', () => {
	const doc = [
		'# Changelog',
		'',
		'## [Unreleased]',
		'',
		'- pending',
		'',
		'## [0.2.0] - 2026-09-06',
		'',
		'### Added',
		'',
		'- the thing',
		'',
		'## [0.1.0] - 2026-08-01',
		'',
		'- first release',
		'',
	].join('\n');

	it('returns one version section, without its own heading', () => {
		expect(notes(doc, '0.2.0')).toBe('### Added\n\n- the thing');
	});

	it('reads the oldest section to the end of the file', () => {
		expect(notes(doc, '0.1.0')).toBe('- first release');
	});

	it('throws when the version has no dated heading', () => {
		expect(() => notes(doc, '9.9.9')).toThrow(/no dated heading for 9\.9\.9/);
	});

	it('throws when the heading is present but undated', () => {
		expect(() => notes('## [0.3.0]\n\n- x\n', '0.3.0')).toThrow(/no dated heading/);
	});

	it('does not treat 0.1.0 as a match for 0x1y0, since the dots are literal', () => {
		expect(() => notes('## [0a1b0] - 2026-08-01\n\n- x\n', '0.1.0')).toThrow(/no dated heading/);
	});

	it('returns an empty body for a heading that is the unterminated last line', () => {
		expect(notes('## [0.1.0] - 2026-08-01', '0.1.0')).toBe('');
	});
});

describe('headings', () => {
	it('reads only level two, so a version section keeps its ### groups', () => {
		expect(scan('# One\n## Two\n### Three\n#### Four\n').map((h) => h.text)).toEqual(['Two']);
	});

	it('accepts the 0-3 leading spaces CommonMark permits', () => {
		expect(scan('   ## Indented\n').map((h) => h.text)).toEqual(['Indented']);
	});

	it('rejects a fourth leading space, which makes it an indented code block', () => {
		expect(scan('    ## Code\n')).toEqual([]);
	});

	it('ignores a heading inside a fenced block, which would end a section early', () => {
		expect(scan('## Real\n\n```md\n## Example\n```\n').map((h) => h.text)).toEqual(['Real']);
	});

	it('does not let a ``` inside a ~~~ block close it', () => {
		expect(scan('~~~\n```\n## Hidden\n~~~\n## Real\n').map((h) => h.text)).toEqual(['Real']);
	});

	it('drops a closing sequence from the heading text', () => {
		expect(scan('## Text ##\n').map((h) => h.text)).toEqual(['Text']);
	});

	it('reports the offset of the line the heading starts on', () => {
		const doc = 'intro\n## Two\nbody\n';
		expect(doc.slice(scan(doc)[0]?.index)).toBe('## Two\nbody\n');
	});
});
