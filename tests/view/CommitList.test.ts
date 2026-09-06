import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import CommitList from '../../src/view/CommitList.vue';
import type { Commit } from '../../src/git/types';
import type { Row } from '../../src/graph/types';

const commits = new Map<string, Commit>();
const rows: Row[] = Array.from({ length: 1000 }, (_, i) => {
	const hash = `c${i}`;
	commits.set(hash, { hash, parents: [], author: 'Ann', email: 'a@x', date: '2026-09-06T00:00:00Z', subject: `Commit ${i}` });
	return { hash, lane: 0, color: 0, isMerge: false, laneCount: 1, segments: [] };
});

const mountList = (over: Record<string, unknown> = {}) =>
	mount(CommitList, {
		props: {
			rows,
			commitOf: (h: string) => commits.get(h),
			refsByHash: new Map(),
			headHash: 'c0',
			headBranch: 'main',
			expandedHash: null,
			expandedDetails: null,
			detailsError: null,
			dateFormat: 'relative',
			showGraph: true,
			hasMore: false,
			dirty: null,
			viewportHeight: 220,
			...over,
		},
	});

describe('CommitList', () => {
	it('renders only the rows near the viewport, sized by the spacer', () => {
		const w = mountList();
		const items = w.findAll('.git-graph-row');
		expect(items.length).toBeGreaterThanOrEqual(10);
		expect(items.length).toBeLessThanOrEqual(16);
		expect(items[0]?.get('.git-graph-subject').text()).toBe('Commit 0');
		expect(w.get('.git-graph-list-spacer').attributes('style')).toContain(`height: ${1000 * 22}px`);
	});

	it('moves the window on scroll', async () => {
		const w = mountList();
		const list = w.get('.git-graph-list');
		Object.defineProperty(list.element, 'scrollTop', { value: 22 * 500, configurable: true });
		await list.trigger('scroll');
		await nextTick();
		const subjects = w.findAll('.git-graph-subject').map((s) => s.text());
		expect(subjects).toContain('Commit 500');
		expect(subjects).not.toContain('Commit 0');
	});

	it('renders the dirty row first and shifts commits down by one row', () => {
		const w = mountList({ dirty: { count: 3, laneCount: 1, headLane: 0, color: 0 } });
		const first = w.findAll('.git-graph-row')[0];
		expect(first?.classes()).toContain('git-graph-row-dirty');
		expect(first?.text()).toContain('3 changes');
		expect(w.get('.git-graph-list-spacer').attributes('style')).toContain(`height: ${1001 * 22}px`);
	});

	it('renders details under the expanded row and emits toggle with the hash', async () => {
		const w = mountList({ expandedHash: 'c1', expandedDetails: null });
		const items = w.findAll('.git-graph-item');
		expect(items[1]?.find('.git-graph-details').exists()).toBe(true);
		expect(items[1]?.find('.git-graph-details').text()).toContain('Loading');
		await items[2]?.get('.git-graph-row').trigger('click');
		expect(w.emitted('toggle')).toEqual([['c2']]);
	});

	it('emits loadMore when the window reaches the end and more is available', async () => {
		const w = mountList({ rows: rows.slice(0, 8), hasMore: true });
		await nextTick();
		expect(w.emitted('loadMore')).toHaveLength(1);
		const done = mountList({ rows: rows.slice(0, 8), hasMore: false });
		await nextTick();
		expect(done.emitted('loadMore')).toBeUndefined();
	});

	it('observes the expanded details element (not an array) and grows the spacer to fit its measured height', async () => {
		class FakeRO {
			static instances: FakeRO[] = [];
			observed: Element[] = [];
			constructor(public cb: ResizeObserverCallback) {
				FakeRO.instances.push(this);
			}
			observe(el: Element): void {
				this.observed.push(el);
			}
			disconnect(): void {}
		}
		Object.defineProperty(window, 'ResizeObserver', { value: FakeRO, configurable: true });
		try {
			const w = mountList({ expandedHash: 'c1' });
			await nextTick();

			const containerEl = w.get('.git-graph-list').element;
			const withDetails = FakeRO.instances.find((inst) => inst.observed.some((el) => el instanceof HTMLElement && el !== containerEl && el.querySelector('.git-graph-details')));
			expect(withDetails).toBeDefined();
			const el = withDetails!.observed.find((e) => e instanceof HTMLElement && e !== containerEl && e.querySelector('.git-graph-details')) as HTMLElement;
			expect(el).toBeInstanceOf(HTMLElement);

			Object.defineProperty(el, 'offsetHeight', { value: 100, configurable: true });
			withDetails!.cb([], withDetails as never);
			await nextTick();

			expect(w.get('.git-graph-list-spacer').attributes('style')).toContain(`height: ${1000 * 22 + 100}px`);
		} finally {
			Reflect.deleteProperty(window, 'ResizeObserver');
		}
	});
});
