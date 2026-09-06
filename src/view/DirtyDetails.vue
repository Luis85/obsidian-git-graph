<script setup lang="ts">
import type { ChangedFile } from '../git/types';
import FileList from './FileList.vue';

defineProps<{ files: ChangedFile[] | null; error: string | null }>();
const emit = defineEmits<{ openFile: [path: string] }>();
</script>

<template>
  <div class="git-graph-details git-graph-dirty-details">
    <div
      v-if="error !== null"
      class="git-graph-details-error"
    >
      {{ error }}
    </div>
    <div
      v-else-if="files === null"
      class="git-graph-details-loading"
    >
      Loading changes…
    </div>
    <FileList
      v-else
      :files="files"
      @open-file="emit('openFile', $event)"
    />
  </div>
</template>
