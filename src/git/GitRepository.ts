import { resolve } from 'node:path';
import { GitError } from './GitError';
import { LOG_FORMAT, REF_FORMAT, SHOW_FORMAT, countStatus, parseLog, parseNameStatus, parseRefs, parseShow, parseStatus } from './parse';
import { runGit } from './runGit';
import type { ChangedFile, Commit, CommitDetails, GitReader, RefFilter, RefsSnapshot } from './types';

export interface GitRepositoryOptions {
	gitPath: string;
	cwd: string;
}

export class GitRepository implements GitReader {
	private readonly gitPath: string;
	private readonly cwd: string;

	constructor(opts: GitRepositoryOptions) {
		this.gitPath = opts.gitPath;
		this.cwd = opts.cwd;
	}

	private run(args: readonly string[]): Promise<string> {
		return runGit(this.gitPath, this.cwd, args);
	}

	/** Like run(), but a non-zero exit resolves to null instead of throwing. ENOENT still throws. */
	private async tryRun(args: readonly string[]): Promise<string | null> {
		try {
			return await this.run(args);
		} catch (e) {
			if (e instanceof GitError && e.code === 'EXIT') return null;
			throw e;
		}
	}

	async resolveRepoRoot(): Promise<string | null> {
		const out = await this.tryRun(['rev-parse', '--show-toplevel']);
		return out === null ? null : out.trim();
	}

	async gitDir(): Promise<string> {
		return (await this.run(['rev-parse', '--absolute-git-dir'])).trim();
	}

	/**
	 * Shared git dir: same as gitDir() for a normal checkout, the main repository's .git for a
	 * linked worktree. Deliberately avoids `--path-format=absolute` (git >= 2.31 only, per
	 * git-rev-parse(1)); a relative result is resolved against `cwd` instead, which works back to
	 * git 2.5.
	 */
	async gitCommonDir(): Promise<string> {
		const out = (await this.run(['rev-parse', '--git-common-dir'])).trim();
		return resolve(this.cwd, out);
	}

	async log(opts: { skip: number; count: number; refs: RefFilter; path?: string; fallbackPaths?: readonly string[] }): Promise<Commit[]> {
		const selection = await this.refSelection(opts.refs);
		if (selection === null) return [];
		if (opts.path === undefined) {
			const out = await this.run(['log', '--topo-order', '-z', `--format=${LOG_FORMAT}`, `--skip=${opts.skip}`, `--max-count=${opts.count}`, ...selection, '--']);
			return parseLog(out);
		}
		return this.logFollowing(selection, opts.skip, opts.count, opts.path, opts.fallbackPaths ?? []);
	}

	/**
	 * `git log --follow` does not compose with `--skip`: with both set, git silently returns no
	 * commits at all — in every option order, with or without --topo-order (verified against git
	 * 2.48.1). So a path query is bounded with `--max-count=skip+count` only, and the skip is
	 * applied to the parsed result instead of to git.
	 *
	 * `path` is repository-relative but `cwd` is the vault, which for a vault nested inside a
	 * larger repository is not the repository root — a bare pathspec, resolved against cwd, would
	 * then name a file that does not exist and the history would always be empty. `:(top,…)`
	 * (pathspec magic, git >= 1.9) anchors it to the root instead, and `literal` disables glob
	 * interpretation so a note like `Meeting [2026].md` is not read as a character class.
	 *
	 * `fallbackPaths` covers the window in which Obsidian has already renamed the open note but
	 * the rename is not committed: no commit names the new path yet, so `--follow` on it is
	 * empty and only an earlier path is one git knows. They are tried newest first, because a
	 * rename committed earlier in the chain makes the newer path the one whose history is
	 * complete — `--follow` from an older path stops at that committed rename and misses
	 * everything recorded under the newer one. The choice is made on the unsliced result, so it
	 * does not depend on which page is being fetched — a path with any history at all wins, even
	 * when this page of it happens to be past its last commit.
	 */
	private async logFollowing(selection: string[], skip: number, count: number, path: string, fallbackPaths: readonly string[]): Promise<Commit[]> {
		for (const candidate of [path, ...fallbackPaths]) {
			// Sequential on purpose: each path is only queried because the previous one was empty.
			const commits = await this.runFollow(selection, skip + count, candidate);
			if (commits.length > 0) return commits.slice(skip);
		}
		return [];
	}

	private async runFollow(selection: string[], max: number, path: string): Promise<Commit[]> {
		const out = await this.run(['log', '--topo-order', '-z', `--format=${LOG_FORMAT}`, `--max-count=${max}`, ...selection, '--follow', '--', `:(top,literal)${path}`]);
		return parseLog(out);
	}

	/**
	 * Null when there is nothing to list: for 'auto' that means HEAD has no commits yet (an
	 * unborn branch); `git log HEAD` would fail in that case, so the precheck below short-circuits
	 * before ever running it. For 'all' the precheck is on HEAD's existence specifically, but
	 * `git log --all` doesn't need HEAD to resolve — it only needs *some* ref to exist — so 'all'
	 * uses its own check (any ref at all) instead of piggybacking on the HEAD one.
	 */
	private async refSelection(filter: RefFilter): Promise<string[] | null> {
		if (filter === 'all') {
			const anyRef = await this.tryRun(['for-each-ref', '--count=1', '--format=%(objectname)']);
			return anyRef !== null && anyRef.trim().length > 0 ? ['--all'] : null;
		}
		if ((await this.tryRun(['rev-parse', '--verify', '-q', 'HEAD'])) === null) return null;
		const selection = ['HEAD'];
		const upstream = await this.tryRun(['rev-parse', '--symbolic-full-name', '@{upstream}']);
		if (upstream !== null && upstream.trim().length > 0) selection.push(upstream.trim());
		const defaultRemote = await this.defaultRemoteRef();
		if (defaultRemote !== null) selection.push(defaultRemote);
		return [...new Set(selection)];
	}

	/**
	 * The ref `origin/HEAD` points at, or null when there is none or it dangles: `symbolic-ref`
	 * happily reports a target that no longer exists (a renamed or pruned default branch), and
	 * handing that to `git log` fails the whole listing with "bad revision".
	 */
	private async defaultRemoteRef(): Promise<string | null> {
		const target = (await this.tryRun(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']))?.trim() ?? '';
		if (target.length === 0) return null;
		const resolves = await this.tryRun(['rev-parse', '--verify', '-q', `${target}^{commit}`]);
		return resolves === null ? null : target;
	}

	async refs(): Promise<RefsSnapshot> {
		const [refsOut, headHash, headBranch] = await Promise.all([
			this.run(['for-each-ref', `--format=${REF_FORMAT}`]),
			this.tryRun(['rev-parse', '--verify', '-q', 'HEAD']),
			this.tryRun(['symbolic-ref', '-q', '--short', 'HEAD']),
		]);
		return {
			refs: parseRefs(refsOut),
			headHash: headHash === null ? null : headHash.trim(),
			headBranch: headBranch === null ? null : headBranch.trim(),
		};
	}

	/**
	 * Both status reads are scoped to `cwd` (the vault) with a `.` pathspec: for a vault nested
	 * inside a larger repository, the plugin only sees vault file events, so counting sibling
	 * paths would leave the row stale. For a vault at the repository root `.` is everything.
	 */
	async status(): Promise<{ changed: number }> {
		const out = await this.run(['status', '--porcelain=v1', '--untracked-files=all', '--', '.']);
		return { changed: countStatus(out) };
	}

	async statusFiles(): Promise<ChangedFile[]> {
		return parseStatus(await this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']));
	}

	async commitDetails(hash: string): Promise<CommitDetails> {
		const [showOut, filesOut] = await Promise.all([
			this.run(['show', '--no-patch', `--format=${SHOW_FORMAT}`, hash, '--']),
			this.run(['diff-tree', '--no-commit-id', '-r', '--name-status', '-z', '-M', '--root', '-m', '--first-parent', hash, '--']),
		]);
		return { ...parseShow(showOut), files: parseNameStatus(filesOut) };
	}
}
