import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

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
