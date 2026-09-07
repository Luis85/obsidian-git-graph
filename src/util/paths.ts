import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/**
 * The canonical spelling of an existing path: symlinks and junctions followed, Windows 8.3
 * short names expanded and the on-disk case restored (`realpathSync.native`). A path that does
 * not exist falls back to `resolve()`, so callers can still compare it.
 */
export function realPath(path: string): string {
	try {
		return realpathSync.native(path);
	} catch {
		return resolve(path);
	}
}

/** True when both spellings name the same file or directory. Case-insensitive on Windows. */
export function samePath(a: string, b: string): boolean {
	const x = realPath(a);
	const y = realPath(b);
	return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/**
 * `target` expressed relative to `base` with forward slashes, or `null` when it lies outside
 * `base`. Both spellings are canonicalized first, so a vault opened through a symlink or
 * junction still resolves against the directory git reports. Only the parent directory itself
 * or a path climbing out of it counts as outside — a file named `..notes.md` stays inside.
 */
export function relativeWithin(base: string, target: string): string | null {
	const rel = relative(realPath(base), realPath(target)).replaceAll('\\', '/');
	if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return null;
	return rel;
}
