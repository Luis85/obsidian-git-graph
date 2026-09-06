import { describe, expect, it } from 'vitest';
import type { Commit, CommitDetails, GitReader, RefFilter, RefsSnapshot } from '../../src/git/types';
import { createGraphStore } from '../../src/view/store';

const commit = (hash: string, parent: string | null, subject = hash, author = 'Ann'): Commit => ({
	hash,
	parents: parent === null ? [] : [parent],
	author,
	email: 'a@x',
	date: '2026-09-06T00:00:00Z',
	subject,
});

/** N linear commits c1 (newest) … cN (root). */
const linear = (n: number): Commit[] => Array.from({ length: n }, (_, i) => commit(`c${i + 1}`, i + 1 === n ? null : `c${i + 2}`));

class FakeReader implements GitReader {
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

const settings = (overrides: Partial<{ refFilter: RefFilter; pageSize: number; showDirtyRow: boolean }> = {}) => () => ({
	refFilter: 'auto' as RefFilter,
	pageSize: 3,
	showDirtyRow: true,
	...overrides,
});

describe('createGraphStore', () => {
	it('load fills rows, refs, head and dirty count; hasMore is false for a short history', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		reader.refsSnapshot = { refs: [{ hash: 'c1', name: 'main', kind: 'branch', isHead: true }], headHash: 'c1', headBranch: 'main' };
		reader.changed = 4;
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		expect(store.state.loading).toBe(false);
		expect(store.state.rows.map((r) => r.hash)).toEqual(['c1', 'c2']);
		expect(store.state.refsByHash.get('c1')?.[0]?.name).toBe('main');
		expect(store.state.headHash).toBe('c1');
		expect(store.state.dirtyCount).toBe(4);
		expect(store.state.hasMore).toBe(false);
		expect(reader.logCalls).toEqual([{ skip: 0, count: 3, refs: 'auto' }]);
	});

	it('does not ask for status when the dirty row is off', async () => {
		const reader = new FakeReader();
		reader.commits = linear(1);
		const store = createGraphStore({ reader, settings: settings({ showDirtyRow: false }) });
		await store.load();
		expect(reader.statusCalls).toBe(0);
		expect(store.state.dirtyCount).toBe(0);
	});

	it('loadMore appends the next page with continuous lanes, and reload keeps the depth in one call', async () => {
		const reader = new FakeReader();
		reader.commits = linear(7);
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		expect(store.state.hasMore).toBe(true);
		await store.loadMore();
		expect(reader.logCalls[1]).toEqual({ skip: 3, count: 3, refs: 'auto' });
		expect(store.state.rows.map((r) => r.hash)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
		expect(store.state.rows.every((r) => r.lane === 0)).toBe(true);
		expect(store.state.hasMore).toBe(true);
		await store.load();
		expect(reader.logCalls[2]).toEqual({ skip: 0, count: 6, refs: 'auto' });
		expect(store.state.rows).toHaveLength(6);
		await store.loadMore();
		expect(store.state.rows).toHaveLength(7);
		expect(store.state.hasMore).toBe(false);
	});

	it('clears loadingMore when a reload completes and supersedes an in-flight loadMore', async () => {
		const reader = new FakeReader();
		reader.commits = linear(7);
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		reader.deferLog = true;
		const more = store.loadMore();
		const reload = store.load();
		reader.pendingLogs[1]?.(linear(7).slice(0, 3));
		await reload;
		reader.pendingLogs[0]?.(linear(7).slice(3, 6));
		await more;
		expect(store.state.rows).toHaveLength(3);
		expect(store.state.loadingMore).toBe(false);
		reader.deferLog = false;
		await store.loadMore();
		expect(store.state.rows).toHaveLength(6);
	});

	it('keeps the previous rows and reports the error when a reload fails', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		reader.failLog = new Error('fatal: bad object');
		await store.load();
		expect(store.state.error).toBe('fatal: bad object');
		expect(store.state.rows).toHaveLength(2);
		reader.failLog = null;
		await store.load();
		expect(store.state.error).toBeNull();
	});

	it('drops a stale response when a newer load has started', async () => {
		const reader = new FakeReader();
		reader.deferLog = true;
		const store = createGraphStore({ reader, settings: settings() });
		const first = store.load();
		const second = store.load();
		const [resolveFirst, resolveSecond] = reader.pendingLogs;
		resolveSecond?.(linear(1));
		await second;
		resolveFirst?.(linear(2));
		await first;
		expect(store.state.rows.map((r) => r.hash)).toEqual(['c1']);
		expect(store.state.loading).toBe(false);
	});

	it('toggleExpand loads details, collapses on the second call, and ignores details for a collapsed row', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		const expanding = store.toggleExpand('c1');
		expect(store.state.expandedHash).toBe('c1');
		expect(store.state.expandedDetails).toBeNull();
		reader.resolveDetails();
		await expanding;
		expect(store.state.expandedDetails?.body).toBe('body of c1');
		await store.toggleExpand('c1');
		expect(store.state.expandedHash).toBeNull();
		const stale = store.toggleExpand('c2');
		await store.toggleExpand('c2');
		reader.resolveDetails();
		await stale;
		expect(store.state.expandedHash).toBeNull();
		expect(store.state.expandedDetails).toBeNull();
	});

	it('clears the expanded row when a reload no longer contains it', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		const expanding = store.toggleExpand('c2');
		reader.resolveDetails();
		await expanding;
		reader.commits = linear(1);
		await store.load();
		expect(store.state.expandedHash).toBeNull();
	});

	it('filters visible rows by subject, author or hash prefix, case-insensitively', async () => {
		const reader = new FakeReader();
		reader.commits = [commit('abc123', 'def456', 'Fix the graph', 'Ann'), commit('def456', null, 'Initial commit', 'Bob')];
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		store.setFilter('GRAPH');
		expect(store.visibleRows.value.map((r) => r.hash)).toEqual(['abc123']);
		store.setFilter('bob');
		expect(store.visibleRows.value.map((r) => r.hash)).toEqual(['def456']);
		store.setFilter('DEF4');
		expect(store.visibleRows.value.map((r) => r.hash)).toEqual(['def456']);
		store.setFilter('');
		expect(store.visibleRows.value).toHaveLength(2);
	});

	it('ignores results that arrive after dispose', async () => {
		const reader = new FakeReader();
		reader.deferLog = true;
		const store = createGraphStore({ reader, settings: settings() });
		const loading = store.load();
		store.dispose();
		reader.pendingLogs[0]?.(linear(2));
		await loading;
		expect(store.state.rows).toEqual([]);
	});
});
