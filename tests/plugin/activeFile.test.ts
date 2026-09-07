import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { App, FileSystemAdapter, Plugin as MockPlugin } from '../helpers/obsidian-mock';
import GitGraphPlugin from '../../src/main';
import { createEmptyRepo, createFixtureRepo, type EmptyRepo, type FixtureRepo } from '../helpers/fixtureRepo';

let fixture: FixtureRepo;
const temps: EmptyRepo[] = [];
beforeAll(() => {
	fixture = createFixtureRepo();
});
afterAll(() => {
	fixture.dispose();
	for (const t of temps) t.dispose();
});

/** A repository with the given files in one commit, used as the vault; disposed with the suite. */
function seededRepo(files: Record<string, string>): EmptyRepo {
	const repo = createEmptyRepo('git-graph-active-');
	temps.push(repo);
	for (const [path, body] of Object.entries(files)) {
		mkdirSync(dirname(join(repo.dir, path)), { recursive: true });
		writeFileSync(join(repo.dir, path), body);
	}
	repo.git('add', '-A');
	repo.git('commit', '-q', '-m', 'Seed');
	return repo;
}

function makePlugin(basePath: string): GitGraphPlugin & MockPlugin {
	const app = new App();
	app.vault.adapter = new FileSystemAdapter(basePath);
	return new GitGraphPlugin(app as never, { id: 'git-graph' } as never) as GitGraphPlugin & MockPlugin;
}

interface HeadProbe {
	calls: string[];
	settled: number;
}

/** Wraps the ready repository's `inHead` so a test can tell when the plugin's own checks finished. */
function probeInHead(plugin: GitGraphPlugin): HeadProbe {
	const state = plugin.repoState.value;
	if (state.kind !== 'ready') throw new Error('probeInHead needs a ready repository');
	const probe: HeadProbe = { calls: [], settled: 0 };
	const inHead = state.reader.inHead.bind(state.reader);
	state.reader.inHead = async (path: string): Promise<boolean> => {
		probe.calls.push(path);
		const result = await inHead(path);
		probe.settled++;
		return result;
	};
	return probe;
}

/** Waits for `count` probed checks and then for the microtasks that consume their results. */
async function settled(probe: HeadProbe, count: number): Promise<void> {
	await vi.waitFor(() => expect(probe.settled).toBeGreaterThanOrEqual(count), { timeout: 10000, interval: 20 });
	await new Promise((resolve) => window.setTimeout(resolve, 0));
}

const waitForFallbacks = (plugin: GitGraphPlugin, expected: string[]): Promise<void> =>
	vi.waitFor(() => expect(plugin.activeFileFallbacks.value).toEqual(expected), { timeout: 10000, interval: 20 });

// Which file the header's history toggle points at, and which earlier paths git may still know
// it under. Split out of main.test.ts to keep both files under the per-file line cap.
describe('GitGraphPlugin active file tracking', () => {
	it('tracks the last opened file and ignores a null file-open event', async () => {
		const plugin = makePlugin(fixture.dir);
		await plugin.onload();
		await plugin.initRepo();
		const app = plugin.app as unknown as App;
		expect(plugin.activeFile.value).toBeNull();
		app.workspace.trigger('file-open', { path: 'renamed.md' });
		expect(plugin.activeFile.value).toBe('renamed.md');
		expect(plugin.activeFileFallbacks.value).toEqual([]);
		// Obsidian fires file-open with null whenever a non-file leaf (the graph pane itself,
		// when its history toggle is clicked) becomes active; the history must not reset.
		app.workspace.trigger('file-open', null);
		expect(plugin.activeFile.value).toBe('renamed.md');
		plugin.onunload();
	});

	it('seeds the active file from the workspace on layout ready', async () => {
		const plugin = makePlugin(fixture.dir);
		(plugin.app as unknown as App).workspace.activeFile = { path: 'renamed.md' };
		await plugin.onload();
		await plugin.initRepo();
		expect(plugin.activeFile.value).toBe('renamed.md');
		plugin.onunload();
	});

	it('reports a file opened before the repository resolved once the state is ready', async () => {
		const plugin = makePlugin(fixture.dir);
		await plugin.onload();
		(plugin.app as unknown as App).workspace.trigger('file-open', { path: 'renamed.md' });
		expect(plugin.repoState.value.kind).toBe('unresolved');
		expect(plugin.activeFile.value).toBeNull();
		await plugin.initRepo();
		expect(plugin.activeFile.value).toBe('renamed.md');
		plugin.onunload();
	});

	it('follows a chain of renames of the active file and ignores renames of other files', async () => {
		const plugin = makePlugin(fixture.dir);
		await plugin.onload();
		await plugin.initRepo();
		const probe = probeInHead(plugin);
		const app = plugin.app as unknown as App;
		app.workspace.trigger('file-open', { path: 'renamed.md' });
		// Obsidian does not re-fire file-open on a rename, so the vault event is the only
		// signal that `git log --follow` should switch to the new path.
		app.vault.trigger('rename', { path: 'moved.md' }, 'renamed.md');
		// The header moves at once; whether the old name is worth keeping takes a git call.
		expect(plugin.activeFile.value).toBe('moved.md');
		await waitForFallbacks(plugin, ['renamed.md']);
		// moved.md was never committed, so no commit can be found under it: as a fallback it
		// would only ever return nothing, and it is dropped.
		app.vault.trigger('rename', { path: 'again.md' }, 'moved.md');
		expect(plugin.activeFile.value).toBe('again.md');
		await settled(probe, 2);
		expect(plugin.activeFileFallbacks.value).toEqual(['renamed.md']);
		app.vault.trigger('rename', { path: 'b.md' }, 'a.md');
		expect(plugin.activeFile.value).toBe('again.md');
		expect(plugin.activeFileFallbacks.value).toEqual(['renamed.md']);
		// Another file's history has nothing to do with this rename chain.
		app.workspace.trigger('file-open', { path: 'other.md' });
		expect(plugin.activeFileFallbacks.value).toEqual([]);
		plugin.onunload();
	});

	it('rewrites the active file under a renamed parent folder, and ignores a rename with no file open', async () => {
		const repo = seededRepo({ 'notes/a.md': 'a\n' });
		const plugin = makePlugin(repo.dir);
		await plugin.onload();
		await plugin.initRepo();
		const probe = probeInHead(plugin);
		const app = plugin.app as unknown as App;
		app.vault.trigger('rename', { path: 'archive' }, 'notes');
		expect(plugin.activeFile.value).toBeNull();
		app.workspace.trigger('file-open', { path: 'notes/a.md' });
		app.vault.trigger('rename', { path: 'archive' }, 'notes');
		expect(plugin.activeFile.value).toBe('archive/a.md');
		// A folder rename moves the file too, so the fallback is the file's own previous path.
		await waitForFallbacks(plugin, ['notes/a.md']);
		// A path that merely starts with the old one ("archive/a" vs "archive/a.md") is a
		// different file, not a parent folder.
		app.vault.trigger('rename', { path: 'x' }, 'archive/a');
		expect(plugin.activeFile.value).toBe('archive/a.md');
		await settled(probe, 1);
		expect(plugin.activeFileFallbacks.value).toEqual(['notes/a.md']);
		plugin.onunload();
	});

	it('reports a sub-vault file and its fallbacks relative to the repository root', async () => {
		// As with the sub-vault openFile test, the vault base here is a subfolder of the repository.
		const repo = seededRepo({ 'sub/x.md': 'x\n' });
		const plugin = makePlugin(join(repo.dir, 'sub'));
		await plugin.onload();
		await plugin.initRepo();
		const app = plugin.app as unknown as App;
		app.workspace.trigger('file-open', { path: 'x.md' });
		expect(plugin.activeFile.value).toBe('sub/x.md');
		app.vault.trigger('rename', { path: 'y.md' }, 'x.md');
		expect(plugin.activeFile.value).toBe('sub/y.md');
		await waitForFallbacks(plugin, ['sub/x.md']);
		plugin.onunload();
	});

	it('does not remember an earlier path git never knew', async () => {
		const repo = seededRepo({ 'note.md': 'n\n' });
		const plugin = makePlugin(repo.dir);
		await plugin.onload();
		await plugin.initRepo();
		const probe = probeInHead(plugin);
		const app = plugin.app as unknown as App;
		// new.md was created in the vault and never committed, so no history hides under it.
		app.workspace.trigger('file-open', { path: 'new.md' });
		app.vault.trigger('rename', { path: 'newer.md' }, 'new.md');
		expect(plugin.activeFile.value).toBe('newer.md');
		await settled(probe, 1);
		expect(probe.calls).toEqual(['new.md']);
		expect(plugin.activeFileFallbacks.value).toEqual([]);
		plugin.onunload();
	});
});

describe('GitGraphPlugin retires committed renames', () => {
	it('drops an earlier path once its rename is committed, and never takes it back', async () => {
		const repo = seededRepo({ 'a.md': 'a\n' });
		const plugin = makePlugin(repo.dir);
		await plugin.onload();
		await plugin.initRepo();
		const probe = probeInHead(plugin);
		const app = plugin.app as unknown as App;
		app.workspace.trigger('file-open', { path: 'a.md' });
		renameSync(join(repo.dir, 'a.md'), join(repo.dir, 'b.md'));
		app.vault.trigger('rename', { path: 'b.md' }, 'a.md');
		await waitForFallbacks(plugin, ['a.md']);

		// Committing the rename makes `--follow` from b.md reach a.md's commits by itself.
		repo.git('add', '-A');
		repo.git('commit', '-q', '-m', 'Rename a.md to b.md');
		plugin.changes.emit();
		await waitForFallbacks(plugin, []);

		// A stranger later taking the retired name back must not resurrect it as a fallback.
		writeFileSync(join(repo.dir, 'a.md'), 'unrelated\n');
		repo.git('add', '-A');
		repo.git('commit', '-q', '-m', 'Add an unrelated a.md');
		const before = probe.settled;
		plugin.changes.emit();
		await new Promise((resolve) => window.setTimeout(resolve, 0));
		expect(probe.settled).toBe(before);
		expect(plugin.activeFileFallbacks.value).toEqual([]);
		plugin.onunload();
	});

	it('keeps the newer half of a chain whose older rename was committed unseen', async () => {
		const repo = seededRepo({ 'a.md': 'a\n' });
		const plugin = makePlugin(repo.dir);
		await plugin.onload();
		await plugin.initRepo();
		const app = plugin.app as unknown as App;
		app.workspace.trigger('file-open', { path: 'a.md' });
		renameSync(join(repo.dir, 'a.md'), join(repo.dir, 'b.md'));
		app.vault.trigger('rename', { path: 'b.md' }, 'a.md');
		await waitForFallbacks(plugin, ['a.md']);

		// Committed without the plugin hearing about it (no watcher event), so both names stay.
		repo.git('add', '-A');
		repo.git('commit', '-q', '-m', 'Rename a.md to b.md');
		renameSync(join(repo.dir, 'b.md'), join(repo.dir, 'c.md'));
		app.vault.trigger('rename', { path: 'c.md' }, 'b.md');
		await waitForFallbacks(plugin, ['b.md', 'a.md']);

		// b.md is still in HEAD and is the note's committed identity; a.md is behind a
		// committed rename, so `--follow` from b.md already covers it.
		plugin.changes.emit();
		await waitForFallbacks(plugin, ['b.md']);
		plugin.onunload();
	});

	it('retires on viewOpened, for a commit made while the watcher was paused', async () => {
		const repo = seededRepo({ 'a.md': 'a\n' });
		const plugin = makePlugin(repo.dir);
		await plugin.onload();
		await plugin.initRepo();
		const app = plugin.app as unknown as App;
		app.workspace.trigger('file-open', { path: 'a.md' });
		renameSync(join(repo.dir, 'a.md'), join(repo.dir, 'b.md'));
		app.vault.trigger('rename', { path: 'b.md' }, 'a.md');
		await waitForFallbacks(plugin, ['a.md']);
		repo.git('add', '-A');
		repo.git('commit', '-q', '-m', 'Rename a.md to b.md');
		plugin.viewOpened();
		await waitForFallbacks(plugin, []);
		plugin.viewClosed();
		plugin.onunload();
	});

	it('retires when the repository is re-resolved', async () => {
		const repo = seededRepo({ 'a.md': 'a\n' });
		const plugin = makePlugin(repo.dir);
		await plugin.onload();
		await plugin.initRepo();
		const app = plugin.app as unknown as App;
		app.workspace.trigger('file-open', { path: 'a.md' });
		renameSync(join(repo.dir, 'a.md'), join(repo.dir, 'b.md'));
		app.vault.trigger('rename', { path: 'b.md' }, 'a.md');
		await waitForFallbacks(plugin, ['a.md']);
		repo.git('add', '-A');
		repo.git('commit', '-q', '-m', 'Rename a.md to b.md');
		await plugin.initRepo();
		expect(plugin.activeFileFallbacks.value).toEqual([]);
		plugin.onunload();
	});

	it('discards a check that lands after unload', async () => {
		const repo = seededRepo({ 'a.md': 'a\n' });
		const plugin = makePlugin(repo.dir);
		await plugin.onload();
		await plugin.initRepo();
		const probe = probeInHead(plugin);
		const app = plugin.app as unknown as App;
		app.workspace.trigger('file-open', { path: 'a.md' });
		app.vault.trigger('rename', { path: 'b.md' }, 'a.md');
		plugin.onunload();
		await settled(probe, 1);
		expect(plugin.activeFileFallbacks.value).toEqual([]);
	});
});
