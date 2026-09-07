<script setup lang="ts">
import { computed } from 'vue';
import type { RefFilter } from '../git/types';
import Icon from './Icon.vue';

const props = defineProps<{ repoName: string; branch: string | null; refFilter: RefFilter; filterText: string; loading: boolean; historyActive: boolean; historyFile: string | null }>();
const emit = defineEmits<{ refresh: []; 'update:refFilter': [value: RefFilter]; 'update:filterText': [value: string]; 'update:historyActive': [value: boolean] }>();

// The title row swaps the branch for the file only when history mode actually has a file to follow.
const showHistoryFile = computed(() => props.historyActive && props.historyFile !== null);
const historyName = computed(() => props.historyFile?.split('/').pop() ?? '');

function onFilter(e: Event): void {
	emit('update:refFilter', (e.target as HTMLSelectElement).value === 'all' ? 'all' : 'auto');
}
function onText(e: Event): void {
	emit('update:filterText', (e.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="git-graph-header">
    <div
      class="git-graph-title"
      :title="repoName"
    >
      <Icon name="git-graph" />
      <span class="git-graph-repo">{{ repoName }}</span>
      <span
        v-if="showHistoryFile"
        class="git-graph-history-file"
        :title="historyFile ?? ''"
      >{{ historyName }}</span>
      <span
        v-else
        class="git-graph-branch"
      >{{ branch ?? 'detached' }}</span>
    </div>
    <div class="git-graph-tools">
      <select
        class="git-graph-ref-filter dropdown"
        :value="refFilter"
        aria-label="Refs to show"
        @change="onFilter"
      >
        <option value="auto">
          Auto
        </option>
        <option value="all">
          All
        </option>
      </select>
      <input
        class="git-graph-filter"
        type="search"
        placeholder="Filter commits"
        :value="filterText"
        @input="onText"
      >
      <button
        type="button"
        class="git-graph-refresh clickable-icon"
        aria-label="Refresh"
        :disabled="loading"
        @click="emit('refresh')"
      >
        <Icon name="refresh-cw" />
      </button>
      <button
        type="button"
        class="git-graph-history-toggle clickable-icon"
        :class="{ 'is-active': historyActive }"
        aria-label="Show history of the active file"
        :aria-pressed="historyActive"
        @click="emit('update:historyActive', !historyActive)"
      >
        <Icon name="file-clock" />
      </button>
    </div>
  </div>
</template>
