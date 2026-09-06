import { describe, expect, it } from 'vitest';
import type { Commit } from '../../src/git/types';
import { emptyLayoutState, layoutGraph } from '../../src/graph/layout';
import type { Segment } from '../../src/graph/types';

const c = (hash: string, ...parents: string[]): Commit => ({ hash, parents, author: 'a', email: 'e', date: '2026-09-06T00:00:00Z', subject: hash });
const seg = (kind: Segment['kind'], fromLane: number, toLane: number, color: number): Segment => ({ kind, fromLane, toLane, color });

describe('layoutGraph', () => {
	it('draws a linear history in one lane', () => {
		const { rows, state } = layoutGraph([c('A', 'B'), c('B', 'C'), c('C')], emptyLayoutState());
		expect(rows.map((r) => [r.lane, r.color, r.laneCount, r.isMerge])).toEqual([[0, 0, 1, false], [0, 0, 1, false], [0, 0, 1, false]]);
		expect(rows[0]?.segments).toEqual([seg('out', 0, 0, 0)]);
		expect(rows[1]?.segments).toEqual([seg('in', 0, 0, 0), seg('out', 0, 0, 0)]);
		expect(rows[2]?.segments).toEqual([seg('in', 0, 0, 0)]);
		expect(state.lanes).toEqual([]);
	});

	it('draws a single merge: branch opens right of the merge, rejoins at the common parent', () => {
		const { rows, state } = layoutGraph([c('M', 'A', 'B'), c('A', 'R'), c('B', 'R'), c('R')], emptyLayoutState());
		expect(rows[0]).toMatchObject({ lane: 0, color: 0, isMerge: true, laneCount: 2 });
		expect(rows[0]?.segments).toEqual([seg('out', 0, 0, 0), seg('out', 0, 1, 1)]);
		expect(rows[1]?.segments).toEqual([seg('in', 0, 0, 0), seg('out', 0, 0, 0), seg('pass', 1, 1, 1)]);
		expect(rows[2]).toMatchObject({ lane: 1, color: 1, laneCount: 2 });
		expect(rows[2]?.segments).toEqual([seg('in', 1, 1, 1), seg('out', 1, 0, 1), seg('pass', 0, 0, 0)]);
		expect(rows[3]).toMatchObject({ lane: 0, laneCount: 1 });
		expect(rows[3]?.segments).toEqual([seg('in', 0, 0, 0)]);
		expect(state.lanes).toEqual([]);
	});

	it('draws an octopus merge with one extra lane per extra parent', () => {
		const { rows } = layoutGraph([c('M', 'A', 'B', 'C'), c('A'), c('B'), c('C')], emptyLayoutState());
		expect(rows[0]?.segments).toEqual([seg('out', 0, 0, 0), seg('out', 0, 1, 1), seg('out', 0, 2, 2)]);
		expect(rows[0]?.laneCount).toBe(3);
		expect(rows[3]).toMatchObject({ lane: 2, color: 2 });
	});

	it('gives independent roots their own lane and reuses a freed column', () => {
		const { rows } = layoutGraph([c('A', 'B'), c('B'), c('C')], emptyLayoutState());
		expect(rows[1]?.segments).toEqual([seg('in', 0, 0, 0)]);
		expect(rows[2]).toMatchObject({ lane: 0, color: 1, laneCount: 1 });
		expect(rows[2]?.segments).toEqual([]);
	});

	it('draws a fork: two children of one parent, the second lane closes with an in-curve', () => {
		// X (tip, parent P) and Y (tip, parent P) both open lanes; P joins them.
		const { rows } = layoutGraph([c('X', 'P'), c('Y', 'P'), c('P')], emptyLayoutState());
		expect(rows[0]?.segments).toEqual([seg('out', 0, 0, 0)]);
		expect(rows[1]).toMatchObject({ lane: 1, color: 1 });
		expect(rows[1]?.segments).toEqual([seg('out', 1, 0, 1), seg('pass', 0, 0, 0)]);
		expect(rows[2]?.segments).toEqual([seg('in', 0, 0, 0)]);
	});

	it('continues lanes and colors across a page boundary', () => {
		const all = [c('M', 'A', 'B'), c('A', 'R'), c('B', 'R'), c('R')];
		const whole = layoutGraph(all, emptyLayoutState());
		const first = layoutGraph(all.slice(0, 2), emptyLayoutState());
		expect(first.state.lanes).toEqual([{ waitingFor: 'R', color: 0 }, { waitingFor: 'B', color: 1 }]);
		const second = layoutGraph(all.slice(2), first.state);
		expect([...first.rows, ...second.rows]).toEqual(whole.rows);
	});

	it('keeps a lane open for a parent outside the loaded window', () => {
		const { state } = layoutGraph([c('A', 'B')], emptyLayoutState());
		expect(state.lanes).toEqual([{ waitingFor: 'B', color: 0 }]);
	});

	it('cycles colors after eight lanes', () => {
		const commits = Array.from({ length: 9 }, (_, i) => c(`T${i}`, 'ROOT'));
		const { rows } = layoutGraph(commits, emptyLayoutState());
		expect(rows[8]?.color).toBe(0);
	});

	it('does not mutate the input state', () => {
		const state = emptyLayoutState();
		layoutGraph([c('A', 'B')], state);
		expect(state).toEqual(emptyLayoutState());
	});
});
