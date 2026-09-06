import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import GraphRoot from '../../src/view/GraphRoot.vue';
import { DEFAULT_SETTINGS } from '../../src/settings/types';
import { createEmitter } from '../../src/util/emitter';
import type { RepoState } from '../../src/view/repoState';
import { FakeReader, linear } from '../helpers/fakeReader';

const mountRoot = (repoState: RepoState, changes = createEmitter<void>()) =>
	mount(GraphRoot, { props: { repoState, settings: { ...DEFAULT_SETTINGS, pageSize: 10 }, changes } });

describe('GraphRoot', () => {
	it('renders the non-repo, missing-git, error and unresolved states', () => {
		expect(mountRoot({ kind: 'none' }).text()).toContain('not a git repository');
		expect(mountRoot({ kind: 'no-git', gitPath: 'C:/nope/git.exe' }).text()).toContain('C:/nope/git.exe');
		expect(mountRoot({ kind: 'error', message: 'boom' }).text()).toContain('boom');
		expect(mountRoot({ kind: 'unresolved' }).text()).toContain('Looking for');
	});

	it('loads and renders rows when ready, and reloads on a change event', async () => {
		const reader = new FakeReader();
		reader.commits = linear(3);
		reader.refsSnapshot = { refs: [], headHash: 'c1', headBranch: 'main' };
		const changes = createEmitter<void>();
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader }, changes);
		await flushPromises();
		expect(w.findAll('.git-graph-row:not(.git-graph-row-dirty)')).toHaveLength(3);
		expect(w.get('.git-graph-branch').text()).toBe('main');
		expect(reader.logCalls).toHaveLength(1);
		changes.emit();
		await flushPromises();
		expect(reader.logCalls).toHaveLength(2);
	});

	it('shows the dirty row when there are changes and hides it when the setting is off', async () => {
		const reader = new FakeReader();
		reader.commits = linear(1);
		reader.refsSnapshot = { refs: [], headHash: 'c1', headBranch: 'main' };
		reader.changed = 2;
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader });
		await flushPromises();
		expect(w.find('.git-graph-row-dirty').text()).toContain('2 changes');
		await w.setProps({ settings: { ...DEFAULT_SETTINGS, showDirtyRow: false } });
		await flushPromises();
		expect(w.find('.git-graph-row-dirty').exists()).toBe(false);
	});

	it('shows an error banner with retry while keeping rows, and clears it on success', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader });
		await flushPromises();
		reader.failLog = new Error('fatal: broken');
		await w.get('button.git-graph-refresh').trigger('click');
		await flushPromises();
		expect(w.get('.git-graph-banner').text()).toContain('fatal: broken');
		expect(w.findAll('.git-graph-row')).toHaveLength(2);
		reader.failLog = null;
		await w.get('.git-graph-banner button').trigger('click');
		await flushPromises();
		expect(w.find('.git-graph-banner').exists()).toBe(false);
	});

	it('emits updateSettings when the ref filter changes and expands a row on click', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader });
		await flushPromises();
		await w.get('select.git-graph-ref-filter').setValue('all');
		expect(w.emitted('updateSettings')).toEqual([[{ refFilter: 'all' }]]);
		await w.findAll('.git-graph-row')[0]?.trigger('click');
		expect(w.find('.git-graph-details').exists()).toBe(true);
	});
});
