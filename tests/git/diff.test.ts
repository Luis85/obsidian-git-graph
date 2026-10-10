import { describe, expect, it } from 'vitest';
import { MAX_DIFF_LINES, parseFileDiff, parseFollowLog } from '../../src/git/diff';

const F = '\x1f';
const Z = '\0';
const header = (hash: string, subject: string): string => `${hash}${F}p${F}Ann${F}a@x${F}2026-09-06T10:00:00Z${F}${subject}`;

// `git log -z --name-status --follow` writes each commit as its format record, then a NUL, a
// newline, the status, and the NUL-terminated path(s) the file had in that commit.
describe('parseFollowLog', () => {
	it('attaches the file as it was in each commit, including a rename with its old path', () => {
		const out = [header('c3', 'edit'), '\nM', 'renamed.md', header('c2', 'rename'), '\nR100', 'note.md', 'renamed.md', header('c1', 'root'), '\nA', 'note.md', ''].join(Z);
		const commits = parseFollowLog(out);
		expect(commits.map((c) => [c.hash, c.subject, c.file])).toEqual([
			['c3', 'edit', { path: 'renamed.md', status: 'M' }],
			['c2', 'rename', { path: 'renamed.md', status: 'R', oldPath: 'note.md' }],
			['c1', 'root', { path: 'note.md', status: 'A' }],
		]);
		expect(commits[0]).toMatchObject({ parents: ['p'], author: 'Ann', email: 'a@x', date: '2026-09-06T10:00:00Z' });
	});

	it('leaves `file` off a commit that git listed without a name-status block', () => {
		const out = [header('c2', 'merge'), header('c1', 'root'), '\nA', 'note.md', ''].join(Z);
		const commits = parseFollowLog(out);
		expect(commits[0]).not.toHaveProperty('file');
		expect(commits[1]?.file).toEqual({ path: 'note.md', status: 'A' });
	});

	it('returns [] for empty output', () => {
		expect(parseFollowLog('')).toEqual([]);
	});
});

describe('parseFileDiff', () => {
	it('skips the file headers and classifies hunk, context, added, removed and note lines', () => {
		const out = [
			'diff --git a/a.md b/a.md',
			'index 1..2 100644',
			'--- a/a.md',
			'+++ b/a.md',
			'@@ -1,3 +1,3 @@ # Title',
			' a',
			'-Teh',
			'+The',
			'\\ No newline at end of file',
			'',
		].join('\n');
		expect(parseFileDiff(out)).toEqual({
			binary: false,
			truncated: false,
			lines: [
				{ kind: 'hunk', text: '@@ -1,3 +1,3 @@ # Title' },
				{ kind: 'ctx', text: ' a' },
				{ kind: 'del', text: '-Teh' },
				{ kind: 'add', text: '+The' },
				{ kind: 'note', text: '\\ No newline at end of file' },
			],
		});
	});

	it('keeps a removed line whose text starts with dashes, once inside a hunk', () => {
		const out = ['--- a/a.md', '+++ b/a.md', '@@ -1 +1 @@', '--- a rule', '+++ plus', ''].join('\n');
		expect(parseFileDiff(out).lines.slice(1)).toEqual([
			{ kind: 'del', text: '--- a rule' },
			{ kind: 'add', text: '+++ plus' },
		]);
	});

	// `diff-tree -m` on a merge writes one section per parent; the first is the first parent's.
	it('reads only the first file section', () => {
		const out = ['diff --git a/a.md b/a.md', '@@ -1 +1 @@', '-x', '+y', 'diff --git a/a.md b/a.md', '@@ -1 +1 @@', '-q', '+r', ''].join('\n');
		expect(parseFileDiff(out).lines.map((l) => l.text)).toEqual(['@@ -1 +1 @@', '-x', '+y']);
	});

	it('reports a binary file', () => {
		const out = ['diff --git a/b.dat b/b.dat', 'new file mode 100644', 'Binary files /dev/null and b/b.dat differ', ''].join('\n');
		expect(parseFileDiff(out)).toEqual({ binary: true, truncated: false, lines: [] });
	});

	it('is empty for a rename without content changes, and for no output at all', () => {
		expect(parseFileDiff('diff --git a/a.md b/b.md\nsimilarity index 100%\nrename from a.md\nrename to b.md\n')).toEqual({ binary: false, truncated: false, lines: [] });
		expect(parseFileDiff('')).toEqual({ binary: false, truncated: false, lines: [] });
	});

	it('caps a very large diff and says so', () => {
		const body = Array.from({ length: MAX_DIFF_LINES + 10 }, (_, i) => `+line ${i}`);
		const result = parseFileDiff(['@@ -0,0 +1 @@', ...body, ''].join('\n'));
		expect(result.truncated).toBe(true);
		expect(result.lines).toHaveLength(MAX_DIFF_LINES);
	});
});
