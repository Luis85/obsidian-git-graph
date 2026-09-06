import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import CommitDetails from '../../src/view/CommitDetails.vue';
import type { CommitDetails as Details } from '../../src/git/types';

const details: Details = {
	hash: 'abcdef1234567890',
	author: 'Ann',
	email: 'a@x',
	authorDate: '2026-09-06T10:00:00Z',
	committer: 'Cara',
	commitDate: '2026-09-06T11:00:00Z',
	body: 'Fix the graph\n\nLonger explanation.',
	files: [
		{ path: 'a.md', status: 'M' },
		{ path: 'new.md', status: 'R', oldPath: 'old.md' },
	],
};

describe('CommitDetails', () => {
	it('shows loading, then error', () => {
		expect(mount(CommitDetails, { props: { details: null, error: null } }).text()).toContain('Loading');
		expect(mount(CommitDetails, { props: { details: null, error: 'fatal: nope' } }).text()).toContain('fatal: nope');
	});

	it('renders hash, people, body and files with status letters', () => {
		const w = mount(CommitDetails, { props: { details, error: null } });
		expect(w.get('.git-graph-details-hash').text()).toContain('abcdef1234567890');
		expect(w.text()).toContain('Ann <a@x>');
		expect(w.text()).toContain('Cara');
		expect(w.get('pre.git-graph-details-body').text()).toBe('Fix the graph\n\nLonger explanation.');
		const files = w.findAll('.git-graph-file');
		expect(files).toHaveLength(2);
		expect(files[0]?.get('.git-graph-file-status').classes()).toContain('git-graph-file-status-M');
		expect(files[1]?.text()).toContain('new.md');
		expect(files[1]?.text()).toContain('old.md');
	});

	it('copies the hash to the clipboard', async () => {
		const writeText = vi.fn(() => Promise.resolve());
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const w = mount(CommitDetails, { props: { details, error: null } });
		await w.get('button.git-graph-copy').trigger('click');
		expect(writeText).toHaveBeenCalledWith('abcdef1234567890');
	});

	it('emits openFile with the current path when a file is clicked or activated with Enter', async () => {
		const w = mount(CommitDetails, { props: { details, error: null } });
		const files = w.findAll('.git-graph-file');
		expect(files).toHaveLength(2);
		await files[0]!.trigger('click');
		await files[0]!.trigger('keydown', { key: 'Enter' });
		await files[1]!.trigger('click');
		expect(w.emitted('openFile')).toEqual([['a.md'], ['a.md'], ['new.md']]);
	});
});
