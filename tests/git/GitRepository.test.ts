import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

describe('resolveRepoRoot', () => {
	it('returns the toplevel for the repo and for a subdirectory', async () => {
		const root = await repo.resolveRepoRoot();
		expect(root?.replaceAll('\\', '/').toLowerCase()).toBe(fixture.dir.replaceAll('\\', '/').toLowerCase());
		const sub = join(fixture.dir, 'sub');
		mkdirSync(sub);
		writeFileSync(join(fixture.dir, 'x.txt'), 'x');
		const subRepo = new GitRepository({ gitPath: 'git', cwd: sub });
		expect(await subRepo.resolveRepoRoot()).toBe(root);
	});

	it('returns null outside a repository', async () => {
		const outside = mkdtempSync(join(tmpdir(), 'git-graph-outside-'));
		try {
			expect(await new GitRepository({ gitPath: 'git', cwd: outside }).resolveRepoRoot()).toBeNull();
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it('rethrows when git is missing', async () => {
		await expect(new GitRepository({ gitPath: 'no-such-git-binary', cwd: fixture.dir }).resolveRepoRoot()).rejects.toMatchObject({ code: 'ENOENT' });
	});
});

describe('gitDir', () => {
	it('is the absolute .git directory', async () => {
		expect((await repo.gitDir()).replaceAll('\\', '/').toLowerCase()).toBe(join(fixture.dir, '.git').replaceAll('\\', '/').toLowerCase());
	});

	it('reports the common dir as absolute from a subdirectory cwd, without needing --path-format', async () => {
		const sub = join(fixture.dir, 'sub');
		mkdirSync(sub, { recursive: true });
		const subRepo = new GitRepository({ gitPath: 'git', cwd: sub });
		const common = (await subRepo.gitCommonDir()).replaceAll('\\', '/').toLowerCase();
		expect(common).toBe(join(fixture.dir, '.git').replaceAll('\\', '/').toLowerCase());
	});

	it('reports the common dir, which differs for a linked worktree', async () => {
		expect((await repo.gitCommonDir()).replaceAll('\\', '/').toLowerCase()).toBe((await repo.gitDir()).replaceAll('\\', '/').toLowerCase());
		const wt = realpathSync.native(mkdtempSync(join(tmpdir(), 'git-graph-wt-')));
		rmSync(wt, { recursive: true, force: true });
		try {
			execFileSync('git', ['worktree', 'add', '-q', wt, 'feature'], { cwd: fixture.dir });
			const linked = new GitRepository({ gitPath: 'git', cwd: wt });
			const gitDir = (await linked.gitDir()).replaceAll('\\', '/').toLowerCase();
			const common = (await linked.gitCommonDir()).replaceAll('\\', '/').toLowerCase();
			expect(gitDir).toContain('/.git/worktrees/');
			expect(common).toBe(join(fixture.dir, '.git').replaceAll('\\', '/').toLowerCase());
		} finally {
			try {
				execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: fixture.dir });
			} finally {
				rmSync(wt, { recursive: true, force: true });
			}
		}
	});
});

describe('log', () => {
	it('lists all five commits in topo order with parents, for refs=all', async () => {
		const commits = await repo.log({ skip: 0, count: 200, refs: 'all' });
		expect(commits.map((c) => c.hash)).toEqual([fixture.hashes.tip, fixture.hashes.merge, fixture.hashes.feature, fixture.hashes.second, fixture.hashes.root]);
		expect(commits[1]?.parents).toEqual([fixture.hashes.second, fixture.hashes.feature]);
		expect(commits[4]?.parents).toEqual([]);
		expect(commits[0]).toMatchObject({ author: 'Ann Author', email: 'ann@example.com', subject: 'Tip commit' });
		expect(commits[0]?.date).toBe('2026-09-01T10:00:00+02:00');
	});

	it('pages with skip and count', async () => {
		const page = await repo.log({ skip: 2, count: 2, refs: 'all' });
		expect(page.map((c) => c.hash)).toEqual([fixture.hashes.feature, fixture.hashes.second]);
	});

	it('refs=auto covers HEAD, its upstream and origin/HEAD', async () => {
		const commits = await repo.log({ skip: 0, count: 200, refs: 'auto' });
		expect(commits.map((c) => c.hash)).toContain(fixture.hashes.tip);
		expect(commits).toHaveLength(5);
	});

	it('refs=auto still lists HEAD history when origin/HEAD points at a pruned branch', async () => {
		const tmp = createFixtureRepo();
		try {
			// A symbolic ref may point at a ref that no longer exists (the remote's default branch
			// was renamed, or the tracking ref was pruned); git log must not be asked for it.
			execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/gone'], { cwd: tmp.dir });
			const dangling = new GitRepository({ gitPath: 'git', cwd: tmp.dir });
			const commits = await dangling.log({ skip: 0, count: 200, refs: 'auto' });
			expect(commits.map((c) => c.hash)).toContain(tmp.hashes.tip);
			expect(commits).toHaveLength(5);
		} finally {
			tmp.dispose();
		}
	});

	it('returns [] for a repository with no commits', async () => {
		const empty = createEmptyRepo('git-graph-empty-');
		try {
			const emptyRepo = new GitRepository({ gitPath: 'git', cwd: empty.dir });
			expect(await emptyRepo.log({ skip: 0, count: 10, refs: 'auto' })).toEqual([]);
			expect(await emptyRepo.log({ skip: 0, count: 10, refs: 'all' })).toEqual([]);
		} finally {
			empty.dispose();
		}
	});

	it('refs=all still returns real commits when HEAD is an unborn/orphan branch', async () => {
		const tmp = createEmptyRepo('git-graph-orphan-');
		try {
			writeFileSync(join(tmp.dir, 'note.md'), '# note\n');
			tmp.git('add', '.');
			tmp.git('commit', '-q', '-m', 'Root commit');
			const root = tmp.git('rev-parse', 'HEAD');

			tmp.git('checkout', '-q', '--orphan', 'other');

			const orphanRepo = new GitRepository({ gitPath: 'git', cwd: tmp.dir });
			const all = await orphanRepo.log({ skip: 0, count: 10, refs: 'all' });
			expect(all.map((c) => c.hash)).toEqual([root]);

			const auto = await orphanRepo.log({ skip: 0, count: 10, refs: 'auto' });
			expect(auto).toEqual([]);
		} finally {
			tmp.dispose();
		}
	});
});

describe('log with a path', () => {
	it('follows a rename across history', async () => {
		const commits = await repo.log({ skip: 0, count: 200, refs: 'all', path: 'renamed.md' });
		expect(commits.map((c) => c.hash)).toEqual([fixture.hashes.tip, fixture.hashes.second, fixture.hashes.root]);
	});

	it('lists commits that touch a file added on a branch', async () => {
		const commits = await repo.log({ skip: 0, count: 200, refs: 'all', path: 'feature.md' });
		expect(commits.map((c) => c.hash)).toEqual([fixture.hashes.feature]);
	});

	it('returns [] for a path that never existed', async () => {
		expect(await repo.log({ skip: 0, count: 200, refs: 'all', path: 'no-such.md' })).toEqual([]);
	});

	it('pages with skip and count for a path', async () => {
		const page = await repo.log({ skip: 1, count: 1, refs: 'all', path: 'renamed.md' });
		expect(page.map((c) => c.hash)).toEqual([fixture.hashes.second]);
	});

	it('omitting path still yields the full history', async () => {
		const commits = await repo.log({ skip: 0, count: 200, refs: 'all' });
		expect(commits).toHaveLength(5);
	});

	// The path is repository-relative, but git resolves a bare pathspec against cwd. For a vault
	// nested inside a larger repository the two differ, so the pathspec has to be anchored to the
	// repository root or the history comes back empty.
	it('resolves the path against the repository root, not cwd, when cwd is a subdirectory', async () => {
		const sub = join(fixture.dir, 'sub');
		mkdirSync(sub, { recursive: true });
		const subRepo = new GitRepository({ gitPath: 'git', cwd: sub });
		const commits = await subRepo.log({ skip: 0, count: 200, refs: 'all', path: 'renamed.md' });
		expect(commits.map((c) => c.hash)).toEqual([fixture.hashes.tip, fixture.hashes.second, fixture.hashes.root]);
	});

	// A note named `Meeting [2026].md` is a character class unless the pathspec says `literal`:
	// `[2026]` also matches the `2` of the sibling below, so its commits leak into the history.
	it('treats glob metacharacters in the path literally', async () => {
		const tmp = createEmptyRepo('git-graph-glob-');
		try {
			mkdirSync(join(tmp.dir, 'notes'));
			writeFileSync(join(tmp.dir, 'notes', 'Meeting [2026].md'), 'meeting\n');
			writeFileSync(join(tmp.dir, 'notes', 'Meeting 2.md'), 'sibling\n');
			tmp.git('add', '.');
			tmp.git('commit', '-q', '-m', 'Add both notes');
			const both = tmp.git('rev-parse', 'HEAD');
			writeFileSync(join(tmp.dir, 'notes', 'Meeting 2.md'), 'sibling edited\n');
			tmp.git('commit', '-q', '-am', 'Edit only the sibling');
			const bracketed = new GitRepository({ gitPath: 'git', cwd: tmp.dir });
			const commits = await bracketed.log({ skip: 0, count: 200, refs: 'all', path: 'notes/Meeting [2026].md' });
			expect(commits.map((c) => c.hash)).toEqual([both]);
		} finally {
			tmp.dispose();
		}
	});
});

describe('refs', () => {
	it('reports branches, the remote, the dereferenced tag and HEAD', async () => {
		const snapshot = await repo.refs();
		expect(snapshot.headHash).toBe(fixture.hashes.tip);
		expect(snapshot.headBranch).toBe('main');
		expect(snapshot.refs).toEqual(
			expect.arrayContaining([
				{ hash: fixture.hashes.tip, name: 'main', kind: 'branch', isHead: true, upstream: 'origin/main' },
				{ hash: fixture.hashes.feature, name: 'feature', kind: 'branch', isHead: false },
				{ hash: fixture.hashes.tip, name: 'origin/main', kind: 'remote', isHead: false },
				{ hash: fixture.hashes.tip, name: 'v1', kind: 'tag', isHead: false },
			]),
		);
		expect(snapshot.refs.find((r) => r.name === 'origin/HEAD')).toBeUndefined();
	});
});

describe('status', () => {
	it('counts changed and untracked files', async () => {
		expect((await repo.status()).changed).toBe(1); // x.txt written above
		writeFileSync(join(fixture.dir, 'renamed.md'), 'changed\n');
		expect((await repo.status()).changed).toBe(2);
	});

	it('lists the changed files with their status', async () => {
		const files = await repo.statusFiles();
		expect(files).toEqual(expect.arrayContaining([{ path: 'x.txt', status: 'A' }, { path: 'renamed.md', status: 'M' }]));
	});

	it('counts and lists only the files under cwd when cwd is a subdirectory of the repository', async () => {
		const tmp = createFixtureRepo();
		try {
			mkdirSync(join(tmp.dir, 'sub'));
			writeFileSync(join(tmp.dir, 'sub', 'inside.md'), 'inside\n');
			writeFileSync(join(tmp.dir, 'outside.md'), 'outside\n');
			const subRepo = new GitRepository({ gitPath: 'git', cwd: join(tmp.dir, 'sub') });
			expect(await subRepo.status()).toEqual({ changed: 1 });
			expect(await subRepo.statusFiles()).toEqual([{ path: 'sub/inside.md', status: 'A' }]);
		} finally {
			tmp.dispose();
		}
	});
});

describe('statusFiles', () => {
	it('reports a staged rename with its old path, from a fresh repository', async () => {
		const tmp = createEmptyRepo('git-graph-rename-');
		try {
			writeFileSync(join(tmp.dir, 'old.md'), 'x\n');
			tmp.git('add', '.');
			tmp.git('commit', '-q', '-m', 'Add old.md');
			tmp.git('mv', 'old.md', 'new.md');
			const fresh = new GitRepository({ gitPath: 'git', cwd: tmp.dir });
			expect(await fresh.statusFiles()).toEqual([{ path: 'new.md', status: 'R', oldPath: 'old.md' }]);
			expect((await fresh.status()).changed).toBe(1);
		} finally {
			tmp.dispose();
		}
	});
});

describe('log with a file named HEAD present', () => {
	it('still resolves refs=auto and reads commit details when a "HEAD" file exists in cwd', async () => {
		const headFile = join(fixture.dir, 'HEAD');
		writeFileSync(headFile, 'not a ref\n');
		try {
			const commits = await repo.log({ skip: 0, count: 200, refs: 'auto' });
			expect(commits).toHaveLength(5);
			expect(await repo.commitDetails(fixture.hashes.tip)).toMatchObject({ hash: fixture.hashes.tip });
		} finally {
			rmSync(headFile, { force: true });
		}
	});
});

describe('commitDetails', () => {
	it('reads body, committer and the rename', async () => {
		const details = await repo.commitDetails(fixture.hashes.tip);
		expect(details).toMatchObject({ hash: fixture.hashes.tip, author: 'Ann Author', committer: 'Cara Committer', body: 'Tip commit\n\nWith a body.' });
		expect(details.files).toEqual([{ path: 'renamed.md', status: 'R', oldPath: 'note.md' }]);
	});

	it('lists a merge commit against its first parent', async () => {
		const details = await repo.commitDetails(fixture.hashes.merge);
		expect(details.files).toEqual([{ path: 'feature.md', status: 'A' }]);
	});

	it('lists a root commit', async () => {
		const details = await repo.commitDetails(fixture.hashes.root);
		expect(details.files).toEqual([{ path: 'note.md', status: 'A' }]);
	});
});
