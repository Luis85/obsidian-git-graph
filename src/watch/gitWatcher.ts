import { existsSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';

export interface GitWatcher {
	pause(): void;
	resume(): void;
	dispose(): void;
}

export interface GitWatcherOptions {
	debounceMs?: number;
	onError?: (error: unknown) => void;
}

const FILES = ['HEAD', 'packed-refs', 'index', join('logs', 'HEAD')];
const REF_DIRS = ['heads', 'remotes', 'tags'].map((d) => join('refs', d));
// Direct children of gitDir that git rewrites by rename; the gitDir-level watch (added below)
// exists only to catch rename events on these. Filtering on filename keeps that watch from
// forwarding unrelated directory-level noise (e.g. a `refs` entry touched by the recursive
// refs/ watch) as a spurious extra change.
const DIRECT_RENAME_FILES = new Set(['HEAD', 'packed-refs', 'index']);

export function createGitWatcher(gitDir: string, onChange: () => void, opts: GitWatcherOptions = {}): GitWatcher {
	const debounceMs = opts.debounceMs ?? 500;
	const watchers: FSWatcher[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;
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
		if (timer !== null) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			onChange();
		}, debounceMs);
	};

	const add = (
		path: string,
		recursive: boolean,
		listener: (eventType: string, filename: string | Buffer | null) => void = schedule,
	): boolean => {
		if (!existsSync(path)) return false;
		try {
			const w = watch(path, { recursive, persistent: false }, listener);
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

	if (!existsSync(gitDir)) {
		report(new Error(`git directory not found: ${gitDir}`));
	} else {
		for (const file of FILES) add(join(gitDir, file), false);
		add(gitDir, false, onGitDirEvent);
		if (!add(join(gitDir, 'refs'), true)) {
			for (const dir of REF_DIRS) add(join(gitDir, dir), false);
		}
	}

	return {
		pause() {
			paused = true;
			if (timer !== null) {
				clearTimeout(timer);
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
			if (timer !== null) clearTimeout(timer);
			for (const w of watchers) w.close();
			watchers.length = 0;
		},
	};
}
