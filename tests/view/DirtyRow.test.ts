import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import DirtyRow from '../../src/view/DirtyRow.vue';

const mountRow = (over: Partial<InstanceType<typeof DirtyRow>['$props']> = {}) =>
	mount(DirtyRow, { props: { count: 2, laneCount: 1, headLane: 0, color: 0, expanded: false, ...over } });

describe('DirtyRow', () => {
	it('renders the change count and lane cell', () => {
		const w = mountRow();
		expect(w.get('.git-graph-subject').text()).toBe('2 changes');
		expect(w.find('svg.git-graph-lanes').exists()).toBe(true);
	});

	it('emits toggle on Enter and Space, not on other keys, and reflects expanded', async () => {
		const w = mountRow({ expanded: true });
		expect(w.classes()).toContain('git-graph-row-expanded');
		await w.trigger('keydown', { key: 'Enter' });
		await w.trigger('keydown', { key: ' ' });
		await w.trigger('keydown', { key: 'x' });
		expect(w.emitted('toggle')).toHaveLength(2);
	});
});
