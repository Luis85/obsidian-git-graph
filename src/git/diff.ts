import type { ChangedFile, DiffLine, DiffLineKind, FileDiff } from './types';

/** The most diff lines the pane renders for one commit; the rest is cut and flagged. */
export const MAX_DIFF_LINES = 1500;

/**
 * The most patch output read for one file. Far more than `MAX_DIFF_LINES` lines of prose, so a
 * normal diff never meets it; a huge or single-line generated file stops here instead of being
 * buffered whole (up to the 64 MiB default) only to be cut to the line cap afterwards.
 */
export const MAX_DIFF_BYTES = 2 * 1024 * 1024;

type FileRef = Pick<ChangedFile, 'path' | 'oldPath'>;

const LINE_KINDS: Record<string, DiffLineKind> = { ' ': 'ctx', '+': 'add', '-': 'del', '\\': 'note' };

const C_ESCAPES: Record<string, string> = { '\x07': 'a', '\b': 'b', '\t': 't', '\n': 'n', '\v': 'v', '\f': 'f', '\r': 'r', '"': '"', '\\': '\\' };

function escapeChar(ch: string): string | null {
	const named = C_ESCAPES[ch];
	if (named !== undefined) return `\\${named}`;
	const code = ch.charCodeAt(0);
	return code < 0x20 || code === 0x7f ? `\\${code.toString(8).padStart(3, '0')}` : null;
}

/**
 * A name as git writes it in a `diff --git` header with `core.quotePath=false`: verbatim, unless
 * it holds a `"`, a backslash or a control character, in which case the whole name is quoted
 * C-style. (With quotePath on, the default, every non-ASCII byte would be escaped as well.)
 */
function quoted(name: string): string {
	const chars = [...name];
	const escapes = chars.map(escapeChar);
	if (escapes.every((e) => e === null)) return name;
	return `"${chars.map((ch, i) => escapes[i] ?? ch).join('')}"`;
}

/**
 * The `diff --git` lines that open a section writing `file`: changed in place, or created from
 * its old path by a rename or copy. The header is the one line every kind of section has —
 * a pure rename or a mode change writes no `---`/`+++` — and it names the source too, so the
 * copy source's own section (`a/a.md b/a.md`) is never taken for the copy's (`a/a.md b/c.md`).
 */
function sectionHeaders(file: FileRef): Set<string> {
	const sources = file.oldPath === undefined ? [file.path] : [file.path, file.oldPath];
	return new Set(sources.map((source) => `diff --git ${quoted(`a/${source}`)} ${quoted(`b/${file.path}`)}`));
}

interface DiffState {
	mine: boolean;
	inHunk: boolean;
	binary: boolean;
	lines: DiffLine[];
}

function readLine(state: DiffState, text: string, headers: ReadonlySet<string>): void {
	if (text.startsWith('diff --git ')) {
		state.mine = headers.has(text);
		state.inHunk = false;
	} else if (!state.mine) {
		return;
	} else if (text.startsWith('@@')) {
		state.inHunk = true;
		state.lines.push({ kind: 'hunk', text });
	} else if (state.inHunk) {
		const kind = LINE_KINDS[text.charAt(0)];
		if (kind !== undefined) state.lines.push({ kind, text });
	} else if (text.startsWith('Binary files ')) {
		state.binary = true;
	}
}

/**
 * Parses the patch `git diff-tree -p` writes for `file`. The output can hold other sections:
 * the source of a copy is named in the pathspec too, and its own edit comes first. Every section
 * that writes `file` is read — a type change (symlink to file, say) is a deletion and an addition
 * of the same path. The extended header (`index`, `---`/`+++`, rename lines) is skipped: the pane
 * already names the file. Lines are kept as git wrote them, prefix included.
 */
export function parseFileDiff(stdout: string, file: FileRef): FileDiff {
	const headers = sectionHeaders(file);
	const state: DiffState = { mine: false, inHunk: false, binary: false, lines: [] };
	for (const text of stdout.split('\n')) {
		readLine(state, text, headers);
		if (state.lines.length > MAX_DIFF_LINES) return { binary: state.binary, truncated: true, lines: state.lines.slice(0, MAX_DIFF_LINES) };
	}
	return { binary: state.binary, truncated: false, lines: state.lines };
}

/** The pathspecs naming `file` in its commit: both sides of a rename or copy, so they pair up. */
export function diffPathspecs(file: FileRef): string[] {
	const paths = file.oldPath !== undefined && file.oldPath !== file.path ? [file.oldPath, file.path] : [file.path];
	return paths.map((p) => `:(top,literal)${p}`);
}
