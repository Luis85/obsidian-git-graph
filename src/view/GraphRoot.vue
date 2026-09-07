<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { RefFilter } from '../git/types';
import type { GitGraphSettings } from '../settings/types';
import type { Emitter } from '../util/emitter';
import CommitList from './CommitList.vue';
import GraphHeader from './GraphHeader.vue';
import type { RepoState } from './repoState';
import { createGraphStore, type GraphStore } from './store';

const props = defineProps<{ repoState: RepoState; settings: GitGraphSettings; changes: Emitter<void>; statusChanges: Emitter<void>; activeFile: string | null; activeFileFallbacks?: readonly string[] }>();
const emit = defineEmits<{ updateSettings: [patch: Partial<GitGraphSettings>]; openFile: [path: string] }>();

const store = shallowRef<GraphStore | null>(null);
const historyActive = ref(false);
let unsubscribeChanges: (() => void) | null = null;
let unsubscribeStatus: (() => void) | null = null;

function teardown(): void {
	unsubscribeChanges?.();
	unsubscribeChanges = null;
	unsubscribeStatus?.();
	unsubscribeStatus = null;
	store.value?.dispose();
	store.value = null;
}

watch(
	() => props.repoState,
	(state) => {
		teardown();
		if (state.kind !== 'ready') return;
		const s = createGraphStore({ reader: state.reader, settings: () => props.settings });
		store.value = s;
		unsubscribeChanges = props.changes.on(() => void s.load());
		unsubscribeStatus = props.statusChanges.on(() => void s.refreshStatus());
		void s.load();
	},
	{ immediate: true },
);

// `store` is a source so a repository re-resolve re-applies history mode to the new store.
// The fallbacks are the earlier paths of `activeFile`, which git may still be the only ones to
// know; they are a scope input like the file itself, so they are watched alongside it.
watch([historyActive, () => props.activeFile, () => props.activeFileFallbacks ?? [], store], ([active, file, fallbacks, s]) => {
	s?.setHistoryPath(active ? file : null, active ? fallbacks : []);
});

// Any settings change reloads: page size, ref filter and dirty row all affect what is fetched.
watch(
	() => props.settings,
	() => void store.value?.load(),
);

onBeforeUnmount(teardown);

const repoName = computed(() => (props.repoState.kind === 'ready' ? props.repoState.root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? props.repoState.root : ''));

const dirty = computed(() => {
	const s = store.value;
	if (historyActive.value) return null;
	if (!s || !props.settings.showDirtyRow || s.state.dirtyCount === 0) return null;
	const head = s.state.rows.find((r) => r.hash === s.state.headHash);
	// HEAD sizes the row when it is loaded; otherwise the newest loaded row stands in for it.
	return { count: s.state.dirtyCount, laneCount: (head ?? s.state.rows[0])?.laneCount ?? 1, headLane: head?.lane ?? 0, color: head?.color ?? 0 };
});

// A single file's history is a straight line: lanes carry no information, so they are hidden.
const showGraph = computed(() => !historyActive.value && (store.value?.state.filterText.trim().length ?? 0) === 0);

/** The empty message history mode owns, or null to leave the regular loading/empty/list chain alone. */
const historyEmpty = computed<string | null>(() => {
	if (!historyActive.value) return null;
	if (props.activeFile === null) return 'Open a file to see its history.';
	const s = store.value;
	if (s === null || s.state.loading || s.state.rows.length > 0 || s.state.error !== null) return null;
	return 'No commits for this file yet.';
});

function onRefFilter(value: RefFilter): void {
	emit('updateSettings', { refFilter: value });
}
</script>

<template>
  <div class="git-graph-view">
    <div
      v-if="repoState.kind === 'unresolved'"
      class="git-graph-empty"
    >
      Looking for a git repository…
    </div>
    <div
      v-else-if="repoState.kind === 'none'"
      class="git-graph-empty"
    >
      This vault is not a git repository.
    </div>
    <div
      v-else-if="repoState.kind === 'no-git'"
      class="git-graph-empty"
    >
      Git was not found at "{{ repoState.gitPath }}". Set the git executable in the Git Graph settings.
    </div>
    <div
      v-else-if="repoState.kind === 'error'"
      class="git-graph-empty"
    >
      {{ repoState.message }}
    </div>
    <template v-else-if="store !== null">
      <GraphHeader
        :repo-name="repoName"
        :branch="store.state.headBranch"
        :ref-filter="settings.refFilter"
        :filter-text="store.state.filterText"
        :loading="store.state.loading"
        :history-active="historyActive"
        :history-file="activeFile"
        @refresh="store.load()"
        @update:ref-filter="onRefFilter"
        @update:filter-text="store.setFilter($event)"
        @update:history-active="historyActive = $event"
      />
      <div
        v-if="store.state.error !== null || store.state.statusError !== null"
        class="git-graph-banner"
        role="alert"
      >
        <span class="git-graph-banner-text">{{ store.state.error ?? store.state.statusError }}</span>
        <button
          type="button"
          class="mod-cta"
          @click="store.load()"
        >
          Retry
        </button>
      </div>
      <!-- History mode owns the empty state whenever it has one: with no file open there is
           nothing to load, and an empty file history is not an empty repository. -->
      <div
        v-if="historyEmpty !== null"
        class="git-graph-empty"
      >
        {{ historyEmpty }}
      </div>
      <div
        v-else-if="store.state.loading && store.state.rows.length === 0"
        class="git-graph-empty"
      >
        Loading history…
      </div>
      <!-- An error banner (load or status) replaces the empty message; Retry brings it back.
           A repository with changes but no commits yet still mounts the list for its changes row. -->
      <div
        v-else-if="!store.state.loading && store.state.rows.length === 0 && dirty === null && store.state.error === null && store.state.statusError === null"
        class="git-graph-empty"
      >
        No commits yet.
      </div>
      <CommitList
        v-else
        :rows="store.visibleRows.value"
        :commit-of="store.commitOf"
        :refs-by-hash="store.state.refsByHash"
        :head-hash="store.state.headHash"
        :expanded-hash="store.state.expandedHash"
        :expanded-details="store.state.expandedDetails"
        :details-error="store.state.detailsError"
        :date-format="settings.dateFormat"
        :show-graph="showGraph"
        :has-more="store.state.hasMore"
        :dirty="showGraph ? dirty : null"
        :dirty-expanded="store.state.dirtyExpanded"
        :dirty-files="store.state.dirtyFiles"
        :dirty-error="store.state.dirtyError"
        @toggle="store.toggleExpand($event)"
        @load-more="store.loadMore()"
        @open-file="emit('openFile', $event)"
        @toggle-dirty="store.toggleDirty()"
      />
    </template>
  </div>
</template>
