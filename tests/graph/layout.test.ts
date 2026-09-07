import { describe, expect, it } from 'vitest';
import type { Commit } from '../../src/git/types';
import { layoutGraph } from '../../src/graph/layout';
import type { Segment } from '../../src/graph/types';

const c = (hash: string, ...parents: string[]): Commit => ({ hash, parents, author: 'a', email: 'e', date: '2026-09-06T00:00:00Z', subject: hash });
const seg = (kind: Segment['kind'], fromLane: number, toLane: number, color: number): Segment => ({ kind, fromLane, toLane, color });

/**
 * The top of a real feature branch (`git log --topo-order`), the history whose rendering was
 * compared against VS Code's Git Graph. `3c1c737a` is the tip; its first-parent chain runs
 * `33c98588 → 9cc669cd → 5aedc4da → 2b1749fc → 273f3617 → b78d150f`, while the tip's second
 * parent `3006915e` reaches `273f3617` first in row order. The unloaded parents at the bottom
 * (`8ba7e290`, `866ccc38`, `b2f2e558`, …) stand in for the next page.
 */
const featureBranch: Commit[] = [
	c('3c1c737a', '33c98588', '3006915e'),
	c('3006915e', '273f3617'),
	c('33c98588', '9cc669cd', '7877e473'),
	c('7877e473', 'd485c8c3', 'be55cba7'),
	c('be55cba7', '3e713bdb'),
	c('3e713bdb', 'f0bdc1be', 'f58f1f14'),
	c('f58f1f14', '6521d79d', '5326e14a'),
	c('5326e14a', '976ab733', '38ec673b'),
	c('38ec673b', '809514c5'),
	c('809514c5', 'f9b56d54', '341ad973'),
	c('341ad973', '0a17601c', '4046d6aa'),
	c('4046d6aa', '77b52ec2'),
	c('f9b56d54', 'd8ab50c1'),
	c('976ab733', '167393ca'),
	c('6521d79d', 'abea1b18'),
	c('f0bdc1be', '6ee91bc0'),
	c('d485c8c3', 'd433eb6e'),
	c('9cc669cd', '5aedc4da'),
	c('5aedc4da', '2b1749fc'),
	c('2b1749fc', '273f3617'),
	c('273f3617', 'b78d150f', 'd433eb6e'),
	c('d433eb6e', 'c12d74fa'),
	c('c12d74fa', '018a9309'),
	c('018a9309', '873c0448'),
	c('873c0448', '2d0d282b'),
	c('2d0d282b', '8ba7e290', '6ee91bc0'),
	c('6ee91bc0', '4a4eebc7'),
	c('4a4eebc7', 'a31a6c14'),
	c('a31a6c14', 'a45cca65'),
	c('a45cca65', '7593f55f'),
	c('7593f55f', 'b947ae6f'),
	c('b947ae6f', '866ccc38', 'abea1b18'),
	c('b78d150f', '8ba7e290', 'abea1b18'),
	c('abea1b18', 'b2f2e558'),
];

const laneOf = (commits: Commit[], hash: string): number => layoutGraph(commits).find((r) => r.hash === hash)?.lane ?? -1;

describe('layoutGraph', () => {
	it('draws a linear history in one lane', () => {
		const rows = layoutGraph([c('A', 'B'), c('B', 'C'), c('C')]);
		expect(rows.map((r) => [r.lane, r.color, r.laneCount, r.isMerge])).toEqual([[0, 0, 1, false], [0, 0, 1, false], [0, 0, 1, false]]);
		expect(rows[0]?.segments).toEqual([seg('out', 0, 0, 0)]);
		expect(rows[1]?.segments).toEqual([seg('in', 0, 0, 0), seg('out', 0, 0, 0)]);
		expect(rows[2]?.segments).toEqual([seg('in', 0, 0, 0)]);
	});

	it('draws a single merge: the branch opens right of the merge and curves into the common parent on its row', () => {
		const rows = layoutGraph([c('M', 'A', 'B'), c('A', 'R'), c('B', 'R'), c('R')]);
		expect(rows[0]).toMatchObject({ lane: 0, color: 0, isMerge: true, laneCount: 2 });
		expect(rows[0]?.segments).toEqual([seg('out', 0, 0, 0), seg('out', 0, 1, 1)]);
		expect(rows[1]?.segments).toEqual([seg('in', 0, 0, 0), seg('in', 0, 1, 1), seg('out', 0, 0, 0), seg('out', 1, 1, 1)]);
		expect(rows[2]).toMatchObject({ lane: 1, color: 1, laneCount: 2 });
		expect(rows[2]?.segments).toEqual([seg('pass', 0, 0, 0), seg('in', 1, 1, 1), seg('out', 1, 0, 1)]);
		expect(rows[3]).toMatchObject({ lane: 0, laneCount: 2 });
		expect(rows[3]?.segments).toEqual([seg('in', 0, 0, 0), seg('in', 1, 0, 1)]);
	});

	it('gives every extra parent of an octopus merge its own line, each sliding left once the lines before it end', () => {
		const rows = layoutGraph([c('M', 'A', 'B', 'C'), c('A'), c('B'), c('C')]);
		expect(rows[0]?.segments).toEqual([seg('out', 0, 0, 0), seg('out', 0, 1, 1), seg('out', 0, 2, 2)]);
		expect(rows[0]?.laneCount).toBe(3);
		expect(rows.map((r) => [r.lane, r.color])).toEqual([[0, 0], [0, 0], [0, 1], [0, 2]]);
		expect(rows[3]?.segments).toEqual([seg('in', 1, 0, 2)]);
	});

	it('gives an independent root the freed column and the freed color', () => {
		const rows = layoutGraph([c('A', 'B'), c('B'), c('C')]);
		expect(rows[1]?.segments).toEqual([seg('in', 0, 0, 0)]);
		expect(rows[2]).toMatchObject({ lane: 0, color: 0, laneCount: 1 });
		expect(rows[2]?.segments).toEqual([]);
	});

	it('draws a fork: the second child runs beside the first and curves into the shared parent on its row', () => {
		const rows = layoutGraph([c('X', 'P'), c('Y', 'P'), c('P')]);
		expect(rows[0]?.segments).toEqual([seg('out', 0, 0, 0)]);
		expect(rows[1]).toMatchObject({ lane: 1, color: 1 });
		expect(rows[1]?.segments).toEqual([seg('pass', 0, 0, 0), seg('out', 1, 0, 1)]);
		expect(rows[2]?.segments).toEqual([seg('in', 0, 0, 0), seg('in', 1, 0, 1)]);
	});

	it('keeps the top commit in lane 0 through a parent that a side branch reached first in row order', () => {
		// H's first-parent chain is H → A → I; H's second parent F is listed before A and also has parent I.
		const rows = layoutGraph([c('H', 'A', 'F'), c('F', 'I'), c('A', 'I'), c('I')]);
		expect(rows.map((r) => [r.hash, r.lane, r.color])).toEqual([['H', 0, 0], ['F', 1, 1], ['A', 0, 0], ['I', 0, 0]]);
		expect(rows[1]?.segments).toEqual([seg('pass', 0, 0, 0), seg('in', 0, 1, 1), seg('out', 1, 1, 1)]);
		expect(rows[2]?.segments).toEqual([seg('in', 0, 0, 0), seg('in', 1, 1, 1), seg('out', 0, 0, 0), seg('out', 1, 0, 1)]);
		expect(rows[3]?.segments).toEqual([seg('in', 0, 0, 0), seg('in', 1, 0, 1)]);
	});

	it('slides a line left through the column a finished line freed', () => {
		const rows = layoutGraph([c('A', 'C'), c('B', 'E'), c('C'), c('D', 'E'), c('E')]);
		expect(rows.map((r) => [r.hash, r.lane])).toEqual([['A', 0], ['B', 1], ['C', 0], ['D', 1], ['E', 0]]);
		expect(rows[2]?.segments).toEqual([seg('in', 0, 0, 0), seg('in', 1, 1, 1), seg('out', 1, 0, 1)]);
		expect(rows[3]?.segments).toEqual([seg('in', 1, 0, 1), seg('out', 0, 0, 1), seg('out', 1, 0, 0)]);
	});

	it('draws a merge into an ancestor on its own chain beside the chain, in its color, joining at the ancestor', () => {
		const rows = layoutGraph([c('M', 'A', 'P'), c('A', 'Q'), c('Q', 'P'), c('P')]);
		expect(rows.map((r) => [r.lane, r.color])).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]]);
		expect(rows[0]?.segments).toEqual([seg('out', 0, 0, 0), seg('out', 0, 1, 0)]);
		expect(rows[1]?.segments).toEqual([seg('in', 0, 0, 0), seg('in', 0, 1, 0), seg('out', 0, 0, 0), seg('out', 1, 1, 0)]);
		expect(rows[2]?.segments).toEqual([seg('in', 0, 0, 0), seg('in', 1, 1, 0), seg('out', 0, 0, 0), seg('out', 1, 0, 0)]);
		expect(rows[3]?.segments).toEqual([seg('in', 0, 0, 0), seg('in', 1, 0, 0)]);
	});

	it('runs a line off the bottom for a parent outside the loaded commits', () => {
		expect(layoutGraph([c('A', 'B')])[0]?.segments).toEqual([seg('out', 0, 0, 0)]);
		const rows = layoutGraph([c('M', 'A', 'X'), c('A', 'X')]);
		expect(rows[0]?.segments).toEqual([seg('out', 0, 0, 0), seg('out', 0, 1, 1)]);
		expect(rows[1]?.segments).toEqual([seg('in', 0, 0, 0), seg('in', 0, 1, 1), seg('out', 0, 0, 0), seg('out', 1, 1, 1)]);
		expect(rows[1]?.laneCount).toBe(2);
	});

	it('fans out the parents of a merge that ends the page, one off-bottom column each', () => {
		const [row] = layoutGraph([c('M', 'A', 'B')]);
		expect(row?.segments).toEqual([seg('out', 0, 0, 0), seg('out', 0, 1, 1)]);
		expect(row?.laneCount).toBe(2);
		const [octopus] = layoutGraph([c('O', 'A', 'B', 'C')]);
		expect(octopus?.segments).toEqual([seg('out', 0, 0, 0), seg('out', 0, 1, 1), seg('out', 0, 2, 2)]);
		expect(octopus?.laneCount).toBe(3);
	});

	it('keeps a page-ending merge from colliding with a line already passing its row', () => {
		// X's line to R passes M's row in lane 0 and leaves off the bottom there; M sits in lane 1,
		// so its own off-page parents take lanes 1 and 2 rather than doubling up on lane 1.
		const rows = layoutGraph([c('X', 'R'), c('M', 'P', 'Q')]);
		expect(rows[1]?.segments).toEqual([seg('pass', 0, 0, 0), seg('out', 1, 1, 1), seg('out', 1, 2, 2)]);
		expect(rows[1]?.laneCount).toBe(3);
	});

	it('lays out the feature branch the way VS Code Git Graph does', () => {
		// The tip's first-parent chain owns lane 0 all the way down …
		for (const hash of ['3c1c737a', '33c98588', '9cc669cd', '2b1749fc', '273f3617', 'b78d150f']) expect(laneOf(featureBranch, hash), hash).toBe(0);
		// … the side branch that reached 273f3617 first curves in on that row …
		expect(layoutGraph(featureBranch)[20]?.segments).toContainEqual(seg('in', 1, 0, 1));
		// … and the lanes to its right slide left there instead of leaving a gap.
		expect(laneOf(featureBranch, 'd433eb6e')).toBe(1);
		expect(laneOf(featureBranch, 'abea1b18')).toBe(3);
	});

	it('cycles colors after eight lanes', () => {
		const commits = Array.from({ length: 9 }, (_, i) => c(`T${i}`, 'ROOT'));
		const rows = layoutGraph([...commits, c('ROOT')]);
		expect(rows[8]).toMatchObject({ lane: 8, color: 0 });
	});

	it('draws a repeated parent hash once and still marks the commit as a merge', () => {
		const rows = layoutGraph([c('M', 'A', 'A'), c('A')]);
		expect(rows[0]).toMatchObject({ isMerge: true, laneCount: 1 });
		expect(rows[0]?.segments).toEqual([seg('out', 0, 0, 0)]);
	});

	it('does not hang on a parent listed above its child', () => {
		const rows = layoutGraph([c('B'), c('A', 'B')]);
		expect(rows.map((r) => r.lane)).toEqual([0, 0]);
	});

	it('never emits two segments with the same kind and lanes in one row (LaneCell keys on kind, lanes and color)', () => {
		const histories = [
			[c('A', 'B'), c('B', 'C'), c('C')],
			[c('M', 'A', 'B'), c('A', 'R'), c('B', 'R'), c('R')],
			[c('M', 'A', 'B', 'C'), c('A'), c('B'), c('C')],
			[c('A', 'B'), c('B'), c('C')],
			[c('X', 'P'), c('Y', 'P'), c('P')],
			[c('M', 'A', 'B')],
			[c('O', 'A', 'B', 'C')],
			[c('X', 'R'), c('M', 'P', 'Q')],
			featureBranch,
		];
		for (const history of histories) {
			for (const row of layoutGraph(history)) {
				const keys = row.segments.map((s) => `${s.kind}:${s.fromLane}:${s.toLane}:${s.color}`);
				expect(new Set(keys).size).toBe(keys.length);
			}
		}
	});
});
