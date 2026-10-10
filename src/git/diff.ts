import { parseCommitRecord } from './parse';
import type { ChangedFile, Commit, DiffLine, DiffLineKind, FileDiff, FileStatus } from './types';

/** The most diff lines the pane renders for one commit; the rest is cut and flagged. */
export const MAX_DIFF_LINES = 1500;

const TWO_PATH = new Set(['R', 'C']);

/**
 * Parses `git log -z --name-status --follow` (with `LOG_FORMAT`). Each commit is its format
 * record, then — when git has a change to show for it — a token holding a newline and the
 * status (`M`, `R100`, …), followed by one path, or the old and new path for a rename or copy.
 * A commit git shows without that block (a merge, which `--follow` normally leaves out) simply
 * gets no `file`.
 */
export function parseFollowLog(stdout: string): Commit[] {
	const tokens = stdout.split('\0');
	const commits: Commit[] = [];
	for (let i = 0; i < tokens.length; ) {
		const record = tokens[i++] ?? '';
		if (record.length === 0) continue;
		const commit = parseCommitRecord(record);
		const status = tokens[i] ?? '';
		if (status.startsWith('\n') && status.length > 1) {
			const letter = status.charAt(1) as FileStatus;
			if (TWO_PATH.has(letter)) {
				commit.file = { path: tokens[i + 2] ?? '', status: letter, oldPath: tokens[i + 1] ?? '' };
				i += 3;
			} else {
				commit.file = { path: tokens[i + 1] ?? '', status: letter };
				i += 2;
			}
		}
		commits.push(commit);
	}
	return commits;
}

const LINE_KINDS: Record<string, DiffLineKind> = { ' ': 'ctx', '+': 'add', '-': 'del', '\\': 'note' };

/**
 * Parses the patch `git diff-tree -p` writes for one file. The extended header (`diff --git`,
 * `index`, `---`/`+++`, rename lines) is skipped: the pane already names the file. Only the
 * first file section is read — `-m` gives a merge one section per parent, the first parent's
 * first. Lines are kept as git wrote them, prefix included.
 */
export function parseFileDiff(stdout: string): FileDiff {
	const lines: DiffLine[] = [];
	let binary = false;
	let inHunk = false;
	let sections = 0;
	for (const text of stdout.split('\n')) {
		if (text.startsWith('diff --git ') && ++sections > 1) break;
		if (text.startsWith('@@')) {
			inHunk = true;
			lines.push({ kind: 'hunk', text });
		} else if (inHunk && text.length > 0 && LINE_KINDS[text.charAt(0)] !== undefined) {
			lines.push({ kind: LINE_KINDS[text.charAt(0)] as DiffLineKind, text });
		} else if (!inHunk && text.startsWith('Binary files ')) {
			binary = true;
		}
		if (lines.length > MAX_DIFF_LINES) return { binary, truncated: true, lines: lines.slice(0, MAX_DIFF_LINES) };
	}
	return { binary, truncated: false, lines };
}

/** The pathspecs naming `file` in its commit: both sides of a rename, so `-M` can pair them. */
export function diffPathspecs(file: ChangedFile): string[] {
	const paths = file.oldPath !== undefined && file.oldPath !== file.path ? [file.oldPath, file.path] : [file.path];
	return paths.map((p) => `:(top,literal)${p}`);
}
