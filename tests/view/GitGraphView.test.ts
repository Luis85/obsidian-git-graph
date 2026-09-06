import { flushPromises } from '@vue/test-utils';
import type { WorkspaceLeaf } from 'obsidian';
import { nextTick, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings/types';
import { createEmitter } from '../../src/util/emitter';
import { GIT_GRAPH_VIEW, GitGraphView, type ViewHost } from '../../src/view/GitGraphView';
import type { RepoState } from '../../src/view/repoState';
import { FakeReader, linear } from '../helpers/fakeReader';

function makeLeaf(): WorkspaceLeaf {
	return { view: null, setViewState: () => Promise.resolve() } as unknown as WorkspaceLeaf;
}

function makeHost(repoState: RepoState = { kind: 'none' }): ViewHost {
	return {
		settings: { ...DEFAULT_SETTINGS },
		updateSettings: vi.fn(() => Promise.resolve()),
		repoState: shallowRef<RepoState>(repoState),
		settingsRef: shallowRef({ ...DEFAULT_SETTINGS }),
		changes: createEmitter<void>(),
		statusChanges: createEmitter<void>(),
		viewOpened: vi.fn(),
		viewClosed: vi.fn(),
	};
}

describe('GitGraphView', () => {
	it('reports the view type, display text and icon', () => {
		const view = new GitGraphView(makeLeaf(), makeHost());
		expect(view.getViewType()).toBe(GIT_GRAPH_VIEW);
		expect(view.getViewType()).toBe('git-graph');
		expect(view.getDisplayText()).toBe('Git graph');
		expect(view.getIcon()).toBe('git-graph');
	});

	it('mounts the root on open, tracks repoState reactivity, and unmounts on close', async () => {
		const host = makeHost({ kind: 'none' });
		const view = new GitGraphView(makeLeaf(), host);

		await view.onOpen();
		const mounted = view.contentEl.querySelector('.git-graph-mount .git-graph-view');
		expect(mounted).not.toBeNull();
		expect(mounted?.textContent).toContain('not a git repository');
		expect(host.viewOpened).toHaveBeenCalledTimes(1);

		host.repoState.value = { kind: 'error', message: 'boom' };
		await nextTick();
		expect(view.contentEl.querySelector('.git-graph-view')?.textContent).toContain('boom');

		await view.onClose();
		expect(view.contentEl.querySelector('.git-graph-view')).toBeNull();
		expect(host.viewClosed).toHaveBeenCalledTimes(1);
	});

	it('emits an updateSettings call through the host when the ref filter changes', async () => {
		const reader = new FakeReader();
		reader.commits = linear(1);
		const host = makeHost({ kind: 'ready', root: 'C:/vault', reader });
		const view = new GitGraphView(makeLeaf(), host);

		await view.onOpen();
		await flushPromises();

		const select = view.contentEl.querySelector('select.git-graph-ref-filter');
		expect(select).not.toBeNull();
		const selectEl = select as HTMLSelectElement;
		selectEl.value = 'all';
		selectEl.dispatchEvent(new Event('change'));
		await flushPromises();

		expect(host.updateSettings).toHaveBeenCalledWith({ refFilter: 'all' });
	});
});
