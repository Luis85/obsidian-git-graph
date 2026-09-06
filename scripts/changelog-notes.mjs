import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The `## ` headings of a Markdown document, in order, each with the offset of the line
 * it starts on.
 *
 * ATX only (`## Text`), never the Setext spelling (a line underlined with `---`): a
 * changelog heading is only ever written the first way, and recognising the second would
 * read the `---` of any YAML frontmatter as a heading of its own.
 *
 * Two things here are not decoration:
 *
 * - **Fenced code is skipped.** `CHANGELOG.md` quotes commands and config, and a `## ` in
 *   an example would otherwise end the section being extracted early — silently, since
 *   the result is still a plausible-looking release body.
 * - **0-3 leading spaces are allowed.** CommonMark permits them, so an indented heading
 *   is a real heading; anchoring on `^## ` reads it as prose and the section it opens
 *   gets swallowed into the one above.
 *
 * @param {string} text - the whole document.
 * @returns {{ text: string, index: number }[]} every level-two heading, in document order.
 */
export function headings(text) {
	const found = [];
	let offset = 0;
	let fence = null;
	for (const line of text.split('\n')) {
		const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
		if (fence) {
			// A fence closes only on the same character, at least as long as the one that
			// opened it — so a ``` inside a ~~~ block does not end it.
			if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
		} else if (open) {
			fence = open[1];
		} else {
			// Level two only: after the two `#` the pattern demands whitespace or the end
			// of the line, so `### Added` — whose third `#` is neither — does not match,
			// and a version's own group headings stay inside its section rather than
			// ending it.
			const atx = /^ {0,3}##(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
			if (atx) {
				// A closing sequence (`## Text ##`) is not part of the heading's text.
				found.push({ text: (atx[1] ?? '').replace(/[ \t]+#+$/, '').trim(), index: offset });
			}
		}
		offset += line.length + 1;
	}
	return found;
}

/**
 * The body of one dated version heading in `CHANGELOG.md` — everything between it and the
 * next `## ` heading, or the end of the file for the oldest entry, trimmed.
 *
 * Exported so the boundary logic (heading found or not, a next heading to stop at or
 * none) is testable directly, in `tests/release/changelogNotes.test.ts`, rather than only
 * through the release workflow that calls it.
 *
 * @param {string} changelog - the whole of CHANGELOG.md.
 * @param {string} version - the version whose section to return, e.g. `0.1.0`.
 * @returns {string} that section's body, trimmed, without its own heading.
 */
export function changelogNotes(changelog, version) {
	const dated = new RegExp(`^\\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`);
	const all = headings(changelog);
	const at = all.findIndex((h) => dated.test(h.text));
	if (at === -1) throw new Error(`CHANGELOG.md has no dated heading for ${version}`);
	// A heading with no newline after it is the last line of a file that does not end in
	// one: indexOf returns -1, and `-1 + 1` would slice from 0 — the whole file, rather
	// than the empty body that heading actually has nothing after.
	const lineEnd = changelog.indexOf('\n', all[at].index);
	const from = lineEnd === -1 ? changelog.length : lineEnd + 1;
	return changelog.slice(from, all[at + 1]?.index ?? changelog.length).trim();
}

// CLI entry: `node scripts/changelog-notes.mjs <version>`, what the release workflow runs
// to build the file `gh release create --notes-file` reads. Guarded on the real path (not
// `import.meta.url` compared directly — that breaks on Windows, where it stays
// `file:///C:/...` against argv's `C:\...`) so importing this module for its exports never
// touches argv or the filesystem.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const version = process.argv[2];
	if (!version) {
		console.error('Usage: node scripts/changelog-notes.mjs <version>');
		process.exit(1);
	}
	process.stdout.write(`${changelogNotes(readFileSync('CHANGELOG.md', 'utf8'), version)}\n`);
}
