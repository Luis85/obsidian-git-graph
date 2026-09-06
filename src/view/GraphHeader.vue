<script setup lang="ts">
import type { RefFilter } from '../git/types';
import Icon from './Icon.vue';

defineProps<{ repoName: string; branch: string | null; refFilter: RefFilter; filterText: string; loading: boolean }>();
const emit = defineEmits<{ refresh: []; 'update:refFilter': [value: RefFilter]; 'update:filterText': [value: string] }>();

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
      <span class="git-graph-branch">{{ branch ?? 'detached' }}</span>
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
    </div>
  </div>
</template>
