import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitRepository } from '../../src/git/GitRepository';
import { createEmptyRepo, type EmptyRepo } from '../helpers/fixtureRepo';

/**
 * root (a.md, b.md) → main edits a.md, side edits b.md → main merges side. Against its first
 * parent the merge changed only b.md; a.md differs from its second parent only, which is what
 * `diff-tree -m` also lists.
 */
let tmp: EmptyRepo;
let repo: GitRepository;
let merge: string;
beforeAll(() => {
	tmp = createEmptyRepo('git-graph-merge-');
	writeFileSync(join(tmp.dir, 'a.md'), 'a\n');
	writeFileSync(join(tmp.dir, 'b.md'), 'b\n');
	tmp.git('add', '.');
	tmp.git('commit', '-q', '-m', 'Root');
	tmp.git('checkout', '-q', '-b', 'side');
	writeFileSync(join(tmp.dir, 'b.md'), 'b side\n');
	tmp.git('commit', '-q', '-am', 'Side');
	tmp.git('checkout', '-q', 'main');
	writeFileSync(join(tmp.dir, 'a.md'), 'a main\n');
	tmp.git('commit', '-q', '-am', 'Main');
	tmp.git('merge', '-q', '--no-ff', '-m', 'Merge side', 'side');
	merge = tmp.git('rev-parse', 'HEAD');
	repo = new GitRepository({ gitPath: 'git', cwd: tmp.dir });
});
afterAll(() => tmp.dispose());

describe('a merge, read against its first parent only', () => {
	it('lists only the files the merge brought in', async () => {
		expect((await repo.commitDetails(merge)).files).toEqual([{ path: 'b.md', status: 'M' }]);
	});

	it('diffs a file the merge brought in', async () => {
		const diff = await repo.fileDiff(merge, { path: 'b.md' });
		expect(diff.lines.map((l) => l.text)).toEqual(['@@ -1 +1 @@', '-b', '+b side']);
	});

	it('shows nothing for a file that differs from the second parent only', async () => {
		expect(await repo.fileDiff(merge, { path: 'a.md' })).toEqual({ binary: false, truncated: false, lines: [] });
	});
});
