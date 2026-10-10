import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitRepository } from '../../src/git/GitRepository';
import { createEmptyRepo, createFixtureRepo, type FixtureRepo } from '../helpers/fixtureRepo';

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
		const diff = await repo.fileDiff(fixture.hashes.second, { path: 'note.md', status: 'M' });
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
		const diff = await repo.fileDiff(fixture.hashes.root, { path: 'note.md', status: 'A' });
		expect(diff.lines.map((l) => l.kind)).toEqual(['hunk', 'add']);
	});

	it('pairs both paths of a rename, which carries no content change here', async () => {
		expect(await repo.fileDiff(fixture.hashes.tip, { path: 'renamed.md', status: 'R', oldPath: 'note.md' })).toEqual({ binary: false, truncated: false, lines: [] });
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
			const diff = await sub.fileDiff(hash, { path: 'vault/b.md', status: 'R', oldPath: 'vault/a.md' });
			expect(diff.lines.filter((l) => l.kind === 'del' || l.kind === 'add').map((l) => l.text)).toEqual(['-four', '+four!']);
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
			const diff = await new GitRepository({ gitPath: 'git', cwd: tmp.dir }).fileDiff(tmp.git('rev-parse', 'HEAD'), { path: 'b.dat', status: 'A' });
			expect(diff).toEqual({ binary: true, truncated: false, lines: [] });
		} finally {
			tmp.dispose();
		}
	});
});
