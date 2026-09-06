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

	async function toggleExpand(hash: string): Promise<void> {
		if (state.expandedHash === hash) {
			collapse();
			return;
		}
		state.expandedHash = hash;
		state.expandedDetails = null;
		state.detailsError = null;
		try {
			const details = await deps.reader.commitDetails(hash);
			if (disposed || state.expandedHash !== hash) return;
			state.expandedDetails = details;
		} catch (e) {
			if (disposed || state.expandedHash !== hash) return;
			state.detailsError = errorMessage(e);
		}
	}

	return {
		state,
		visibleRows,
		commitOf: (hash) => byHash.get(hash),
		load,
		loadMore,
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
