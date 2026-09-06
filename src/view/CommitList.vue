<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ChangedFile, Commit, CommitDetails as Details, Ref } from '../git/types';
import type { Row } from '../graph/types';
import type { DateFormat } from '../settings/types';
import CommitDetails from './CommitDetails.vue';
import CommitRow from './CommitRow.vue';
import DirtyDetails from './DirtyDetails.vue';
import DirtyRow from './DirtyRow.vue';
import { ROW_HEIGHT } from './geometry';
import { createMeasuredHeight } from './measuredHeight';

interface Dirty {
	count: number;
	laneCount: number;
	headLane: number;
	color: number;
}

const props = defineProps<{
	rows: Row[];
	commitOf: (hash: string) => Commit | undefined;
	refsByHash: Map<string, Ref[]>;
	headHash: string | null;
	expandedHash: string | null;
	expandedDetails: Details | null;
	detailsError: string | null;
	dateFormat: DateFormat;
	showGraph: boolean;
	hasMore: boolean;
	dirty: Dirty | null;
	dirtyExpanded: boolean;
	dirtyFiles: ChangedFile[] | null;
	dirtyError: string | null;
	viewportHeight?: number;
}>();
const emit = defineEmits<{ toggle: [hash: string]; loadMore: []; openFile: [path: string]; toggleDirty: [] }>();

const OVERSCAN = 5;
const DETAILS_FALLBACK = 240;

const container = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const measuredViewport = ref(600);

const detailsBox = createMeasuredHeight(container, '.git-graph-details-host', DETAILS_FALLBACK, () => props.expandedHash);
const dirtyBox = createMeasuredHeight(container, '.git-graph-dirty-host', DETAILS_FALLBACK, () => props.dirtyExpanded);

const viewport = computed(() => props.viewportHeight ?? measuredViewport.value);
const dirtyOffset = computed(() => (props.dirty === null ? 0 : ROW_HEIGHT + (props.dirtyExpanded ? dirtyBox.height.value : 0)));
const expandedIndex = computed(() => (props.expandedHash === null ? -1 : props.rows.findIndex((r) => r.hash === props.expandedHash)));
const extra = computed(() => (expandedIndex.value === -1 ? 0 : detailsBox.height.value));

const totalHeight = computed(() => dirtyOffset.value + props.rows.length * ROW_HEIGHT + extra.value);

function offsetOf(i: number): number {
	return dirtyOffset.value + i * ROW_HEIGHT + (expandedIndex.value !== -1 && i > expandedIndex.value ? extra.value : 0);
}

function indexAt(y: number): number {
	const local = y - dirtyOffset.value;
	if (local < 0) return 0;
	const e = expandedIndex.value;
	let i: number;
	if (e === -1 || local < (e + 1) * ROW_HEIGHT) i = Math.floor(local / ROW_HEIGHT);
	else if (local < (e + 1) * ROW_HEIGHT + extra.value) i = e;
	else i = Math.floor((local - extra.value) / ROW_HEIGHT);
	return Math.min(Math.max(i, 0), Math.max(props.rows.length - 1, 0));
}

const first = computed(() => Math.max(0, indexAt(scrollTop.value) - OVERSCAN));
const last = computed(() => Math.min(props.rows.length - 1, indexAt(scrollTop.value + viewport.value) + OVERSCAN));
const visible = computed(() => (props.rows.length === 0 ? [] : props.rows.slice(first.value, last.value + 1).map((row, k) => ({ row, index: first.value + k }))));

watch(
	[last, () => props.hasMore, () => props.rows.length],
	([lastIndex, hasMore, length]) => {
		if (hasMore && length > 0 && lastIndex >= length - 1) emit('loadMore');
	},
	{ immediate: true },
);

function onScroll(): void {
	scrollTop.value = container.value?.scrollTop ?? 0;
}

let observer: ResizeObserver | null = null;

onMounted(() => {
	if (typeof ResizeObserver === 'undefined') return;
	observer = new ResizeObserver(() => {
		if (container.value) measuredViewport.value = container.value.clientHeight || 600;
	});
	if (container.value) observer.observe(container.value);
});

onBeforeUnmount(() => observer?.disconnect());

const headLane = computed(() => props.rows.find((r) => r.hash === props.headHash) ?? null);
</script>

<template>
  <div
    ref="container"
    class="git-graph-list"
    @scroll.passive="onScroll"
  >
    <div
      class="git-graph-list-spacer"
      :style="{ height: `${totalHeight}px` }"
    >
      <div
        v-if="dirty !== null"
        class="git-graph-item"
        :style="{ transform: 'translateY(0px)' }"
      >
        <DirtyRow
          :count="dirty.count"
          :lane-count="dirty.laneCount"
          :head-lane="headLane?.lane ?? dirty.headLane"
          :color="headLane?.color ?? dirty.color"
          :expanded="dirtyExpanded"
          @toggle="emit('toggleDirty')"
        />
        <div
          v-if="dirtyExpanded"
          :ref="dirtyBox.onRef"
          class="git-graph-dirty-host"
        >
          <DirtyDetails
            :files="dirtyFiles"
            :error="dirtyError"
            @open-file="emit('openFile', $event)"
          />
        </div>
      </div>
      <template
        v-for="{ row, index } in visible"
        :key="row.hash"
      >
        <div
          v-if="commitOf(row.hash)"
          class="git-graph-item"
          :style="{ transform: `translateY(${offsetOf(index)}px)` }"
        >
          <CommitRow
            :row="row"
            :commit="commitOf(row.hash)!"
            :refs="refsByHash.get(row.hash) ?? []"
            :is-head="row.hash === headHash"
            :expanded="row.hash === expandedHash"
            :date-format="dateFormat"
            :show-graph="showGraph"
            @toggle="emit('toggle', row.hash)"
          />
          <div
            v-if="row.hash === expandedHash"
            :ref="detailsBox.onRef"
            class="git-graph-details-host"
          >
            <CommitDetails
              :details="expandedDetails"
              :error="detailsError"
              @open-file="emit('openFile', $event)"
            />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
