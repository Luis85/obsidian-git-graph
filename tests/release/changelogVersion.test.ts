import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs script, no type declarations
import { headings } from '../../scripts/changelog-notes.mjs';

/**
 * `CHANGELOG.md` held against `manifest.json`.
 *
 * `RELEASING.md` says a second commit, right after the version bump and in the same pull
 * request, renames `## [Unreleased]` to `## [<version>] - <date>` — it cannot be the same
 * commit `npm version` makes, since that one runs against a clean tree. A rule stated only
 * in prose is one nothing enforces, so this makes the two files disagree loudly:
 * `manifest.json`'s version must be the FIRST dated heading below `## [Unreleased]`, not
 * merely present somewhere in the file's history. A bump that forgot the entry — or added
 * one under the wrong heading — fails here rather than shipping a changelog that does not
 * name its own latest release.
 *
 * What this cannot check: that the entry says anything true. A heading with no bullets
 * under it still passes, and so does a date that does not exist on a calendar —
 * `2026-13-40` matches `\d{4}-\d{2}-\d{2}` exactly as a real one does, and
 * `changelogNotes` never reads the heading's date at all, only the body beneath it.
 */
const DATED_VERSION = /^\[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$/;

describe('the changelog names the released version', () => {
	const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
	const all = headings(readFileSync('CHANGELOG.md', 'utf8')) as { text: string; index: number }[];
	const unreleasedAt = all.findIndex((h) => h.text === '[Unreleased]');

	it('has an [Unreleased] section', () => {
		expect(unreleasedAt).toBeGreaterThanOrEqual(0);
	});

	it('names the manifest version, dated, as the first heading below [Unreleased]', () => {
		const first = all[unreleasedAt + 1];
		const dated = first ? DATED_VERSION.exec(first.text) : null;
		expect(dated?.[1]).toBe(manifest.version);
	});
});

/**
 * One release, one group of each kind.
 *
 * A pull request that adds a bullet can write its own `### Added` rather than finding the
 * section's, and nothing would notice. That is not a tidiness question: `changelogNotes()`
 * slices a version's whole section into the file `gh release create --notes-file` reads,
 * so a published release body would restart "Added / Changed / Fixed" once per pull
 * request that touched it.
 *
 * Every section is checked, not only the one being released, because the older entries are
 * what a reader deciding whether to upgrade scrolls through.
 */
describe('each changelog section groups its bullets once', () => {
	const changelog = readFileSync('CHANGELOG.md', 'utf8');
	const all = headings(changelog) as { text: string; index: number }[];

	it('has no repeated ### group heading within one version section', () => {
		const repeated: string[] = [];
		for (const [at, section] of all.entries()) {
			const body = changelog.slice(section.index, all[at + 1]?.index ?? changelog.length);
			const groups = [...body.matchAll(/^ {0,3}### +(.+?)[ \t]*$/gm)].map((m) => m[1] ?? '');
			const seen = new Set<string>();
			for (const group of groups) {
				if (seen.has(group)) repeated.push(`${section.text} → ### ${group}`);
				seen.add(group);
			}
		}
		expect(repeated).toEqual([]);
	});
});
