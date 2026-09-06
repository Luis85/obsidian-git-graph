<script setup lang="ts">
import { computed } from 'vue';
import { LANE_WIDTH, NODE_RADIUS, ROW_HEIGHT } from './geometry';

const props = defineProps<{ count: number; laneCount: number; headLane: number; color: number }>();
const width = computed(() => Math.max(1, props.laneCount) * LANE_WIDTH);
const x = computed(() => props.headLane * LANE_WIDTH + LANE_WIDTH / 2);
const label = computed(() => `${props.count} ${props.count === 1 ? 'change' : 'changes'}`);
</script>

<template>
  <div
    class="git-graph-row git-graph-row-dirty"
    :title="`${label} in the working tree`"
  >
    <svg
      class="git-graph-lanes"
      :width="width"
      :height="ROW_HEIGHT"
      :viewBox="`0 0 ${width} ${ROW_HEIGHT}`"
      aria-hidden="true"
    >
      <path
        :class="['git-graph-segment', 'git-graph-segment-dirty', `git-graph-lane-${color}`]"
        :d="`M ${x} ${ROW_HEIGHT / 2} L ${x} ${ROW_HEIGHT}`"
      />
      <circle
        :class="['git-graph-node', 'git-graph-node-dirty', `git-graph-lane-${color}`]"
        :cx="x"
        :cy="ROW_HEIGHT / 2"
        :r="NODE_RADIUS"
      />
    </svg>
    <span class="git-graph-subject">{{ label }}</span>
  </div>
</template>
