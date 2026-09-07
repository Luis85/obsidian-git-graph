import { computed, shallowReactive, type ComputedRef } from 'vue';
import type { Commit, CommitDetails, GitReader, Ref, RefFilter, RefsSnapshot } from '../git/types';
import { layoutGraph } from '../graph/layout';
import type { Row } from '../graph/types';
import type { GitGraphSettings } from '../settings/types';
import { errorMessage } from './errors';
import { createStatusSync, type StatusState } from './statusSync';

export interface GraphStoreDeps {
	reader: GitReader;
	settings: () => Pick<GitGraphSettings, 'refFilter' | 'pageSize' | 'showDirtyRow'>;
}

export interface GraphState extends StatusState {
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
	expandedHash: string | null;
	expandedDetails: CommitDetails | null;
	detailsError: string | null;
	filterText: string;
	historyPath: string | null;
	historyFallbackPath: string | null;
}

export interface GraphStore {
	readonly state: GraphState;
	readonly visibleRows: ComputedRef<Row[]>;
	commitOf(hash: string): Commit | undefined;
	load(): Promise<void>;
	loadMore(): Promise<void>;
	refreshStatus(): Promise<void>;
	toggleExpand(hash: string): Promise<void>;
	toggleDirty(): Promise<void>;
	setFilter(text: string): void;
	setHistoryPath(path: string | null, fallbackPath?: string | null): void;
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

/** Builds `toggleExpand`: expands/collapses a row and loads its details, ignoring stale results. */
function createExpandToggler(deps: GraphStoreDeps, state: GraphState, isDisposed: () => boolean, collapse: () => void): (hash: string) => Promise<void> {
	return async function toggleExpand(hash: string): Promise<void> {
		if (state.expandedHash === hash) {
			collapse();
			return;
		}
		state.expandedHash = hash;
		state.expandedDetails = null;
		state.detailsError = null;
		try {
			const details = await deps.reader.commitDetails(hash);
			if (isDisposed() || state.expandedHash !== hash) return;
			state.expandedDetails = details;
		} catch (e) {
			if (isDisposed() || state.expandedHash !== hash) return;
			state.detailsError = errorMessage(e);
		}
	};
}

/** Assembles `reader.log` options, including `path`/`fallbackPath` only when set (never `path: undefined`). */
function logOptions(state: GraphState, refFilter: RefFilter, skip: number, count: number): { skip: number; count: number; refs: RefFilter; path?: string; fallbackPath?: string } {
	if (state.historyPath === null) return { skip, count, refs: refFilter };
	if (state.historyFallbackPath === null) return { skip, count, refs: refFilter, path: state.historyPath };
	return { skip, count, refs: refFilter, path: state.historyPath, fallbackPath: state.historyFallbackPath };
}

/**
 * Builds `setHistoryPath`: switches the path filter, drops the rows of the old scope, resets
 * pagination to one page, collapses any expansion, and reloads. `fallbackPath` is the path git
 * may still know while a rename of `path` is uncommitted; changing only it is still a scope
 * change, so both take part in the same-value check.
 */
function createHistoryPathSetter(state: GraphState, byHash: Map<string, Commit>, collapse: () => void, load: () => Promise<void>): (path: string | null, fallbackPath?: string | null) => void {
	return function setHistoryPath(path: string | null, fallbackPath: string | null = null): void {
		if (state.historyPath === path && state.historyFallbackPath === fallbackPath) return;
		state.historyPath = path;
		state.historyFallbackPath = fallbackPath;
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

/**
 * Applies a completed `load()`: rows/refs/head are replaced wholesale. Status is applied
 * separately, by `statusSync`. A `loadMore` this load superseded no longer owns anything here,
 * so its flag is cleared with the same assignment that publishes the new page — before the list
 * can react to it. Otherwise the list's one automatic request for the next page (a first page
 * short enough to be fully visible) is rejected as a duplicate, and nothing re-issues it.
 */
function applyLoad(state: GraphState, byHash: Map<string, Commit>, result: { commits: Commit[]; refs: RefsSnapshot; count: number }, collapse: () => void): void {
	const { commits, refs, count } = result;
	state.loadingMore = false;
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
		expandedHash: null,
		expandedDetails: null,
		detailsError: null,
		filterText: '',
		historyPath: null,
		historyFallbackPath: null,
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

	const collapse = (): void => {
		state.expandedHash = null;
		state.expandedDetails = null;
		state.detailsError = null;
	};

	async function load(): Promise<void> {
		const gen = ++generation;
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

	async function loadMore(): Promise<void> {
		if (state.loading || state.loadingMore || !state.hasMore) return;
		const gen = generation;
		const { refFilter, pageSize } = deps.settings();
		const skip = state.loadedCount;
		state.loadingMore = true;
		try {
			const page = await deps.reader.log(logOptions(state, refFilter, skip, pageSize));
			if (gen !== generation || disposed) return;
			for (const c of page) byHash.set(c.hash, c);
			state.commits = [...state.commits, ...page];
			state.rows = layoutGraph(state.commits);
			state.loadedCount = skip + pageSize;
			state.hasMore = page.length >= pageSize;
			state.error = null;
		} catch (e) {
			if (gen !== generation || disposed) return;
			state.error = errorMessage(e);
		} finally {
			// A newer request owns the flag once this one is superseded; clearing it here would
			// release a page load that is still in flight.
			if (gen === generation) state.loadingMore = false;
		}
	}

	const toggleExpand = createExpandToggler(deps, state, () => disposed, collapse);
	const setHistoryPath = createHistoryPathSetter(state, byHash, collapse, load);

	return {
		state,
		visibleRows,
		commitOf: (hash) => byHash.get(hash),
		load,
		loadMore,
		refreshStatus: status.refresh,
		toggleExpand,
		toggleDirty: status.toggleDirty,
		setFilter(text) {
			state.filterText = text;
		},
		setHistoryPath,
		dispose() {
			disposed = true;
			generation++;
		},
	};
}
