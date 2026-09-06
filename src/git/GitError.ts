export type GitErrorCode = 'ENOENT' | 'TIMEOUT' | 'EXIT';

export class GitError extends Error {
	constructor(
		readonly code: GitErrorCode,
		readonly args: readonly string[],
		readonly stderr: string,
		readonly exitCode: number | null,
	) {
		super(GitError.describe(code, args, stderr));
		this.name = 'GitError';
	}

	private static describe(code: GitErrorCode, args: readonly string[], stderr: string): string {
		const cmd = `git ${args.join(' ')}`;
		if (code === 'ENOENT') return `git executable not found (${cmd})`;
		if (code === 'TIMEOUT') return `git timed out (${cmd})`;
		return stderr.trim() || `git failed (${cmd})`;
	}
}
