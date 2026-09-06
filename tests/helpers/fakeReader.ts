import type { Commit, CommitDetails, GitReader, RefFilter, RefsSnapshot } from '../../src/git/types';

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
	logCalls: { skip: number; count: number; refs: RefFilter }[] = [];
	statusCalls = 0;
	failLog: Error | null = null;
	pendingLogs: ((c: Commit[]) => void)[] = [];
	deferLog = false;
	detailsResolvers: (() => void)[] = [];

	log(opts: { skip: number; count: number; refs: RefFilter }): Promise<Commit[]> {
		this.logCalls.push(opts);
		if (this.failLog) return Promise.reject(this.failLog);
		if (this.deferLog) return new Promise((resolve) => this.pendingLogs.push(resolve));
		return Promise.resolve(this.commits.slice(opts.skip, opts.skip + opts.count));
	}
	refs(): Promise<RefsSnapshot> {
		return Promise.resolve(this.refsSnapshot);
	}
	status(): Promise<{ changed: number }> {
		this.statusCalls++;
		return Promise.resolve({ changed: this.changed });
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
			files: [],
		}));
	}
	resolveDetails(): void {
		for (const r of this.detailsResolvers.splice(0)) r();
	}
}
