import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

export interface MeasuredHeight {
	/** The block's measured height, or `fallback` while nothing is mounted or measured yet. */
	readonly height: Ref<number>;
	/** Bind as `:ref` on the block's wrapper element. */
	onRef(el: unknown): void;
}

/**
 * Measures a block that appears and disappears inside a scrolling `container` — a virtualized
 * list needs its real height to place the rows below it.
 *
 * A template ref inside `v-for` is an array Vue mutates in place, so watching it only fires for
 * the first mount; instead `onRef` counts mounts of a genuinely new element (Vue re-invokes a
 * function ref on every patch) and the post-flush watch below re-queries `selector` inside
 * `container` and re-attaches a ResizeObserver to whichever element is in the DOM now.
 */
export function createMeasuredHeight(container: Ref<HTMLElement | null>, selector: string, fallback: number, key: () => unknown): MeasuredHeight {
	const height = ref(fallback);
	const mounts = ref(0);
	let lastEl: HTMLElement | null = null;
	let observer: ResizeObserver | null = null;

	function onRef(el: unknown): void {
		if (el instanceof HTMLElement && el !== lastEl) {
			lastEl = el;
			mounts.value++;
		}
	}

	watch(
		[key, mounts],
		() => {
			observer?.disconnect();
			observer = null;
			const el = container.value?.querySelector<HTMLElement>(selector) ?? null;
			if (el === null || typeof ResizeObserver === 'undefined') return;
			observer = new ResizeObserver(() => {
				height.value = el.offsetHeight || fallback;
			});
			observer.observe(el);
		},
		{ flush: 'post' },
	);

	onBeforeUnmount(() => observer?.disconnect());

	return { height, onRef };
}
