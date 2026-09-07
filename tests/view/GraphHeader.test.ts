import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import GraphHeader from '../../src/view/GraphHeader.vue';

const mountHeader = (over: Record<string, unknown> = {}) =>
	mount(GraphHeader, { props: { repoName: 'my-vault', branch: 'main', refFilter: 'auto', filterText: '', loading: false, historyActive: false, historyFile: null, ...over } });

describe('GraphHeader', () => {
	it('shows repo name and branch, and "detached" when there is no branch', () => {
		expect(mountHeader().get('.git-graph-title').text()).toContain('my-vault');
		expect(mountHeader().get('.git-graph-branch').text()).toBe('main');
		expect(mountHeader({ branch: null }).get('.git-graph-branch').text()).toBe('detached');
	});

	it('emits ref filter, filter text and refresh', async () => {
		const w = mountHeader();
		await w.get('select.git-graph-ref-filter').setValue('all');
		expect(w.emitted('update:refFilter')).toEqual([['all']]);
		await w.get('input.git-graph-filter').setValue('fix');
		expect(w.emitted('update:filterText')).toEqual([['fix']]);
		await w.get('button.git-graph-refresh').trigger('click');
		expect(w.emitted('refresh')).toHaveLength(1);
	});

	it('disables refresh while loading', () => {
		expect(mountHeader({ loading: true }).get('button.git-graph-refresh').attributes('disabled')).toBeDefined();
	});

	it('toggles file history and reports its pressed state', async () => {
		const off = mountHeader();
		const button = off.get('button.git-graph-history-toggle');
		expect(button.attributes('aria-label')).toBe('Show history of the active file');
		expect(button.attributes('aria-pressed')).toBe('false');
		expect(button.classes()).not.toContain('is-active');
		await button.trigger('click');
		expect(off.emitted('update:historyActive')).toEqual([[true]]);

		const on = mountHeader({ historyActive: true, historyFile: 'notes/a.md' });
		expect(on.get('button.git-graph-history-toggle').attributes('aria-pressed')).toBe('true');
		expect(on.get('button.git-graph-history-toggle').classes()).toContain('is-active');
		await on.get('button.git-graph-history-toggle').trigger('click');
		expect(on.emitted('update:historyActive')).toEqual([[false]]);
	});

	it('shows the active file name instead of the branch while history is on', () => {
		const w = mountHeader({ historyActive: true, historyFile: 'notes/daily/2026-09-07.md' });
		expect(w.get('.git-graph-history-file').text()).toBe('2026-09-07.md');
		expect(w.get('.git-graph-history-file').attributes('title')).toBe('notes/daily/2026-09-07.md');
		expect(w.find('.git-graph-branch').exists()).toBe(false);
		expect(mountHeader({ historyActive: true }).get('.git-graph-branch').text()).toBe('main');
		expect(mountHeader({ historyFile: 'notes/a.md' }).get('.git-graph-branch').text()).toBe('main');
	});
});
