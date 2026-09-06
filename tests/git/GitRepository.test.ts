import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
			const { execFileSync } = await import('node:child_process');
			execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: empty });
			expect(await new GitRepository({ gitPath: 'git', cwd: empty }).log({ skip: 0, count: 10, refs: 'auto' })).toEqual([]);
		} finally {
			rmSync(empty, { recursive: true, force: true });
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
