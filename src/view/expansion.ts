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
	historyPath: string | null;
}

export const INITIAL_EXPANSION = {
	expandedHash: null,
	expandedDetails: null,
	detailsError: null,
	expandedFile: null,
	expandedDiff: null,
	diffError: null,
} as const;

/** Collapses the expanded commit, if any, and forgets everything loaded for it. */
export function collapseExpansion(state: ExpansionState): void {
	Object.assign(state, INITIAL_EXPANSION);
}

interface ExpansionDeps {
	reader: GitReader;
	state: ExpansionState;
	isDisposed: () => boolean;
	commitOf: (hash: string) => Commit | undefined;
}

/**
 * The file a diff is asked for in file mode. `--follow` records the path each commit knew the
 * file by; a commit listed without one (git leaves merges out, so this is a safety net) is
 * asked under the history path itself.
 */
function followedFile(state: ExpansionState, commit: Commit | undefined): ChangedFile | null {
	if (state.historyPath === null) return null;
	return commit?.file ?? { path: state.historyPath, status: 'M' };
}

/**
 * Builds `toggleExpand`: expands/collapses a row and loads its details — and in file mode the
 * followed file's diff, independently, so a failure of one leaves the other standing. A result
 * for a row that is no longer the expanded one is dropped.
 */
export function createExpandToggler(deps: ExpansionDeps): (hash: string) => Promise<void> {
	const { reader, state, isDisposed } = deps;
	const stale = (hash: string): boolean => isDisposed() || state.expandedHash !== hash;

	async function loadDetails(hash: string): Promise<void> {
		try {
			const details = await reader.commitDetails(hash);
			if (!stale(hash)) state.expandedDetails = details;
		} catch (e) {
			if (!stale(hash)) state.detailsError = errorMessage(e);
		}
	}

	async function loadDiff(hash: string, file: ChangedFile): Promise<void> {
		try {
			const diff = await reader.fileDiff(hash, file);
			if (!stale(hash)) state.expandedDiff = diff;
		} catch (e) {
			if (!stale(hash)) state.diffError = errorMessage(e);
		}
	}

	return async function toggleExpand(hash: string): Promise<void> {
		if (state.expandedHash === hash) {
			collapseExpansion(state);
			return;
		}
		collapseExpansion(state);
		state.expandedHash = hash;
		const file = followedFile(state, deps.commitOf(hash));
		state.expandedFile = file;
		await Promise.all([loadDetails(hash), file === null ? null : loadDiff(hash, file)]);
	};
}

interface StepperDeps {
	state: ExpansionState;
	visibleRows: () => Row[];
	hasMore: () => boolean;
	loadMore: () => Promise<void>;
	toggleExpand: (hash: string) => Promise<void>;
}

/**
 * Builds `expandAdjacent`: expands the shown row `step` places from `fromHash` (+1 older, -1
 * newer). Stepping past the last loaded row first loads the next page. Stepping off either end,
 * or from a row that is not shown, leaves the expansion where it is.
 */
export function createStepper(deps: StepperDeps): (fromHash: string, step: 1 | -1) => Promise<void> {
	const indexOf = (hash: string): number => deps.visibleRows().findIndex((r) => r.hash === hash);
	return async function expandAdjacent(fromHash: string, step: 1 | -1): Promise<void> {
		if (indexOf(fromHash) === -1) return;
		if (step > 0 && indexOf(fromHash) + 1 >= deps.visibleRows().length && deps.hasMore()) await deps.loadMore();
		const from = indexOf(fromHash);
		const target = from === -1 ? undefined : deps.visibleRows()[from + step];
		if (target === undefined || target.hash === deps.state.expandedHash) return;
		await deps.toggleExpand(target.hash);
	};
}
