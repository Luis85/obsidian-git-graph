import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ChangedFile, FileDiff } from '../../src/git/types';
import FileChange from '../../src/view/FileChange.vue';

const file: ChangedFile = { path: 'a.md', status: 'M' };
const files: ChangedFile[] = [file, { path: 'b.md', status: 'A' }];
const diff: FileDiff = {
	binary: false,
	truncated: false,
	lines: [
		{ kind: 'hunk', text: '@@ -1,2 +1,2 @@' },
		{ kind: 'ctx', text: ' # Title' },
		{ kind: 'del', text: '-Teh' },
		{ kind: 'add', text: '+The' },
	],
};

const mountChange = (over: Record<string, unknown> = {}) => mount(FileChange, { props: { file, diff, error: null, files, ...over } });

describe('FileChange', () => {
	it('renders each diff line with its kind as a class, text as git wrote it', () => {
		const lines = mountChange().findAll('.git-graph-diff-line');
		expect(lines.map((l) => l.text())).toEqual(['@@ -1,2 +1,2 @@', '# Title', '-Teh', '+The']);
		expect(lines.map((l) => l.classes().find((c) => c.startsWith('git-graph-diff-') && c !== 'git-graph-diff-line'))).toEqual([
			'git-graph-diff-hunk',
			'git-graph-diff-ctx',
			'git-graph-diff-del',
			'git-graph-diff-add',
		]);
	});

	it('shows loading, error, binary and empty states', () => {
		expect(mountChange({ diff: { binary: true, truncated: false, lines: [] }, file: { path: 'b.md', status: 'C', oldPath: 'a.md' } }).text()).toContain('Binary file');
		expect(mountChange({ diff: { binary: false, truncated: false, lines: [] }, file: { path: 'b.md', status: 'C', oldPath: 'a.md' } }).text()).toContain('Copied, content unchanged');
		expect(mountChange({ diff: null }).text()).toContain('Loading changes');
		expect(mountChange({ diff: null, error: 'fatal: bad object' }).get('.git-graph-details-error').text()).toBe('fatal: bad object');
		expect(mountChange({ diff: { binary: true, truncated: false, lines: [] } }).text()).toContain('Binary file');
		expect(mountChange({ diff: { binary: false, truncated: false, lines: [] } }).text()).toContain('No content changes');
	});

	it('heads the diff with the status and path, naming the earlier path of a rename or copy', () => {
		const plain = mountChange().get('.git-graph-change-file');
		expect(plain.get('.git-graph-file-status').classes()).toContain('git-graph-file-status-M');
		expect(plain.get('.git-graph-file-path').text()).toBe('a.md');
		const renamed = mountChange({ file: { path: 'a.md', status: 'R', oldPath: 'old.md' }, diff: { binary: false, truncated: false, lines: [] } });
		const renamedPath = renamed.get('.git-graph-change-file .git-graph-file-path');
		expect(renamedPath.text()).toMatch(/^a\.md ←.*old\.md$/);
		expect(renamedPath.attributes('title')).toBe('Renamed from old.md');
		expect(renamed.text()).toContain('Renamed, content unchanged');
		const copied = mountChange({ file: { path: 'b.md', status: 'C', oldPath: 'a.md' } });
		expect(copied.get('.git-graph-change-file .git-graph-file-path').attributes('title')).toBe('Copied from a.md');
		expect(copied.get('.git-graph-change-file').text()).toContain('copied from');
	});

	it('says how much of a cut-short diff it shows', () => {
		expect(mountChange({ diff: { ...diff, truncated: true } }).get('.git-graph-change-notice').text()).toBe('Showing the first 1,500 lines.');
		expect(mountChange().find('.git-graph-change-notice').exists()).toBe(false);
	});

	// Long lines scroll sideways inside the box, so a keyboard user has to be able to reach it.
	it('makes the diff a focusable region named after the file', () => {
		const box = mountChange().get('.git-graph-diff');
		expect(box.attributes('tabindex')).toBe('0');
		expect(box.attributes('role')).toBe('region');
		expect(box.attributes('aria-label')).toBe('Changes to a.md');
	});

	// A null file means nothing is followed in this commit, not a load still to come.
	it('shows no diff and no loading state for a null file, but still lists the files', () => {
		const w = mountChange({ file: null, diff: null });
		expect(w.find('.git-graph-change-file').exists()).toBe(false);
		expect(w.find('.git-graph-diff').exists()).toBe(false);
		expect(w.text()).not.toContain('Loading changes');
		expect(w.get('details.git-graph-change-all summary').text()).toBe('All files (2)');
	});

	// The diff loads on its own, so it can be there before the commit's file list is.
	it('says the files are loading while the commit details are', () => {
		const w = mountChange({ files: null });
		expect(w.get('details.git-graph-change-all summary').text()).toBe('All files');
		expect(w.get('details.git-graph-change-all').text()).toContain('Loading files…');
		expect(w.find('.git-graph-diff').exists()).toBe(true);
	});

	it('leaves the file disclosure out when the commit details failed', () => {
		expect(mountChange({ files: null, filesFailed: true }).find('details.git-graph-change-all').exists()).toBe(false);
	});

	it('opens the disclosure from allOpen and reports its toggles', async () => {
		const w = mountChange({ allOpen: true });
		const all = w.get('details.git-graph-change-all');
		expect(all.attributes('open')).toBeDefined();
		(all.element as HTMLDetailsElement).open = false;
		await all.trigger('toggle');
		expect(w.emitted('update:allOpen')).toEqual([[false]]);
	});

	it('keeps every file of the commit behind a closed disclosure that still opens them', async () => {
		const w = mountChange();
		const all = w.get('details.git-graph-change-all');
		expect(all.attributes('open')).toBeUndefined();
		expect(all.get('summary').text()).toBe('All files (2)');
		await w.findAll('.git-graph-file-link')[1]?.trigger('click');
		expect(w.emitted('openFile')).toEqual([['b.md']]);
	});
});
