import { GitError } from '../git/GitError';

export function errorMessage(e: unknown): string {
	if (e instanceof GitError || e instanceof Error) return e.message;
	return String(e);
}
