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
	/**
	 * `path`, when given, narrows the log to one file's history (renames followed). It is
	 * repository-relative with forward slashes — not relative to the reader's working directory,
	 * which for a vault nested inside a larger repository is a subdirectory of the root.
	 * `GitRepository` anchors it with the `:(top,literal)` pathspec magic accordingly, which also
	 * stops a name like `Meeting [2026].md` being read as a glob.
	 *
	 * `fallbackPath` is used when `path` has no history yet — an uncommitted rename — in which
	 * case the history of this path is served instead.
	 */
	log(opts: { skip: number; count: number; refs: RefFilter; path?: string; fallbackPath?: string }): Promise<Commit[]>;
	refs(): Promise<RefsSnapshot>;
	status(): Promise<{ changed: number }>;
	statusFiles(): Promise<ChangedFile[]>;
	commitDetails(hash: string): Promise<CommitDetails>;
}
