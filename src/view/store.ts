import { computed, shallowReactive, type ComputedRef } from 'vue';
import { GitError } from '../git/GitError';
import type { ChangedFile, Commit, CommitDetails, GitReader, Ref, RefsSnapshot } from '../git/types';
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
	statusError: string | null;
	commits: Commit[];
	rows: Row[];
	layout: LayoutState;
	refsByHash: Map<string, Ref[]>;
	headHash: string | null;
	headBranch: string | null;
	dirtyCount: number;
	dirtyExpanded: boolean;
	dirtyFiles: ChangedFile[] | null;
	dirtyError: string | null;
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
	toggleDirty(): Promise<void>;
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

function collapseDirty(state: GraphState): void {
	state.dirtyExpanded = false;
	state.dirtyFiles = null;
	state.dirtyError = null;
}

/**
 * Builds `syncDirtyFiles(gen)`: re-reads the working-tree file list while the changes row is
 * expanded, deriving `dirtyCount` from the file list itself (so this is the *only* status
 * process run while expanded — see `fetchStatus` and `refreshStatus`), and collapses the row
 * once there is nothing left to show. A stale generation (a newer load, or a dispose) drops
 * the result, like the other fetches here.
 */
function createDirtySync(deps: GraphStoreDeps, state: GraphState, currentGeneration: () => number, isDisposed: () => boolean): (gen: number) => Promise<void> {
	return async function syncDirtyFiles(gen: number): Promise<void> {
		if (!state.dirtyExpanded) return;
		if (state.dirtyCount === 0) {
			collapseDirty(state);
			return;
		}
		try {
			const files = await deps.reader.statusFiles();
			if (gen !== currentGeneration() || isDisposed() || !state.dirtyExpanded) return;
			if (files.length === 0) {
				state.dirtyCount = 0;
				collapseDirty(state);
				return;
			}
			state.dirtyCount = files.length;
			state.dirtyFiles = files;
			state.dirtyError = null;
		} catch (e) {
			if (gen !== currentGeneration() || isDisposed() || !state.dirtyExpanded) return;
			state.dirtyError = errorMessage(e);
		}
	};
}

/** Builds `toggleDirty`: expands the changes row and loads its files, or collapses it. */
function createDirtyToggler(state: GraphState, syncDirtyFiles: (gen: number) => Promise<void>, currentGeneration: () => number): () => Promise<void> {
	return async function toggleDirty(): Promise<void> {
		if (state.dirtyExpanded) {
			collapseDirty(state);
			return;
		}
		state.dirtyExpanded = true;
		state.dirtyFiles = null;
		state.dirtyError = null;
		await syncDirtyFiles(currentGeneration());
	};
}

type StatusResult = { ok: true; changed: number } | { ok: false; error: string };

/**
 * Fetches status as a settled result: a rejection becomes `{ ok: false }` instead of failing the
 * whole `load()`. While the changes row is expanded, `syncDirtyFiles` is the sole source of a
 * fresh `dirtyCount` (derived from `statusFiles()`), so this resolves to the current count
 * without running a second `git status` process.
 */
function fetchStatus(deps: GraphStoreDeps, state: GraphState, showDirtyRow: boolean): Promise<StatusResult> {
	if (!showDirtyRow) return Promise.resolve({ ok: true as const, changed: 0 });
	if (state.dirtyExpanded) return Promise.resolve({ ok: true as const, changed: state.dirtyCount });
	return deps.reader
		.status()
		.then((s) => ({ ok: true as const, changed: s.changed }))
		.catch((e: unknown) => ({ ok: false as const, error: errorMessage(e) }));
}

/** Applies a completed `load()`: rows/refs/head are replaced wholesale; a failed status keeps the previous `dirtyCount`. */
function applyLoad(
	state: GraphState,
	byHash: Map<string, Commit>,
	result: { commits: Commit[]; refs: RefsSnapshot; status: StatusResult; count: number },
	collapse: () => void,
): void {
	const { commits, refs, status, count } = result;
	const { rows, state: layout } = layoutGraph(commits, emptyLayoutState());
	byHash.clear();
	for (const c of commits) byHash.set(c.hash, c);
	state.commits = commits;
	state.rows = rows;
	state.layout = layout;
	state.refsByHash = groupRefs(refs.refs);
	state.headHash = refs.headHash;
	state.headBranch = refs.headBranch;
	state.loadedCount = count;
	state.hasMore = commits.length >= count;
	if (state.expandedHash !== null && !byHash.has(state.expandedHash)) collapse();
	if (status.ok) {
		state.dirtyCount = status.changed;
		state.statusError = null;
	} else {
		state.statusError = status.error;
	}
}

/**
 * Builds `refreshStatus`: re-runs the status step only, generation-guarded like `load()`, never
 * touching `rows`. While the changes row is expanded, `statusFiles()` alone provides a fresh
 * `dirtyCount` (via `syncDirtyFiles`), so `status()` is skipped rather than running both.
 */
function createStatusRefresher(
	deps: GraphStoreDeps,
	state: GraphState,
	currentGeneration: () => number,
	isDisposed: () => boolean,
	syncDirtyFiles: (gen: number) => Promise<void>,
): () => Promise<void> {
	return async function refreshStatus(): Promise<void> {
		if (isDisposed() || !deps.settings().showDirtyRow) return;
		const gen = currentGeneration();
		if (state.dirtyExpanded) {
			await syncDirtyFiles(gen);
			return;
		}
		try {
			const status = await deps.reader.status();
			if (gen !== currentGeneration() || isDisposed()) return;
			state.dirtyCount = status.changed;
			state.statusError = null;
		} catch (e) {
			if (gen !== currentGeneration() || isDisposed()) return;
			state.statusError = errorMessage(e);
		}
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
		layout: emptyLayoutState(),
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

	const syncDirtyFiles = createDirtySync(deps, state, () => generation, () => disposed);

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
				fetchStatus(deps, state, showDirtyRow),
			]);
			if (gen !== generation || disposed) return;
			state.error = null;
			applyLoad(state, byHash, { commits, refs, status, count }, collapse);
			void syncDirtyFiles(gen);
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

	const refreshStatus = createStatusRefresher(deps, state, () => generation, () => disposed, syncDirtyFiles);
	const toggleExpand = createExpandToggler(deps, state, () => disposed, collapse);
	const toggleDirty = createDirtyToggler(state, syncDirtyFiles, () => generation);

	return {
		state,
		visibleRows,
		commitOf: (hash) => byHash.get(hash),
		load,
		loadMore,
		refreshStatus,
		toggleExpand,
		toggleDirty,
		setFilter(text) {
			state.filterText = text;
		},
		dispose() {
			disposed = true;
			generation++;
		},
	};
}
