<script setup lang="ts">
import type { ChangedFile } from '../git/types';

defineProps<{ files: ChangedFile[] }>();
const emit = defineEmits<{ openFile: [path: string] }>();

function fileLabel(f: ChangedFile): string {
	return f.oldPath ? `${f.path} ← ${f.oldPath}` : f.path;
}

function onFileKey(e: KeyboardEvent, path: string): void {
	if (e.key === 'Enter' || e.key === ' ') {
		e.preventDefault();
		e.stopPropagation();
		emit('openFile', path);
	}
}
</script>

<template>
  <ul class="git-graph-files">
    <li
      v-for="f in files"
      :key="f.path"
      class="git-graph-file"
    >
      <span
        class="git-graph-file-link"
        role="link"
        tabindex="0"
        :title="`Open ${fileLabel(f)}`"
        @click.stop="emit('openFile', f.path)"
        @keydown="onFileKey($event, f.path)"
      >
        <span :class="['git-graph-file-status', `git-graph-file-status-${f.status}`]">{{ f.status }}</span>
        <span class="git-graph-file-path">{{ fileLabel(f) }}</span>
      </span>
    </li>
  </ul>
  <div
    v-if="files.length === 0"
    class="git-graph-files-empty"
  >
    No file changes
  </div>
</template>
