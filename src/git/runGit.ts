import { execFile } from 'node:child_process';
import { GitError } from './GitError';

export interface RunGitOptions {
	timeoutMs?: number;
	maxBuffer?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/** Runs git with stdin closed so no command can wait for a terminal. */
export function runGit(gitPath: string, cwd: string, args: readonly string[], opts: RunGitOptions = {}): Promise<string> {
	const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
	return new Promise((resolve, reject) => {
		const child = execFile(
			gitPath,
			[...args],
			{ cwd, timeout, maxBuffer, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } },
			(error, stdout, stderr) => {
				if (error === null) {
					resolve(stdout);
					return;
				}
				const e = error as NodeJS.ErrnoException & { killed?: boolean; code?: string | number; signal?: string };
				if (e.code === 'ENOENT') {
					reject(new GitError('ENOENT', args, stderr, null));
				} else if (e.killed === true || e.signal === 'SIGTERM') {
					reject(new GitError('TIMEOUT', args, stderr, null));
				} else {
					reject(new GitError('EXIT', args, stderr, typeof e.code === 'number' ? e.code : null));
				}
			},
		);
		child.stdin?.end();
	});
}
