import { FileSystemAdapter, Notice, Plugin, type TFile } from 'obsidian';
import { resolve } from 'node:path';
import { shallowRef } from 'vue';
import { GitError } from './git/GitError';
import { GitRepository } from './git/GitRepository';
import { GitGraphSettingTab } from './settings/GitGraphSettingTab';
import { DEFAULT_SETTINGS, normalizeSettings, type GitGraphSettings } from './settings/types';
import { createEmitter } from './util/emitter';
import { relativeWithin } from './util/paths';
import { GIT_GRAPH_ICON, GIT_GRAPH_VIEW, GitGraphView, type ViewHost } from './view/GitGraphView';
import type { RepoState } from './view/repoState';
import { createGitWatcher, type GitWatcher } from './watch/gitWatcher';

/** How long to wait after the last gitPath edit before re-resolving the repository. */
export const GIT_PATH_DEBOUNCE_MS = 500;
/** How long to wait after the last vault edit before refreshing the dirty-changes count. */
export const STATUS_DEBOUNCE_MS = 500;

export default class GitGraphPlugin extends Plugin implements ViewHost {
	settings: GitGraphSettings = { ...DEFAULT_SETTINGS };
	readonly settingsRef = shallowRef<GitGraphSettings>(this.settings);
	readonly repoState = shallowRef<RepoState>({ kind: 'unresolved' });
	readonly changes = createEmitter<void>();
	readonly statusChanges = createEmitter<void>();
	/** Repository-relative path of Obsidian's active file, or null while none is known. */
	readonly activeFile = shallowRef<string | null>(null);

	private watcher: GitWatcher | null = null;
	/**
	 * Vault-relative path of the last file Obsidian opened; survives null `file-open` events.
	 * Renaming the active file does not re-fire `file-open`, so this stays the pre-rename path
	 * until another file is opened — `git log --follow` still reports that file's history.
	 */
	private activeVaultPath: string | null = null;
	private openViews = 0;
	private initGeneration = 0;
	// Runs in Obsidian's Electron renderer, so timers go through `window` per the
	// obsidianmd popout-window rule (obsidianmd/prefer-window-timers).
	private reinitTimer: number | null = null;
	private statusTimer: number | null = null;

	async onload(): Promise<void> {
		let data: unknown = null;
		try {
			data = await this.loadData();
		} catch (e) {
			console.error('Git graph: failed to load settings, using defaults', e);
		}
		this.settings = normalizeSettings(data);
		this.settingsRef.value = this.settings;

		this.registerView(GIT_GRAPH_VIEW, (leaf) => new GitGraphView(leaf, this));
		this.addRibbonIcon(GIT_GRAPH_ICON, 'Open Git graph', () => void this.activateView());
		this.addCommand({ id: 'open', name: 'Open', callback: () => void this.activateView() });
		this.addCommand({ id: 'refresh', name: 'Refresh', callback: () => this.refresh() });
		this.addSettingTab(new GitGraphSettingTab(this.app, this));
		this.registerVaultWatchers();
		// Obsidian fires `file-open` with null whenever a non-file leaf becomes active — the graph
		// pane itself does that when its history toggle is clicked — so null events are ignored and
		// the history keeps showing the file that is still open in the editor.
		this.registerEvent(
			this.app.workspace.on('file-open', (file: TFile | null) => {
				if (file === null) return;
				this.activeVaultPath = file.path;
				this.resolveActiveFile();
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			// Same policy as the `file-open` handler: the seed may set a path, never clear one.
			this.activeVaultPath = this.app.workspace.getActiveFile()?.path ?? this.activeVaultPath;
			void this.initRepo();
		});
	}

	onunload(): void {
		this.initGeneration++;
		this.watcher?.dispose();
		this.watcher = null;
		if (this.reinitTimer !== null) {
			window.clearTimeout(this.reinitTimer);
			this.reinitTimer = null;
		}
		if (this.statusTimer !== null) {
			window.clearTimeout(this.statusTimer);
			this.statusTimer = null;
		}
	}

	/** Refreshes the dirty-changes count (debounced) whenever a vault file is touched. */
	private registerVaultWatchers(): void {
		const onVaultEdit = (): void => this.scheduleStatusRefresh();
		this.registerEvent(this.app.vault.on('modify', onVaultEdit));
		this.registerEvent(this.app.vault.on('create', onVaultEdit));
		this.registerEvent(this.app.vault.on('delete', onVaultEdit));
		this.registerEvent(this.app.vault.on('rename', onVaultEdit));
	}

	/** Debounces vault edits into a single `statusChanges` emit, only while a view is open and the repo is ready. */
	private scheduleStatusRefresh(): void {
		if (this.openViews === 0 || this.repoState.value.kind !== 'ready') return;
		if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
		this.statusTimer = window.setTimeout(() => {
			this.statusTimer = null;
			this.statusChanges.emit();
		}, STATUS_DEBOUNCE_MS);
	}

	/** Resolves the repository for the vault folder and (re)starts the watcher. Safe to call again. */
	async initRepo(): Promise<void> {
		const gen = ++this.initGeneration;
		this.watcher?.dispose();
		this.watcher = null;
		this.repoState.value = { kind: 'unresolved' };
		this.resolveActiveFile();

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
			const watcher = await this.resolveWatcher(reader, gen);
			if (watcher === null) return;
			this.watcher = watcher;
			if (this.openViews === 0) this.watcher.pause();
			this.repoState.value = { kind: 'ready', root, reader };
			// A file opened before the repository resolved is only convertible now.
			this.resolveActiveFile();
		} catch (e) {
			if (gen !== this.initGeneration) return;
			if (e instanceof GitError && e.code === 'ENOENT') {
				this.repoState.value = { kind: 'no-git', gitPath: this.settings.gitPath };
			} else {
				this.repoState.value = { kind: 'error', message: e instanceof Error ? e.message : String(e) };
			}
		}
	}

	/**
	 * Recomputes `activeFile` from the last opened vault file. Null unless the repository is
	 * ready, a file is known and it lives inside the repository root.
	 */
	private resolveActiveFile(): void {
		const state = this.repoState.value;
		const adapter = this.app.vault.adapter;
		const vaultPath = this.activeVaultPath;
		if (state.kind !== 'ready' || vaultPath === null || !(adapter instanceof FileSystemAdapter)) {
			this.activeFile.value = null;
			return;
		}
		this.activeFile.value = relativeWithin(state.root, resolve(adapter.getBasePath(), vaultPath));
	}

	/** Resolves gitDir/commonDir and builds the watcher, bailing out (returning null) if a newer initRepo() has since started. */
	private async resolveWatcher(reader: GitRepository, gen: number): Promise<GitWatcher | null> {
		const gitDir = await reader.gitDir();
		if (gen !== this.initGeneration) return null;
		const commonDir = await reader.gitCommonDir();
		if (gen !== this.initGeneration) return null;
		return createGitWatcher(gitDir, () => this.changes.emit(), {
			commonDir,
			onError: () => new Notice('Git graph: automatic refresh is unavailable. Use the refresh button.'),
		});
	}

	async updateSettings(patch: Partial<GitGraphSettings>): Promise<void> {
		const previousGitPath = this.settings.gitPath;
		this.settings = normalizeSettings({ ...this.settings, ...patch });
		await this.saveData(this.settings);
		this.settingsRef.value = this.settings;
		// A changed identity (normalizeSettings always returns a new object) is enough to make
		// settingsRef's watcher in GraphRoot reload — no separate changes.emit() needed here.
		if (patch.gitPath !== undefined && this.settings.gitPath !== previousGitPath) this.scheduleReinit();
	}

	/** Debounces initRepo() so a partially-typed gitPath doesn't spawn git on every keystroke. */
	private scheduleReinit(): void {
		if (this.reinitTimer !== null) window.clearTimeout(this.reinitTimer);
		this.reinitTimer = window.setTimeout(() => {
			this.reinitTimer = null;
			void this.initRepo();
		}, GIT_PATH_DEBOUNCE_MS);
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

	/**
	 * Opens a repository-relative path in the current leaf when it lives inside this vault.
	 * `relativeWithin` canonicalizes both the vault base path and the resolved target, so a
	 * vault opened through a symlink or junction resolves to the same directory git reports.
	 */
	openFile(path: string): void {
		const state = this.repoState.value;
		const adapter = this.app.vault.adapter;
		if (state.kind !== 'ready' || !(adapter instanceof FileSystemAdapter)) return;
		const vaultRelative = relativeWithin(adapter.getBasePath(), resolve(state.root, path));
		if (vaultRelative === null) {
			void new Notice(`Git graph: ${path} is outside this vault.`);
			return;
		}
		const file = this.app.vault.getFileByPath(vaultRelative);
		if (file === null) {
			void new Notice(`Git graph: ${vaultRelative} is not in the vault (deleted or ignored).`);
			return;
		}
		void this.app.workspace.getLeaf(false).openFile(file);
	}
}
