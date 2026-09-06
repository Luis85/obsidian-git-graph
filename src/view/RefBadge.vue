<script setup lang="ts">
import { computed } from 'vue';
import type { Ref } from '../git/types';
import Icon from './Icon.vue';

const props = defineProps<{ gitRef: Ref; isUpstream: boolean }>();

const ICONS: Record<Ref['kind'], string> = { branch: 'git-branch', remote: 'cloud', tag: 'tag' };
const LABELS: Record<Ref['kind'], string> = { branch: 'Branch', remote: 'Remote branch', tag: 'Tag' };

const classes = computed(() => ({
	'git-graph-ref': true,
	[`git-graph-ref-${props.gitRef.kind}`]: true,
	'git-graph-ref-head': props.gitRef.isHead,
	'git-graph-ref-upstream': props.isUpstream,
}));
const title = computed(() => `${LABELS[props.gitRef.kind]} ${props.gitRef.name}`);
</script>

<template>
  <span
    :class="classes"
    :title="title"
  >
    <Icon :name="ICONS[gitRef.kind]" />
    <span class="git-graph-ref-name">{{ gitRef.name }}</span>
  </span>
</template>
