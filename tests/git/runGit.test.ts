import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GitError } from '../../src/git/GitError';
import { runGit } from '../../src/git/runGit';

const cwd = mkdtempSync(join(tmpdir(), 'git-graph-rungit-'));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

describe('runGit', () => {
	it('returns stdout of a successful command', async () => {
		const out = await runGit('git', cwd, ['--version']);
		expect(out).toMatch(/^git version /);
	});

	it('throws GitError EXIT with stderr on a failing command', async () => {
		const err = await runGit('git', cwd, ['rev-parse', '--show-toplevel']).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(GitError);
		const gitErr = err as GitError;
		expect(gitErr.code).toBe('EXIT');
		expect(gitErr.exitCode).not.toBe(0);
		expect(gitErr.stderr).toMatch(/not a git repository/);
		expect(gitErr.args).toEqual(['rev-parse', '--show-toplevel']);
	});

	it('throws GitError ENOENT when the binary does not exist', async () => {
		const err = await runGit('definitely-not-git-xyz', cwd, ['--version']).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(GitError);
		expect((err as GitError).code).toBe('ENOENT');
	});

	it('throws GitError TIMEOUT when the command exceeds the timeout', async () => {
		// `git credential fill` blocks reading stdin until EOF, but runGit closes stdin
		// immediately (child.stdin?.end()), so on some platforms it exits before the
		// timeout fires. Use a command that is slow regardless of stdin state instead.
		const err = await runGit('node', cwd, ['-e', 'setTimeout(()=>{},5000)'], { timeoutMs: 200 }).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(GitError);
		expect((err as GitError).code).toBe('TIMEOUT');
	});

	it('throws GitError EXIT (not TIMEOUT) when output exceeds maxBuffer', async () => {
		const err = await runGit('node', cwd, ['-e', "process.stdout.write('x'.repeat(2000))"], { maxBuffer: 100 }).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(GitError);
		const gitErr = err as GitError;
		expect(gitErr.code).toBe('EXIT');
		expect(gitErr.stderr).toMatch(/exceeded the 0 MiB buffer/);
	});

	it('reports the actual configured maxBuffer size in the message', async () => {
		const err = await runGit('node', cwd, ['-e', `process.stdout.write('x'.repeat(${3 * 1024 * 1024}))`], { maxBuffer: 2 * 1024 * 1024 }).catch(
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(GitError);
		expect((err as GitError).stderr).toMatch(/2 MiB/);
	});
});
