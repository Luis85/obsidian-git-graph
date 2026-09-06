import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitRepository } from '../../src/git/GitRepository';
import { createFixtureRepo, type FixtureRepo } from '../helpers/fixtureRepo';

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

	it('returns [] for a repository with no commits', async () => {
		const empty = mkdtempSync(join(tmpdir(), 'git-graph-empty-'));
		try {
			execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: empty });
			const emptyRepo = new GitRepository({ gitPath: 'git', cwd: empty });
			expect(await emptyRepo.log({ skip: 0, count: 10, refs: 'auto' })).toEqual([]);
			expect(await emptyRepo.log({ skip: 0, count: 10, refs: 'all' })).toEqual([]);
		} finally {
			rmSync(empty, { recursive: true, force: true });
		}
	});

	it('refs=all still returns real commits when HEAD is an unborn/orphan branch', async () => {
		const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'git-graph-orphan-')));
		try {
			const git = (...args: string[]): string =>
				execFileSync('git', args, {
					cwd: dir,
					encoding: 'utf8',
					env: {
						...process.env,
						GIT_AUTHOR_NAME: 'Ann Author',
						GIT_AUTHOR_EMAIL: 'ann@example.com',
						GIT_COMMITTER_NAME: 'Cara Committer',
						GIT_COMMITTER_EMAIL: 'cara@example.com',
						GIT_AUTHOR_DATE: '2026-09-01T10:00:00+02:00',
						GIT_COMMITTER_DATE: '2026-09-01T10:00:00+02:00',
					},
				}).trim();

			git('init', '-q', '-b', 'main');
			writeFileSync(join(dir, 'note.md'), '# note\n');
			git('add', '.');
			git('commit', '-q', '-m', 'Root commit');
			const root = git('rev-parse', 'HEAD');

			git('checkout', '-q', '--orphan', 'other');

			const orphanRepo = new GitRepository({ gitPath: 'git', cwd: dir });
			const all = await orphanRepo.log({ skip: 0, count: 10, refs: 'all' });
			expect(all.map((c) => c.hash)).toEqual([root]);

			const auto = await orphanRepo.log({ skip: 0, count: 10, refs: 'auto' });
			expect(auto).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
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
