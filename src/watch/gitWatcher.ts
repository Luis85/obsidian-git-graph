// Imported as a namespace (rather than destructured) so that `fs.watch` is looked up at call
// time: a destructured `{ watch }` binding to this built-in module can end up pinned to the
// pre-mock implementation across a module boundary when a test replaces `watch` via
// `vi.mock('node:fs', ...)`, which the gitWatcher tests rely on to count `watch` calls.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { samePath } from '../util/paths';

export interface GitWatcher {
	pause(): void;
	resume(): void;
	dispose(): void;
}

export interface GitWatcherOptions {
	debounceMs?: number;
	onError?: (error: unknown) => void;
	/**
	 * The shared git dir for a linked worktree (`GitRepository.gitCommonDir()`). When given and
	 * different from `gitDir`, its `refs/` and `packed-refs` are watched too, since branch/tag
	 * updates for a linked worktree land there rather than in the per-worktree gitDir. Compared
	 * by canonical path, so a vault opened under another spelling (case, 8.3 short name, junction)
	 * of the same directory is not watched twice.
	 */
	commonDir?: string;
}

const FILES = ['HEAD', 'packed-refs', 'index', join('logs', 'HEAD')];
const REF_DIRS = ['heads', 'remotes', 'tags'].map((d) => join('refs', d));
// Direct children of gitDir that git rewrites by rename; the gitDir-level watch (added below)
// exists only to catch rename events on these. Filtering on filename keeps that watch from
// forwarding unrelated directory-level noise (e.g. a `refs` entry touched by the recursive
// refs/ watch) as a spurious extra change.
const DIRECT_RENAME_FILES = new Set(['HEAD', 'packed-refs', 'index']);

type AddFn = (path: string, recursive: boolean, listener?: (eventType: string, filename: string | Buffer | null) => void) => boolean;
type DirListener = (eventType: string, filename: string | Buffer | null) => void;

/** Watches `<dir>/refs` recursively where supported, falling back to one watch per ref subdirectory. */
function watchRefs(dir: string, add: AddFn): void {
	if (!add(join(dir, 'refs'), true)) {
		for (const refDir of REF_DIRS) add(join(dir, refDir), false);
	}
}

function watchGitDir(dir: string, add: AddFn, onDirEvent: DirListener, report: (error: unknown) => void): void {
	if (!fs.existsSync(dir)) {
		report(new Error(`git directory not found: ${dir}`));
		return;
	}
	for (const file of FILES) add(join(dir, file), false);
	add(dir, false, onDirEvent);
	watchRefs(dir, add);
}

/** Also watches refs/ and packed-refs in the shared common dir of a linked worktree, when it differs from gitDir. */
function watchCommonDir(commonDir: string | undefined, gitDir: string, add: AddFn, onDirEvent: DirListener): void {
	if (commonDir === undefined || !fs.existsSync(commonDir) || samePath(commonDir, gitDir)) return;
	add(join(commonDir, 'packed-refs'), false);
	add(commonDir, false, onDirEvent);
	watchRefs(commonDir, add);
}

export function createGitWatcher(gitDir: string, onChange: () => void, opts: GitWatcherOptions = {}): GitWatcher {
	const debounceMs = opts.debounceMs ?? 500;
	const watchers: fs.FSWatcher[] = [];
	// Runs in Obsidian's Electron renderer, so timers go through `window` per the
	// obsidianmd popout-window rule (obsidianmd/prefer-window-timers).
	let timer: number | null = null;
	let paused = false;
	let dropped = false;
	let disposed = false;
	let reported = false;

	const report = (error: unknown): void => {
		if (reported) return;
		reported = true;
		opts.onError?.(error);
	};

	const schedule = (): void => {
		if (disposed) return;
		if (paused) {
			dropped = true;
			return;
		}
		if (timer !== null) window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			timer = null;
			onChange();
		}, debounceMs);
	};

	const add = (
		path: string,
		recursive: boolean,
		listener: (eventType: string, filename: string | Buffer | null) => void = schedule,
	): boolean => {
		if (!fs.existsSync(path)) return false;
		try {
			const w = fs.watch(path, { recursive, persistent: false }, listener);
			w.on('error', report);
			watchers.push(w);
			return true;
		} catch (error) {
			report(error);
			return false;
		}
	};

	// Only forward gitDir-level events that name one of the direct-child files git rewrites by
	// rename; other entries (e.g. `refs`) are already covered by the refs/ watch below and would
	// otherwise show up here as an extra, unrelated change.
	const onGitDirEvent = (_eventType: string, filename: string | Buffer | null): void => {
		if (filename === null) {
			schedule();
			return;
		}
		if (DIRECT_RENAME_FILES.has(filename.toString())) schedule();
	};

	watchGitDir(gitDir, add, onGitDirEvent, report);
	watchCommonDir(opts.commonDir, gitDir, add, onGitDirEvent);

	return {
		pause() {
			paused = true;
			if (timer !== null) {
				window.clearTimeout(timer);
				timer = null;
				dropped = true;
			}
		},
		resume() {
			paused = false;
			if (dropped) {
				dropped = false;
				onChange();
			}
		},
		dispose() {
			disposed = true;
			if (timer !== null) window.clearTimeout(timer);
			for (const w of watchers) w.close();
			watchers.length = 0;
		},
	};
}
