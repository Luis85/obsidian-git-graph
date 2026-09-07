// Deterministic in-memory repositories for the browser harness.
//
// Nothing here reads the clock or a random source: every hash, date, author and file list is a
// pure function of the fixture id, so two runs of `npm run screenshot` produce the same pixels
// (relative dates are the one exception — they are rendered against the wall clock by
// src/view/dates.ts; pass `dateFormat=absolute` when that matters).

import type { ChangedFile, Commit, CommitDetails, FileStatus, GitReader, Ref, RefsSnapshot } from '../src/git/types';

export interface Scenario {
	readonly name: string;
	readonly description: string;
	/**
	 * Scenarios that are not a readable repository. `harness/main.ts` maps these straight to a
	 * RepoState instead of calling createScenarioReader().
	 */
	readonly state?: 'none' | 'no-git' | 'unresolved';
	/**
	 * The error banner only appears once a *second* load fails, so the harness emits one change
	 * event after the first load settles.
	 */
	readonly refreshAfterLoad?: boolean;
}

const AUTHORS = [
	{ name: 'Ann Novak', email: 'ann@example.com' },
	{ name: 'Bob Reyes', email: 'bob@example.com' },
	{ name: 'Cara Silva', email: 'cara@example.com' },
] as const;
type Author = (typeof AUTHORS)[number];
const authorAt = (index: number): Author => AUTHORS[index % AUTHORS.length] ?? AUTHORS[0];

// Newest commit, then one step older per row. Fixed instants, written in +02:00 like a European
// working day so the absolute date format has something realistic to show.
const NEWEST_MS = Date.parse('2026-09-05T17:40:00+02:00');
const STEP_MS = 3 * 3_600_000 + 7 * 60_000;
const OFFSET_MS = 2 * 3_600_000;
const pad = (n: number): string => String(n).padStart(2, '0');

function isoAt(index: number): string {
	const d = new Date(NEWEST_MS - index * STEP_MS + OFFSET_MS);
	const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
	return `${date}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+02:00`;
}

/** FNV-1a over the id, stretched to 40 hex chars: stable, unique per id, looks like a sha. */
function fakeHash(id: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
	let out = '';
	let x = h;
	while (out.length < 40) {
		x = Math.imul(x ^ (x >>> 15), 0x2545f491) >>> 0;
		out += x.toString(16).padStart(8, '0');
	}
	return out.slice(0, 40);
}

interface CommitSpec {
	readonly id: string;
	readonly subject: string;
	readonly parents?: readonly string[];
}

/** Turns compact specs (newest first) into commits, resolving parent ids to fake hashes. */
function buildCommits(prefix: string, specs: readonly CommitSpec[]): Commit[] {
	const hashOf = (id: string): string => fakeHash(`${prefix}/${id}`);
	return specs.map((spec, index) => {
		const author = authorAt(index);
		return {
			hash: hashOf(spec.id),
			parents: (spec.parents ?? []).map(hashOf),
			author: author.name,
			email: author.email,
			date: isoAt(index),
			subject: spec.subject,
		};
	});
}

interface RefSpec {
	readonly id: string;
	readonly name: string;
	readonly kind: Ref['kind'];
	readonly isHead?: boolean;
	readonly upstream?: string;
}

function buildRefs(prefix: string, specs: readonly RefSpec[]): Ref[] {
	return specs.map((spec) => ({
		hash: fakeHash(`${prefix}/${spec.id}`),
		name: spec.name,
		kind: spec.kind,
		isHead: spec.isHead === true,
		...(spec.upstream === undefined ? {} : { upstream: spec.upstream }),
	}));
}

interface Fixture {
	readonly commits: Commit[];
	readonly refs: Ref[];
	readonly headId: string | null;
	readonly headBranch: string | null;
	readonly changed: number;
	/** What `statusFiles()` serves; `changed` stays the count the dirty row shows. */
	readonly dirtyFiles?: readonly ChangedFile[];
	readonly detailsDelayMs?: number;
	/** After the first successful log(), every later log() rejects — the error banner path. */
	readonly failLogAfterFirst?: boolean;
	readonly prefix: string;
}

function fixture(prefix: string, parts: Omit<Fixture, 'prefix' | 'commits' | 'refs'> & { commits: readonly CommitSpec[]; refs: readonly RefSpec[] }): Fixture {
	return { ...parts, prefix, commits: buildCommits(prefix, parts.commits), refs: buildRefs(prefix, parts.refs) };
}

// --- commit details -------------------------------------------------------------------------

const FILES = [
	'src/view/CommitList.vue',
	'src/view/GraphHeader.vue',
	'src/graph/layout.ts',
	'src/git/parse.ts',
	'src/settings/types.ts',
	'styles.css',
	'README.md',
	'tests/graph/layout.test.ts',
] as const;
const STATUSES: readonly FileStatus[] = ['M', 'A', 'M', 'D', 'M', 'R'];
const BODIES = [
	'Keeps the pane responsive on repositories with a long history.',
	'Noticed while reviewing the pane on a vault with several remotes.',
	'No behavior change; this only moves code around.',
	'Follow-up to the review comments on the previous commit.',
] as const;

function detailsFor(commit: Commit): CommitDetails {
	const seed = Number.parseInt(commit.hash.slice(0, 4), 16);
	const count = 1 + (seed % 4);
	const files = Array.from({ length: count }, (_, i) => {
		const at = (seed + i * 3) % FILES.length;
		const status = STATUSES[(seed + i) % STATUSES.length] ?? 'M';
		const path = FILES[at] ?? 'README.md';
		return status === 'R' ? { path, status, oldPath: `${path}.old` } : { path, status };
	});
	const isMerge = commit.parents.length > 1;
	return {
		hash: commit.hash,
		author: commit.author,
		email: commit.email,
		authorDate: commit.date,
		committer: isMerge ? 'Ann Novak' : commit.author,
		commitDate: commit.date,
		body: `${commit.subject}\n\n${BODIES[seed % BODIES.length] ?? BODIES[0]}`,
		files,
	};
}

/** The working-tree changes behind the `dirty` scenario's count of 3. */
const DIRTY_FILES: readonly ChangedFile[] = [
	{ path: 'src/view/GraphHeader.vue', status: 'M' },
	{ path: 'src/view/DirtyDetails.vue', status: 'A' },
	{ path: 'notes/scratch.md', status: 'D' },
];

// --- scenarios ------------------------------------------------------------------------------

const LINEAR_SUBJECTS = [
	'Fix pane flicker when the vault reloads',
	'Add a keyboard shortcut for refresh',
	'Cache the ref snapshot between loads',
	'Document the settings tab',
	'Handle a detached HEAD in the header',
	'Bump vite to 8.2',
	'Split the layout into lanes and segments',
	'Extract the git reader interface',
	'Add relative date formatting',
	'Render commit details on click',
	'Draw the commit graph lanes',
	'Initial commit',
] as const;

const linear = (prefix: string): Fixture =>
	fixture(prefix, {
		commits: LINEAR_SUBJECTS.map((subject, i) => ({ id: `c${i}`, subject, parents: i === LINEAR_SUBJECTS.length - 1 ? [] : [`c${i + 1}`] })),
		refs: [
			{ id: 'c0', name: 'main', kind: 'branch', isHead: true, upstream: 'origin/main' },
			{ id: 'c0', name: 'origin/main', kind: 'remote' },
			{ id: 'c3', name: 'v1.0.0', kind: 'tag' },
		],
		headId: 'c0',
		headBranch: 'main',
		changed: 0,
	});

const merge = (prefix: string, changed: number, detailsDelayMs?: number): Fixture =>
	fixture(prefix, {
		commits: [
			{ id: 'm0', subject: "Merge branch 'feature/search' into main", parents: ['m1', 'f0'] },
			{ id: 'm1', subject: 'Fix the ref badge overflow on narrow panes', parents: ['m2'] },
			{ id: 'f0', subject: 'Filter commits by author and subject', parents: ['f1'] },
			{ id: 'f1', subject: 'Add a search box to the graph header', parents: ['m2'] },
			{ id: 'm2', subject: 'Show the working tree change count', parents: ['m3'] },
			{ id: 'm3', subject: 'Fix relative dates around midnight', parents: ['m4'] },
			{ id: 'm4', subject: 'Add branch and tag badges', parents: ['m5'] },
			{ id: 'm5', subject: 'Initial commit' },
		],
		refs: [
			{ id: 'm0', name: 'main', kind: 'branch', isHead: true, upstream: 'origin/main' },
			{ id: 'm0', name: 'origin/main', kind: 'remote' },
			{ id: 'f0', name: 'feature/search', kind: 'branch' },
		],
		headId: 'm0',
		headBranch: 'main',
		changed,
		...(detailsDelayMs === undefined ? {} : { detailsDelayMs }),
	});

const octopus = (): Fixture =>
	fixture('octopus', {
		commits: [
			{ id: 'o0', subject: "Merge branches 'docs', 'ci' and 'perf' into main", parents: ['o1', 'o2', 'o3'] },
			{ id: 'o1', subject: 'Trim the settings descriptions', parents: ['o4'] },
			{ id: 'o2', subject: 'Run oxlint and eslint in CI', parents: ['o4'] },
			{ id: 'o3', subject: 'Reuse the layout state while paging', parents: ['o4'] },
			{ id: 'o4', subject: 'Extract the graph store', parents: ['o5'] },
			{ id: 'o5', subject: 'Initial commit' },
		],
		refs: [
			{ id: 'o0', name: 'main', kind: 'branch', isHead: true, upstream: 'origin/main' },
			{ id: 'o0', name: 'origin/main', kind: 'remote' },
		],
		headId: 'o0',
		headBranch: 'main',
		changed: 0,
	});

// Four tips open at once, and HEAD deliberately sits on the third row rather than the first.
const branches = (): Fixture =>
	fixture('branches', {
		commits: [
			{ id: 'b0', subject: 'Add a lane color setting', parents: ['b5'] },
			{ id: 'b1', subject: 'Draft the release notes', parents: ['b5'] },
			{ id: 'b2', subject: 'Retry a failed git call once', parents: ['b4'] },
			{ id: 'b3', subject: 'Pin the Chromium build used by the harness', parents: ['b5'] },
			{ id: 'b4', subject: 'Show the upstream badge on the head row', parents: ['b5'] },
			{ id: 'b5', subject: 'Split the view into components', parents: ['b6'] },
			{ id: 'b6', subject: 'Initial commit' },
		],
		refs: [
			{ id: 'b2', name: 'main', kind: 'branch', isHead: true, upstream: 'origin/main' },
			{ id: 'b4', name: 'origin/main', kind: 'remote' },
			{ id: 'b0', name: 'feature/colors', kind: 'branch' },
			{ id: 'b0', name: 'origin/feature/colors', kind: 'remote' },
			{ id: 'b1', name: 'docs/release', kind: 'branch' },
			{ id: 'b3', name: 'chore/deps', kind: 'branch' },
			{ id: 'b5', name: 'v0.9.0', kind: 'tag' },
			{ id: 'b6', name: 'v0.8.0', kind: 'tag' },
		],
		headId: 'b2',
		headBranch: 'main',
		changed: 0,
	});

// A stacked feature branch: nested merges, and the tip's second parent (s1) reaching the shared
// parent s12 before the tip's own first-parent chain does — the shape that keeps the left lane
// honest and makes the side lanes slide in as the lines to their left end.
const stacked = (): Fixture =>
	fixture('stacked', {
		commits: [
			{ id: 's0', subject: "Merge remote-tracking branch 'origin/feature/costs' into feature/costs", parents: ['s2', 's1'] },
			{ id: 's1', subject: 'Fix the review completeness check', parents: ['s12'] },
			{ id: 's2', subject: "Merge branch 'feature/renovation' into feature/costs", parents: ['s9', 's3'] },
			{ id: 's3', subject: "Merge branch 'feature/walls' into feature/renovation", parents: ['s10', 's4'] },
			{ id: 's4', subject: "Merge branch 'feature/reference' into feature/walls", parents: ['s11', 's5'] },
			{ id: 's5', subject: "Merge branch 'feature/room-naming' into feature/reference", parents: ['s7', 's6'] },
			{ id: 's6', subject: 'Rename reaches the inspector heading', parents: ['s14'] },
			{ id: 's7', subject: 'Drop a calibration the snapshot lacks', parents: ['s14'] },
			{ id: 's11', subject: 'Every spatial code answers with its own sentence', parents: ['s13'] },
			{ id: 's10', subject: 'A metadata-only renovation still writes the sidecar', parents: ['s13'] },
			{ id: 's9', subject: 'Withhold the all-clear until planning has loaded', parents: ['s12'] },
			{ id: 's12', subject: 'Integrate the renovation stack', parents: ['s15', 's13'] },
			{ id: 's13', subject: 'Stop exporting the V2 schemas', parents: ['s14'] },
			{ id: 's14', subject: 'Validate the structure draft against the sidecar', parents: ['s15'] },
			{ id: 's15', subject: 'Implement connected materials and costs', parents: ['s16'] },
			{ id: 's16', subject: 'Initial commit' },
		],
		refs: [
			{ id: 's0', name: 'feature/costs', kind: 'branch', isHead: true, upstream: 'origin/feature/costs' },
			{ id: 's0', name: 'origin/feature/costs', kind: 'remote' },
			{ id: 's3', name: 'feature/renovation', kind: 'branch' },
		],
		headId: 's0',
		headBranch: 'feature/costs',
		changed: 0,
	});

// A short linear history on main (e0 to the root e1), plus a second tip (a three-parent
// octopus merge, e2) whose parents are all outside the loaded commits. e2 is unconnected to
// main's chain — a merge commit reachable only through its own branch, the way a page can end
// on a second tip once every ref is followed — so its row exercises offBottomColumn's fan-out
// fallback in src/graph/layout.ts with no incoming line of its own: three lines leave the
// bottom, one per parent, each claiming its own column.
const pageEndMerge = (): Fixture =>
	fixture('page-end-merge', {
		commits: [
			{ id: 'e0', subject: 'Add the page-end-merge harness scenario', parents: ['e1'] },
			{ id: 'e1', subject: 'Initial commit' },
			{ id: 'e2', subject: "Merge branches 'alpha', 'beta' and 'gamma' into main", parents: ['alpha', 'beta', 'gamma'] },
		],
		refs: [
			{ id: 'e0', name: 'main', kind: 'branch', isHead: true, upstream: 'origin/main' },
			{ id: 'e0', name: 'origin/main', kind: 'remote' },
			{ id: 'e2', name: 'feature/merged-elsewhere', kind: 'branch' },
		],
		headId: 'e0',
		headBranch: 'main',
		changed: 0,
	});

const LONG_COUNT = 600;
const LONG_VERBS = ['Add', 'Fix', 'Refactor', 'Document', 'Simplify', 'Speed up', 'Guard'] as const;
const LONG_TOPICS = [
	'the ref parser',
	'the lane layout',
	'the details panel',
	'the status poll',
	'the settings tab',
	'the date formatter',
	'the git runner',
	'the watcher debounce',
	'the empty state',
	'the filter box',
	'the page loader',
	'the error banner',
] as const;

const long = (): Fixture =>
	fixture('long', {
		commits: Array.from({ length: LONG_COUNT }, (_, i) => ({
			id: `l${i}`,
			subject: i === LONG_COUNT - 1 ? 'Initial commit' : `${LONG_VERBS[i % LONG_VERBS.length] ?? 'Add'} ${LONG_TOPICS[i % LONG_TOPICS.length] ?? 'the pane'}`,
			parents: i === LONG_COUNT - 1 ? [] : [`l${i + 1}`],
		})),
		refs: [
			{ id: 'l0', name: 'main', kind: 'branch', isHead: true, upstream: 'origin/main' },
			{ id: 'l0', name: 'origin/main', kind: 'remote' },
			{ id: 'l120', name: 'v2.0.0', kind: 'tag' },
			{ id: 'l380', name: 'v1.0.0', kind: 'tag' },
		],
		headId: 'l0',
		headBranch: 'main',
		changed: 0,
	});

const empty = (): Fixture => fixture('empty', { commits: [], refs: [], headId: null, headBranch: 'main', changed: 0 });

const FIXTURES: Record<string, () => Fixture> = {
	linear: () => linear('linear'),
	merge: () => merge('merge', 0),
	octopus,
	branches,
	stacked,
	'page-end-merge': pageEndMerge,
	long,
	dirty: () => ({ ...merge('dirty', 3), dirtyFiles: DIRTY_FILES }),
	empty,
	'empty-dirty': () => ({ ...empty(), changed: 2, dirtyFiles: DIRTY_FILES.slice(0, 2) }),
	error: () => ({ ...linear('error'), failLogAfterFirst: true }),
	slow: () => merge('slow', 0, 1500),
};

export const SCENARIOS: readonly Scenario[] = [
	{ name: 'linear', description: '12 commits on main, with an upstream remote branch and a tag.' },
	{ name: 'merge', description: 'A feature branch merged back into main — 8 commits, two lanes.' },
	{ name: 'octopus', description: 'A three-parent octopus merge.' },
	{ name: 'branches', description: 'Four open lanes, remotes and tags, with HEAD below the first row.' },
	{ name: 'stacked', description: 'Nested feature merges: the left lane stays with the tip, side lanes slide in as lines end.' },
	{ name: 'page-end-merge', description: 'The page ends on a three-parent merge whose parents are not loaded: three lines leave the bottom.' },
	{ name: 'long', description: `${LONG_COUNT} commits, so scrolling to the bottom pages in more.` },
	{ name: 'dirty', description: 'The merge history plus three uncommitted working tree changes; the changes row expands.' },
	{ name: 'empty', description: 'A repository with no commits yet.' },
	{ name: 'empty-dirty', description: 'No commits yet, but two uncommitted files: only the changes row shows.' },
	{ name: 'error', description: 'The first load succeeds, every later one fails: banner over kept rows.', refreshAfterLoad: true },
	{ name: 'slow', description: 'Commit details take 1.5 s to resolve, for the details loading state.' },
	{ name: 'none', description: 'The vault is not inside a git repository.', state: 'none' },
	{ name: 'no-git', description: 'Git was not found at the configured path.', state: 'no-git' },
	{ name: 'unresolved', description: 'The repository has not been located yet.', state: 'unresolved' },
];

const DEFAULT_SCENARIO = 'merge';

/** The scenario a `scenario=` query parameter names, falling back to the default. */
export function findScenario(name: string | null): Scenario {
	return SCENARIOS.find((s) => s.name === name) ?? SCENARIOS.find((s) => s.name === DEFAULT_SCENARIO) ?? { name: DEFAULT_SCENARIO, description: '' };
}

function fixtureFor(name: string): Fixture {
	const make = FIXTURES[name] ?? FIXTURES[DEFAULT_SCENARIO];
	if (make === undefined) throw new Error(`harness: no fixture for "${name}"`);
	return make();
}

/** The commit list a scenario will serve, for resolving `expand=` to a row. */
export function scenarioCommits(name: string): Commit[] {
	return fixtureFor(name).commits;
}

const delay = (ms: number): Promise<void> => (ms <= 0 ? Promise.resolve() : new Promise((resolve) => window.setTimeout(resolve, ms)));

/**
 * A GitReader over one fixture. `log` honours skip/count so paging is real, and honours `path`
 * by keeping only commits whose fixture file list (`detailsFor`) contains it, so the history
 * toggle shows a real subset. It ignores the ref filter, because a fixture is a pre-baked commit
 * list rather than a graph walk — changing `refs=auto|all` in the harness changes the header
 * dropdown and what the store asks for, not which commits come back.
 */
export function createScenarioReader(name: string): GitReader {
	const f = fixtureFor(name);
	const headHash = f.headId === null ? null : fakeHash(`${f.prefix}/${f.headId}`);
	const snapshot: RefsSnapshot = { refs: f.refs, headHash, headBranch: f.headBranch };
	const byHash = new Map(f.commits.map((c) => [c.hash, c]));
	let logCalls = 0;

	return {
		log({ skip, count, path }) {
			logCalls++;
			if (f.failLogAfterFirst === true && logCalls > 1) return Promise.reject(new Error('fatal: bad object HEAD'));
			const commits = path === undefined ? f.commits : f.commits.filter((c) => detailsFor(c).files.some((file) => file.path === path));
			return Promise.resolve(commits.slice(skip, skip + count));
		},
		refs: () => Promise.resolve(snapshot),
		status: () => Promise.resolve({ changed: f.changed }),
		statusFiles: () => Promise.resolve([...(f.dirtyFiles ?? [])]),
		commitDetails(hash) {
			const commit = byHash.get(hash);
			if (commit === undefined) return Promise.reject(new Error(`fatal: bad object ${hash}`));
			return delay(f.detailsDelayMs ?? 0).then(() => detailsFor(commit));
		},
	};
}
