import { isReactive } from 'vue';
import { describe, expect, it } from 'vitest';
import type { RefFilter } from '../../src/git/types';
import { createGraphStore } from '../../src/view/store';
import { FakeReader, commit, linear } from '../helpers/fakeReader';

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

	it('refreshStatus updates only the dirty count', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		reader.changed = 5;
		await store.refreshStatus();
		expect(store.state.dirtyCount).toBe(5);
		expect(reader.logCalls).toHaveLength(1);
		expect(reader.statusCalls).toBe(2);
		reader.failStatus = new Error('fatal: status failed');
		await store.refreshStatus();
		expect(store.state.error).toBe('fatal: status failed');
		reader.failStatus = null;
		reader.changed = 7;
		await store.refreshStatus();
		expect(store.state.dirtyCount).toBe(7);
		expect(store.state.error).toBeNull();
	});

	it('refreshStatus is a no-op when the dirty row is off or after dispose', async () => {
		const reader = new FakeReader();
		reader.commits = linear(1);
		reader.changed = 2;
		const store = createGraphStore({ reader, settings: settings({ showDirtyRow: false }) });
		await store.load();
		await store.refreshStatus();
		expect(reader.statusCalls).toBe(0);
		const live = createGraphStore({ reader, settings: settings() });
		await live.load();
		live.dispose();
		await live.refreshStatus();
		expect(live.state.dirtyCount).toBe(2);
	});

	it('does not deep-proxy rows and commits', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		expect(isReactive(store.state.rows)).toBe(false);
		expect(isReactive(store.state.rows[0])).toBe(false);
		expect(isReactive(store.state.commits[0])).toBe(false);
		expect(isReactive(store.state)).toBe(true);
	});

	it('keeps the graph when only status fails, and reports the status error', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		reader.changed = 1;
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		reader.commits = linear(3);
		reader.failStatus = new Error('fatal: index locked');
		await store.load();
		expect(store.state.rows.map((r) => r.hash)).toEqual(['c1', 'c2', 'c3']);
		expect(store.state.dirtyCount).toBe(1);
		expect(store.state.error).toBe('fatal: index locked');
	});

	it('toggleDirty loads the working-tree files, collapses on the second call, and follows the dirty count', async () => {
		const reader = new FakeReader();
		reader.commits = linear(1);
		reader.changed = 2;
		reader.dirtyFiles = [{ path: 'a.md', status: 'M' }, { path: 'b.md', status: 'A' }];
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		await store.toggleDirty();
		expect(store.state.dirtyExpanded).toBe(true);
		expect(store.state.dirtyFiles?.map((f) => f.path)).toEqual(['a.md', 'b.md']);
		reader.dirtyFiles = [{ path: 'a.md', status: 'M' }];
		reader.changed = 1;
		await store.refreshStatus();
		expect(store.state.dirtyFiles).toHaveLength(1);
		reader.changed = 0;
		reader.dirtyFiles = [];
		await store.refreshStatus();
		expect(store.state.dirtyExpanded).toBe(false);
		expect(store.state.dirtyFiles).toBeNull();
		await store.toggleDirty();
		await store.toggleDirty();
		expect(store.state.dirtyExpanded).toBe(false);
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
