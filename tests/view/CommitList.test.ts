import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import CommitList from '../../src/view/CommitList.vue';
import type { Commit } from '../../src/git/types';
import type { Row } from '../../src/graph/types';

const commits = new Map<string, Commit>();
const rows: Row[] = Array.from({ length: 1000 }, (_, i) => {
	const hash = `c${i}`;
	commits.set(hash, { hash, parents: [], author: 'Ann', email: 'a@x', date: '2026-09-06T00:00:00Z', subject: `Commit ${i}` });
	return { hash, lane: 0, color: 0, isMerge: false, laneCount: 1, segments: [] };
});

const mountList = (over: Record<string, unknown> = {}, attachTo?: HTMLElement) =>
	mount(CommitList, {
		attachTo,
		props: {
			rows,
			commitOf: (h: string) => commits.get(h),
			refsByHash: new Map(),
			headHash: 'c0',
			expandedHash: null,
			expandedDetails: null,
			detailsError: null,
			dateFormat: 'relative',
			showGraph: true,
			hasMore: false,
			dirty: null,
			dirtyExpanded: false,
			dirtyFiles: null,
			dirtyError: null,
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

	it('measures the expanded dirty block, shifting the commits below it, and emits toggleDirty on a click', async () => {
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
			const w = mountList({ dirty: { count: 2, laneCount: 1, headLane: 0, color: 0 }, dirtyExpanded: true, dirtyFiles: [{ path: 'a.md', status: 'M' }] });
			await nextTick();
			const host = w.get('.git-graph-dirty-host').element as HTMLElement;
			const observer = FakeRO.instances.find((inst) => inst.observed.includes(host));
			expect(observer).toBeDefined();

			Object.defineProperty(host, 'offsetHeight', { value: 60, configurable: true });
			observer!.cb([], observer as never);
			await nextTick();

			expect(w.findAll('.git-graph-item')[1]?.attributes('style')).toContain('top: 82px');
			expect(w.get('.git-graph-list-spacer').attributes('style')).toContain(`height: ${22 + 60 + 1000 * 22}px`);

			await w.get('.git-graph-row-dirty').trigger('click');
			expect(w.emitted('toggleDirty')).toHaveLength(1);
		} finally {
			Reflect.deleteProperty(window, 'ResizeObserver');
		}
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

	it('re-observes the details element after collapsing and expanding another row', async () => {
		class FakeRO {
			static instances: FakeRO[] = [];
			observed: Element[] = [];
			disconnected = false;
			constructor(public cb: ResizeObserverCallback) {
				FakeRO.instances.push(this);
			}
			observe(el: Element): void {
				this.observed.push(el);
			}
			disconnect(): void {
				this.disconnected = true;
			}
		}
		Object.defineProperty(window, 'ResizeObserver', { value: FakeRO, configurable: true });
		try {
			const w = mountList({ expandedHash: 'c1' });
			await nextTick();
			const containerEl = w.get('.git-graph-list').element;
			const observerFor = (el: Element) => FakeRO.instances.find((inst) => inst.observed.includes(el));
			const firstEl = w.get('.git-graph-details').element.parentElement as HTMLElement;
			expect(observerFor(firstEl)).toBeDefined();

			await w.setProps({ expandedHash: null } as never);
			await nextTick();
			expect(observerFor(firstEl)?.disconnected).toBe(true);

			await w.setProps({ expandedHash: 'c2' } as never);
			await nextTick();
			const secondEl = w.get('.git-graph-details').element.parentElement as HTMLElement;
			expect(secondEl).not.toBe(firstEl);
			expect(secondEl).not.toBe(containerEl);
			const second = observerFor(secondEl);
			expect(second).toBeDefined();

			Object.defineProperty(secondEl, 'offsetHeight', { value: 100, configurable: true });
			second!.cb([], second as never);
			await nextTick();
			expect(w.get('.git-graph-list-spacer').attributes('style')).toContain(`height: ${1000 * 22 + 100}px`);
		} finally {
			Reflect.deleteProperty(window, 'ResizeObserver');
		}
	});

	describe('file mode', () => {
		const fileChange = { file: { path: 'a.md', status: 'M' }, diff: { binary: false, truncated: false, lines: [{ kind: 'add', text: '+x' }] }, error: null };
		const details = { hash: 'c1', author: 'Ann', email: 'a@x', authorDate: '2026-09-06T00:00:00Z', committer: 'Ann', commitDate: '2026-09-06T00:00:00Z', body: 'b', files: [{ path: 'a.md', status: 'M' }] };

		it('shows the file diff after the commit header, with the files behind it, and keeps the plain list outside file mode', () => {
			const w = mountList({ expandedHash: 'c1', expandedDetails: details, fileChange });
			const host = w.get('.git-graph-details-host');
			expect([...host.element.children].map((el) => el.classList[0])).toEqual(['git-graph-step', 'git-graph-details', 'git-graph-change']);
			expect(host.find('.git-graph-details .git-graph-files').exists()).toBe(false);
			expect(host.get('.git-graph-change .git-graph-diff-add').text()).toBe('+x');
			expect(host.findAll('details.git-graph-change-all .git-graph-file')).toHaveLength(1);
			const plain = mountList({ expandedHash: 'c1', expandedDetails: details });
			expect(plain.find('.git-graph-diff').exists()).toBe(false);
			expect(plain.find('.git-graph-step').exists()).toBe(false);
			expect(plain.findAll('.git-graph-file')).toHaveLength(1);
		});

		// The diff is loaded independently of the details, so it neither waits on them nor
		// disappears with them.
		it('shows the diff while the details load and after they fail', () => {
			const loading = mountList({ expandedHash: 'c1', expandedDetails: null, fileChange });
			expect(loading.get('.git-graph-details').text()).toContain('Loading commit');
			expect(loading.get('.git-graph-diff-add').text()).toBe('+x');
			expect(loading.get('details.git-graph-change-all').text()).toContain('Loading files');
			const failed = mountList({ expandedHash: 'c1', detailsError: 'fatal: nope', fileChange });
			expect(failed.get('.git-graph-details-error').text()).toBe('fatal: nope');
			expect(failed.get('.git-graph-diff-add').text()).toBe('+x');
			expect(failed.find('details.git-graph-change-all').exists()).toBe(false);
		});

		it('names the commit each step button goes to', () => {
			const w = mountList({ rows: rows.slice(0, 3), expandedHash: 'c1', expandedDetails: details, fileChange });
			expect(w.get('.git-graph-step-newer').attributes('aria-label')).toBe('Newer commit: Commit 0');
			expect(w.get('.git-graph-step-older').attributes('aria-label')).toBe('Older commit: Commit 2');
			const last = mountList({ rows: rows.slice(0, 3), expandedHash: 'c2', fileChange, hasMore: true });
			expect(last.get('.git-graph-step-older').attributes('aria-label')).toBe('Older commit');
		});

		it('keeps the All files disclosure open or closed across steps', async () => {
			const w = mountList({ rows: rows.slice(0, 3), expandedHash: 'c1', expandedDetails: details, fileChange });
			const all = w.get('details.git-graph-change-all');
			(all.element as HTMLDetailsElement).open = true;
			await all.trigger('toggle');
			await w.setProps({ expandedHash: 'c2' });
			expect(w.get('.git-graph-row-expanded .git-graph-subject').text()).toBe('Commit 2');
			expect(w.get('details.git-graph-change-all').attributes('open')).toBeDefined();
		});

		it('steps with the Newer/Older buttons, disabling the ones with nowhere to go', async () => {
			const w = mountList({ rows: rows.slice(0, 3), expandedHash: 'c1', expandedDetails: details, fileChange });
			await w.get('.git-graph-step-newer').trigger('click');
			await w.get('.git-graph-step-older').trigger('click');
			expect(w.emitted('step')).toEqual([['c1', -1], ['c1', 1]]);
			const first = mountList({ rows: rows.slice(0, 3), expandedHash: 'c0', fileChange });
			expect(first.get('.git-graph-step-newer').attributes('disabled')).toBeDefined();
			const last = mountList({ rows: rows.slice(0, 3), expandedHash: 'c2', fileChange });
			expect(last.get('.git-graph-step-older').attributes('disabled')).toBeDefined();
			const more = mountList({ rows: rows.slice(0, 3), expandedHash: 'c2', fileChange, hasMore: true });
			expect(more.get('.git-graph-step-older').attributes('disabled')).toBeUndefined();
		});

		it('steps from the focused expanded row with the arrow keys, but not past either end', async () => {
			const w = mountList({ rows: rows.slice(0, 3), expandedHash: 'c1', fileChange });
			await w.get('.git-graph-row-expanded').trigger('keydown', { key: 'ArrowDown' });
			expect(w.emitted('step')).toEqual([['c1', 1]]);
			const first = mountList({ rows: rows.slice(0, 3), expandedHash: 'c0', fileChange });
			await first.get('.git-graph-row-expanded').trigger('keydown', { key: 'ArrowUp' });
			const last = mountList({ rows: rows.slice(0, 3), expandedHash: 'c2', fileChange });
			await last.get('.git-graph-row-expanded').trigger('keydown', { key: 'ArrowDown' });
			expect(first.emitted('step')).toBeUndefined();
			expect(last.emitted('step')).toBeUndefined();
		});

		it('announces the commit a step lands on to screen readers', async () => {
			const w = mountList({ rows: rows.slice(0, 12), expandedHash: 'c2', fileChange });
			const live = w.get('[aria-live="polite"]');
			expect(live.classes()).toContain('git-graph-sr-only');
			expect(live.text()).toBe('');
			await w.get('.git-graph-step-older').trigger('click');
			await w.setProps({ expandedHash: 'c3' });
			await nextTick();
			expect(live.text()).toBe('Older commit: Commit 3, 4 of 12');
			await w.get('.git-graph-step-newer').trigger('click');
			await w.setProps({ expandedHash: 'c2', hasMore: true });
			await nextTick();
			expect(live.text()).toBe('Newer commit: Commit 2, 3 of 12 loaded');
		});

		// The stepped-to row takes the place the stepped-from row had in the viewport, so the
		// Newer/Older buttons stay under the pointer while clicking through the history.
		it('keeps the expanded row where it was in the viewport after a step, and focuses the same control', async () => {
			const w = mountList({ expandedHash: 'c10', expandedDetails: details, fileChange, viewportHeight: 220 }, document.body);
			const list = w.get('.git-graph-list');
			(list.element as HTMLElement).scrollTop = 22 * 8;
			await list.trigger('scroll');
			await w.get('.git-graph-step-older').trigger('click');
			const focus = vi.spyOn(HTMLElement.prototype, 'focus');
			await w.setProps({ expandedHash: 'c11' });
			await nextTick();
			expect((list.element as HTMLElement).scrollTop).toBe(22 * 9);
			expect(document.activeElement?.classList.contains('git-graph-step-older')).toBe(true);
			expect(document.activeElement?.closest('.git-graph-item')?.querySelector('.git-graph-row')?.textContent).toContain('Commit 11');
			// Focusing must not scroll the control into view, undoing the anchoring above.
			expect(focus).toHaveBeenCalledWith({ preventScroll: true });
			focus.mockRestore();
			w.unmount();
		});

		it('moves focus, not the expansion, with the arrow keys on a row that is not expanded', async () => {
			const w = mountList({ rows: rows.slice(0, 3), expandedHash: 'c0', fileChange }, document.body);
			const second = w.get('[data-hash="c1"]');
			const event = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
			second.element.dispatchEvent(event);
			expect(w.emitted('step')).toBeUndefined();
			expect(w.emitted('toggle')).toBeUndefined();
			expect((document.activeElement as HTMLElement | null)?.dataset.hash).toBe('c2');
			expect(event.defaultPrevented).toBe(true);
			w.unmount();
		});
	});

	describe('arrow keys', () => {
		it('move focus to the previous and next rendered row without expanding', async () => {
			const w = mountList({ rows: rows.slice(0, 3) }, document.body);
			const row = (hash: string) => w.get(`[data-hash="${hash}"]`).element as HTMLElement;
			row('c1').focus();
			await w.get('[data-hash="c1"]').trigger('keydown', { key: 'ArrowDown' });
			expect(document.activeElement).toBe(row('c2'));
			await w.get('[data-hash="c2"]').trigger('keydown', { key: 'ArrowUp' });
			expect(document.activeElement).toBe(row('c1'));
			expect(w.emitted('toggle')).toBeUndefined();
			w.unmount();
		});

		// With nowhere to go, the key keeps its default (scrolling the list).
		it('leave the key alone at either end', () => {
			const w = mountList({ rows: rows.slice(0, 3) }, document.body);
			const event = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true });
			w.get('[data-hash="c0"]').element.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
			w.unmount();
		});
	});
});
