import { execFile } from 'node:child_process';
import { GitError } from './GitError';

export interface RunGitOptions {
	timeoutMs?: number;
	maxBuffer?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/** Runs git with stdin closed so no command can wait for a terminal. */
export async function runGit(gitPath: string, cwd: string, args: readonly string[], opts: RunGitOptions = {}): Promise<string> {
	const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
	const { stdout, truncated } = await execGit(gitPath, cwd, args, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer);
	if (truncated) throw new GitError('EXIT', args, `git output exceeded the ${Math.floor(maxBuffer / (1024 * 1024))} MiB buffer`, null);
	return stdout;
}

/**
 * Like runGit, but output past `maxBuffer` bytes ends the read instead of failing it: git is
 * stopped and what it wrote up to the cap comes back with `truncated: true`. The cut can fall
 * mid-line. For reads whose tail the caller would throw away anyway.
 */
export function runGitCapped(gitPath: string, cwd: string, args: readonly string[], maxBuffer: number): Promise<{ stdout: string; truncated: boolean }> {
	return execGit(gitPath, cwd, args, DEFAULT_TIMEOUT_MS, maxBuffer);
}

function execGit(gitPath: string, cwd: string, args: readonly string[], timeout: number, maxBuffer: number): Promise<{ stdout: string; truncated: boolean }> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			gitPath,
			[...args],
			{ cwd, timeout, maxBuffer, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } },
			(error, stdout, stderr) => {
				if (error === null) {
					resolve({ stdout, truncated: false });
					return;
				}
				const e = error as NodeJS.ErrnoException & { killed?: boolean; code?: string | number; signal?: string };
				// Node stops the child at the cap and still hands over the output read up to it.
				if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') resolve({ stdout, truncated: true });
				else if (e.code === 'ENOENT') reject(new GitError('ENOENT', args, stderr, null));
				else if (e.killed === true || e.signal === 'SIGTERM') reject(new GitError('TIMEOUT', args, stderr, null));
				else reject(new GitError('EXIT', args, stderr, typeof e.code === 'number' ? e.code : null));
			},
		);
		child.stdin?.end();
	});
}
