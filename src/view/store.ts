import { computed, shallowReactive, type ComputedRef } from 'vue';
import type { Commit, GitReader, Ref, RefFilter, RefsSnapshot } from '../git/types';
import { layoutGraph } from '../graph/layout';
import type { Row } from '../graph/types';
import type { GitGraphSettings } from '../settings/types';
import { errorMessage } from './errors';
import { createExpansion, createStepper, INITIAL_EXPANSION, type ExpansionState } from './expansion';
import { createStatusSync, type StatusState } from './statusSync';

export interface GraphStoreDeps {
	reader: GitReader;
	settings: () => Pick<GitGraphSettings, 'refFilter' | 'pageSize' | 'showDirtyRow'>;
}

export interface GraphState extends StatusState, ExpansionState {
	loading: boolean;
	loadingMore: boolean;
	error: string | null;
	commits: Commit[];
	rows: Row[];
	refsByHash: Map<string, Ref[]>;
	headHash: string | null;
	headBranch: string | null;
	loadedCount: number;
	hasMore: boolean;
	filterText: string;
	/** The file whose history is shown; null for the whole repository. */
	historyPath: string | null;
	historyFallbackPaths: readonly string[];
}

export interface GraphStore {
	readonly state: GraphState;
	readonly visibleRows: ComputedRef<Row[]>;
	commitOf(hash: string): Commit | undefined;
	load(): Promise<void>;
	/** Loads the next page; a call while one is in flight resolves with that page. */
	loadMore(): Promise<void>;
	refreshStatus(): Promise<void>;
	toggleExpand(hash: string): Promise<void>;
	/**
	 * Expands the shown commit `step` rows from `fromHash` (+1 is older, -1 newer) and resolves
	 * whether the expansion moved. Its details and diff follow once stepping pauses.
	 */
	expandAdjacent(fromHash: string, step: 1 | -1): Promise<boolean>;
	toggleDirty(): Promise<void>;
	setFilter(text: string): void;
	setHistoryPath(path: string | null, fallbackPaths?: readonly string[]): void;
	dispose(): void;
}

function groupRefs(refs: Ref[]): Map<string, Ref[]> {
	const map = new Map<string, Ref[]>();
	for (const ref of refs) {
		const list = map.get(ref.hash);
		if (list) list.push(ref);
		else map.set(ref.hash, [ref]);
	}
	return map;
}

/** Assembles `reader.log` options, including `path`/`fallbackPaths` only when set (never `path: undefined`). */
function logOptions(state: GraphState, refFilter: RefFilter, skip: number, count: number): { skip: number; count: number; refs: RefFilter; path?: string; fallbackPaths?: readonly string[] } {
	if (state.historyPath === null) return { skip, count, refs: refFilter };
	if (state.historyFallbackPaths.length === 0) return { skip, count, refs: refFilter, path: state.historyPath };
	return { skip, count, refs: refFilter, path: state.historyPath, fallbackPaths: [...state.historyFallbackPaths] };
}

/** True when both lists hold the same paths in the same order. */
function samePaths(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((path, i) => path === b[i]);
}

/**
 * Builds `setHistoryPath`: switches the path filter, drops the rows of the old scope, resets
 * pagination to one page, collapses any expansion, and reloads. `fallbackPaths` are the earlier
 * paths git may still know while a rename of `path` is uncommitted; changing only them is still
 * a scope change, so they take part in the same-value check — element-wise, since the caller
 * hands down a fresh array whenever anything about the active file moves.
 */
function createHistoryPathSetter(state: GraphState, byHash: Map<string, Commit>, collapse: () => void, load: () => Promise<void>): (path: string | null, fallbackPaths?: readonly string[]) => void {
	return function setHistoryPath(path: string | null, fallbackPaths: readonly string[] = []): void {
		if (state.historyPath === path && samePaths(state.historyFallbackPaths, fallbackPaths)) return;
		state.historyPath = path;
		state.historyFallbackPaths = [...fallbackPaths];
		state.loadedCount = 0;
		// The loaded commits belong to the previous scope. Clearing them here (rather than
		// waiting for the new log) keeps another file's history from showing under this file's
		// name — and, when the request fails, from sitting under the error banner indefinitely.
		byHash.clear();
		state.commits = [];
		state.rows = [];
		state.hasMore = false;
		collapse();
		void load();
	};
}

/** Applies a completed `load()`: rows/refs/head are replaced wholesale. Status is applied separately, by `statusSync`. */
function applyLoad(state: GraphState, byHash: Map<string, Commit>, result: { commits: Commit[]; refs: RefsSnapshot; count: number }, collapse: () => void): void {
	const { commits, refs, count } = result;
	byHash.clear();
	for (const c of commits) byHash.set(c.hash, c);
	state.commits = commits;
	state.rows = layoutGraph(commits);
	state.refsByHash = groupRefs(refs.refs);
	state.headHash = refs.headHash;
	state.headBranch = refs.headBranch;
	state.loadedCount = count;
	state.hasMore = commits.length >= count;
	if (state.expandedHash !== null && !byHash.has(state.expandedHash)) collapse();
}

/** Applies a completed `loadMore()`: the page is appended and the lanes are laid out again. */
function applyPage(state: GraphState, byHash: Map<string, Commit>, page: Commit[], at: { skip: number; pageSize: number }): void {
	for (const c of page) byHash.set(c.hash, c);
	state.commits = [...state.commits, ...page];
	state.rows = layoutGraph(state.commits);
	state.loadedCount = at.skip + at.pageSize;
	state.hasMore = page.length >= at.pageSize;
	state.error = null;
}

interface LoadTracker {
	load: () => Promise<void>;
	loadMore: () => Promise<void>;
	/** The load or page load in flight, if any. */
	inFlight: () => Promise<void> | null;
}

/**
 * Wraps the raw loads so that their promises outlive the call that started them: a caller that
 * arrives while one runs can wait for it. A repeat `loadMore` — the list asking again, or a step
 * past the last row — gets the page already in flight instead of being turned away before the
 * rows it needs are in.
 */
function trackLoads(state: GraphState, run: Omit<LoadTracker, 'inFlight'>, isDisposed: () => boolean): LoadTracker {
	let pendingLoad: Promise<void> = Promise.resolve();
	let pendingMore: Promise<void> = Promise.resolve();
	return {
		load() {
			pendingLoad = run.load();
			return pendingLoad;
		},
		loadMore() {
			if (state.loadingMore) return pendingMore;
			if (state.loading || !state.hasMore) return Promise.resolve();
			pendingMore = run.loadMore();
			return pendingMore;
		},
		inFlight() {
			if (isDisposed()) return null;
			if (state.loading) return pendingLoad;
			return state.loadingMore ? pendingMore : null;
		},
	};
}

export function createGraphStore(deps: GraphStoreDeps): GraphStore {
	const state = shallowReactive<GraphState>({
		loading: false,
		loadingMore: false,
		error: null,
		statusError: null,
		commits: [],
		rows: [],
		refsByHash: new Map(),
		headHash: null,
		headBranch: null,
		dirtyCount: 0,
		dirtyExpanded: false,
		dirtyFiles: null,
		dirtyError: null,
		loadedCount: 0,
		hasMore: false,
		...INITIAL_EXPANSION,
		filterText: '',
		historyPath: null,
		historyFallbackPaths: [],
	});

	const byHash = new Map<string, Commit>();
	let generation = 0;
	let disposed = false;

	const status = createStatusSync({
		reader: deps.reader,
		showDirtyRow: () => deps.settings().showDirtyRow,
		state,
		currentGeneration: () => generation,
		isDisposed: () => disposed,
	});

	const visibleRows = computed(() => {
		const needle = state.filterText.trim().toLowerCase();
		if (needle.length === 0) return state.rows;
		return state.rows.filter((row) => {
			const c = byHash.get(row.hash);
			return c !== undefined && (c.hash.toLowerCase().startsWith(needle) || c.subject.toLowerCase().includes(needle) || c.author.toLowerCase().includes(needle));
		});
	});

	const expansion = createExpansion({ reader: deps.reader, state, isDisposed: () => disposed, commitOf: (hash) => byHash.get(hash), historyPath: () => state.historyPath });
	const collapse = expansion.collapse;

	async function runLoad(): Promise<void> {
		const gen = ++generation;
		// Bumping the generation supersedes any in-flight `loadMore`, so its flag is released here,
		// whether this load succeeds or fails. Otherwise the list's one automatic request for the
		// next page (a first page short enough to be fully visible) would be rejected as a duplicate
		// and nothing would re-issue it. `loading` keeps a new `loadMore` out until this settles.
		state.loadingMore = false;
		const { refFilter, pageSize } = deps.settings();
		const count = Math.max(pageSize, state.loadedCount);
		state.loading = true;
		try {
			const [commits, refs, read] = await Promise.all([deps.reader.log(logOptions(state, refFilter, 0, count)), deps.reader.refs(), status.fetch()]);
			if (gen !== generation || disposed) return;
			state.error = null;
			applyLoad(state, byHash, { commits, refs, count }, collapse);
			status.apply(read);
		} catch (e) {
			if (gen !== generation || disposed) return;
			state.error = errorMessage(e);
		} finally {
			if (gen === generation) state.loading = false;
		}
	}

	async function runLoadMore(): Promise<void> {
		const gen = generation;
		const { refFilter, pageSize } = deps.settings();
		const skip = state.loadedCount;
		state.loadingMore = true;
		try {
			const page = await deps.reader.log(logOptions(state, refFilter, skip, pageSize));
			if (gen !== generation || disposed) return;
			applyPage(state, byHash, page, { skip, pageSize });
		} catch (e) {
			if (gen !== generation || disposed) return;
			state.error = errorMessage(e);
		} finally {
			// A newer request owns the flag once this one is superseded; clearing it here would
			// release a page load that is still in flight.
			if (gen === generation) state.loadingMore = false;
		}
	}

	const { load, loadMore, inFlight } = trackLoads(state, { load: runLoad, loadMore: runLoadMore }, () => disposed);
	const expandAdjacent = createStepper({ state, expansion, isDisposed: () => disposed, visibleRows: () => visibleRows.value, hasMore: () => state.hasMore, loadMore, inFlight });
	const setHistoryPath = createHistoryPathSetter(state, byHash, collapse, load);

	return {
		state,
		visibleRows,
		commitOf: (hash) => byHash.get(hash),
		load,
		loadMore,
		refreshStatus: status.refresh,
		toggleExpand: expansion.toggleExpand,
		expandAdjacent,
		toggleDirty: status.toggleDirty,
		setFilter(text) {
			state.filterText = text;
		},
		setHistoryPath,
		dispose() {
			disposed = true;
			generation++;
			expansion.dispose();
		},
	};
}
