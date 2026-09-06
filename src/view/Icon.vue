<script setup lang="ts">
import { setIcon } from 'obsidian';
import { onMounted, ref, watch } from 'vue';

const props = defineProps<{ name: string }>();
const el = ref<HTMLElement | null>(null);

const apply = (): void => {
	if (el.value) setIcon(el.value, props.name);
};
onMounted(apply);
watch(() => props.name, apply);
</script>

<template>
  <span
    ref="el"
    class="git-graph-icon"
    :data-icon="name"
    aria-hidden="true"
  />
</template>
