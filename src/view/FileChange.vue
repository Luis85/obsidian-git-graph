<script setup lang="ts">
import { computed } from 'vue';
import { MAX_DIFF_LINES } from '../git/diff';
import type { ChangedFile, FileDiff } from '../git/types';
import FileList from './FileList.vue';

const props = defineProps<{
	/** The followed file as this commit had it; null when there is nothing followed to show. */
	file: ChangedFile | null;
	diff: FileDiff | null;
	error: string | null;
	/** Every file of the commit, from its details: null while those are still loading. */
	files: ChangedFile[] | null;
	/** The details failed (CommitDetails says so above), so there is no file list to offer. */
	filesFailed?: boolean;
	/** Owned by CommitList, so the disclosure stays as the user left it while stepping. */
	allOpen?: boolean;
}>();
const emit = defineEmits<{ openFile: [path: string]; 'update:allOpen': [open: boolean] }>();

/** A rename or copy names where the file came from; the verb is spelled out for screen readers. */
const origin = computed<{ verb: 'Renamed' | 'Copied'; path: string } | null>(() => {
	const f = props.file;
	if (f === null || f.oldPath === undefined) return null;
	if (f.status === 'R') return { verb: 'Renamed', path: f.oldPath };
	if (f.status === 'C') return { verb: 'Copied', path: f.oldPath };
	return null;
});

/** What to say instead of lines, when there are none to show. */
const notice = computed<string | null>(() => {
	const d = props.diff;
	if (d === null || d.lines.length > 0) return null;
	if (d.binary) return 'Binary file changed.';
	return origin.value === null ? 'No content changes.' : `${origin.value.verb}, content unchanged.`;
});

const truncatedNote = `Showing the first ${MAX_DIFF_LINES.toLocaleString('en-US')} lines.`;

function onToggle(e: Event): void {
	emit('update:allOpen', (e.target as HTMLDetailsElement).open);
}
</script>

<template>
  <div class="git-graph-change">
    <template v-if="file !== null">
      <div class="git-graph-change-file">
        <span :class="['git-graph-file-status', `git-graph-file-status-${file.status}`]">{{ file.status }}</span>
        <span
          class="git-graph-file-path"
          :title="origin === null ? file.path : `${origin.verb} from ${origin.path}`"
        >{{ file.path }}<span v-if="origin !== null"><span aria-hidden="true"> ← </span><span class="git-graph-sr-only">, {{ origin.verb.toLowerCase() }} from </span>{{ origin.path }}</span></span>
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
        <!-- v-text, not a mustache: template whitespace around it would show under white-space: pre.
             Focusable so a keyboard can scroll the long lines sideways. -->
        <div
          class="git-graph-diff"
          tabindex="0"
          role="region"
          :aria-label="`Changes to ${file.path}`"
        >
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
          {{ truncatedNote }}
        </div>
      </template>
    </template>
    <details
      v-if="!filesFailed"
      class="git-graph-change-all"
      :open="allOpen"
      @toggle="onToggle"
    >
      <summary>{{ files === null ? 'All files' : `All files (${files.length})` }}</summary>
      <div
        v-if="files === null"
        class="git-graph-details-loading"
      >
        Loading files…
      </div>
      <FileList
        v-else
        :files="files"
        @open-file="emit('openFile', $event)"
      />
    </details>
  </div>
</template>
