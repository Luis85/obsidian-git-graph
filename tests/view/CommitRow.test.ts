import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CommitRow from '../../src/view/CommitRow.vue';
import type { Commit, Ref } from '../../src/git/types';
import type { Row } from '../../src/graph/types';

const commit: Commit = { hash: 'abcdef1234567890', parents: [], author: 'Ann', email: 'a@x', date: '2026-09-06T10:00:00Z', subject: 'Fix the graph' };
const row: Row = { hash: commit.hash, lane: 0, color: 0, isMerge: false, laneCount: 1, segments: [] };
const refs: Ref[] = [
	{ hash: commit.hash, name: 'v1', kind: 'tag', isHead: false },
	{ hash: commit.hash, name: 'origin/main', kind: 'remote', isHead: false },
	{ hash: commit.hash, name: 'feature', kind: 'branch', isHead: false },
	{ hash: commit.hash, name: 'main', kind: 'branch', isHead: true, upstream: 'origin/main' },
];

const mountRow = (over: Partial<InstanceType<typeof CommitRow>['$props']> = {}) =>
	mount(CommitRow, { props: { row, commit, refs, isHead: true, expanded: false, dateFormat: 'absolute', showGraph: true, ...over } });

describe('CommitRow', () => {
	it('renders subject, author, absolute date and the lane cell', () => {
		const w = mountRow();
		expect(w.get('.git-graph-subject').text()).toBe('Fix the graph');
		expect(w.get('.git-graph-author').text()).toBe('Ann');
		expect(w.get('.git-graph-date').text()).toMatch(/^2026-09-06 \d\d:\d\d$/);
		expect(w.find('svg.git-graph-lanes').exists()).toBe(true);
	});

	it('orders badges head, branches, remotes, tags and marks the upstream', () => {
		const w = mountRow();
		const badges = w.findAll('.git-graph-ref');
		expect(badges.map((b) => b.text())).toEqual(['main', 'feature', 'origin/main', 'v1']);
		expect(badges[2]?.classes()).toContain('git-graph-ref-upstream');
	});

	it('hides the lane cell when showGraph is false', () => {
		expect(mountRow({ showGraph: false }).find('svg').exists()).toBe(false);
	});

	it('emits toggle on click and on Enter, and reflects expanded', async () => {
		const w = mountRow({ expanded: true });
		expect(w.classes()).toContain('git-graph-row-expanded');
		await w.trigger('click');
		await w.trigger('keydown', { key: 'Enter' });
		await w.trigger('keydown', { key: 'x' });
		expect(w.emitted('toggle')).toHaveLength(2);
	});
});
