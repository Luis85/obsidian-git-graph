import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs')>();
	return { ...actual, watch: vi.fn(actual.watch) };
});

import { createGitWatcher, type GitWatcher } from '../../src/watch/gitWatcher';

let gitDir: string;
let watcher: GitWatcher | null = null;

const settle = () => new Promise((r) => setTimeout(r, 150));

beforeEach(() => {
	gitDir = mkdtempSync(join(tmpdir(), 'git-graph-watch-'));
	mkdirSync(join(gitDir, 'refs', 'heads'), { recursive: true });
	mkdirSync(join(gitDir, 'refs', 'tags'), { recursive: true });
	mkdirSync(join(gitDir, 'logs'), { recursive: true });
	writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
	writeFileSync(join(gitDir, 'index'), '');
	writeFileSync(join(gitDir, 'logs', 'HEAD'), '');
});

afterEach(() => {
	watcher?.dispose();
	watcher = null;
	rmSync(gitDir, { recursive: true, force: true });
});

describe('createGitWatcher', () => {
	it('fires once, debounced, when HEAD and a ref change together', async () => {
		const onChange = vi.fn();
		watcher = createGitWatcher(gitDir, onChange, { debounceMs: 50 });
		await settle();
		writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/other\n');
		writeFileSync(join(gitDir, 'refs', 'heads', 'main'), 'abc\n');
		await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 2000 });
	});

	it('fires for a new ref inside refs/heads', async () => {
		const onChange = vi.fn();
		watcher = createGitWatcher(gitDir, onChange, { debounceMs: 50 });
		await settle();
		writeFileSync(join(gitDir, 'refs', 'heads', 'feature'), 'def\n');
		await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 2000 });
	});

	it('drops events while paused and fires once on resume if anything was dropped', async () => {
		const onChange = vi.fn();
		watcher = createGitWatcher(gitDir, onChange, { debounceMs: 50 });
		await settle();
		watcher.pause();
		writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/other\n');
		await settle();
		expect(onChange).not.toHaveBeenCalled();
		watcher.resume();
		expect(onChange).toHaveBeenCalledTimes(1);
		watcher.resume();
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it('is silent after dispose', async () => {
		const onChange = vi.fn();
		watcher = createGitWatcher(gitDir, onChange, { debounceMs: 50 });
		await settle();
		watcher.dispose();
		writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/other\n');
		await settle();
		expect(onChange).not.toHaveBeenCalled();
		watcher = null;
	});

	it('reports a missing directory through onError and still returns a watcher', () => {
		const onError = vi.fn();
		watcher = createGitWatcher(join(gitDir, 'does-not-exist'), () => undefined, { onError });
		expect(onError).toHaveBeenCalledTimes(1);
		watcher.dispose();
		watcher = null;
	});

	it('watches refs and packed-refs in the common dir when it differs from gitDir', async () => {
		const common = mkdtempSync(join(tmpdir(), 'git-graph-common-'));
		try {
			mkdirSync(join(common, 'refs', 'heads'), { recursive: true });
			const onChange = vi.fn();
			watcher = createGitWatcher(gitDir, onChange, { debounceMs: 50, commonDir: common });
			await settle();
			writeFileSync(join(common, 'refs', 'heads', 'shared'), 'abc\n');
			await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 2000 });
			writeFileSync(join(common, 'packed-refs'), '# pack-refs\n');
			await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2), { timeout: 2000 });
		} finally {
			watcher?.dispose();
			watcher = null;
			rmSync(common, { recursive: true, force: true });
		}
	});

	it('does not watch the git dir twice when commonDir is the same directory under another spelling', async () => {
		const watchesFor = (commonDir?: string): number => {
			vi.mocked(watch).mockClear();
			const w = createGitWatcher(gitDir, () => undefined, commonDir === undefined ? {} : { commonDir });
			const n = vi.mocked(watch).mock.calls.length;
			w.dispose();
			return n;
		};
		const plain = watchesFor();
		expect(plain).toBeGreaterThan(0);
		const link = join(realpathSync.native(tmpdir()), `git-graph-watch-link-${process.pid}`);
		symlinkSync(gitDir, link, 'junction');
		try {
			expect(watchesFor(link)).toBe(plain);
			if (process.platform === 'win32') expect(watchesFor(gitDir.toUpperCase())).toBe(plain);
		} finally {
			rmSync(link, { force: true });
		}
	});
});
