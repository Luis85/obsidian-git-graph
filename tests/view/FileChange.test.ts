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
		expect(mountChange({ diff: null }).text()).toContain('Loading changes');
		expect(mountChange({ diff: null, error: 'fatal: bad object' }).get('.git-graph-details-error').text()).toBe('fatal: bad object');
		expect(mountChange({ diff: { binary: true, truncated: false, lines: [] } }).text()).toContain('Binary file');
		expect(mountChange({ diff: { binary: false, truncated: false, lines: [] } }).text()).toContain('No content changes');
	});

	it('names the earlier path of a rename, and says when it carried no content change', () => {
		const w = mountChange({ file: { path: 'a.md', status: 'R', oldPath: 'old.md' }, diff: { binary: false, truncated: false, lines: [] } });
		expect(w.get('.git-graph-change-rename').text()).toContain('old.md');
		expect(w.text()).toContain('content unchanged');
		expect(mountChange().find('.git-graph-change-rename').exists()).toBe(false);
	});

	it('says when the diff was cut short', () => {
		expect(mountChange({ diff: { ...diff, truncated: true } }).text()).toContain('truncated');
		expect(mountChange().text()).not.toContain('truncated');
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
