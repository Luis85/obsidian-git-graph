import type { ChangedFile, Commit, CommitDetails, FileDiff, GitReader } from '../git/types';
import type { Row } from '../graph/types';
import { errorMessage } from './errors';

/** The expanded commit: its details, and in file mode the followed file's diff in it. */
export interface ExpansionState {
	expandedHash: string | null;
	expandedDetails: CommitDetails | null;
	detailsError: string | null;
	/** The followed file as the expanded commit had it; null outside file mode. */
	expandedFile: ChangedFile | null;
	expandedDiff: FileDiff | null;
	diffError: string | null;
}

export const INITIAL_EXPANSION = {
	expandedHash: null,
	expandedDetails: null,
	detailsError: null,
	expandedFile: null,
	expandedDiff: null,
	diffError: null,
} as const;

/**
 * How long an expansion reached by stepping waits before asking git for its details and diff.
 * Key repeat steps about 30 times a second and every expansion costs a details and a diff
 * process, so a step that comes within this window replaces the previous one before it has
 * spawned anything. Long enough to span the key-repeat interval, short enough that a single
 * step does not read as lag.
 */
export const STEP_SETTLE_MS = 100;

interface ExpansionDeps {
	reader: GitReader;
	state: ExpansionState;
	isDisposed: () => boolean;
	commitOf: (hash: string) => Commit | undefined;
	/** The followed file's path; null outside file mode. A dependency, not expansion state. */
	historyPath: () => string | null;
}

/** Owns the expanded commit: which one it is, loading what it shows, and dropping late results. */
export interface Expansion {
	/** Expands `hash` (collapsing it when it already is) and loads its contents right away. */
	toggleExpand: (hash: string) => Promise<void>;
	/** Expands `hash` at once, but asks git for its contents only after `STEP_SETTLE_MS`. */
	stepTo: (hash: string) => void;
	collapse: () => void;
	/** Identifies the current expansion: it changes on every expand and every collapse. */
	token: () => number;
	/** Cancels a fetch still waiting out its settle delay. */
	dispose: () => void;
}

/**
 * The file a diff is asked for in file mode. `--follow` records the path each commit knew the
 * file by; a commit listed without one (git leaves merges out, so this is a safety net) is
 * asked under the history path itself — even when the history was found under one of the
 * fallback paths of an uncommitted rename, in which case git may answer with an empty diff.
 * Acceptable for a safety net: the commit's file list still shows what it touched.
 */
function followedFile(historyPath: string | null, commit: Commit | undefined): ChangedFile | null {
	if (historyPath === null) return null;
	return commit?.file ?? { path: historyPath, status: 'M' };
}

/**
 * Builds the expansion: expands/collapses a row and loads its details — and in file mode the
 * followed file's diff, independently, so a failure of one leaves the other standing.
 *
 * A result is kept only while the expansion it was asked for is still current. That is decided
 * by a token bumped on every expand and collapse rather than by the hash: the same commit can be
 * collapsed and re-expanded, or re-expanded under another history path (a commit that touched
 * both a.md and b.md), while the first request is still out.
 */
export function createExpansion(deps: ExpansionDeps): Expansion {
	const { reader, state, isDisposed } = deps;
	let token = 0;
	let settleTimer: number | null = null;
	const stale = (mine: number): boolean => isDisposed() || token !== mine;

	function cancelSettle(): void {
		if (settleTimer === null) return;
		window.clearTimeout(settleTimer);
		settleTimer = null;
	}

	async function loadDetails(hash: string, mine: number): Promise<void> {
		try {
			const details = await reader.commitDetails(hash);
			if (!stale(mine)) state.expandedDetails = details;
		} catch (e) {
			if (!stale(mine)) state.detailsError = errorMessage(e);
		}
	}

	async function loadDiff(hash: string, file: ChangedFile, mine: number): Promise<void> {
		try {
			const diff = await reader.fileDiff(hash, file);
			if (!stale(mine)) state.expandedDiff = diff;
		} catch (e) {
			if (!stale(mine)) state.diffError = errorMessage(e);
		}
	}

	async function loadContents(hash: string, file: ChangedFile | null, mine: number): Promise<void> {
		await Promise.all([loadDetails(hash, mine), file === null ? null : loadDiff(hash, file, mine)]);
	}

	function collapse(): void {
		cancelSettle();
		token++;
		Object.assign(state, INITIAL_EXPANSION);
	}

	/** Makes `hash` the expanded commit, dropping whatever the previous one showed. */
	function open(hash: string): ChangedFile | null {
		collapse();
		state.expandedHash = hash;
		state.expandedFile = followedFile(deps.historyPath(), deps.commitOf(hash));
		return state.expandedFile;
	}

	return {
		async toggleExpand(hash) {
			if (state.expandedHash === hash) {
				collapse();
				return;
			}
			const file = open(hash);
			await loadContents(hash, file, token);
		},
		stepTo(hash) {
			const file = open(hash);
			const mine = token;
			settleTimer = window.setTimeout(() => {
				settleTimer = null;
				void loadContents(hash, file, mine);
			}, STEP_SETTLE_MS);
		},
		collapse,
		token: () => token,
		dispose: cancelSettle,
	};
}

interface StepperDeps {
	state: ExpansionState;
	expansion: Pick<Expansion, 'stepTo' | 'token'>;
	isDisposed: () => boolean;
	visibleRows: () => Row[];
	hasMore: () => boolean;
	loadMore: () => Promise<void>;
	/** The full load or page load in flight, if any. */
	inFlight: () => Promise<void> | null;
}

/**
 * Builds `expandAdjacent`: expands the shown row `step` places from `fromHash` (+1 older, -1
 * newer) and resolves whether the expansion moved. Stepping past the last loaded row first
 * waits for any load in flight — the list requests the next page by itself as soon as its last
 * row is in view, so that is the usual case — and then loads the next page if still needed.
 * Stepping off either end, or from a row that is not shown, leaves the expansion where it is.
 *
 * Waiting for a page can take a while, and the user may have moved on meanwhile: a step is
 * dropped when the expansion changed (a click, a collapse, a scope change) or a newer step was
 * taken while it waited. The newer step wins even if it is itself still waiting.
 */
export function createStepper(deps: StepperDeps): (fromHash: string, step: 1 | -1) => Promise<boolean> {
	const indexOf = (hash: string): number => deps.visibleRows().findIndex((r) => r.hash === hash);
	const isLast = (hash: string): boolean => indexOf(hash) !== -1 && indexOf(hash) + 1 >= deps.visibleRows().length;
	let latestStep = 0;

	/**
	 * Waits until no load is in flight. A finished load can hand over to another (a reload
	 * superseding a page), hence the loop; a promise seen twice means its flag outlived it
	 * (dispose leaves a superseded request's flag set), so that ends the wait as well.
	 */
	async function settle(): Promise<void> {
		let seen: Promise<void> | null = null;
		for (let p = deps.inFlight(); p !== null && p !== seen; p = deps.inFlight()) {
			seen = p;
			await p;
		}
	}

	/** Brings in the row after `fromHash`, if git has one. */
	async function pageIn(fromHash: string): Promise<void> {
		await settle();
		if (!isLast(fromHash) || !deps.hasMore()) return;
		await deps.loadMore();
		await settle();
	}

	return async function expandAdjacent(fromHash: string, step: 1 | -1): Promise<boolean> {
		if (indexOf(fromHash) === -1) return false;
		const expansion = deps.expansion.token();
		const mine = ++latestStep;
		if (step > 0 && isLast(fromHash)) await pageIn(fromHash);
		if (deps.isDisposed() || mine !== latestStep || expansion !== deps.expansion.token()) return false;
		const from = indexOf(fromHash);
		const target = from === -1 ? undefined : deps.visibleRows()[from + step];
		if (target === undefined || target.hash === deps.state.expandedHash) return false;
		deps.expansion.stepTo(target.hash);
		return true;
	};
}
