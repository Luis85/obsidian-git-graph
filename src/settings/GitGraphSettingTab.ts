import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import { isValidGitPath, MAX_PAGE_SIZE, MIN_PAGE_SIZE, type GitGraphSettings } from './types';

export interface SettingsHost {
	settings: GitGraphSettings;
	updateSettings(patch: Partial<GitGraphSettings>): Promise<void>;
}

type Key = keyof GitGraphSettings;

export class GitGraphSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly host: SettingsHost,
	) {
		// The real Plugin instance is what the base class wants; the host is the plugin in production.
		super(app, host as never);
	}

	getSettingDefinitions(): SettingDefinitionItem<Key>[] {
		return [
			{
				name: 'Git executable',
				desc: 'Path or command used to run Git. Leave as "git" to use the one on your path.',
				control: {
					type: 'text',
					key: 'gitPath',
					placeholder: 'git',
					validate: (v) => (isValidGitPath(v) ? undefined : 'Enter a command on your PATH or an absolute path.'),
				},
			},
			{
				name: 'Refs to show',
				desc: 'Auto shows the current branch, its upstream and the default remote branch. All shows every branch and tag.',
				control: { type: 'dropdown', key: 'refFilter', options: { auto: 'Auto', all: 'All' } },
			},
			{
				name: 'Commits per page',
				desc: `How many commits to load at once (${MIN_PAGE_SIZE} to ${MAX_PAGE_SIZE}). More load as you scroll.`,
				control: {
					type: 'number',
					key: 'pageSize',
					min: MIN_PAGE_SIZE,
					max: MAX_PAGE_SIZE,
					step: 1,
					validate: (v) =>
						Number.isInteger(v) && v >= MIN_PAGE_SIZE && v <= MAX_PAGE_SIZE
							? undefined
							: `Enter a whole number between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE}.`,
				},
			},
			{
				name: 'Show working tree changes',
				desc: 'Show a row above the newest commit with the number of uncommitted changes.',
				control: { type: 'toggle', key: 'showDirtyRow' },
			},
			{
				name: 'Date format',
				desc: 'Relative shows "3 days ago"; absolute shows the date and time.',
				control: { type: 'dropdown', key: 'dateFormat', options: { relative: 'Relative', absolute: 'Absolute' } },
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.host.settings[key as Key];
	}

	setControlValue(key: string, value: unknown): Promise<void> {
		switch (key as Key) {
			case 'gitPath': {
				const trimmed = String(value).trim();
				if (!isValidGitPath(trimmed)) return Promise.resolve();
				return this.host.updateSettings({ gitPath: trimmed });
			}
			case 'refFilter':
				return this.host.updateSettings({ refFilter: value === 'all' ? 'all' : 'auto' });
			case 'pageSize': {
				const n = Number.parseInt(String(value), 10);
				if (!Number.isFinite(n) || n < MIN_PAGE_SIZE || n > MAX_PAGE_SIZE) return Promise.resolve();
				return this.host.updateSettings({ pageSize: n });
			}
			case 'showDirtyRow':
				return this.host.updateSettings({ showDirtyRow: Boolean(value) });
			case 'dateFormat':
				return this.host.updateSettings({ dateFormat: value === 'absolute' ? 'absolute' : 'relative' });
			default:
				return Promise.resolve();
		}
	}
}
