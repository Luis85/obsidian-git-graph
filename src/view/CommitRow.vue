<script setup lang="ts">
import { computed } from 'vue';
import type { Commit, Ref } from '../git/types';
import type { Row } from '../graph/types';
import type { DateFormat } from '../settings/types';
import { formatAbsolute, formatDate } from './dates';
import LaneCell from './LaneCell.vue';
import RefBadge from './RefBadge.vue';

const props = defineProps<{
	row: Row;
	commit: Commit;
	refs: Ref[];
	isHead: boolean;
	expanded: boolean;
	dateFormat: DateFormat;
	showGraph: boolean;
	/** File mode: the arrow keys step the expansion to the next newer/older commit. */
	steppable?: boolean;
}>();
const emit = defineEmits<{ toggle: []; step: [step: 1 | -1] }>();

const ORDER: Record<Ref['kind'], number> = { branch: 1, remote: 2, tag: 3 };
const sortedRefs = computed(() =>
	[...props.refs].sort((a, b) => (a.isHead ? 0 : ORDER[a.kind]) - (b.isHead ? 0 : ORDER[b.kind]) || a.name.localeCompare(b.name)),
);
const upstreamName = computed(() => props.refs.find((r) => r.isHead)?.upstream ?? null);
const isUpstream = (ref: Ref): boolean => ref.kind === 'remote' && ref.name === upstreamName.value;

const dateText = computed(() => formatDate(props.commit.date, props.dateFormat));
const dateTitle = computed(() => formatAbsolute(props.commit.date));

const STEP_KEYS: Record<string, 1 | -1> = { ArrowDown: 1, ArrowUp: -1 };

function onKey(e: KeyboardEvent): void {
	if (e.key === 'Enter' || e.key === ' ') {
		e.preventDefault();
		emit('toggle');
		return;
	}
	const step = STEP_KEYS[e.key];
	if (props.steppable === true && step !== undefined) {
		e.preventDefault();
		emit('step', step);
	}
}
</script>

<template>
  <div
    :class="{ 'git-graph-row': true, 'git-graph-row-expanded': expanded, 'git-graph-row-head': isHead }"
    role="button"
    tabindex="0"
    :aria-expanded="expanded"
    @click="emit('toggle')"
    @keydown="onKey"
  >
    <LaneCell
      v-if="showGraph"
      :row="row"
      :is-head="isHead"
    />
    <span
      class="git-graph-subject"
      :title="commit.subject"
    >{{ commit.subject }}</span>
    <span
      v-if="sortedRefs.length > 0"
      class="git-graph-refs"
    >
      <RefBadge
        v-for="r in sortedRefs"
        :key="`${r.kind}:${r.name}`"
        :git-ref="r"
        :is-upstream="isUpstream(r)"
      />
    </span>
    <span
      class="git-graph-author"
      :title="commit.email"
    >{{ commit.author }}</span>
    <span
      class="git-graph-date"
      :title="dateTitle"
    >{{ dateText }}</span>
  </div>
</template>
