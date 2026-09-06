import type { ChangedFile, GitReader } from '../git/types';
import { errorMessage } from './errors';

export interface StatusState {
	statusError: string | null;
	dirtyCount: number;
	dirtyExpanded: boolean;
	dirtyFiles: ChangedFile[] | null;
	dirtyError: string | null;
}

interface StatusSyncDeps {
	reader: GitReader;
	showDirtyRow: () => boolean;
	state: StatusState;
	currentGeneration: () => number;
	isDisposed: () => boolean;
}

type StatusResult = { ok: true; changed: number; files: ChangedFile[] | null } | { ok: false; error: string };

/** One settled status read, tagged with the sequence number it was requested under. */
interface StatusRead {
	seq: number;
	/** `files` reads went through `statusFiles()` (the row was expanded when requested). */
	via: 'status' | 'files';
	result: StatusResult;
}

interface StatusSync {
	/** Requests a status read. Never rejects; failures are carried in the result. */
	fetch: () => Promise<StatusRead>;
	/** Applies a read unless a newer one has been requested since (per-request sequence: the newest request wins). */
	apply: (read: StatusRead) => void;
	/** fetch + apply, dropped if the store generation moved or the store was disposed meanwhile. */
	refresh: () => Promise<void>;
	toggleDirty: () => Promise<void>;
}

function collapseDirty(state: StatusState): void {
	state.dirtyExpanded = false;
	state.dirtyFiles = null;
	state.dirtyError = null;
}

/**
 * Owns every status read for the store. While the changes row is expanded a read goes through
 * `statusFiles()` and derives `dirtyCount` from the list, so there is still exactly one git
 * process per refresh; otherwise it goes through `status()`. Every successful read clears
 * `statusError`; a count of 0 collapses the row.
 */
export function createStatusSync(deps: StatusSyncDeps): StatusSync {
	const { reader, state } = deps;
	let seq = 0;

	async function fetch(): Promise<StatusRead> {
		const mine = ++seq;
		const via = state.dirtyExpanded ? 'files' : 'status';
		if (!deps.showDirtyRow()) return { seq: mine, via, result: { ok: true, changed: 0, files: null } };
		try {
			if (via === 'files') {
				const files = await reader.statusFiles();
				return { seq: mine, via, result: { ok: true, changed: files.length, files } };
			}
			const { changed } = await reader.status();
			return { seq: mine, via, result: { ok: true, changed, files: null } };
		} catch (e) {
			return { seq: mine, via, result: { ok: false, error: errorMessage(e) } };
		}
	}

	function apply(read: StatusRead): void {
		if (read.seq !== seq) return;
		const { result } = read;
		if (!result.ok) {
			if (read.via === 'files' && state.dirtyExpanded) state.dirtyError = result.error;
			else state.statusError = result.error;
			return;
		}
		state.statusError = null;
		state.dirtyCount = result.changed;
		if (result.changed === 0) {
			collapseDirty(state);
			return;
		}
		if (result.files !== null && state.dirtyExpanded) {
			state.dirtyFiles = result.files;
			state.dirtyError = null;
		}
	}

	async function refresh(): Promise<void> {
		if (deps.isDisposed() || !deps.showDirtyRow()) return;
		const gen = deps.currentGeneration();
		const read = await fetch();
		// Defensive: apply()'s own seq check already drops a read superseded by a newer refresh
		// request, so this gen check is redundant against that case but still guards a store
		// swap (a new generation) that happened while this read was in flight.
		if (gen !== deps.currentGeneration() || deps.isDisposed()) return;
		apply(read);
	}

	async function toggleDirty(): Promise<void> {
		if (state.dirtyExpanded) {
			collapseDirty(state);
			return;
		}
		state.dirtyExpanded = true;
		state.dirtyFiles = null;
		state.dirtyError = null;
		await refresh();
	}

	return { fetch, apply, refresh, toggleDirty };
}
