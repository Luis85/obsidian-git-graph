import type { GitReader } from '../git/types';

export type RepoState =
	| { kind: 'unresolved' }
	| { kind: 'none' }
	| { kind: 'no-git'; gitPath: string }
	| { kind: 'error'; message: string }
	| { kind: 'ready'; root: string; reader: GitReader };
