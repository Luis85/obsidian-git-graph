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
	viewOpened(): void;
	viewClosed(): void;
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
					onUpdateSettings: (patch: Partial<GitGraphSettings>) => void host.updateSettings(patch),
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
