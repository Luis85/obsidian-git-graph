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
	/** File mode: on the expanded row, the arrow keys step the expansion to the next newer/older commit. */
	steppable?: boolean;
}>();
/**
 * `move` asks CommitList to focus the neighbouring row, which only it can find. It carries the
 * event so the list can leave the key's default alone when there is no row to move to.
 */
const emit = defineEmits<{ toggle: []; step: [step: 1 | -1]; move: [step: 1 | -1, event: KeyboardEvent] }>();

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
	if (step === undefined) return;
	// Stepping is for the commit being read; anywhere else the arrows walk the list, so a
	// keyboard user can reach another commit without opening each one on the way.
	if (props.steppable === true && props.expanded) {
		e.preventDefault();
		emit('step', step);
	} else {
		emit('move', step, e);
	}
}
</script>

<template>
  <div
    :class="{ 'git-graph-row': true, 'git-graph-row-expanded': expanded, 'git-graph-row-head': isHead }"
    role="button"
    tabindex="0"
    :data-hash="commit.hash"
    :aria-expanded="expanded"
    :aria-keyshortcuts="steppable ? 'ArrowUp ArrowDown' : undefined"
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
