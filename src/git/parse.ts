import type { ChangedFile, Commit, CommitDetails, FileStatus, Ref } from './types';

export const FIELD_SEP = '\x1f';
const RECORD_SEP = '\0';

export const LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s';
export const REF_FORMAT = '%(objectname)%x1f%(*objectname)%x1f%(refname)%x1f%(upstream:short)%x1f%(HEAD)';
export const SHOW_FORMAT = '%H%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%cI%x1f%B';

export function parseLog(stdout: string): Commit[] {
	return stdout
		.split(RECORD_SEP)
		.filter((record) => record.length > 0)
		.map((record) => {
			const [hash = '', parents = '', author = '', email = '', date = '', ...subject] = record.split(FIELD_SEP);
			return {
				hash,
				parents: parents.length === 0 ? [] : parents.split(' '),
				author,
				email,
				date,
				subject: subject.join(FIELD_SEP),
			};
		});
}

const REF_KINDS: readonly [prefix: string, kind: Ref['kind']][] = [
	['refs/heads/', 'branch'],
	['refs/remotes/', 'remote'],
	['refs/tags/', 'tag'],
];

export function parseRefs(stdout: string): Ref[] {
	const refs: Ref[] = [];
	for (const line of stdout.split('\n')) {
		if (line.length === 0) continue;
		const [objectname = '', derefed = '', refname = '', upstream = '', head = ''] = line.split(FIELD_SEP);
		const match = REF_KINDS.find(([prefix]) => refname.startsWith(prefix));
		if (match === undefined) continue;
		const [prefix, kind] = match;
		const name = refname.slice(prefix.length);
		if (kind === 'remote' && name.endsWith('/HEAD')) continue;
		const ref: Ref = { hash: derefed.length > 0 ? derefed : objectname, name, kind, isHead: head === '*' };
		if (upstream.length > 0) ref.upstream = upstream;
		refs.push(ref);
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

export function countStatus(stdout: string): number {
	return stdout.split('\n').filter((line) => line.length > 0).length;
}
