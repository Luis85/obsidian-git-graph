import type { ChangedFile, Commit, CommitDetails, GitReader, RefFilter, RefsSnapshot } from '../../src/git/types';

export const commit = (hash: string, parent: string | null, subject = hash, author = 'Ann'): Commit => ({
	hash,
	parents: parent === null ? [] : [parent],
	author,
	email: 'a@x',
	date: '2026-09-06T00:00:00Z',
	subject,
});

/** N linear commits c1 (newest) … cN (root). */
export const linear = (n: number): Commit[] => Array.from({ length: n }, (_, i) => commit(`c${i + 1}`, i + 1 === n ? null : `c${i + 2}`));

export class FakeReader implements GitReader {
	commits: Commit[] = [];
	refsSnapshot: RefsSnapshot = { refs: [], headHash: null, headBranch: null };
	changed = 0;
	logCalls: { skip: number; count: number; refs: RefFilter; path?: string; fallbackPath?: string }[] = [];
	statusCalls = 0;
	statusFilesCalls = 0;
	failLog: Error | null = null;
	failStatus: Error | null = null;
	pendingLogs: ((c: Commit[]) => void)[] = [];
	deferLog = false;
	detailsResolvers: (() => void)[] = [];
	detailFiles: ChangedFile[] = [];
	dirtyFiles: ChangedFile[] = [];
	deferStatus = false;
	pendingStatus: ((changed: number) => void)[] = [];
	deferStatusFiles = false;
	pendingStatusFiles: ((files: ChangedFile[]) => void)[] = [];
	/** Repository-relative paths HEAD's tree contains, for `inHead`. */
	headPaths = new Set<string>();

	log(opts: { skip: number; count: number; refs: RefFilter; path?: string; fallbackPath?: string }): Promise<Commit[]> {
		this.logCalls.push(opts);
		if (this.failLog) return Promise.reject(this.failLog);
		if (this.deferLog) return new Promise((resolve) => this.pendingLogs.push(resolve));
		return Promise.resolve(this.commits.slice(opts.skip, opts.skip + opts.count));
	}
	inHead(path: string): Promise<boolean> {
		return Promise.resolve(this.headPaths.has(path));
	}
	refs(): Promise<RefsSnapshot> {
		return Promise.resolve(this.refsSnapshot);
	}
	status(): Promise<{ changed: number }> {
		this.statusCalls++;
		if (this.failStatus) return Promise.reject(this.failStatus);
		if (this.deferStatus) return new Promise((resolve) => this.pendingStatus.push((changed) => resolve({ changed })));
		return Promise.resolve({ changed: this.changed });
	}
	statusFiles(): Promise<ChangedFile[]> {
		this.statusFilesCalls++;
		if (this.deferStatusFiles) return new Promise((resolve) => this.pendingStatusFiles.push(resolve));
		return Promise.resolve(this.dirtyFiles);
	}
	commitDetails(hash: string): Promise<CommitDetails> {
		return new Promise<void>((resolve) => this.detailsResolvers.push(resolve)).then(() => ({
			hash,
			author: 'Ann',
			email: 'a@x',
			authorDate: '2026-09-06T00:00:00Z',
			committer: 'Ann',
			commitDate: '2026-09-06T00:00:00Z',
			body: `body of ${hash}`,
			files: this.detailFiles,
		}));
	}
	resolveDetails(): void {
		for (const r of this.detailsResolvers.splice(0)) r();
	}
}
