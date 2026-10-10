<script setup lang="ts">
import { computed } from 'vue';
import type { ChangedFile, FileDiff } from '../git/types';
import FileList from './FileList.vue';

const props = defineProps<{ file: ChangedFile | null; diff: FileDiff | null; error: string | null; files: ChangedFile[] }>();
const emit = defineEmits<{ openFile: [path: string] }>();

const renamedFrom = computed(() => (props.file?.status === 'R' && props.file.oldPath !== undefined ? props.file.oldPath : null));

/** What to say instead of lines, when there are none to show. */
const notice = computed<string | null>(() => {
	const d = props.diff;
	if (d === null || d.lines.length > 0) return null;
	if (d.binary) return 'Binary file changed.';
	return renamedFrom.value === null ? 'No content changes.' : 'Renamed, content unchanged.';
});
</script>

<template>
  <div>
    <div
      v-if="renamedFrom !== null"
      class="git-graph-change-rename"
    >
      Renamed from {{ renamedFrom }}
    </div>
    <div
      v-if="error !== null"
      class="git-graph-details-error"
    >
      {{ error }}
    </div>
    <div
      v-else-if="diff === null"
      class="git-graph-details-loading"
    >
      Loading changes…
    </div>
    <div
      v-else-if="notice !== null"
      class="git-graph-change-notice"
    >
      {{ notice }}
    </div>
    <template v-else>
      <!-- v-text, not a mustache: template whitespace around it would show under white-space: pre. -->
      <div class="git-graph-diff">
        <div
          v-for="(line, i) in diff.lines"
          :key="i"
          :class="['git-graph-diff-line', `git-graph-diff-${line.kind}`]"
          v-text="line.text"
        />
      </div>
      <div
        v-if="diff.truncated"
        class="git-graph-change-notice"
      >
        Diff truncated: too long to show in full.
      </div>
    </template>
    <details class="git-graph-change-all">
      <summary>All files ({{ files.length }})</summary>
      <FileList
        :files="files"
        @open-file="emit('openFile', $event)"
      />
    </details>
  </div>
</template>
