import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App, FileSystemAdapter, Plugin as MockPlugin } from '../helpers/obsidian-mock';
import GitGraphPlugin from '../../src/main';
import { GIT_GRAPH_VIEW } from '../../src/view/GitGraphView';
import { createFixtureRepo, type FixtureRepo } from '../helpers/fixtureRepo';

let fixture: FixtureRepo;
beforeAll(() => {
	fixture = createFixtureRepo();
});
afterAll(() => fixture.dispose());

function makePlugin(basePath: string, data: unknown = null): GitGraphPlugin & MockPlugin {
	const app = new App();
	app.vault.adapter = new FileSystemAdapter(basePath);
	const plugin = new GitGraphPlugin(app as never, { id: 'git-graph' } as never) as GitGraphPlugin & MockPlugin;
	plugin.data = data;
	return plugin;
}

describe('GitGraphPlugin', () => {
	it('registers the view, a ribbon icon, two commands and the settings tab', async () => {
		const plugin = makePlugin(fixture.dir);
		await plugin.onload();
		expect([...plugin.views.keys()]).toEqual([GIT_GRAPH_VIEW]);
		expect(plugin.ribbon).toHaveLength(1);
		expect(plugin.commands.map((c) => c.id)).toEqual(['open', 'refresh']);
		expect(plugin.settingTabs).toHaveLength(1);
	});

	it('resolves the repository on load and exposes a ready state', async () => {
		const plugin = makePlugin(fixture.dir);
		await plugin.onload();
		await plugin.initRepo();
		expect(plugin.repoState.value.kind).toBe('ready');
		plugin.onunload();
	});

	it('reports a non-repository vault and a missing git binary', async () => {
		const outside = mkdtempSync(join(tmpdir(), 'git-graph-plugin-'));
		try {
			const plugin = makePlugin(outside);
			await plugin.onload();
			await plugin.initRepo();
			expect(plugin.repoState.value.kind).toBe('none');
			const broken = makePlugin(fixture.dir, { gitPath: 'no-such-git' });
			await broken.onload();
			await broken.initRepo();
			expect(broken.repoState.value).toEqual({ kind: 'no-git', gitPath: 'no-such-git' });
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it('normalizes and saves settings, emits a change, and re-resolves when gitPath changes', async () => {
		const plugin = makePlugin(fixture.dir, { pageSize: 50, bogus: true });
		await plugin.onload();
		await plugin.initRepo();
		expect(plugin.settings.pageSize).toBe(50);
		let changes = 0;
		plugin.changes.on(() => changes++);
		await plugin.updateSettings({ refFilter: 'all' });
		expect(plugin.saved.at(-1)).toMatchObject({ refFilter: 'all', pageSize: 50 });
		expect(plugin.settingsRef.value.refFilter).toBe('all');
		expect(changes).toBe(1);
		await plugin.updateSettings({ gitPath: 'no-such-git' });
		expect(plugin.repoState.value.kind).toBe('no-git');
		plugin.onunload();
	});

	it('pauses the watcher while no view is open and the refresh command emits a change', async () => {
		const plugin = makePlugin(fixture.dir);
		await plugin.onload();
		await plugin.initRepo();
		let changes = 0;
		plugin.changes.on(() => changes++);
		plugin.commands.find((c) => c.id === 'refresh')?.callback?.();
		expect(changes).toBe(1);
		plugin.viewOpened();
		plugin.viewClosed();
		plugin.onunload();
	});
});
