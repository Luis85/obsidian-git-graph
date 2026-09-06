<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Commit, CommitDetails as Details, Ref } from '../git/types';
import type { Row } from '../graph/types';
import type { DateFormat } from '../settings/types';
import CommitDetails from './CommitDetails.vue';
import CommitRow from './CommitRow.vue';
import DirtyRow from './DirtyRow.vue';
import { ROW_HEIGHT } from './geometry';

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
	headBranch: string | null;
	expandedHash: string | null;
	expandedDetails: Details | null;
	detailsError: string | null;
	dateFormat: DateFormat;
	showGraph: boolean;
	hasMore: boolean;
	dirty: Dirty | null;
	viewportHeight?: number;
}>();
const emit = defineEmits<{ toggle: [hash: string]; loadMore: [] }>();

const OVERSCAN = 5;
const DETAILS_FALLBACK = 240;

const container = ref<HTMLElement | null>(null);
// A template ref bound inside `v-for` is always delivered as an array by Vue's compiler
// (ref_for: true), even though the sibling v-if guarantees at most one match here.
const detailsEl = ref<HTMLElement | HTMLElement[] | null>(null);
const scrollTop = ref(0);
const measuredViewport = ref(600);
const detailsHeight = ref(DETAILS_FALLBACK);

const viewport = computed(() => props.viewportHeight ?? measuredViewport.value);
const dirtyOffset = computed(() => (props.dirty === null ? 0 : ROW_HEIGHT));
const expandedIndex = computed(() => (props.expandedHash === null ? -1 : props.rows.findIndex((r) => r.hash === props.expandedHash)));
const extra = computed(() => (expandedIndex.value === -1 ? 0 : detailsHeight.value));

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
let detailsObserver: ResizeObserver | null = null;

onMounted(() => {
	if (typeof ResizeObserver === 'undefined') return;
	observer = new ResizeObserver(() => {
		if (container.value) measuredViewport.value = container.value.clientHeight || 600;
	});
	if (container.value) observer.observe(container.value);
});

watch(detailsEl, (raw) => {
	detailsObserver?.disconnect();
	detailsObserver = null;
	const el = Array.isArray(raw) ? (raw[0] ?? null) : raw;
	if (el === null || typeof ResizeObserver === 'undefined') return;
	detailsObserver = new ResizeObserver(() => {
		detailsHeight.value = el.offsetHeight || DETAILS_FALLBACK;
	});
	detailsObserver.observe(el);
});

onBeforeUnmount(() => {
	observer?.disconnect();
	detailsObserver?.disconnect();
});

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
        />
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
            :head-branch="headBranch"
            :expanded="row.hash === expandedHash"
            :date-format="dateFormat"
            :show-graph="showGraph"
            @toggle="emit('toggle', row.hash)"
          />
          <div
            v-if="row.hash === expandedHash"
            ref="detailsEl"
          >
            <CommitDetails
              :details="expandedDetails"
              :error="detailsError"
              :hash="row.hash"
            />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
