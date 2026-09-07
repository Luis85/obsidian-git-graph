import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { createApp, h, type App as VueApp, type ShallowRef } from 'vue';
import type { GitGraphSettings } from '../settings/types';
import type { SettingsHost } from '../settings/GitGraphSettingTab';
import type { Emitter } from '../util/emitter';
import GraphRoot from './GraphRoot.vue';
import type { RepoState } from './repoState';

export const GIT_GRAPH_VIEW = 'git-graph';
export const GIT_GRAPH_ICON = 'git-graph';

export interface ViewHost extends SettingsHost {
	readonly repoState: ShallowRef<RepoState>;
	readonly settingsRef: ShallowRef<GitGraphSettings>;
	readonly changes: Emitter<void>;
	readonly statusChanges: Emitter<void>;
	/**
	 * Repository-relative path of Obsidian's active file. Null when no file has been opened yet,
	 * when the repository is not ready, and when the file lies outside the repository root.
	 */
	readonly activeFile: ShallowRef<string | null>;
	/**
	 * Repository-relative paths `activeFile` had before Obsidian renamed it, newest first, while
	 * those renames are still uncommitted — the paths git may know the file's history under.
	 * Empty otherwise.
	 */
	readonly activeFileFallbacks: ShallowRef<readonly string[]>;
	viewOpened(): void;
	viewClosed(): void;
	openFile(path: string): void;
}

export class GitGraphView extends ItemView {
	private vueApp: VueApp | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly host: ViewHost,
	) {
		super(leaf);
	}

	getViewType(): string {
		return GIT_GRAPH_VIEW;
	}

	getDisplayText(): string {
		return 'Git graph';
	}

	getIcon(): string {
		return GIT_GRAPH_ICON;
	}

	onOpen(): Promise<void> {
		this.contentEl.empty();
		const mountEl = this.contentEl.createDiv('git-graph-mount');
		const host = this.host;
		this.vueApp = createApp({
			render: () =>
				h(GraphRoot, {
					repoState: host.repoState.value,
					settings: host.settingsRef.value,
					changes: host.changes,
					statusChanges: host.statusChanges,
					activeFile: host.activeFile.value,
					activeFileFallbacks: host.activeFileFallbacks.value,
					onUpdateSettings: (patch: Partial<GitGraphSettings>) => void host.updateSettings(patch),
					onOpenFile: (path: string) => host.openFile(path),
				}),
		});
		this.vueApp.mount(mountEl);
		host.viewOpened();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.vueApp?.unmount();
		this.vueApp = null;
		this.host.viewClosed();
		return Promise.resolve();
	}
}
