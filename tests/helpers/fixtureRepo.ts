import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURE_ENV = {
	GIT_AUTHOR_NAME: 'Ann Author',
	GIT_AUTHOR_EMAIL: 'ann@example.com',
	GIT_COMMITTER_NAME: 'Cara Committer',
	GIT_COMMITTER_EMAIL: 'cara@example.com',
	GIT_AUTHOR_DATE: '2026-09-01T10:00:00+02:00',
	GIT_COMMITTER_DATE: '2026-09-01T10:00:00+02:00',
};

export interface EmptyRepo {
	dir: string;
	git: (...args: string[]) => string;
	dispose(): void;
}

/** A fresh `git init -b main` in a canonical temp dir, with the fixture's deterministic identity and dates. */
export function createEmptyRepo(prefix = 'git-graph-tmp-'): EmptyRepo {
	const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
	const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...FIXTURE_ENV } }).trim();
	git('init', '-q', '-b', 'main');
	git('config', 'core.autocrlf', 'false');
	return { dir, git, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface FixtureRepo {
	dir: string;
	hashes: Record<'root' | 'second' | 'feature' | 'merge' | 'tip', string>;
	dispose(): void;
}

/**
 * History (newest first, as `git log --topo-order --all` lists it):
 *   tip     — on main, after the merge; renames note.md → renamed.md, tagged v1 (annotated)
 *   merge   — merge of feature into main
 *   feature — on branch feature, adds feature.md
 *   second  — on main, edits note.md
 *   root    — adds note.md
 * A bare "origin" remote is added with main pushed, so origin/main and origin/HEAD exist
 * and main has an upstream.
 */
export function createFixtureRepo(): FixtureRepo {
	const { dir, git, dispose } = createEmptyRepo('git-graph-fixture-');
	writeFileSync(join(dir, 'note.md'), '# note\n');
	git('add', '.');
	git('commit', '-q', '-m', 'Root commit');
	const root = git('rev-parse', 'HEAD');

	writeFileSync(join(dir, 'note.md'), '# note\nmore\n');
	git('commit', '-q', '-am', 'Second commit');
	const second = git('rev-parse', 'HEAD');

	git('checkout', '-q', '-b', 'feature');
	writeFileSync(join(dir, 'feature.md'), 'feature\n');
	git('add', '.');
	git('commit', '-q', '-m', 'Feature commit');
	const feature = git('rev-parse', 'HEAD');

	git('checkout', '-q', 'main');
	git('merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature');
	const merge = git('rev-parse', 'HEAD');

	git('mv', 'note.md', 'renamed.md');
	git('commit', '-q', '-m', 'Tip commit\n\nWith a body.');
	const tip = git('rev-parse', 'HEAD');
	git('tag', '-a', 'v1', '-m', 'version 1');

	const remote = realpathSync.native(mkdtempSync(join(tmpdir(), 'git-graph-remote-')));
	execFileSync('git', ['init', '-q', '--bare', remote]);
	git('remote', 'add', 'origin', remote);
	git('push', '-q', '-u', 'origin', 'main');
	git('remote', 'set-head', 'origin', 'main');

	return {
		dir,
		hashes: { root, second, feature, merge, tip },
		dispose: () => {
			dispose();
			rmSync(remote, { recursive: true, force: true });
		},
	};
}
