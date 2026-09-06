import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import FileList from '../../src/view/FileList.vue';
import type { ChangedFile } from '../../src/git/types';

const mountList = (files: ChangedFile[]) => mount(FileList, { props: { files } });

describe('FileList', () => {
	it('opens a file on click, Enter and Space, and ignores other keys', async () => {
		const w = mountList([{ path: 'a.md', status: 'M' }]);
		const link = w.get('.git-graph-file-link');
		await link.trigger('click');
		await link.trigger('keydown', { key: 'Enter' });
		await link.trigger('keydown', { key: ' ' });
		await link.trigger('keydown', { key: 'x' });
		expect(w.emitted('openFile')).toEqual([['a.md'], ['a.md'], ['a.md']]);
	});

	it('renders a deleted file muted, unfocusable and inert, with a title saying why', async () => {
		const w = mountList([{ path: 'gone.md', status: 'D' }]);
		const link = w.get('.git-graph-file-link');
		expect(link.classes()).toContain('git-graph-file-deleted');
		expect(link.attributes('tabindex')).toBeUndefined();
		expect(link.attributes('role')).toBeUndefined();
		expect(link.attributes('aria-disabled')).toBe('true');
		expect(link.attributes('title')).toContain('cannot be opened');
		await link.trigger('click');
		await link.trigger('keydown', { key: 'Enter' });
		expect(w.emitted('openFile')).toBeUndefined();
	});

	it('shows the empty message when there are no files', () => {
		expect(mountList([]).get('.git-graph-files-empty').text()).toBe('No file changes');
	});

	it('keeps a rename and a modification of the same path apart through a reorder that revisits the same paths', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			const w = mountList([
				{ path: 'a.md', status: 'M' },
				{ path: 'b.md', status: 'M' },
			]);
			await w.setProps({
				files: [
					{ path: 'b.md', status: 'M' },
					{ path: 'a.md', status: 'R', oldPath: 'c.md' },
					{ path: 'a.md', status: 'M' },
				],
			});
			expect(w.findAll('.git-graph-file')).toHaveLength(3);
			expect(warn.mock.calls.flat().some((arg) => String(arg).includes('Duplicate keys'))).toBe(false);
		} finally {
			warn.mockRestore();
		}
	});
});
