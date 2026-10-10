import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitRepository } from '../../src/git/GitRepository';
import type { FileDiff } from '../../src/git/types';
import { createEmptyRepo, createFixtureRepo, type EmptyRepo, type FixtureRepo } from '../helpers/fixtureRepo';

const TEN = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n') + '\n';

function commitAll(tmp: EmptyRepo, message: string): void {
	tmp.git('add', '-A');
	tmp.git('commit', '-q', '-m', message);
}

/** Writes `content` to the object store and returns its blob id. */
function blob(tmp: EmptyRepo, content: string): string {
	const file = join(tmp.dir, '.blob');
	writeFileSync(file, content);
	try {
		return tmp.git('hash-object', '-w', file);
	} finally {
		rmSync(file);
	}
}

const changed = (diff: FileDiff): string[] => diff.lines.filter((l) => l.kind === 'add' || l.kind === 'del').map((l) => l.text);

let fixture: FixtureRepo;
let repo: GitRepository;
beforeAll(() => {
	fixture = createFixtureRepo();
	repo = new GitRepository({ gitPath: 'git', cwd: fixture.dir });
});
afterAll(() => fixture.dispose());

// One file's changes in one commit, as file mode shows them under an expanded commit.
describe('fileDiff', () => {
	it('diffs an edit against the parent', async () => {
		const diff = await repo.fileDiff(fixture.hashes.second, { path: 'note.md' });
		expect(diff).toEqual({
			binary: false,
			truncated: false,
			lines: [
				{ kind: 'hunk', text: '@@ -1 +1,2 @@' },
				{ kind: 'ctx', text: ' # note' },
				{ kind: 'add', text: '+more' },
			],
		});
	});

	it('shows a root commit as all additions', async () => {
		const diff = await repo.fileDiff(fixture.hashes.root, { path: 'note.md' });
		expect(diff.lines.map((l) => l.kind)).toEqual(['hunk', 'add']);
	});

	it('pairs both paths of a rename, which carries no content change here', async () => {
		expect(await repo.fileDiff(fixture.hashes.tip, { path: 'renamed.md', oldPath: 'note.md' })).toEqual({ binary: false, truncated: false, lines: [] });
	});

	it('pairs a rename that also edits the file into one diff, from a subdirectory cwd', async () => {
		const tmp = createEmptyRepo('git-graph-diff-');
		try {
			mkdirSync(join(tmp.dir, 'vault'));
			writeFileSync(join(tmp.dir, 'vault', 'a.md'), 'one\ntwo\nthree\nfour\n');
			tmp.git('add', '.');
			tmp.git('commit', '-q', '-m', 'Add');
			tmp.git('mv', 'vault/a.md', 'vault/b.md');
			writeFileSync(join(tmp.dir, 'vault', 'b.md'), 'one\ntwo\nthree\nfour!\n');
			tmp.git('commit', '-q', '-am', 'Rename and edit');
			const hash = tmp.git('rev-parse', 'HEAD');
			const sub = new GitRepository({ gitPath: 'git', cwd: join(tmp.dir, 'vault') });
			const diff = await sub.fileDiff(hash, { path: 'vault/b.md', oldPath: 'vault/a.md' });
			expect(diff.lines.filter((l) => l.kind === 'del' || l.kind === 'add').map((l) => l.text)).toEqual(['-four', '+four!']);
		} finally {
			tmp.dispose();
		}
	});

	// `--follow` reports a copy (`C092 a.md c.md`) even when the source was edited in the same
	// commit; the source's own section must not stand in for the copy's.
	it("shows a copy's changes against its source, not the source's own edit", async () => {
		const tmp = createEmptyRepo('git-graph-copy-');
		try {
			writeFileSync(join(tmp.dir, 'a.md'), TEN);
			commitAll(tmp, 'Add');
			writeFileSync(join(tmp.dir, 'a.md'), `${TEN}source\n`);
			writeFileSync(join(tmp.dir, 'c.md'), `${TEN}copy\n`);
			commitAll(tmp, 'Copy and edit both');
			const diff = await new GitRepository({ gitPath: 'git', cwd: tmp.dir }).fileDiff(tmp.git('rev-parse', 'HEAD'), { path: 'c.md', oldPath: 'a.md' });
			expect(changed(diff)).toEqual(['+copy']);
		} finally {
			tmp.dispose();
		}
	});

	// Obsidian's "duplicate note": the source is untouched, which plain `-C` never considers.
	it('pairs a copy whose source the commit left unchanged', async () => {
		const tmp = createEmptyRepo('git-graph-dup-');
		try {
			writeFileSync(join(tmp.dir, 'a.md'), TEN);
			commitAll(tmp, 'Add');
			writeFileSync(join(tmp.dir, 'c.md'), `${TEN}copy\n`);
			commitAll(tmp, 'Duplicate');
			const diff = await new GitRepository({ gitPath: 'git', cwd: tmp.dir }).fileDiff(tmp.git('rev-parse', 'HEAD'), { path: 'c.md', oldPath: 'a.md' });
			expect(changed(diff)).toEqual(['+copy']);
		} finally {
			tmp.dispose();
		}
	});

	it('shows both halves of a type change', async () => {
		const tmp = createEmptyRepo('git-graph-type-');
		try {
			writeFileSync(join(tmp.dir, 'keep.md'), 'keep\n');
			commitAll(tmp, 'Root');
			// A symlink committed straight into the index, so the test needs no symlink support.
			tmp.git('update-index', '--add', '--cacheinfo', `120000,${blob(tmp, 'target.md')},s.md`);
			tmp.git('commit', '-q', '-m', 'Link');
			tmp.git('update-index', '--cacheinfo', `100644,${blob(tmp, 'now a file\n')},s.md`);
			tmp.git('commit', '-q', '-m', 'Type change');
			const diff = await new GitRepository({ gitPath: 'git', cwd: tmp.dir }).fileDiff(tmp.git('rev-parse', 'HEAD'), { path: 's.md' });
			expect(changed(diff)).toEqual(['-target.md', '+now a file']);
		} finally {
			tmp.dispose();
		}
	});

	// Without `core.quotePath=false` git writes `"b/B\303\244r notiz.md"`, and the section would not be found.
	it('finds the section of a path with non-ASCII characters and spaces', async () => {
		const tmp = createEmptyRepo('git-graph-quote-');
		try {
			writeFileSync(join(tmp.dir, 'Bär notiz.md'), 'x\n');
			commitAll(tmp, 'Add');
			const quoting = new GitRepository({ gitPath: 'git', cwd: tmp.dir });
			expect(changed(await quoting.fileDiff(tmp.git('rev-parse', 'HEAD'), { path: 'Bär notiz.md' }))).toEqual(['+x']);
			// A quote and a tab still make git quote the name. Neither can be in a Windows file name,
			// so it goes straight into the index, past Git for Windows' NTFS path check.
			const odd = 'say "hi"\tthere.md';
			tmp.git('-c', 'core.protectNTFS=false', 'update-index', '--add', '--cacheinfo', `100644,${blob(tmp, 'y\n')},${odd}`);
			tmp.git('commit', '-q', '-m', 'Odd name');
			expect(changed(await quoting.fileDiff(tmp.git('rev-parse', 'HEAD'), { path: odd }))).toEqual(['+y']);
		} finally {
			tmp.dispose();
		}
	});

	// A handful of very long lines: under the line cap, but far more output than the pane needs.
	it('stops reading a huge diff early and reports it truncated, without a partial line', async () => {
		const tmp = createEmptyRepo('git-graph-huge-');
		try {
			const line = 'x'.repeat(400_000);
			writeFileSync(join(tmp.dir, 'huge.md'), `${Array.from({ length: 10 }, () => line).join('\n')}\n`);
			commitAll(tmp, 'Huge');
			const diff = await new GitRepository({ gitPath: 'git', cwd: tmp.dir }).fileDiff(tmp.git('rev-parse', 'HEAD'), { path: 'huge.md' });
			expect(diff.truncated).toBe(true);
			expect(diff.lines.length).toBeGreaterThan(1);
			expect(diff.lines.slice(1).every((l) => l.text === `+${line}`)).toBe(true);
		} finally {
			tmp.dispose();
		}
	});

	it('reports a binary file without lines', async () => {
		const tmp = createEmptyRepo('git-graph-bin-');
		try {
			writeFileSync(join(tmp.dir, 'b.dat'), Buffer.from([0, 1, 2, 0]));
			tmp.git('add', '.');
			tmp.git('commit', '-q', '-m', 'Binary');
			const diff = await new GitRepository({ gitPath: 'git', cwd: tmp.dir }).fileDiff(tmp.git('rev-parse', 'HEAD'), { path: 'b.dat' });
			expect(diff).toEqual({ binary: true, truncated: false, lines: [] });
		} finally {
			tmp.dispose();
		}
	});
});
