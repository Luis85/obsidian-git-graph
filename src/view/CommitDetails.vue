<script setup lang="ts">
import type { CommitDetails } from '../git/types';
import { formatAbsolute } from './dates';
import FileList from './FileList.vue';
import Icon from './Icon.vue';

defineProps<{ details: CommitDetails | null; error: string | null }>();
const emit = defineEmits<{ openFile: [path: string] }>();

function copy(text: string): void {
	void navigator.clipboard?.writeText(text);
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
      <FileList
        :files="details.files"
        @open-file="emit('openFile', $event)"
      />
    </template>
  </div>
</template>
