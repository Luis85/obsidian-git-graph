import { describe, expect, it } from 'vitest';
import { countStatus, parseFollowLog, parseLog, parseNameStatus, parseRefs, parseShow, parseStatus } from '../../src/git/parse';

const F = '\x1f';
const Z = '\0';

describe('parseLog', () => {
	it('splits NUL-terminated records and space-separated parents', () => {
		const out = `aaa${F}bbb ccc${F}Ann${F}ann@x.y${F}2026-09-06T10:00:00+02:00${F}Merge it${Z}bbb${F}${F}Bob${F}bob@x.y${F}2026-09-05T10:00:00+02:00${F}Root${Z}`;
		expect(parseLog(out)).toEqual([
			{ hash: 'aaa', parents: ['bbb', 'ccc'], author: 'Ann', email: 'ann@x.y', date: '2026-09-06T10:00:00+02:00', subject: 'Merge it' },
			{ hash: 'bbb', parents: [], author: 'Bob', email: 'bob@x.y', date: '2026-09-05T10:00:00+02:00', subject: 'Root' },
		]);
	});

	it('returns [] for empty output', () => {
		expect(parseLog('')).toEqual([]);
	});
});

const header = (hash: string, subject: string): string => `${hash}${F}p${F}Ann${F}a@x${F}2026-09-06T10:00:00Z${F}${subject}`;

// `git log -z --name-status --follow` writes each commit as its format record, then a NUL, a
// newline, the status, and the NUL-terminated path(s) the file had in that commit.
describe('parseFollowLog', () => {
	it('attaches the file as it was in each commit, including a rename with its old path', () => {
		const out = [header('c3', 'edit'), '\nM', 'renamed.md', header('c2', 'rename'), '\nR100', 'note.md', 'renamed.md', header('c1', 'root'), '\nA', 'note.md', ''].join(Z);
		const commits = parseFollowLog(out, 'renamed.md');
		expect(commits.map((c) => [c.hash, c.subject, c.file])).toEqual([
			['c3', 'edit', { path: 'renamed.md', status: 'M' }],
			['c2', 'rename', { path: 'renamed.md', status: 'R', oldPath: 'note.md' }],
			['c1', 'root', { path: 'note.md', status: 'A' }],
		]);
		expect(commits[0]).toMatchObject({ parents: ['p'], author: 'Ann', email: 'a@x', date: '2026-09-06T10:00:00Z' });
	});

	it('leaves `file` off a commit that git listed without a name-status block', () => {
		const out = [header('c2', 'merge'), header('c1', 'root'), '\nA', 'note.md', ''].join(Z);
		const commits = parseFollowLog(out, 'note.md');
		expect(commits[0]).not.toHaveProperty('file');
		expect(commits[1]?.file).toEqual({ path: 'note.md', status: 'A' });
	});

	// The followed path is also a prefix pathspec: a commit that swapped a directory `Docs/` for a
	// file `Docs` lists every entry under it, and only the first entry carries the newline.
	it('reads every entry of a commit and attaches the one for the followed path', () => {
		const out = [header('c2', 'swap'), '\nD', 'Docs/a.md', 'A', 'Docs', 'D', 'Docs/b.md', header('c1', 'root'), '\nA', 'Docs/a.md', 'A', 'Docs/b.md', ''].join(Z);
		const commits = parseFollowLog(out, 'Docs');
		expect(commits.map((c) => [c.hash, c.file])).toEqual([
			['c2', { path: 'Docs', status: 'A' }],
			['c1', { path: 'Docs/a.md', status: 'A' }],
		]);
	});

	it('keeps following the path a rename came from, and reads a status git may add later as a modification', () => {
		const out = [header('c3', 'rename'), '\nR090', 'b.md', 'c.md', header('c2', 'edit'), '\nM', 'c.md', 'X', 'b.md', header('c1', 'root'), '\nA', 'b.md', ''].join(Z);
		expect(parseFollowLog(out, 'c.md').map((c) => c.file)).toEqual([
			{ path: 'c.md', status: 'R', oldPath: 'b.md' },
			{ path: 'b.md', status: 'M' },
			{ path: 'b.md', status: 'A' },
		]);
	});

	it('returns [] for empty output', () => {
		expect(parseFollowLog('', 'a.md')).toEqual([]);
	});
});

describe('parseRefs', () => {
	it('classifies heads, remotes and tags, dereferences annotated tags, skips origin/HEAD and other namespaces', () => {
		const out = [
			`aaa${F}${F}refs/heads/main${F}origin/main${F}*`,
			`bbb${F}${F}refs/heads/feature${F}${F} `,
			`aaa${F}${F}refs/remotes/origin/main${F}${F} `,
			`aaa${F}${F}refs/remotes/origin/HEAD${F}${F} `,
			`tagobj${F}bbb${F}refs/tags/v1${F}${F} `,
			`ccc${F}${F}refs/stash${F}${F} `,
		].join('\n') + '\n';
		expect(parseRefs(out)).toEqual([
			{ hash: 'aaa', name: 'main', kind: 'branch', isHead: true, upstream: 'origin/main' },
			{ hash: 'bbb', name: 'feature', kind: 'branch', isHead: false },
			{ hash: 'aaa', name: 'origin/main', kind: 'remote', isHead: false },
			{ hash: 'bbb', name: 'v1', kind: 'tag', isHead: false },
		]);
	});
});

describe('parseShow', () => {
	it('reads the seven fields and keeps the body verbatim including newlines', () => {
		const out = `aaa${F}Ann${F}ann@x.y${F}2026-09-06T10:00:00+02:00${F}Cara${F}2026-09-06T11:00:00+02:00${F}Subject\n\nBody line 1\nBody line 2\n`;
		expect(parseShow(out)).toEqual({
			hash: 'aaa',
			author: 'Ann',
			email: 'ann@x.y',
			authorDate: '2026-09-06T10:00:00+02:00',
			committer: 'Cara',
			commitDate: '2026-09-06T11:00:00+02:00',
			body: 'Subject\n\nBody line 1\nBody line 2',
		});
	});
});

describe('parseNameStatus', () => {
	it('reads single-path and two-path (rename/copy) entries', () => {
		const out = `M${Z}a.md${Z}A${Z}b.md${Z}R100${Z}old.md${Z}new.md${Z}D${Z}gone.md${Z}`;
		expect(parseNameStatus(out)).toEqual([
			{ path: 'a.md', status: 'M' },
			{ path: 'b.md', status: 'A' },
			{ path: 'new.md', status: 'R', oldPath: 'old.md' },
			{ path: 'gone.md', status: 'D' },
		]);
	});

	it('returns [] for empty output', () => {
		expect(parseNameStatus('')).toEqual([]);
	});
});

describe('countStatus', () => {
	it('counts porcelain lines, renames as one', () => {
		expect(countStatus(' M a.md\n?? b.md\nR  old.md -> new.md\n')).toBe(3);
		expect(countStatus('')).toBe(0);
	});
});

describe('parseStatus', () => {
	it('maps porcelain v1 -z entries to changed files', () => {
		const out = ` M${' '}a.md${Z}?? b.md${Z}R  new.md${Z}old.md${Z}D  gone.md${Z}!! ignored.md${Z}MM both.md${Z}`;
		expect(parseStatus(out)).toEqual([
			{ path: 'a.md', status: 'M' },
			{ path: 'b.md', status: 'A' },
			{ path: 'new.md', status: 'R', oldPath: 'old.md' },
			{ path: 'gone.md', status: 'D' },
			{ path: 'both.md', status: 'M' },
		]);
		expect(parseStatus('')).toEqual([]);
	});

	it('lets a rename in either column win over a modification, so a dirty rename keeps its R label', () => {
		const out = `RM${' '}new.md${Z}old.md${Z}`;
		expect(parseStatus(out)).toEqual([{ path: 'new.md', status: 'R', oldPath: 'old.md' }]);
	});
});
