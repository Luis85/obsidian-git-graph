import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App, FileSystemAdapter, Plugin as MockPlugin } from '../helpers/obsidian-mock';
import GitGraphPlugin, { GIT_PATH_DEBOUNCE_MS } from '../../src/main';
import { DEFAULT_SETTINGS } from '../../src/settings/types';
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
		// The mock's onLayoutReady invokes its callback synchronously, so onload() already
		// parked a floating initRepo() on resolveRepoRoot. Awaiting a second initRepo() makes
		// generation 1 bail out (so it never touches repoState after this test returns), and
		// onunload() disposes the watcher that generation 2 installs — otherwise a live
		// fs.watch on fixture.dir/.git outlives the test and races afterAll's rmSync.
		await plugin.initRepo();
		plugin.onunload();
	});

	it('resolves the repository on load and exposes a ready state', async () => {
		const plugin = makePlugin(fixture.dir);
		await plugin.onload();
		await plugin.initRepo();
		expect(plugin.repoState.value.kind).toBe('ready');
		plugin.onunload();
	});

	it('still registers the view and falls back to default settings when loadData rejects', async () => {
		const plugin = makePlugin(fixture.dir);
		plugin.loadData = () => Promise.reject(new Error('corrupt'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		await plugin.onload();
		expect([...plugin.views.keys()]).toEqual([GIT_GRAPH_VIEW]);
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
		await plugin.initRepo();
		plugin.onunload();
	});

	it('reports a non-repository vault and a missing git binary', async () => {
		const outside = mkdtempSync(join(tmpdir(), 'git-graph-plugin-'));
		try {
			const plugin = makePlugin(outside);
			await plugin.onload();
			await plugin.initRepo();
			expect(plugin.repoState.value.kind).toBe('none');
			plugin.onunload();
			const broken = makePlugin(fixture.dir, { gitPath: 'no-such-git' });
			await broken.onload();
			await broken.initRepo();
			expect(broken.repoState.value).toEqual({ kind: 'no-git', gitPath: 'no-such-git' });
			broken.onunload();
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	it('normalizes and saves settings and updates settingsRef without emitting a change event', async () => {
		// GraphRoot reloads off settingsRef's identity change (normalizeSettings always returns
		// a new object), so updateSettings must not also emit on `changes` — that would be a
		// second, stale-settings reload. See GraphRoot.vue's settings watch.
		const plugin = makePlugin(fixture.dir, { pageSize: 50, bogus: true });
		await plugin.onload();
		await plugin.initRepo();
		expect(plugin.settings.pageSize).toBe(50);
		let changes = 0;
		plugin.changes.on(() => changes++);
		await plugin.updateSettings({ refFilter: 'all' });
		expect(plugin.saved.at(-1)).toMatchObject({ refFilter: 'all', pageSize: 50 });
		expect(plugin.settingsRef.value.refFilter).toBe('all');
		expect(changes).toBe(0);
		plugin.onunload();
	});

	describe('gitPath changes', () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		it('rejects a relative gitPath from updateSettings without scheduling a re-init', async () => {
			vi.useFakeTimers();
			const plugin = makePlugin(fixture.dir);
			await plugin.onload();
			await plugin.initRepo();
			const initRepoSpy = vi.spyOn(plugin, 'initRepo');
			await plugin.updateSettings({ gitPath: './relative/git' });
			expect(plugin.settings.gitPath).toBe('git');
			await vi.advanceTimersByTimeAsync(GIT_PATH_DEBOUNCE_MS + 100);
			expect(initRepoSpy).not.toHaveBeenCalled();
			plugin.onunload();
		});

		it('debounces the re-init: repoState stays ready until 500ms pass, then becomes no-git', async () => {
			vi.useFakeTimers();
			const plugin = makePlugin(fixture.dir);
			await plugin.onload();
			await plugin.initRepo();
			expect(plugin.repoState.value.kind).toBe('ready');
			const update = plugin.updateSettings({ gitPath: 'no-such-git' });
			await update;
			expect(plugin.repoState.value.kind).toBe('ready');
			await vi.advanceTimersByTimeAsync(GIT_PATH_DEBOUNCE_MS);
			expect(plugin.repoState.value.kind).toBe('no-git');
			plugin.onunload();
		});

		it('collapses two rapid gitPath updates into exactly one initRepo call', async () => {
			vi.useFakeTimers();
			const plugin = makePlugin(fixture.dir);
			await plugin.onload();
			await plugin.initRepo();
			const initRepoSpy = vi.spyOn(plugin, 'initRepo');
			await plugin.updateSettings({ gitPath: 'no-such-git' });
			await plugin.updateSettings({ gitPath: 'still-no-such-git' });
			await vi.advanceTimersByTimeAsync(GIT_PATH_DEBOUNCE_MS);
			expect(initRepoSpy).toHaveBeenCalledTimes(1);
			plugin.onunload();
		});

		it('schedules nothing when gitPath is set to its current value', async () => {
			vi.useFakeTimers();
			const plugin = makePlugin(fixture.dir);
			await plugin.onload();
			await plugin.initRepo();
			const initRepoSpy = vi.spyOn(plugin, 'initRepo');
			await plugin.updateSettings({ gitPath: plugin.settings.gitPath });
			await vi.advanceTimersByTimeAsync(GIT_PATH_DEBOUNCE_MS);
			expect(initRepoSpy).not.toHaveBeenCalled();
			plugin.onunload();
		});
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

	describe('lifecycle and vault-driven status refresh', () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		it('unloading cancels an in-flight repository resolution', async () => {
			const plugin = makePlugin(fixture.dir);
			await plugin.onload();
			const pending = plugin.initRepo();
			plugin.onunload();
			await pending;
			expect(plugin.repoState.value.kind).toBe('unresolved');
		});

		it('debounces vault edits into one status change while a view is open', async () => {
			vi.useFakeTimers();
			const plugin = makePlugin(fixture.dir);
			await plugin.onload();
			await plugin.initRepo();
			let statusChanges = 0;
			plugin.statusChanges.on(() => statusChanges++);
			const app = plugin.app as unknown as App;
			app.vault.trigger('modify');
			await vi.advanceTimersByTimeAsync(600);
			expect(statusChanges).toBe(0); // no view open
			plugin.viewOpened();
			app.vault.trigger('modify');
			app.vault.trigger('create');
			await vi.advanceTimersByTimeAsync(600);
			expect(statusChanges).toBe(1);
			expect(plugin.registeredEvents.map((r) => r.name)).toEqual(['modify', 'create', 'delete', 'rename']);
			plugin.onunload();
		});
	});
});
