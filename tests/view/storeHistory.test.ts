import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { RefFilter } from '../../src/git/types';
import { createGraphStore } from '../../src/view/store';
import { FakeReader, linear } from '../helpers/fakeReader';

const settings = () => () => ({ refFilter: 'auto' as RefFilter, pageSize: 3, showDirtyRow: true });

// The file-history scope of the store: what setHistoryPath sends to git, what it drops, and
// how it treats results that a later path change has superseded.
describe('createGraphStore history path', () => {
	it('setHistoryPath filters log calls, collapses an expansion, carries the path into loadMore, and null clears it', async () => {
		const reader = new FakeReader();
		reader.commits = linear(7);
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		const expanding = store.toggleExpand('c1');
		reader.resolveDetails();
		await expanding;
		expect(store.state.expandedHash).toBe('c1');
		store.setHistoryPath('notes/a.md');
		expect(store.state.expandedHash).toBeNull();
		await flushPromises();
		expect(reader.logCalls.at(-1)).toEqual({ skip: 0, count: 3, refs: 'auto', path: 'notes/a.md' });
		expect(store.state.historyPath).toBe('notes/a.md');
		await store.loadMore();
		expect(reader.logCalls.at(-1)).toEqual({ skip: 3, count: 3, refs: 'auto', path: 'notes/a.md' });
		store.setHistoryPath(null);
		await flushPromises();
		expect(reader.logCalls.at(-1)).not.toHaveProperty('path');
	});

	it('setting the same history path twice is a no-op, and a new path resets the grown loadedCount to one page', async () => {
		const reader = new FakeReader();
		reader.commits = linear(7);
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		const callsBefore = reader.logCalls.length;
		store.setHistoryPath('notes/a.md');
		await flushPromises();
		const callsAfterFirst = reader.logCalls.length;
		expect(callsAfterFirst).toBe(callsBefore + 1);
		store.setHistoryPath('notes/a.md');
		await flushPromises();
		expect(reader.logCalls.length).toBe(callsAfterFirst);
		await store.loadMore();
		expect(store.state.loadedCount).toBe(6);
		store.setHistoryPath('x.md');
		await flushPromises();
		expect(reader.logCalls.at(-1)).toEqual({ skip: 0, count: 3, refs: 'auto', path: 'x.md' });
	});

	it('clears the loaded rows synchronously when the history scope changes, and leaves them cleared if the reload fails', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		expect(store.commitOf('c1')).toBeDefined();
		reader.failLog = new Error('fatal: bad revision');
		// Rows belong to the previous scope: they must not survive under the new file's name,
		// not even until the new log resolves — and least of all under the error banner.
		store.setHistoryPath('a.md');
		expect(store.state.rows).toEqual([]);
		expect(store.state.commits).toEqual([]);
		expect(store.state.hasMore).toBe(false);
		expect(store.commitOf('c1')).toBeUndefined();
		await flushPromises();
		expect(store.state.rows).toEqual([]);
		expect(store.state.error).toBe('fatal: bad revision');
	});

	// After Obsidian renames the open note, git only knows the earlier paths until the rename is
	// committed; the controller hands them all down and the reader decides which one has history.
	it('carries the fallback paths into the log options and reloads when only they change', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		store.setHistoryPath('c.md', ['b.md', 'a.md']);
		await flushPromises();
		expect(reader.logCalls.at(-1)).toEqual({ skip: 0, count: 3, refs: 'auto', path: 'c.md', fallbackPaths: ['b.md', 'a.md'] });
		const calls = reader.logCalls.length;
		// A fresh array with the same entries is the same scope: the check is element-wise.
		store.setHistoryPath('c.md', ['b.md', 'a.md']);
		await flushPromises();
		expect(reader.logCalls).toHaveLength(calls);
		// Dropping one of them is a scope change even though the path is unchanged.
		store.setHistoryPath('c.md', ['b.md']);
		await flushPromises();
		expect(reader.logCalls).toHaveLength(calls + 1);
		expect(reader.logCalls.at(-1)).toEqual({ skip: 0, count: 3, refs: 'auto', path: 'c.md', fallbackPaths: ['b.md'] });
		// The rename is committed: same path, no fallbacks any more — still a scope change.
		store.setHistoryPath('c.md');
		await flushPromises();
		expect(reader.logCalls).toHaveLength(calls + 2);
		expect(reader.logCalls.at(-1)).not.toHaveProperty('fallbackPaths');
	});

	it('drops a stale result when a history path change supersedes a pending one', async () => {
		const reader = new FakeReader();
		reader.deferLog = true;
		const store = createGraphStore({ reader, settings: settings() });
		store.setHistoryPath('a.md');
		store.setHistoryPath('b.md');
		const [resolveFirst, resolveSecond] = reader.pendingLogs;
		resolveFirst?.(linear(2));
		resolveSecond?.(linear(1));
		await flushPromises();
		expect(store.state.rows).toHaveLength(1);
	});

	// A superseded loadMore holds `loadingMore` until its own request settles. CommitList asks
	// for the next page exactly once, when the fresh short page turns out to be fully visible;
	// if the flag is still set then the store drops that request and nothing re-issues it, so
	// the file history stays truncated with no scrollbar to pull the rest in.
	it('clears loadingMore for the new scope and keeps the superseded request from clearing a newer one', async () => {
		const reader = new FakeReader();
		reader.commits = linear(7);
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		reader.deferLog = true;
		const more = store.loadMore();
		store.setHistoryPath('a.md');
		reader.pendingLogs[1]?.(linear(3));
		await flushPromises();
		expect(store.state.loadingMore).toBe(false);
		const calls = reader.logCalls.length;
		const next = store.loadMore();
		expect(reader.logCalls).toHaveLength(calls + 1);
		expect(reader.logCalls.at(-1)).toMatchObject({ skip: 3, count: 3, path: 'a.md' });
		reader.pendingLogs[0]?.(linear(2));
		await more;
		expect(store.state.loadingMore).toBe(true);
		expect(store.state.rows).toHaveLength(3);
		reader.pendingLogs[2]?.(linear(7).slice(3, 6));
		await next;
		expect(store.state.loadingMore).toBe(false);
		expect(store.state.rows).toHaveLength(6);
	});

	it('releases loadingMore even when the load that superseded the pending loadMore fails', async () => {
		const reader = new FakeReader();
		reader.commits = linear(7);
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		reader.deferLog = true;
		const more = store.loadMore();
		reader.deferLog = false;
		reader.failLog = new Error('fatal: broken');
		store.setHistoryPath('a.md');
		await flushPromises();
		expect(store.state.error).toBe('fatal: broken');
		expect(store.state.loadingMore).toBe(false);
		reader.pendingLogs[0]?.(linear(2));
		await more;
		expect(store.state.loadingMore).toBe(false);
		reader.failLog = null;
		await store.load();
		expect(store.state.rows).toHaveLength(3);
		await store.loadMore();
		expect(store.state.rows).toHaveLength(6);
	});
});
