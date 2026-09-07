import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import GraphRoot from '../../src/view/GraphRoot.vue';
import { DEFAULT_SETTINGS } from '../../src/settings/types';
import { createEmitter } from '../../src/util/emitter';
import type { RepoState } from '../../src/view/repoState';
import { FakeReader, commit, linear } from '../helpers/fakeReader';

const mountRoot = (repoState: RepoState, changes = createEmitter<void>(), statusChanges = createEmitter<void>(), activeFile: string | null = null) =>
	mount(GraphRoot, { props: { repoState, settings: { ...DEFAULT_SETTINGS, pageSize: 10 }, changes, statusChanges, activeFile } });

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

	it('shows the changes row, not "No commits yet.", for a repository with changes but no commits', async () => {
		const reader = new FakeReader();
		reader.commits = [];
		reader.refsSnapshot = { refs: [], headHash: null, headBranch: 'main' };
		reader.changed = 2;
		reader.dirtyFiles = [{ path: 'first.md', status: 'A' }];
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader });
		await flushPromises();
		expect(w.text()).not.toContain('No commits yet');
		expect(w.get('.git-graph-row-dirty').text()).toContain('2 changes');
		await w.get('.git-graph-row-dirty').trigger('click');
		await flushPromises();
		expect(w.text()).toContain('first.md');
	});

	it('reloads exactly once per settings change (a single settings prop update, not a double load)', async () => {
		const reader = new FakeReader();
		reader.commits = linear(1);
		reader.refsSnapshot = { refs: [], headHash: 'c1', headBranch: 'main' };
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader });
		await flushPromises();
		const callsBefore = reader.logCalls.length;
		await w.setProps({ settings: { ...DEFAULT_SETTINGS, pageSize: 20 } });
		await flushPromises();
		expect(reader.logCalls).toHaveLength(callsBefore + 1);
		expect(reader.logCalls.at(-1)).toMatchObject({ count: 20 });
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

	it('shows the banner, not "No commits yet.", when an empty repository cannot report its status', async () => {
		const reader = new FakeReader();
		reader.commits = [];
		reader.failStatus = new Error('fatal: index locked');
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader });
		await flushPromises();
		expect(w.get('.git-graph-banner').text()).toContain('fatal: index locked');
		expect(w.text()).not.toContain('No commits yet.');
		reader.failStatus = null;
		await w.get('.git-graph-banner button').trigger('click');
		await flushPromises();
		expect(w.find('.git-graph-banner').exists()).toBe(false);
		expect(w.text()).toContain('No commits yet.');
	});

	it('refreshes only the changes row on a status change event', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		reader.changed = 1;
		const statusChanges = createEmitter<void>();
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader }, createEmitter<void>(), statusChanges);
		await flushPromises();
		reader.changed = 4;
		statusChanges.emit();
		await flushPromises();
		expect(w.find('.git-graph-row-dirty').text()).toContain('4 changes');
		expect(reader.logCalls).toHaveLength(1);
	});

	it('sizes the dirty row by the first loaded row when HEAD is not loaded', async () => {
		const reader = new FakeReader();
		reader.commits = [{ ...commit('m', 'a'), parents: ['a', 'b'] }, commit('a', 'r'), commit('b', 'r'), commit('r', null)];
		reader.refsSnapshot = { refs: [], headHash: 'zzz', headBranch: 'main' };
		reader.changed = 1;
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader });
		await flushPromises();
		const rowSvg = w.get('.git-graph-row:not(.git-graph-row-dirty) svg');
		expect(w.get('.git-graph-row-dirty svg').attributes('width')).toBe(rowSvg.attributes('width'));
		expect(w.get('.git-graph-row-dirty svg').attributes('width')).toBe('32');
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

	it('expands the changes row into the working tree files and opens one', async () => {
		const reader = new FakeReader();
		reader.commits = linear(1);
		reader.changed = 2;
		reader.dirtyFiles = [{ path: 'a.md', status: 'M' }, { path: 'notes/b.md', status: 'A' }];
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader });
		await flushPromises();
		await w.get('.git-graph-row-dirty').trigger('click');
		await flushPromises();
		expect(w.findAll('.git-graph-dirty-details .git-graph-file')).toHaveLength(2);
		await w.findAll('.git-graph-dirty-details .git-graph-file-link')[1]?.trigger('click');
		expect(w.emitted('openFile')).toEqual([['notes/b.md']]);
	});

	it('follows the active file while the history toggle is on, and restores the graph when it is off', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		reader.changed = 2;
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader }, undefined, undefined, 'notes/a.md');
		await flushPromises();
		expect(reader.logCalls.at(-1)?.path).toBeUndefined();
		await w.get('button.git-graph-history-toggle').trigger('click');
		await flushPromises();
		expect(reader.logCalls.at(-1)).toMatchObject({ path: 'notes/a.md' });
		expect(w.findAll('.git-graph-row:not(.git-graph-row-dirty)')).toHaveLength(2);
		expect(w.find('svg.git-graph-lanes').exists()).toBe(false);
		expect(w.find('.git-graph-row-dirty').exists()).toBe(false);
		const calls = reader.logCalls.length;
		await w.setProps({ activeFile: 'notes/b.md' });
		await flushPromises();
		expect(reader.logCalls).toHaveLength(calls + 1);
		expect(reader.logCalls.at(-1)).toMatchObject({ path: 'notes/b.md' });
		await w.setProps({ activeFile: 'notes/b.md' });
		await flushPromises();
		expect(reader.logCalls).toHaveLength(calls + 1);
		await w.get('button.git-graph-history-toggle').trigger('click');
		await flushPromises();
		expect(reader.logCalls.at(-1)?.path).toBeUndefined();
		expect(w.find('svg.git-graph-lanes').exists()).toBe(true);
	});

	it('keeps the history mode when the repository re-resolves', async () => {
		const reader = new FakeReader();
		reader.commits = linear(1);
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader }, undefined, undefined, 'notes/a.md');
		await flushPromises();
		await w.get('button.git-graph-history-toggle').trigger('click');
		await flushPromises();
		await w.setProps({ repoState: { kind: 'ready', root: 'C:/vault', reader } });
		await flushPromises();
		expect(reader.logCalls.at(-1)).toMatchObject({ path: 'notes/a.md' });
	});

	it('asks for a file when history is on with none open, and reports an empty file history', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader });
		await flushPromises();
		await w.get('button.git-graph-history-toggle').trigger('click');
		await flushPromises();
		expect(w.text()).toContain('Open a file to see its history.');
		expect(w.findAll('.git-graph-row')).toHaveLength(0);
		expect(reader.logCalls.every((c) => c.path === undefined)).toBe(true);

		reader.commits = [];
		await w.setProps({ activeFile: 'notes/a.md' });
		await flushPromises();
		expect(w.text()).toContain('No commits for this file yet.');
		expect(w.text()).not.toContain('No commits yet.');
	});

	it('re-emits openFile from the expanded commit', async () => {
		const reader = new FakeReader();
		reader.commits = linear(1);
		reader.detailFiles = [{ path: 'notes/a.md', status: 'M' }];
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader });
		await flushPromises();
		await w.get('.git-graph-row').trigger('click');
		reader.resolveDetails();
		await flushPromises();
		await w.get('.git-graph-file-link').trigger('click');
		expect(w.emitted('openFile')).toEqual([['notes/a.md']]);
	});
});
