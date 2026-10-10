import { describe, expect, it } from 'vitest';
import { MAX_DIFF_LINES, parseFileDiff } from '../../src/git/diff';

const A_MD = { path: 'a.md' };
const texts = (out: string, file: { path: string; oldPath?: string }): string[] => parseFileDiff(out, file).lines.map((l) => l.text);

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
		expect(parseFileDiff(out, A_MD)).toEqual({
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
		const out = ['diff --git a/a.md b/a.md', '--- a/a.md', '+++ b/a.md', '@@ -1 +1 @@', '--- a rule', '+++ plus', ''].join('\n');
		expect(parseFileDiff(out, A_MD).lines.slice(1)).toEqual([
			{ kind: 'del', text: '--- a rule' },
			{ kind: 'add', text: '+++ plus' },
		]);
	});

	// A copy is asked for with its source named too, so the source's own edit in the same commit
	// comes first in the output; only the section that writes the copy belongs to it.
	it('reads the section that writes the file, not the copy source before it', () => {
		const out = [
			'diff --git a/a.md b/a.md',
			'@@ -1 +1 @@',
			'-x',
			'+source edit',
			'diff --git a/a.md b/c.md',
			'similarity index 92%',
			'copy from a.md',
			'copy to c.md',
			'@@ -1 +1 @@',
			'-x',
			'+copy edit',
			'',
		].join('\n');
		expect(texts(out, { path: 'c.md', oldPath: 'a.md' })).toEqual(['@@ -1 +1 @@', '-x', '+copy edit']);
	});

	// A type change (symlink to file, say) is written as a deletion and an addition of one path.
	it('reads every section of the file, resetting the hunk state at each one', () => {
		const out = [
			'diff --git a/s.md b/s.md',
			'deleted file mode 120000',
			'@@ -1 +0,0 @@',
			'-target.md',
			'\\ No newline at end of file',
			'diff --git a/s.md b/s.md',
			'new file mode 100644',
			'--- /dev/null',
			'+++ b/s.md',
			'@@ -0,0 +1 @@',
			'+now a file',
			'',
		].join('\n');
		expect(texts(out, { path: 's.md' })).toEqual(['@@ -1 +0,0 @@', '-target.md', '\\ No newline at end of file', '@@ -0,0 +1 @@', '+now a file']);
	});

	it('matches a header git had to quote', () => {
		const out = ['diff --git "a/say \\"hi\\"\\there.md" "b/say \\"hi\\"\\there.md"', '@@ -0,0 +1 @@', '+x', ''].join('\n');
		expect(texts(out, { path: 'say "hi"\there.md' })).toEqual(['@@ -0,0 +1 @@', '+x']);
		const control = ['diff --git "a/odd\\a\\001\\177.md" "b/odd\\a\\001\\177.md"', '@@ -0,0 +1 @@', '+y', ''].join('\n');
		expect(texts(control, { path: 'odd\x07\x01\x7f.md' })).toEqual(['@@ -0,0 +1 @@', '+y']);
	});

	it('reports a binary file', () => {
		const out = ['diff --git a/b.dat b/b.dat', 'new file mode 100644', 'Binary files /dev/null and b/b.dat differ', ''].join('\n');
		expect(parseFileDiff(out, { path: 'b.dat' })).toEqual({ binary: true, truncated: false, lines: [] });
	});

	it('is empty for a rename without content changes, and for no output at all', () => {
		const rename = 'diff --git a/a.md b/b.md\nsimilarity index 100%\nrename from a.md\nrename to b.md\n';
		expect(parseFileDiff(rename, { path: 'b.md', oldPath: 'a.md' })).toEqual({ binary: false, truncated: false, lines: [] });
		expect(parseFileDiff('', A_MD)).toEqual({ binary: false, truncated: false, lines: [] });
	});

	it('caps a very large diff and says so', () => {
		const body = Array.from({ length: MAX_DIFF_LINES + 10 }, (_, i) => `+line ${i}`);
		const result = parseFileDiff(['diff --git a/a.md b/a.md', '@@ -0,0 +1 @@', ...body, ''].join('\n'), A_MD);
		expect(result.truncated).toBe(true);
		expect(result.lines).toHaveLength(MAX_DIFF_LINES);
	});
});
