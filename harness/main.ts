// Entry point for the browser harness: mounts the real GraphRoot.vue against a fixture
// repository, wires the toolbar, and exposes `window.__harness` so an agent (or Playwright) can
// wait for the first load instead of sleeping.

import { createApp, h, shallowRef } from 'vue';
import { DEFAULT_SETTINGS, normalizeSettings, type GitGraphSettings } from '../src/settings/types';
import { createEmitter } from '../src/util/emitter';
import GraphRoot from '../src/view/GraphRoot.vue';
import type { RepoState } from '../src/view/repoState';
import { createScenarioReader, findScenario, scenarioCommits, SCENARIOS, type Scenario } from './fixtures';
import '../styles.css';
import './theme.css';

interface HarnessApi {
	readonly scenarios: readonly Scenario[];
	readonly params: Record<string, string>;
	readonly ready: Promise<void>;
	emitChange(): void;
	setFilter(text: string): void;
}

declare global {
	interface Window {
		__harness: HarnessApi;
	}
}

const READY_TIMEOUT_MS = 15_000;
const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 700;
const FAKE_ROOT = 'C:/Vaults/notes';
const FAKE_GIT_PATH = 'C:\\Program Files\\Git\\cmd\\git.exe';

const params = new URLSearchParams(window.location.search);
const scenario = findScenario(params.get('scenario'));
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';

// --- state ----------------------------------------------------------------------------------

function buildSettings(): GitGraphSettings {
	return normalizeSettings({
		...DEFAULT_SETTINGS,
		refFilter: params.get('refs') ?? undefined,
		dateFormat: params.get('dateFormat') ?? undefined,
		showDirtyRow: params.has('dirtyRow') ? params.get('dirtyRow') !== '0' : undefined,
		pageSize: params.has('pageSize') ? Number(params.get('pageSize')) : undefined,
	});
}

function buildRepoState(): RepoState {
	if (scenario.state === 'none') return { kind: 'none' };
	if (scenario.state === 'no-git') return { kind: 'no-git', gitPath: FAKE_GIT_PATH };
	if (scenario.state === 'unresolved') return { kind: 'unresolved' };
	return { kind: 'ready', root: FAKE_ROOT, reader: createScenarioReader(scenario.name) };
}

const settings = shallowRef(buildSettings());
const changes = createEmitter<void>();
const repoState = buildRepoState();

// --- mount ----------------------------------------------------------------------------------

const frame = document.querySelector<HTMLElement>('#app');
if (frame === null) throw new Error('harness: #app is missing from index.html');

const size = (name: string, fallback: number): number => {
	const value = Number(params.get(name));
	return Number.isFinite(value) && value > 0 ? value : fallback;
};
frame.style.width = `${size('width', DEFAULT_WIDTH)}px`;
frame.style.height = `${size('height', DEFAULT_HEIGHT)}px`;
document.body.classList.toggle('theme-dark', theme === 'dark');

createApp({
	render: () =>
		h(GraphRoot, {
			repoState,
			settings: settings.value,
			changes,
			onUpdateSettings: (patch: Partial<GitGraphSettings>) => {
				settings.value = { ...settings.value, ...patch };
			},
		}),
}).mount(frame);

// --- toolbar --------------------------------------------------------------------------------

function navigate(key: string, value: string): void {
	const next = new URLSearchParams(window.location.search);
	next.set(key, value);
	window.location.search = next.toString();
}

function fillSelect(id: string, options: readonly { value: string; label: string }[], selected: string, key: string): void {
	const select = document.querySelector<HTMLSelectElement>(`#${id}`);
	if (select === null) return;
	select.replaceChildren(
		...options.map((option) => {
			const el = document.createElement('option');
			el.value = option.value;
			el.textContent = option.label;
			return el;
		}),
	);
	select.value = selected;
	select.addEventListener('change', () => navigate(key, select.value));
}

function setText(id: string, text: string): void {
	const el = document.querySelector<HTMLElement>(`#${id}`);
	if (el !== null) el.textContent = text;
}

function buildToolbar(): void {
	fillSelect('harness-scenario', SCENARIOS.map((s) => ({ value: s.name, label: s.name })), scenario.name, 'scenario');
	fillSelect('harness-theme', [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], theme, 'theme');
	fillSelect('harness-refs', [{ value: 'auto', label: 'Auto' }, { value: 'all', label: 'All' }], settings.value.refFilter, 'refs');
	setText('harness-description', scenario.description);
	document.querySelector('#harness-emit')?.addEventListener('click', () => changes.emit());
}

buildToolbar();

// --- readiness ------------------------------------------------------------------------------

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
	const deadline = performance.now() + READY_TIMEOUT_MS;
	while (!predicate()) {
		if (performance.now() > deadline) throw new Error(`harness: timed out waiting for ${what}`);
		await nextFrame();
	}
}

/** True once the view shows a terminal state: rows, an empty message that is not "Loading…", or a banner. */
function firstLoadSettled(): boolean {
	const view = document.querySelector('.git-graph-view');
	if (view === null) return false;
	const empties = [...view.querySelectorAll('.git-graph-empty')];
	if (empties.some((el) => (el.textContent ?? '').includes('Loading history'))) return false;
	return view.querySelector('.git-graph-row') !== null || empties.length > 0 || view.querySelector('.git-graph-banner') !== null;
}

function setFilter(text: string): void {
	const input = document.querySelector<HTMLInputElement>('.git-graph-filter');
	if (input === null) return;
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** `expand=` takes a hash prefix or a piece of a commit subject; the row must be rendered. */
async function expandRow(needle: string): Promise<void> {
	const wanted = needle.toLowerCase();
	const commit = scenarioCommits(scenario.name).find((c) => c.hash.startsWith(wanted) || c.subject.toLowerCase().includes(wanted));
	if (commit === undefined) return;
	const rows = [...document.querySelectorAll<HTMLElement>('.git-graph-row:not(.git-graph-row-dirty)')];
	const row = rows.find((el) => el.querySelector('.git-graph-subject')?.textContent === commit.subject);
	if (row === undefined) return;
	row.click();
	await waitFor(() => document.querySelector('.git-graph-details') !== null, 'the commit details panel');
}

async function becomeReady(): Promise<void> {
	await waitFor(firstLoadSettled, 'the first load to settle');
	if (scenario.refreshAfterLoad === true) {
		changes.emit();
		await waitFor(() => document.querySelector('.git-graph-banner') !== null, 'the error banner');
	}
	const filter = params.get('filter');
	if (filter !== null) setFilter(filter);
	const expand = params.get('expand');
	if (expand !== null) await expandRow(expand);
	// Two frames so Vue has flushed the filter/expand updates before a screenshot is taken.
	await nextFrame();
	await nextFrame();
}

const ready = becomeReady();
// Nobody may ever await `ready`; keep a rejection from surfacing as an unhandled rejection
// while still letting an awaiting caller (Playwright) see it.
ready.catch((e: unknown) => console.error(e));

window.__harness = {
	scenarios: SCENARIOS,
	params: Object.fromEntries(params),
	ready,
	emitChange: () => changes.emit(),
	setFilter,
};
