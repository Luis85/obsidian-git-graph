import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefFilter } from '../../src/git/types';
import { STEP_SETTLE_MS } from '../../src/view/expansion';
import { createGraphStore, type GraphStore } from '../../src/view/store';
import { FakeReader, linear } from '../helpers/fakeReader';

const settings = (pageSize: number) => () => ({ refFilter: 'auto' as RefFilter, pageSize, showDirtyRow: true });

async function historyStore(reader: FakeReader, pageSize = 3): Promise<GraphStore> {
	const store = createGraphStore({ reader, settings: settings(pageSize) });
	store.setHistoryPath('a.md');
	await flushPromises();
	return store;
}

/** Expands `hash` by a click and lets details and diff settle. */
async function expand(reader: FakeReader, store: GraphStore, hash: string): Promise<void> {
	const pending = store.toggleExpand(hash);
	reader.resolveDetails();
	await pending;
}

/** Lets a step's settle delay run out and the details and diff it then asks for land. */
async function settle(reader: FakeReader): Promise<void> {
	await vi.advanceTimersByTimeAsync(STEP_SETTLE_MS);
	reader.resolveDetails();
	await flushPromises();
}

// Only the timeout pair is faked: flushPromises schedules on setImmediate and must keep working.
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());

// Newer/Older and the arrow keys move the expansion one shown row at a time, paging in history
// past the last loaded row.
describe('createGraphStore expandAdjacent', () => {
	it('moves the expansion to the older or newer neighbour and stops at the ends', async () => {
		const reader = new FakeReader();
		reader.commits = linear(3);
		const store = await historyStore(reader);
		await expand(reader, store, 'c1');
		expect(await store.expandAdjacent('c1', 1)).toBe(true);
		expect(store.state.expandedHash).toBe('c2');
		await settle(reader);
		expect(store.state.expandedDetails?.hash).toBe('c2');
		expect(store.state.expandedDiff?.lines[0]?.text).toBe('+c2');
		expect(await store.expandAdjacent('c2', -1)).toBe(true);
		expect(store.state.expandedHash).toBe('c1');
		expect(await store.expandAdjacent('c1', -1)).toBe(false);
		expect(store.state.expandedHash).toBe('c1');
	});

	it('loads the next page to step past the last loaded commit', async () => {
		const reader = new FakeReader();
		reader.commits = linear(5);
		const store = await historyStore(reader, 2);
		await expand(reader, store, 'c2');
		expect(await store.expandAdjacent('c2', 1)).toBe(true);
		expect(reader.logCalls.at(-1)).toMatchObject({ skip: 2, count: 2, path: 'a.md' });
		expect(store.state.expandedHash).toBe('c3');
	});

	it('steps within the filtered rows, and ignores a hash that is not shown', async () => {
		const reader = new FakeReader();
		reader.commits = linear(3).map((c) => ({ ...c, subject: c.hash === 'c2' ? 'skip me' : `keep ${c.hash}` }));
		const store = await historyStore(reader);
		store.setFilter('keep');
		await expand(reader, store, 'c1');
		expect(await store.expandAdjacent('c1', 1)).toBe(true);
		expect(store.state.expandedHash).toBe('c3');
		expect(await store.expandAdjacent('c2', 1)).toBe(false);
		expect(store.state.expandedHash).toBe('c3');
	});

	// The list asks for the next page on its own as soon as the last row scrolls into view, so a
	// step past the end usually finds that request already running.
	it('joins a page load already in flight instead of dropping the step', async () => {
		const reader = new FakeReader();
		reader.commits = linear(5);
		const store = await historyStore(reader, 2);
		await expand(reader, store, 'c2');
		reader.deferLog = true;
		const calls = reader.logCalls.length;
		const auto = store.loadMore();
		let joined = false;
		void store.loadMore().then(() => (joined = true));
		const step = store.expandAdjacent('c2', 1);
		await flushPromises();
		expect(reader.logCalls).toHaveLength(calls + 1);
		expect(joined).toBe(false);
		reader.pendingLogs[0]?.(reader.commits.slice(2, 4));
		expect(await step).toBe(true);
		expect(joined).toBe(true);
		expect(store.state.expandedHash).toBe('c3');
		await auto;
	});

	it('waits for a reload in flight before paging past the end', async () => {
		const reader = new FakeReader();
		reader.commits = linear(5);
		const store = await historyStore(reader, 2);
		await expand(reader, store, 'c2');
		reader.deferLog = true;
		const reload = store.load();
		const step = store.expandAdjacent('c2', 1);
		reader.pendingLogs[0]?.(reader.commits.slice(0, 2));
		await reload;
		await flushPromises();
		expect(reader.pendingLogs).toHaveLength(2);
		expect(reader.logCalls.at(-1)).toMatchObject({ skip: 2, count: 2 });
		reader.pendingLogs[1]?.(reader.commits.slice(2, 4));
		expect(await step).toBe(true);
		expect(store.state.expandedHash).toBe('c3');
	});

	it('drops a step whose page lands after the user expanded another row', async () => {
		const reader = new FakeReader();
		reader.commits = linear(5);
		const store = await historyStore(reader, 2);
		await expand(reader, store, 'c2');
		reader.deferLog = true;
		const step = store.expandAdjacent('c2', 1);
		await expand(reader, store, 'c1');
		reader.pendingLogs[0]?.(reader.commits.slice(2, 4));
		expect(await step).toBe(false);
		expect(store.state.expandedHash).toBe('c1');
	});

	it('drops a step whose page lands after the user collapsed the row', async () => {
		const reader = new FakeReader();
		reader.commits = linear(5);
		const store = await historyStore(reader, 2);
		await expand(reader, store, 'c2');
		reader.deferLog = true;
		const step = store.expandAdjacent('c2', 1);
		await store.toggleExpand('c2');
		reader.pendingLogs[0]?.(reader.commits.slice(2, 4));
		expect(await step).toBe(false);
		expect(store.state.expandedHash).toBeNull();
	});

	it('lets a newer step supersede one still waiting for its page', async () => {
		const reader = new FakeReader();
		reader.commits = linear(5);
		const store = await historyStore(reader, 2);
		await expand(reader, store, 'c2');
		reader.deferLog = true;
		const first = store.expandAdjacent('c2', 1);
		expect(await store.expandAdjacent('c2', -1)).toBe(true);
		expect(store.state.expandedHash).toBe('c1');
		reader.pendingLogs[0]?.(reader.commits.slice(2, 4));
		expect(await first).toBe(false);
		expect(store.state.expandedHash).toBe('c1');
	});

	it('drops a step whose page lands after dispose', async () => {
		const reader = new FakeReader();
		reader.commits = linear(5);
		const store = await historyStore(reader, 2);
		await expand(reader, store, 'c2');
		reader.deferLog = true;
		const step = store.expandAdjacent('c2', 1);
		await flushPromises();
		store.dispose();
		reader.pendingLogs[0]?.(reader.commits.slice(2, 4));
		expect(await step).toBe(false);
		expect(store.state.expandedHash).toBe('c2');
	});
});

// Key repeat steps ~30 times a second. Each expansion costs a details and a diff process, so a
// step only names the new row at once and asks git once stepping pauses; a click asks at once.
describe('createGraphStore step settle delay', () => {
	it('defers the fetches of a stepped-to commit until stepping pauses', async () => {
		const reader = new FakeReader();
		reader.commits = linear(4);
		const store = await historyStore(reader, 5);
		await expand(reader, store, 'c1');
		await store.expandAdjacent('c1', 1);
		expect(store.state.expandedHash).toBe('c2');
		expect(store.state.expandedFile).toEqual({ path: 'a.md', status: 'M' });
		expect(store.state.expandedDetails).toBeNull();
		await vi.advanceTimersByTimeAsync(STEP_SETTLE_MS - 1);
		await store.expandAdjacent('c2', 1);
		await store.expandAdjacent('c3', 1);
		expect(store.state.expandedHash).toBe('c4');
		expect(reader.detailsCalls).toEqual(['c1']);
		expect(reader.diffCalls).toHaveLength(1);
		await settle(reader);
		expect(reader.detailsCalls).toEqual(['c1', 'c4']);
		expect(reader.diffCalls.map((c) => c.hash)).toEqual(['c1', 'c4']);
		expect(store.state.expandedDetails?.hash).toBe('c4');
		expect(store.state.expandedDiff?.lines[0]?.text).toBe('+c4');
	});

	it('steps without a diff outside file mode', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		const store = createGraphStore({ reader, settings: settings(3) });
		await store.load();
		await expand(reader, store, 'c1');
		await store.expandAdjacent('c1', 1);
		expect(store.state.expandedFile).toBeNull();
		await settle(reader);
		expect(store.state.expandedDetails?.hash).toBe('c2');
		expect(reader.diffCalls).toEqual([]);
	});

	it('expands a click at once and cancels a pending stepped fetch', async () => {
		const reader = new FakeReader();
		reader.commits = linear(3);
		const store = await historyStore(reader);
		await expand(reader, store, 'c1');
		await store.expandAdjacent('c1', 1);
		const click = store.toggleExpand('c3');
		expect(reader.detailsCalls).toEqual(['c1', 'c3']);
		reader.resolveDetails();
		await click;
		await settle(reader);
		expect(reader.detailsCalls).toEqual(['c1', 'c3']);
		expect(store.state.expandedDetails?.hash).toBe('c3');
	});

	it('cancels a pending stepped fetch on collapse and on dispose', async () => {
		const reader = new FakeReader();
		reader.commits = linear(3);
		const store = await historyStore(reader);
		await expand(reader, store, 'c1');
		await store.expandAdjacent('c1', 1);
		await store.toggleExpand('c2');
		await settle(reader);
		expect(reader.detailsCalls).toEqual(['c1']);
		await expand(reader, store, 'c1');
		await store.expandAdjacent('c1', 1);
		store.dispose();
		expect(vi.getTimerCount()).toBe(0);
		await settle(reader);
		expect(reader.detailsCalls).toEqual(['c1', 'c1']);
	});
});
