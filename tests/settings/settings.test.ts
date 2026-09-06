import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { GitGraphSettingTab } from '../../src/settings/GitGraphSettingTab';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/settings/types';
import { App as MockApp } from '../helpers/obsidian-mock';

describe('normalizeSettings', () => {
	it('returns defaults for null, garbage and unknown keys', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ bogus: 1 })).toEqual(DEFAULT_SETTINGS);
	});

	it('keeps valid values and drops invalid ones field by field', () => {
		expect(
			normalizeSettings({ gitPath: '/usr/bin/git', refFilter: 'all', pageSize: 50, showDirtyRow: false, dateFormat: 'absolute' }),
		).toEqual({
			gitPath: '/usr/bin/git',
			refFilter: 'all',
			pageSize: 50,
			showDirtyRow: false,
			dateFormat: 'absolute',
		});
		expect(normalizeSettings({ gitPath: '', refFilter: 'some', pageSize: 0, showDirtyRow: 'yes', dateFormat: 3 })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ pageSize: 99999 }).pageSize).toBe(5000);
	});
});

function makeTab() {
	const host = { settings: { ...DEFAULT_SETTINGS }, updateSettings: vi.fn(() => Promise.resolve()) };
	const tab = new GitGraphSettingTab(new MockApp() as unknown as App, host);
	return { host, tab };
}

describe('GitGraphSettingTab', () => {
	it('returns five setting definitions in order with the right names and control key/type pairs', () => {
		const { tab } = makeTab();
		const defs = tab.getSettingDefinitions();

		expect(defs).toHaveLength(5);
		expect(defs.map((d) => ('name' in d ? d.name : undefined))).toEqual([
			'Git executable',
			'Refs to show',
			'Commits per page',
			'Show working tree changes',
			'Date format',
		]);
		expect(
			defs.map((d) => {
				if (!('control' in d) || !d.control) throw new Error('expected a control definition');
				return `${d.control.key}/${d.control.type}`;
			}),
		).toEqual(['gitPath/text', 'refFilter/dropdown', 'pageSize/number', 'showDirtyRow/toggle', 'dateFormat/dropdown']);
	});

	it('getControlValue reads the current value from the host settings', () => {
		const { tab, host } = makeTab();
		host.settings.pageSize = 321;
		expect(tab.getControlValue('pageSize')).toBe(321);
	});

	it('setControlValue coerces and writes each change through the host', async () => {
		const { tab, host } = makeTab();

		await tab.setControlValue('gitPath', 'C:/git/bin/git.exe');
		expect(host.updateSettings).toHaveBeenLastCalledWith({ gitPath: 'C:/git/bin/git.exe' });

		await tab.setControlValue('refFilter', 'all');
		expect(host.updateSettings).toHaveBeenLastCalledWith({ refFilter: 'all' });

		await tab.setControlValue('pageSize', 300);
		expect(host.updateSettings).toHaveBeenLastCalledWith({ pageSize: 300 });

		await tab.setControlValue('pageSize', 'abc');
		expect(host.updateSettings).toHaveBeenCalledTimes(3);

		await tab.setControlValue('showDirtyRow', false);
		expect(host.updateSettings).toHaveBeenLastCalledWith({ showDirtyRow: false });

		await tab.setControlValue('dateFormat', 'absolute');
		expect(host.updateSettings).toHaveBeenLastCalledWith({ dateFormat: 'absolute' });
	});

	it('the pageSize control validates whole numbers within range', () => {
		const { tab } = makeTab();
		const defs = tab.getSettingDefinitions();
		const pageSizeDef = defs[2];
		if (!pageSizeDef || !('control' in pageSizeDef) || !pageSizeDef.control || pageSizeDef.control.type !== 'number') {
			throw new Error('expected the pageSize number control');
		}
		const validate = pageSizeDef.control.validate;
		if (!validate) throw new Error('expected a validate function');

		expect(validate(5)).toEqual(expect.any(String));
		expect(validate(2.5)).toEqual(expect.any(String));
		expect(validate(200)).toBeUndefined();
	});
});
