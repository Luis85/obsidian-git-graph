export type RefFilter = 'auto' | 'all';
export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T';

export interface Commit {
	hash: string;
	parents: string[];
	author: string;
	email: string;
	date: string;
	subject: string;
}

export interface Ref {
	hash: string;
	name: string;
	kind: 'branch' | 'remote' | 'tag';
	isHead: boolean;
	upstream?: string;
}

export interface RefsSnapshot {
	refs: Ref[];
	headHash: string | null;
	headBranch: string | null;
}

export interface ChangedFile {
	path: string;
	status: FileStatus;
	oldPath?: string;
}

export interface CommitDetails {
	hash: string;
	author: string;
	email: string;
	authorDate: string;
	committer: string;
	commitDate: string;
	body: string;
	files: ChangedFile[];
}

export interface GitReader {
	log(opts: { skip: number; count: number; refs: RefFilter; path?: string }): Promise<Commit[]>;
	refs(): Promise<RefsSnapshot>;
	status(): Promise<{ changed: number }>;
	statusFiles(): Promise<ChangedFile[]>;
	commitDetails(hash: string): Promise<CommitDetails>;
}
