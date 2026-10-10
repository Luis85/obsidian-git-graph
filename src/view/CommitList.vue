<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ChangedFile, Commit, CommitDetails as Details, FileDiff, Ref } from '../git/types';
import type { Row } from '../graph/types';
import type { DateFormat } from '../settings/types';
import CommitDetails from './CommitDetails.vue';
import CommitRow from './CommitRow.vue';
import DirtyDetails from './DirtyDetails.vue';
import DirtyRow from './DirtyRow.vue';
import FileChange from './FileChange.vue';
import Icon from './Icon.vue';
import { ROW_HEIGHT } from './geometry';
import { createMeasuredHeight } from './measuredHeight';

interface Dirty {
	count: number;
	laneCount: number;
	headLane: number;
	color: number;
}

/** File mode's view of the expanded commit: the followed file's diff in it. */
interface FileChangeView {
	file: ChangedFile | null;
	diff: FileDiff | null;
	error: string | null;
}

type StepControl = 'row' | 'newer' | 'older';

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
	/** Set in file mode, which turns on the diff and stepping between commits. */
	fileChange?: FileChangeView | null;
	viewportHeight?: number;
}>();
const emit = defineEmits<{ toggle: [hash: string]; loadMore: []; openFile: [path: string]; toggleDirty: []; step: [hash: string, step: 1 | -1] }>();

const OVERSCAN = 5;
const DETAILS_FALLBACK = 240;
const DIRTY_FALLBACK = 88;

const container = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const measuredViewport = ref(600);

const detailsBox = createMeasuredHeight(container, '.git-graph-details-host', DETAILS_FALLBACK, () => props.expandedHash);
const dirtyBox = createMeasuredHeight(container, '.git-graph-dirty-host', DIRTY_FALLBACK, () => props.dirtyExpanded);

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

const fileMode = computed(() => props.fileChange !== undefined && props.fileChange !== null);
const canStep = (index: number, step: 1 | -1): boolean => (step < 0 ? index > 0 : index < props.rows.length - 1 || props.hasMore);

/**
 * Set when a step is asked for: where the stepped-from row sat in the viewport, and which
 * control to focus once the step lands. The stepped-to row is put in the same place, so the
 * Newer/Older buttons stay under the pointer while clicking through a history.
 */
let pendingStep: { anchor: number; control: StepControl } | null = null;

function requestStep(hash: string, step: 1 | -1, control: StepControl): void {
	const index = props.rows.findIndex((r) => r.hash === hash);
	if (index === -1 || !canStep(index, step)) return;
	const top = offsetOf(index) - scrollTop.value;
	pendingStep = { anchor: Math.min(Math.max(top, 0), Math.max(viewport.value - ROW_HEIGHT, 0)), control };
	emit('step', hash, step);
}

function onToggle(hash: string): void {
	pendingStep = null;
	emit('toggle', hash);
}

/** Focuses the control that stepped, in the newly expanded row — or the row itself, when that control has nowhere further to go. */
function focusAfterStep(control: StepControl): void {
	const item = container.value?.querySelector('.git-graph-details-host')?.parentElement;
	const button = control === 'row' ? null : item?.querySelector<HTMLButtonElement>(`.git-graph-step-${control}`);
	const target = button !== null && button !== undefined && !button.disabled ? button : item?.querySelector<HTMLElement>('.git-graph-row');
	target?.focus();
}

watch(
	() => props.expandedHash,
	(hash) => {
		const pending = pendingStep;
		pendingStep = null;
		if (pending === null || hash === null || expandedIndex.value === -1) return;
		const top = Math.max(0, offsetOf(expandedIndex.value) - pending.anchor);
		if (container.value) container.value.scrollTop = top;
		scrollTop.value = top;
		void nextTick(() => focusAfterStep(pending.control));
	},
	{ flush: 'post' },
);
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
            :steppable="fileMode"
            @toggle="onToggle(row.hash)"
            @step="requestStep(row.hash, $event, 'row')"
          />
          <div
            v-if="row.hash === expandedHash"
            :ref="detailsBox.onRef"
            class="git-graph-details-host"
          >
            <div
              v-if="fileMode"
              class="git-graph-step"
            >
              <button
                type="button"
                class="git-graph-step-newer"
                :disabled="!canStep(index, -1)"
                @click="requestStep(row.hash, -1, 'newer')"
              >
                <Icon name="arrow-up" />
                Newer
              </button>
              <button
                type="button"
                class="git-graph-step-older"
                :disabled="!canStep(index, 1)"
                @click="requestStep(row.hash, 1, 'older')"
              >
                <Icon name="arrow-down" />
                Older
              </button>
            </div>
            <CommitDetails
              :details="expandedDetails"
              :error="detailsError"
              @open-file="emit('openFile', $event)"
            >
              <template
                v-if="fileChange"
                #files="{ files }"
              >
                <FileChange
                  :file="fileChange.file"
                  :diff="fileChange.diff"
                  :error="fileChange.error"
                  :files="files"
                  @open-file="emit('openFile', $event)"
                />
              </template>
            </CommitDetails>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
