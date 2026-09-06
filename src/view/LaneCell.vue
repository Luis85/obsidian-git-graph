<script setup lang="ts">
import { computed } from 'vue';
import type { Row, Segment } from '../graph/types';
import { LANE_WIDTH, NODE_RADIUS, ROW_HEIGHT } from './geometry';

const props = defineProps<{ row: Row; isHead: boolean }>();

const x = (lane: number): number => lane * LANE_WIDTH + LANE_WIDTH / 2;
const mid = ROW_HEIGHT / 2;

function pathFor(s: Segment): string {
	if (s.kind === 'pass') return `M ${x(s.fromLane)} 0 L ${x(s.fromLane)} ${ROW_HEIGHT}`;
	if (s.kind === 'in') {
		if (s.fromLane === s.toLane) return `M ${x(s.fromLane)} 0 L ${x(s.toLane)} ${mid}`;
		return `M ${x(s.fromLane)} 0 C ${x(s.fromLane)} ${mid} ${x(s.toLane)} 0 ${x(s.toLane)} ${mid}`;
	}
	if (s.fromLane === s.toLane) return `M ${x(s.fromLane)} ${mid} L ${x(s.toLane)} ${ROW_HEIGHT}`;
	return `M ${x(s.fromLane)} ${mid} C ${x(s.fromLane)} ${ROW_HEIGHT} ${x(s.toLane)} ${mid} ${x(s.toLane)} ${ROW_HEIGHT}`;
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
      :key="`${s.kind}:${s.fromLane}:${s.toLane}`"
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
