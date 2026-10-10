import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitRepository } from '../../src/git/GitRepository';
import { createEmptyRepo } from '../helpers/fixtureRepo';

// The per-commit file that `log` with a path records, which `fileDiff` is then asked for.
describe('log with a path, per-commit file', () => {
	// With `diff.relative` set, `--name-status` would print `a.md` for a vault nested at `vault/`,
	// and a `:(top,literal)a.md` pathspec built from it names nothing.
	it('stays repository-relative under diff.relative, so the diff is found', async () => {
		const tmp = createEmptyRepo('git-graph-relative-');
		try {
			mkdirSync(join(tmp.dir, 'vault'));
			writeFileSync(join(tmp.dir, 'vault', 'a.md'), 'a\n');
			tmp.git('add', '.');
			tmp.git('commit', '-q', '-m', 'Add');
			writeFileSync(join(tmp.dir, 'vault', 'a.md'), 'a\nb\n');
			tmp.git('commit', '-q', '-am', 'Edit');
			tmp.git('config', 'diff.relative', 'true');
			const vault = new GitRepository({ gitPath: 'git', cwd: join(tmp.dir, 'vault') });
			const commits = await vault.log({ skip: 0, count: 10, refs: 'all', path: 'vault/a.md' });
			expect(commits.map((c) => c.file)).toEqual([
				{ path: 'vault/a.md', status: 'M' },
				{ path: 'vault/a.md', status: 'A' },
			]);
			const [edit] = commits;
			if (edit?.file === undefined) throw new Error('no file on the edit commit');
			expect((await vault.fileDiff(edit.hash, edit.file)).lines.map((l) => l.text)).toEqual(['@@ -1 +1,2 @@', ' a', '+b']);
		} finally {
			tmp.dispose();
		}
	});

	// A commit that replaced a directory `Docs/` with a file `Docs` lists several entries under
	// the followed path; none of them may be read as a commit of its own.
	it('keeps one commit per commit when a commit lists several entries', async () => {
		const tmp = createEmptyRepo('git-graph-dirfile-');
		try {
			mkdirSync(join(tmp.dir, 'Docs'));
			writeFileSync(join(tmp.dir, 'Docs', 'a.md'), 'a\n');
			writeFileSync(join(tmp.dir, 'Docs', 'b.md'), 'b\n');
			tmp.git('add', '.');
			tmp.git('commit', '-q', '-m', 'Add Docs/');
			const root = tmp.git('rev-parse', 'HEAD');
			rmSync(join(tmp.dir, 'Docs'), { recursive: true });
			writeFileSync(join(tmp.dir, 'Docs'), 'now a file\n');
			tmp.git('add', '-A');
			tmp.git('commit', '-q', '-m', 'Swap');
			const swap = tmp.git('rev-parse', 'HEAD');
			const commits = await new GitRepository({ gitPath: 'git', cwd: tmp.dir }).log({ skip: 0, count: 10, refs: 'all', path: 'Docs' });
			expect(commits.map((c) => c.hash)).toEqual([swap, root]);
			expect(commits[0]?.file).toEqual({ path: 'Docs', status: 'A' });
		} finally {
			tmp.dispose();
		}
	});
});
