// Browser stand-in for the `obsidian` module, aliased in by vite.harness.config.ts.
//
// `src/view/**` imports exactly one name from `obsidian` (`setIcon`, in Icon.vue), so that is
// all this file provides. Obsidian's real `setIcon` looks the name up in its bundled Lucide
// set and appends the SVG; `lucide` on npm is the same icon set, so the harness renders the
// same glyphs the plugin shows in Obsidian. Extend this only when src/view/** starts importing
// something new — never to make the harness diverge from the plugin.

import { createElement, icons } from 'lucide';

type IconNode = (typeof icons)[keyof typeof icons];
const ICONS = icons as Record<string, IconNode | undefined>;

const SVG_NS = 'http://www.w3.org/2000/svg';
const FALLBACK_SIZE = '12';

/** `git-branch` → `GitBranch`, matching Lucide's export names. */
function pascalCase(name: string): string {
	return name
		.split(/[-_\s]+/)
		.filter((part) => part.length > 0)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('');
}

/** An unknown icon name renders as an empty box rather than throwing, like Obsidian does. */
function placeholder(): SVGElement {
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('width', FALLBACK_SIZE);
	svg.setAttribute('height', FALLBACK_SIZE);
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	return svg;
}

export function setIcon(el: HTMLElement, icon: string): void {
	// The test mock records the name the same way; keeping it here means a selector that works
	// in the unit tests also works in the browser.
	el.dataset.icon = icon;
	const node = ICONS[pascalCase(icon)];
	el.replaceChildren(node === undefined ? placeholder() : createElement(node));
}
