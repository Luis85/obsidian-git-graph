import { FileSystemAdapter, Notice, Plugin } from 'obsidian';
import { shallowRef } from 'vue';
import { GitError } from './git/GitError';
import { GitRepository } from './git/GitRepository';
import { GitGraphSettingTab } from './settings/GitGraphSettingTab';
import { DEFAULT_SETTINGS, normalizeSettings, type GitGraphSettings } from './settings/types';
import { createEmitter } from './util/emitter';
import { GIT_GRAPH_ICON, GIT_GRAPH_VIEW, GitGraphView, type ViewHost } from './view/GitGraphView';
import type { RepoState } from './view/repoState';
import { createGitWatcher, type GitWatcher } from './watch/gitWatcher';

export default class GitGraphPlugin extends Plugin implements ViewHost {
	settings: GitGraphSettings = { ...DEFAULT_SETTINGS };
	readonly settingsRef = shallowRef<GitGraphSettings>(this.settings);
	readonly repoState = shallowRef<RepoState>({ kind: 'unresolved' });
	readonly changes = createEmitter<void>();

	private watcher: GitWatcher | null = null;
	private openViews = 0;
	private initGeneration = 0;

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.settingsRef.value = this.settings;

		this.registerView(GIT_GRAPH_VIEW, (leaf) => new GitGraphView(leaf, this));
		this.addRibbonIcon(GIT_GRAPH_ICON, 'Open git graph', () => void this.activateView());
		this.addCommand({ id: 'open', name: 'Open git graph', callback: () => void this.activateView() });
		this.addCommand({ id: 'refresh', name: 'Refresh git graph', callback: () => this.refresh() });
		this.addSettingTab(new GitGraphSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => void this.initRepo());
	}

	onunload(): void {
		this.watcher?.dispose();
		this.watcher = null;
	}

	/** Resolves the repository for the vault folder and (re)starts the watcher. Safe to call again. */
	async initRepo(): Promise<void> {
		const gen = ++this.initGeneration;
		this.watcher?.dispose();
		this.watcher = null;
		this.repoState.value = { kind: 'unresolved' };

		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			this.repoState.value = { kind: 'error', message: 'Git graph needs a desktop vault on the local file system.' };
			return;
		}
		const cwd = adapter.getBasePath();
		const reader = new GitRepository({ gitPath: this.settings.gitPath, cwd });
		try {
			const root = await reader.resolveRepoRoot();
			if (gen !== this.initGeneration) return;
			if (root === null) {
				this.repoState.value = { kind: 'none' };
				return;
			}
			const gitDir = await reader.gitDir();
			if (gen !== this.initGeneration) return;
			this.watcher = createGitWatcher(gitDir, () => this.changes.emit(), {
				onError: () => new Notice('Git graph: automatic refresh is unavailable. Use the refresh button.'),
			});
			if (this.openViews === 0) this.watcher.pause();
			this.repoState.value = { kind: 'ready', root, reader };
		} catch (e) {
			if (gen !== this.initGeneration) return;
			if (e instanceof GitError && e.code === 'ENOENT') {
				this.repoState.value = { kind: 'no-git', gitPath: this.settings.gitPath };
			} else {
				this.repoState.value = { kind: 'error', message: e instanceof Error ? e.message : String(e) };
			}
		}
	}

	async updateSettings(patch: Partial<GitGraphSettings>): Promise<void> {
		this.settings = normalizeSettings({ ...this.settings, ...patch });
		await this.saveData(this.settings);
		this.settingsRef.value = this.settings;
		if (patch.gitPath !== undefined) await this.initRepo();
		else this.changes.emit();
	}

	refresh(): void {
		this.changes.emit();
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(GIT_GRAPH_VIEW)[0];
		const leaf = existing ?? workspace.getRightLeaf(false);
		if (leaf === null) return;
		if (!existing) await leaf.setViewState({ type: GIT_GRAPH_VIEW, active: true });
		await workspace.revealLeaf(leaf);
	}

	viewOpened(): void {
		this.openViews++;
		if (this.openViews === 1) this.watcher?.resume();
	}

	viewClosed(): void {
		this.openViews = Math.max(0, this.openViews - 1);
		if (this.openViews === 0) this.watcher?.pause();
	}
}
