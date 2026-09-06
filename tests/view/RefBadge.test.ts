import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import RefBadge from '../../src/view/RefBadge.vue';

describe('RefBadge', () => {
	it('renders kind class, icon and name', () => {
		const w = mount(RefBadge, { props: { gitRef: { hash: 'a', name: 'origin/main', kind: 'remote', isHead: false }, isUpstream: true } });
		expect(w.classes()).toEqual(expect.arrayContaining(['git-graph-ref', 'git-graph-ref-remote', 'git-graph-ref-upstream']));
		expect(w.get('.git-graph-icon').attributes('data-icon')).toBe('cloud');
		expect(w.text()).toBe('origin/main');
	});

	it('marks the head branch and uses the branch and tag icons', () => {
		const head = mount(RefBadge, { props: { gitRef: { hash: 'a', name: 'main', kind: 'branch', isHead: true }, isUpstream: false } });
		expect(head.classes()).toContain('git-graph-ref-head');
		expect(head.get('.git-graph-icon').attributes('data-icon')).toBe('git-branch');
		const tag = mount(RefBadge, { props: { gitRef: { hash: 'a', name: 'v1', kind: 'tag', isHead: false }, isUpstream: false } });
		expect(tag.get('.git-graph-icon').attributes('data-icon')).toBe('tag');
		expect(tag.attributes('title')).toBe('Tag v1');
	});
});
