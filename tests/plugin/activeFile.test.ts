import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App, FileSystemAdapter, Plugin as MockPlugin } from '../helpers/obsidian-mock';
import GitGraphPlugin from '../../src/main';
import { createFixtureRepo, type FixtureRepo } from '../helpers/fixtureRepo';

let fixture: FixtureRepo;
beforeAll(() => {
	fixture = createFixtureRepo();
});
afterAll(() => fixture.dispose());

function makePlugin(basePath: string): GitGraphPlugin & MockPlugin {
	const app = new App();
	app.vault.adapter = new FileSystemAdapter(basePath);
	return new GitGraphPlugin(app as never, { id: 'git-graph' } as never) as GitGraphPlugin & MockPlugin;
}

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
		const app = plugin.app as unknown as App;
		app.workspace.trigger('file-open', { path: 'renamed.md' });
		// Obsidian does not re-fire file-open on a rename, so the vault event is the only
		// signal that `git log --follow` should switch to the new path.
		app.vault.trigger('rename', { path: 'moved.md' }, 'renamed.md');
		expect(plugin.activeFile.value).toBe('moved.md');
		// git knows nothing about the new path until the rename is committed, so every path it
		// may still know is kept — newest first, since a rename committed in between makes the
		// newer path the one whose history is complete.
		expect(plugin.activeFileFallbacks.value).toEqual(['renamed.md']);
		app.vault.trigger('rename', { path: 'again.md' }, 'moved.md');
		expect(plugin.activeFile.value).toBe('again.md');
		expect(plugin.activeFileFallbacks.value).toEqual(['moved.md', 'renamed.md']);
		app.vault.trigger('rename', { path: 'b.md' }, 'a.md');
		expect(plugin.activeFile.value).toBe('again.md');
		expect(plugin.activeFileFallbacks.value).toEqual(['moved.md', 'renamed.md']);
		// Another file's history has nothing to do with this rename chain.
		app.workspace.trigger('file-open', { path: 'other.md' });
		expect(plugin.activeFileFallbacks.value).toEqual([]);
		plugin.onunload();
	});

	it('rewrites the active file under a renamed parent folder, and ignores a rename with no file open', async () => {
		const plugin = makePlugin(fixture.dir);
		await plugin.onload();
		await plugin.initRepo();
		const app = plugin.app as unknown as App;
		app.vault.trigger('rename', { path: 'archive' }, 'notes');
		expect(plugin.activeFile.value).toBeNull();
		app.workspace.trigger('file-open', { path: 'notes/a.md' });
		app.vault.trigger('rename', { path: 'archive' }, 'notes');
		expect(plugin.activeFile.value).toBe('archive/a.md');
		// A folder rename moves the file too, so the fallback is the file's own previous path.
		expect(plugin.activeFileFallbacks.value).toEqual(['notes/a.md']);
		// A path that merely starts with the old one ("archive/a" vs "archive/a.md") is a
		// different file, not a parent folder.
		app.vault.trigger('rename', { path: 'x' }, 'archive/a');
		expect(plugin.activeFile.value).toBe('archive/a.md');
		expect(plugin.activeFileFallbacks.value).toEqual(['notes/a.md']);
		plugin.onunload();
	});

	it('reports a sub-vault file and its fallbacks relative to the repository root', async () => {
		// As with the sub-vault openFile test, the vault base here is a subfolder of the fixture.
		const sub = join(fixture.dir, 'sub');
		mkdirSync(sub, { recursive: true });
		const plugin = makePlugin(sub);
		await plugin.onload();
		await plugin.initRepo();
		const app = plugin.app as unknown as App;
		app.workspace.trigger('file-open', { path: 'x.md' });
		expect(plugin.activeFile.value).toBe('sub/x.md');
		app.vault.trigger('rename', { path: 'y.md' }, 'x.md');
		expect(plugin.activeFile.value).toBe('sub/y.md');
		expect(plugin.activeFileFallbacks.value).toEqual(['sub/x.md']);
		plugin.onunload();
	});
});
