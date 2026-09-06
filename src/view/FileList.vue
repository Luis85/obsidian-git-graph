<script setup lang="ts">
import type { ChangedFile } from '../git/types';

defineProps<{ files: ChangedFile[] }>();
const emit = defineEmits<{ openFile: [path: string] }>();

const isDeleted = (f: ChangedFile): boolean => f.status === 'D';
const keyOf = (f: ChangedFile): string => `${f.status}:${f.oldPath ?? ''}:${f.path}`;

function fileLabel(f: ChangedFile): string {
	return f.oldPath ? `${f.path} ← ${f.oldPath}` : f.path;
}

function titleFor(f: ChangedFile): string {
	return isDeleted(f) ? `${f.path} is deleted and cannot be opened` : `Open ${fileLabel(f)}`;
}

function open(f: ChangedFile): void {
	if (!isDeleted(f)) emit('openFile', f.path);
}

function onFileKey(e: KeyboardEvent, f: ChangedFile): void {
	if (e.key === 'Enter' || e.key === ' ') {
		e.preventDefault();
		e.stopPropagation();
		open(f);
	}
}
</script>

<template>
  <ul class="git-graph-files">
    <li
      v-for="f in files"
      :key="keyOf(f)"
      class="git-graph-file"
    >
      <span
        :class="['git-graph-file-link', { 'git-graph-file-deleted': isDeleted(f) }]"
        :role="isDeleted(f) ? undefined : 'link'"
        :tabindex="isDeleted(f) ? undefined : 0"
        :aria-disabled="isDeleted(f) ? 'true' : undefined"
        :title="titleFor(f)"
        @click.stop="open(f)"
        @keydown="onFileKey($event, f)"
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
