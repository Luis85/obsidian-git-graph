import type { ChangedFile, Commit, CommitDetails, FileStatus, Ref } from './types';

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\0';

export const LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s';
// Note: for-each-ref's --format uses bare %NN hex escapes (e.g. %1f), unlike the %xNN escapes
// accepted by log/show pretty-format; %x1f here would be emitted as the literal text "%x1f".
export const REF_FORMAT = '%(objectname)%1f%(*objectname)%1f%(refname)%1f%(upstream:short)%1f%(HEAD)';
export const SHOW_FORMAT = '%H%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%cI%x1f%B';

/** One `LOG_FORMAT` record. */
function parseCommitRecord(record: string): Commit {
	const [hash = '', parents = '', author = '', email = '', date = '', ...subject] = record.split(FIELD_SEP);
	return {
		hash,
		parents: parents.length === 0 ? [] : parents.split(' '),
		author,
		email,
		date,
		subject: subject.join(FIELD_SEP),
	};
}

export function parseLog(stdout: string): Commit[] {
	return stdout
		.split(RECORD_SEP)
		.filter((record) => record.length > 0)
		.map(parseCommitRecord);
}

const REF_KINDS: readonly [prefix: string, kind: Ref['kind']][] = [
	['refs/heads/', 'branch'],
	['refs/remotes/', 'remote'],
	['refs/tags/', 'tag'],
];

// Split out of parseRefs so the loop body isn't one large branchy function (eslint
// complexity backstop): a single line's worth of skip/parse decisions, unchanged in behavior.
function parseRefLine(line: string): Ref | null {
	if (line.length === 0) return null;
	const [objectname = '', derefed = '', refname = '', upstream = '', head = ''] = line.split(FIELD_SEP);
	const match = REF_KINDS.find(([prefix]) => refname.startsWith(prefix));
	if (match === undefined) return null;
	const [prefix, kind] = match;
	const name = refname.slice(prefix.length);
	if (kind === 'remote' && name.endsWith('/HEAD')) return null;
	const ref: Ref = { hash: derefed.length > 0 ? derefed : objectname, name, kind, isHead: head === '*' };
	if (upstream.length > 0) ref.upstream = upstream;
	return ref;
}

export function parseRefs(stdout: string): Ref[] {
	const refs: Ref[] = [];
	for (const line of stdout.split('\n')) {
		const ref = parseRefLine(line);
		if (ref !== null) refs.push(ref);
	}
	return refs;
}

export function parseShow(stdout: string): Omit<CommitDetails, 'files'> {
	const [hash = '', author = '', email = '', authorDate = '', committer = '', commitDate = '', ...rest] = stdout.split(FIELD_SEP);
	return { hash, author, email, authorDate, committer, commitDate, body: rest.join(FIELD_SEP).replace(/\n+$/, '') };
}

const TWO_PATH = new Set(['R', 'C']);

export function parseNameStatus(stdout: string): ChangedFile[] {
	const tokens = stdout.split(RECORD_SEP).filter((t) => t.length > 0);
	const files: ChangedFile[] = [];
	for (let i = 0; i < tokens.length; ) {
		const raw = tokens[i] ?? '';
		const status = (raw.charAt(0) || 'M') as FileStatus;
		if (TWO_PATH.has(status)) {
			files.push({ path: tokens[i + 2] ?? '', status, oldPath: tokens[i + 1] ?? '' });
			i += 3;
		} else {
			files.push({ path: tokens[i + 1] ?? '', status });
			i += 2;
		}
	}
	return files;
}

const STATUS_LETTERS = new Set<string>(['A', 'M', 'D', 'R', 'C', 'T']);

/** A `--name-status` status token: the letter, then a similarity score for a rename or copy. */
const NAME_STATUS = /^[ACDMRTUXB]\d*$/;

/**
 * The name-status entry starting at `tokens[i]` and the index after it, or null when that token
 * is not a status. Letters this plugin has no label for (`U`, `X`, `B`) read as a modification.
 */
function readEntry(tokens: readonly string[], i: number): [ChangedFile, number] | null {
	const status = (tokens[i] ?? '').replace(/^\n/, '');
	if (!NAME_STATUS.test(status)) return null;
	const letter = status.charAt(0);
	const label = (STATUS_LETTERS.has(letter) ? letter : 'M') as FileStatus;
	if (TWO_PATH.has(letter)) return [{ path: tokens[i + 2] ?? '', status: label, oldPath: tokens[i + 1] ?? '' }, i + 3];
	return [{ path: tokens[i + 1] ?? '', status: label }, i + 2];
}

/** The entry for `followed` — as the file it names, else as the source it came from — or the first. */
function pickEntry(entries: readonly ChangedFile[], followed: string): ChangedFile | undefined {
	return entries.find((e) => e.path === followed) ?? entries.find((e) => e.oldPath === followed) ?? entries[0];
}

/**
 * Parses `git log -z --name-status --follow` (with `LOG_FORMAT`) for the history of `path`. Each
 * commit is its format record, then — when git has a change to show for it — its name-status
 * entries: a status (`M`, `R100`, …) and one path, or the old and new path for a rename or copy.
 * Only the first status carries a leading newline. A commit can list several entries, because
 * the pathspec also matches a directory of that name (a commit that replaced `Docs/` with a file
 * `Docs` lists `A Docs` and a `D` for every file under it); the one for the followed path is
 * kept. Below a rename the file is followed by its old path. A commit git shows without entries
 * (a merge, which `--follow` normally leaves out) simply gets no `file`. Only a token holding a
 * field separator is a commit record, so a path is never mistaken for one.
 */
export function parseFollowLog(stdout: string, path: string): Commit[] {
	const tokens = stdout.split(RECORD_SEP);
	const commits: Commit[] = [];
	let followed = path;
	for (let i = 0; i < tokens.length; ) {
		const record = tokens[i++] ?? '';
		if (!record.includes(FIELD_SEP)) continue;
		const entries: ChangedFile[] = [];
		for (let entry = readEntry(tokens, i); entry !== null; entry = readEntry(tokens, i)) {
			entries.push(entry[0]);
			i = entry[1];
		}
		const commit = parseCommitRecord(record);
		const file = pickEntry(entries, followed);
		if (file !== undefined) commit.file = file;
		if (file?.path === followed && file.oldPath !== undefined) followed = file.oldPath;
		commits.push(commit);
	}
	return commits;
}

/**
 * The single status letter for one porcelain `XY` pair: a rename/copy in either column wins
 * (`R` preferred over `C` when both differ) so a dirty rename (`RM`) still reads as a rename,
 * not a modification; otherwise the worktree column when it says something, else the index
 * column. `??` (untracked) reads as an addition, `!!` (ignored) is dropped, and any other
 * letter git may grow falls back to a modification.
 */
function statusOf(x: string, y: string): FileStatus | null {
	if (x === '!' && y === '!') return null;
	if (x === '?' && y === '?') return 'A';
	if (x === 'R' || y === 'R') return 'R';
	if (x === 'C' || y === 'C') return 'C';
	const letter = y !== ' ' ? y : x;
	return STATUS_LETTERS.has(letter) ? (letter as FileStatus) : 'M';
}

/** Parses `git status --porcelain=v1 -z`: a NUL-terminated `XY path` per entry, with a second NUL-terminated old path for renames and copies. */
export function parseStatus(stdout: string): ChangedFile[] {
	const tokens = stdout.split(RECORD_SEP).filter((t) => t.length > 0);
	const files: ChangedFile[] = [];
	for (let i = 0; i < tokens.length; ) {
		const entry = tokens[i] ?? '';
		const x = entry.charAt(0);
		const y = entry.charAt(1);
		const oldPath = TWO_PATH.has(x) || TWO_PATH.has(y) ? tokens[i + 1] ?? '' : null;
		i += oldPath === null ? 1 : 2;
		const status = statusOf(x, y);
		if (status === null) continue;
		files.push(oldPath === null ? { path: entry.slice(3), status } : { path: entry.slice(3), status, oldPath });
	}
	return files;
}

export function countStatus(stdout: string): number {
	return stdout.split('\n').filter((line) => line.length > 0).length;
}
