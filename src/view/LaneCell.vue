<script setup lang="ts">
import { computed } from 'vue';
import type { Row, Segment } from '../graph/types';
import { LANE_WIDTH, NODE_RADIUS, ROW_HEIGHT } from './geometry';

const props = defineProps<{ row: Row; isHead: boolean }>();

const x = (lane: number): number => lane * LANE_WIDTH + LANE_WIDTH / 2;
const mid = ROW_HEIGHT / 2;
/**
 * A lane change is one S-curve from this row's centre to the next row's centre, split at the
 * row boundary so the `out` half in this cell and the `in` half in the next join up. The
 * control points sit 0.8 of a row from each end (as in VS Code's Git Graph), which keeps the
 * line vertical until just before the boundary and swings it across there.
 */
const bend = ROW_HEIGHT * 0.8;

function pathFor(s: Segment): string {
	const [x1, x2] = [x(s.fromLane), x(s.toLane)];
	if (s.kind === 'pass') return `M ${x1} 0 L ${x1} ${ROW_HEIGHT}`;
	if (s.kind === 'in') {
		if (x1 === x2) return `M ${x2} 0 L ${x2} ${mid}`;
		return `M ${(x1 + x2) / 2} 0 C ${(x1 + 3 * x2) / 4} ${(ROW_HEIGHT - bend) / 4} ${x2} ${(ROW_HEIGHT - bend) / 2} ${x2} ${mid}`;
	}
	if (x1 === x2) return `M ${x1} ${mid} L ${x1} ${ROW_HEIGHT}`;
	return `M ${x1} ${mid} C ${x1} ${mid + bend / 2} ${(3 * x1 + x2) / 4} ${mid + (ROW_HEIGHT + bend) / 4} ${(x1 + x2) / 2} ${ROW_HEIGHT}`;
}

const width = computed(() => props.row.laneCount * LANE_WIDTH);
const nodeClasses = computed(() => ({
	'git-graph-node': true,
	'git-graph-node-merge': props.row.isMerge,
	'git-graph-node-head': props.isHead,
	[`git-graph-lane-${props.row.color}`]: true,
}));
</script>

<template>
  <svg
    class="git-graph-lanes"
    :width="width"
    :height="ROW_HEIGHT"
    :viewBox="`0 0 ${width} ${ROW_HEIGHT}`"
    aria-hidden="true"
  >
    <path
      v-for="s in row.segments"
      :key="`${s.kind}:${s.fromLane}:${s.toLane}:${s.color}`"
      :class="['git-graph-segment', `git-graph-lane-${s.color}`]"
      :d="pathFor(s)"
    />
    <circle
      :class="nodeClasses"
      :cx="x(row.lane)"
      :cy="mid"
      :r="NODE_RADIUS"
    />
  </svg>
</template>
