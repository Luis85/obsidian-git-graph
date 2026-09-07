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

});
