import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import LaneCell from '../../src/view/LaneCell.vue';
import type { Row } from '../../src/graph/types';

const row: Row = {
	hash: 'B',
	lane: 1,
	color: 1,
	isMerge: true,
	laneCount: 2,
	segments: [
		{ kind: 'in', fromLane: 1, toLane: 1, color: 1 },
		{ kind: 'out', fromLane: 1, toLane: 0, color: 1 },
		{ kind: 'pass', fromLane: 0, toLane: 0, color: 0 },
	],
};

describe('LaneCell', () => {
	it('sizes the svg by lane count and draws one path per segment with its color class', () => {
		const w = mount(LaneCell, { props: { row, isHead: false } });
		const svg = w.get('svg');
		expect(svg.attributes('width')).toBe('32');
		expect(svg.attributes('height')).toBe('22');
		const paths = w.findAll('path');
		expect(paths).toHaveLength(3);
		expect(paths[0]?.classes()).toContain('git-graph-lane-1');
		expect(paths[2]?.classes()).toContain('git-graph-lane-0');
	});

	it('draws straight lines for same-lane segments and curves for lane changes', () => {
		const w = mount(LaneCell, { props: { row, isHead: false } });
		const d = w.findAll('path').map((p) => p.attributes('d') ?? '');
		expect(d[0]).toBe('M 24 0 L 24 11');
		expect(d[1]).toMatch(/^M 24 11 C .* 8 22$/);
		expect(d[2]).toBe('M 8 0 L 8 22');
	});

	it('marks the node as merge and head', () => {
		const w = mount(LaneCell, { props: { row, isHead: true } });
		const node = w.get('circle');
		expect(node.attributes('cx')).toBe('24');
		expect(node.attributes('cy')).toBe('11');
		expect(node.classes()).toEqual(expect.arrayContaining(['git-graph-node', 'git-graph-node-merge', 'git-graph-node-head', 'git-graph-lane-1']));
	});
});
