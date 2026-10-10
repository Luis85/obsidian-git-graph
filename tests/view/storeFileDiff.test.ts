import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { Commit, RefFilter } from '../../src/git/types';
import { createGraphStore, type GraphStore } from '../../src/view/store';
import { FakeReader, linear } from '../helpers/fakeReader';

const settings = (pageSize = 3) => () => ({ refFilter: 'auto' as RefFilter, pageSize, showDirtyRow: true });

/** Commits of a followed file: c2 renamed `old.md` to `a.md`, c1 and c3 edited it under each name. */
function followed(): Commit[] {
	const [c1, c2, c3] = linear(3) as [Commit, Commit, Commit];
	return [
		{ ...c1, file: { path: 'a.md', status: 'M' } },
		{ ...c2, file: { path: 'a.md', status: 'R', oldPath: 'old.md' } },
		{ ...c3, file: { path: 'old.md', status: 'A' } },
	];
}

/** Expands `hash` and lets details and diff settle. */
async function expand(reader: FakeReader, store: GraphStore, hash: string): Promise<void> {
	const pending = store.toggleExpand(hash);
	reader.resolveDetails();
	await pending;
}

async function historyStore(reader: FakeReader, pageSize = 3): Promise<GraphStore> {
	const store = createGraphStore({ reader, settings: settings(pageSize) });
	store.setHistoryPath('a.md');
	await flushPromises();
	return store;
}

// In file mode an expanded commit also shows that file's changes, asked for under the path the
// file had in that commit.
describe('createGraphStore file diff', () => {
	it('loads the diff of the followed file as that commit had it, rename included', async () => {
		const reader = new FakeReader();
		reader.commits = followed();
		const store = await historyStore(reader);
		await expand(reader, store, 'c2');
		expect(reader.diffCalls).toEqual([{ hash: 'c2', file: { path: 'a.md', status: 'R', oldPath: 'old.md' } }]);
		expect(store.state.expandedFile).toEqual({ path: 'a.md', status: 'R', oldPath: 'old.md' });
		expect(store.state.expandedDiff?.lines).toEqual([{ kind: 'add', text: '+c2' }]);
		await expand(reader, store, 'c3');
		expect(reader.diffCalls.at(-1)).toEqual({ hash: 'c3', file: { path: 'old.md', status: 'A' } });
	});

	it('falls back to the history path for a commit git listed without its file', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		const store = await historyStore(reader);
		await expand(reader, store, 'c1');
		expect(reader.diffCalls).toEqual([{ hash: 'c1', file: { path: 'a.md', status: 'M' } }]);
	});

	it('asks for no diff outside file mode, and clears it on collapse', async () => {
		const reader = new FakeReader();
		reader.commits = followed();
		const plain = createGraphStore({ reader, settings: settings() });
		await plain.load();
		await expand(reader, plain, 'c1');
		expect(reader.diffCalls).toEqual([]);
		expect(plain.state.expandedFile).toBeNull();

		const store = await historyStore(reader);
		await expand(reader, store, 'c1');
		expect(store.state.expandedDiff).not.toBeNull();
		await store.toggleExpand('c1');
		expect(store.state.expandedHash).toBeNull();
		expect(store.state.expandedDiff).toBeNull();
		expect(store.state.expandedFile).toBeNull();
	});

	it('reports a failed diff without losing the details', async () => {
		const reader = new FakeReader();
		reader.commits = followed();
		reader.failDiff = new Error('fatal: bad object');
		const store = await historyStore(reader);
		await expand(reader, store, 'c1');
		expect(store.state.diffError).toContain('bad object');
		expect(store.state.expandedDetails?.hash).toBe('c1');
	});

	it('drops a diff that arrives after the expansion moved on', async () => {
		const reader = new FakeReader();
		reader.commits = followed();
		reader.deferDiff = true;
		const store = await historyStore(reader);
		const first = store.toggleExpand('c1');
		const second = store.toggleExpand('c2');
		reader.resolveDetails();
		reader.resolveDiffs();
		await Promise.all([first, second]);
		expect(store.state.expandedHash).toBe('c2');
		expect(store.state.expandedDiff?.lines[0]?.text).toBe('+c2');
	});
});

describe('createGraphStore expandAdjacent', () => {
	it('moves the expansion to the older or newer neighbour and stops at the ends', async () => {
		const reader = new FakeReader();
		reader.commits = followed();
		const store = await historyStore(reader);
		await expand(reader, store, 'c1');
		const older = store.expandAdjacent('c1', 1);
		reader.resolveDetails();
		await older;
		expect(store.state.expandedHash).toBe('c2');
		expect(store.state.expandedDiff?.lines[0]?.text).toBe('+c2');
		const newer = store.expandAdjacent('c2', -1);
		reader.resolveDetails();
		await newer;
		expect(store.state.expandedHash).toBe('c1');
		await store.expandAdjacent('c1', -1);
		expect(store.state.expandedHash).toBe('c1');
	});

	it('loads the next page to step past the last loaded commit', async () => {
		const reader = new FakeReader();
		reader.commits = linear(5);
		const store = await historyStore(reader, 2);
		await expand(reader, store, 'c2');
		const older = store.expandAdjacent('c2', 1);
		await flushPromises();
		reader.resolveDetails();
		await older;
		expect(reader.logCalls.at(-1)).toMatchObject({ skip: 2, count: 2, path: 'a.md' });
		expect(store.state.expandedHash).toBe('c3');
	});

	it('steps within the filtered rows, and ignores a hash that is not shown', async () => {
		const reader = new FakeReader();
		reader.commits = linear(3).map((c) => ({ ...c, subject: c.hash === 'c2' ? 'skip me' : `keep ${c.hash}` }));
		const store = await historyStore(reader);
		store.setFilter('keep');
		await expand(reader, store, 'c1');
		const older = store.expandAdjacent('c1', 1);
		reader.resolveDetails();
		await older;
		expect(store.state.expandedHash).toBe('c3');
		await store.expandAdjacent('c2', 1);
		expect(store.state.expandedHash).toBe('c3');
	});
});
