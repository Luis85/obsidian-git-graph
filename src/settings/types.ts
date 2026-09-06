import type { RefFilter } from '../git/types';

export type DateFormat = 'relative' | 'absolute';

export interface GitGraphSettings {
	gitPath: string;
	refFilter: RefFilter;
	pageSize: number;
	showDirtyRow: boolean;
	dateFormat: DateFormat;
}

export const DEFAULT_SETTINGS: GitGraphSettings = {
	gitPath: 'git',
	refFilter: 'auto',
	pageSize: 200,
	showDirtyRow: true,
	dateFormat: 'relative',
};

export const MIN_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 5000;

/** Absolute on Windows (drive letter or UNC) or POSIX; keeps this module free of Node built-ins for the browser harness. */
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[/\\]|\\\\|\/)/;

/** A bare command (looked up on PATH) or an absolute path; relative paths would resolve inside the vault. */
export function isValidGitPath(value: string): boolean {
	const trimmed = value.trim();
	if (trimmed.length === 0) return false;
	// Reject drive-relative paths like C:git.exe
	if (/^[A-Za-z]:(?![/\\])/.test(trimmed)) return false;
	// Accept bare commands (no slashes)
	if (!/[\\/]/.test(trimmed)) return true;
	// Accept absolute paths (Windows drive absolute, UNC, or POSIX)
	return ABSOLUTE_PATH.test(trimmed);
}

export function normalizeSettings(raw: unknown): GitGraphSettings {
	const out = { ...DEFAULT_SETTINGS };
	if (typeof raw !== 'object' || raw === null) return out;
	const r = raw as Record<string, unknown>;
	if (typeof r['gitPath'] === 'string' && isValidGitPath(r['gitPath'])) out.gitPath = r['gitPath'].trim();
	if (r['refFilter'] === 'auto' || r['refFilter'] === 'all') out.refFilter = r['refFilter'];
	if (typeof r['pageSize'] === 'number' && Number.isFinite(r['pageSize']) && r['pageSize'] >= MIN_PAGE_SIZE) {
		out.pageSize = Math.min(MAX_PAGE_SIZE, Math.floor(r['pageSize']));
	}
	if (typeof r['showDirtyRow'] === 'boolean') out.showDirtyRow = r['showDirtyRow'];
	if (r['dateFormat'] === 'relative' || r['dateFormat'] === 'absolute') out.dateFormat = r['dateFormat'];
	return out;
}
