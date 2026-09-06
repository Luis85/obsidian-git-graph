import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
		await settle();
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it('fires for a new ref inside refs/heads', async () => {
		const onChange = vi.fn();
		watcher = createGitWatcher(gitDir, onChange, { debounceMs: 50 });
		await settle();
		writeFileSync(join(gitDir, 'refs', 'heads', 'feature'), 'def\n');
		await settle();
		expect(onChange).toHaveBeenCalledTimes(1);
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
});
