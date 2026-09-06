import { computed, reactive, type ComputedRef } from 'vue';
import { GitError } from '../git/GitError';
import type { Commit, CommitDetails, GitReader, Ref } from '../git/types';
import { emptyLayoutState, layoutGraph } from '../graph/layout';
import type { LayoutState, Row } from '../graph/types';
import type { GitGraphSettings } from '../settings/types';

export interface GraphStoreDeps {
	reader: GitReader;
	settings: () => Pick<GitGraphSettings, 'refFilter' | 'pageSize' | 'showDirtyRow'>;
}

export interface GraphState {
	loading: boolean;
	loadingMore: boolean;
	error: string | null;
	commits: Commit[];
	rows: Row[];
	layout: LayoutState;
	refsByHash: Map<string, Ref[]>;
	headHash: string | null;
	headBranch: string | null;
	dirtyCount: number;
	loadedCount: number;
	hasMore: boolean;
	expandedHash: string | null;
	expandedDetails: CommitDetails | null;
	detailsError: string | null;
	filterText: string;
}

export interface GraphStore {
	readonly state: GraphState;
	readonly visibleRows: ComputedRef<Row[]>;
	commitOf(hash: string): Commit | undefined;
	load(): Promise<void>;
	loadMore(): Promise<void>;
	refreshStatus(): Promise<void>;
	toggleExpand(hash: string): Promise<void>;
	setFilter(text: string): void;
	dispose(): void;
}

function errorMessage(e: unknown): string {
	if (e instanceof GitError || e instanceof Error) return e.message;
	return String(e);
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

/** Builds `refreshStatus`: re-runs `status()` only, generation-guarded like `load()`, never touching `rows`. */
function createStatusRefresher(deps: GraphStoreDeps, state: GraphState, currentGeneration: () => number, isDisposed: () => boolean): () => Promise<void> {
	return async function refreshStatus(): Promise<void> {
		if (isDisposed() || !deps.settings().showDirtyRow) return;
		const gen = currentGeneration();
		try {
			const status = await deps.reader.status();
			if (gen !== currentGeneration() || isDisposed()) return;
			state.dirtyCount = status.changed;
			state.error = null;
		} catch (e) {
			if (gen !== currentGeneration() || isDisposed()) return;
			state.error = errorMessage(e);
		}
	};
}

export function createGraphStore(deps: GraphStoreDeps): GraphStore {
	const state = reactive<GraphState>({
		loading: false,
		loadingMore: false,
		error: null,
		commits: [],
		rows: [],
		layout: emptyLayoutState(),
		refsByHash: new Map(),
		headHash: null,
		headBranch: null,
		dirtyCount: 0,
		loadedCount: 0,
		hasMore: false,
		expandedHash: null,
		expandedDetails: null,
		detailsError: null,
		filterText: '',
	});

	const byHash = new Map<string, Commit>();
	let generation = 0;
	let disposed = false;

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
		const { refFilter, pageSize, showDirtyRow } = deps.settings();
		const count = Math.max(pageSize, state.loadedCount);
		state.loading = true;
		try {
			const [commits, refs, status] = await Promise.all([
				deps.reader.log({ skip: 0, count, refs: refFilter }),
				deps.reader.refs(),
				showDirtyRow ? deps.reader.status() : Promise.resolve({ changed: 0 }),
			]);
			if (gen !== generation || disposed) return;
			const { rows, state: layout } = layoutGraph(commits, emptyLayoutState());
			byHash.clear();
			for (const c of commits) byHash.set(c.hash, c);
			state.commits = commits;
			state.rows = rows;
			state.layout = layout;
			state.refsByHash = groupRefs(refs.refs);
			state.headHash = refs.headHash;
			state.headBranch = refs.headBranch;
			state.dirtyCount = status.changed;
			state.loadedCount = count;
			state.hasMore = commits.length >= count;
			state.error = null;
			if (state.expandedHash !== null && !byHash.has(state.expandedHash)) collapse();
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
			const page = await deps.reader.log({ skip, count: pageSize, refs: refFilter });
			if (gen !== generation || disposed) return;
			const { rows, state: layout } = layoutGraph(page, state.layout);
			for (const c of page) byHash.set(c.hash, c);
			state.commits = [...state.commits, ...page];
			state.rows = [...state.rows, ...rows];
			state.layout = layout;
			state.loadedCount = skip + pageSize;
			state.hasMore = page.length >= pageSize;
			state.error = null;
		} catch (e) {
			if (gen !== generation || disposed) return;
			state.error = errorMessage(e);
		} finally {
			state.loadingMore = false;
		}
	}

	const refreshStatus = createStatusRefresher(deps, state, () => generation, () => disposed);
	const toggleExpand = createExpandToggler(deps, state, () => disposed, collapse);

	return {
		state,
		visibleRows,
		commitOf: (hash) => byHash.get(hash),
		load,
		loadMore,
		refreshStatus,
		toggleExpand,
		setFilter(text) {
			state.filterText = text;
		},
		dispose() {
			disposed = true;
			generation++;
		},
	};
}
