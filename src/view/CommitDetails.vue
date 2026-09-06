<script setup lang="ts">
import type { ChangedFile, CommitDetails } from '../git/types';
import { formatAbsolute } from './dates';
import Icon from './Icon.vue';

defineProps<{ details: CommitDetails | null; error: string | null; hash: string }>();

function copy(text: string): void {
	void navigator.clipboard?.writeText(text);
}

function fileLabel(f: ChangedFile): string {
	return f.oldPath ? `${f.path} ← ${f.oldPath}` : f.path;
}
</script>

<template>
  <div class="git-graph-details">
    <div
      v-if="error !== null"
      class="git-graph-details-error"
    >
      {{ error }}
    </div>
    <div
      v-else-if="details === null"
      class="git-graph-details-loading"
    >
      Loading commit…
    </div>
    <template v-else>
      <div class="git-graph-details-hash">
        <code>{{ details.hash }}</code>
        <button
          type="button"
          class="git-graph-copy clickable-icon"
          aria-label="Copy hash"
          @click.stop="copy(details.hash)"
        >
          <Icon name="copy" />
        </button>
      </div>
      <div class="git-graph-details-people">
        <div>Author: {{ details.author }} &lt;{{ details.email }}&gt;, {{ formatAbsolute(details.authorDate) }}</div>
        <div v-if="details.committer !== details.author || details.commitDate !== details.authorDate">
          Committer: {{ details.committer }}, {{ formatAbsolute(details.commitDate) }}
        </div>
      </div>
      <pre class="git-graph-details-body">{{ details.body }}</pre>
      <ul class="git-graph-files">
        <li
          v-for="f in details.files"
          :key="f.path"
          class="git-graph-file"
          :title="fileLabel(f)"
        >
          <span :class="['git-graph-file-status', `git-graph-file-status-${f.status}`]">{{ f.status }}</span>
          <span class="git-graph-file-path">{{ fileLabel(f) }}</span>
        </li>
      </ul>
      <div
        v-if="details.files.length === 0"
        class="git-graph-files-empty"
      >
        No file changes
      </div>
    </template>
  </div>
</template>
