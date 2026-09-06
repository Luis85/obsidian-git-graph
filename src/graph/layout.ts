import type { Commit } from '../git/types';
import type { Lane, LayoutState, Row, Segment } from './types';

const LANE_COLORS = 8;

export function emptyLayoutState(): LayoutState {
	return { lanes: [], nextColor: 0 };
}

function firstFree(lanes: (Lane | null)[], from: number): number {
	for (let i = from; i < lanes.length; i++) if (lanes[i] === null) return i;
	return Math.max(from, lanes.length);
}

function findWaiting(lanes: (Lane | null)[], hash: string, skip: ReadonlySet<number>): number {
	return lanes.findIndex((lane, i) => lane !== null && !skip.has(i) && lane.waitingFor === hash);
}

export function layoutGraph(commits: readonly Commit[], state: LayoutState): { rows: Row[]; state: LayoutState } {
	const lanes: (Lane | null)[] = state.lanes.map((lane) => (lane === null ? null : { ...lane }));
	let nextColor = state.nextColor;
	const rows: Row[] = [];

	const open = (slot: number, waitingFor: string): Lane => {
		const lane = { waitingFor, color: nextColor };
		nextColor = (nextColor + 1) % LANE_COLORS;
		while (lanes.length < slot) lanes.push(null);
		lanes[slot] = lane;
		return lane;
	};

	for (const commit of commits) {
		const segments: Segment[] = [];
		const closing = new Set<number>();
		const present = lanes.map((lane) => lane !== null);

		let laneIndex = findWaiting(lanes, commit.hash, closing);
		const isTip = laneIndex === -1;
		if (isTip) {
			laneIndex = firstFree(lanes, 0);
			open(laneIndex, commit.hash);
		}
		const lane = lanes[laneIndex] as Lane;
		const color = lane.color;

		if (!isTip) segments.push({ kind: 'in', fromLane: laneIndex, toLane: laneIndex, color });

		lanes.forEach((other, i) => {
			if (other !== null && i !== laneIndex && other.waitingFor === commit.hash) {
				segments.push({ kind: 'in', fromLane: i, toLane: laneIndex, color: other.color });
				closing.add(i);
			}
		});

		const [firstParent, ...otherParents] = commit.parents;
		if (firstParent === undefined) {
			closing.add(laneIndex);
		} else {
			const skip = new Set([...closing, laneIndex]);
			const existing = findWaiting(lanes, firstParent, skip);
			if (existing === -1) {
				lane.waitingFor = firstParent;
				segments.push({ kind: 'out', fromLane: laneIndex, toLane: laneIndex, color });
			} else {
				segments.push({ kind: 'out', fromLane: laneIndex, toLane: existing, color });
				closing.add(laneIndex);
			}
			for (const parent of new Set(otherParents)) {
				if (parent === firstParent) continue;
				const target = findWaiting(lanes, parent, closing);
				if (target !== -1) {
					segments.push({ kind: 'out', fromLane: laneIndex, toLane: target, color: (lanes[target] as Lane).color });
				} else {
					const slot = firstFree(lanes, laneIndex + 1);
					const opened = open(slot, parent);
					segments.push({ kind: 'out', fromLane: laneIndex, toLane: slot, color: opened.color });
				}
			}
		}

		const closingIn = new Set(segments.filter((s) => s.kind === 'in' && s.fromLane !== laneIndex).map((s) => s.fromLane));
		present.forEach((wasPresent, i) => {
			if (wasPresent && i !== laneIndex && !closingIn.has(i)) {
				segments.push({ kind: 'pass', fromLane: i, toLane: i, color: (lanes[i] as Lane).color });
			}
		});

		const touched = [laneIndex, ...segments.flatMap((s) => [s.fromLane, s.toLane])];
		rows.push({ hash: commit.hash, lane: laneIndex, color, isMerge: commit.parents.length > 1, segments, laneCount: Math.max(...touched) + 1 });

		for (const i of closing) lanes[i] = null;
		while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
	}

	return { rows, state: { lanes, nextColor } };
}
