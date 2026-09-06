# Git Graph Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the seven parked findings from the last whole-branch review (path identity for the watcher and `openFile`, status-read sequencing in the store, the empty-repo banner, doc accuracy, the harness toast, a real rename in the `statusFiles()` integration test) and land the improvements that fit one pass (muted deleted files, calendar-aware relative dates, stable `v-for` keys, coverage of three untested branches).

**Architecture:** One new leaf module `src/util/paths.ts` (canonical path identity, used by `src/watch` and `src/main.ts`), one new view module `src/view/statusSync.ts` that owns every status read for the store behind a per-request sequence, and otherwise surgical edits inside the existing layers. Every behavior change lands with a failing test first.

**Tech Stack:** unchanged. TypeScript strict, Vue 3.5, vitest 4 (`dom` and `node` projects, coverage thresholds 90/80/90/90), eslint 10 + eslint-plugin-obsidianmd, oxlint, fallow, Playwright Chromium harness.

**Spec:** `docs/superpowers/specs/2026-09-06-git-graph-design.md` (binding; its two "Superseded by user request" notes apply) plus the review findings restated in each task. Previous pass: `docs/superpowers/plans/2026-09-06-git-graph-polish.md`.

## Global Constraints

- Read-only git: only `rev-parse`, `log`, `for-each-ref`, `symbolic-ref`, `status`, `show`, `diff-tree` in `src/`; every rev list terminated with `--`.
- Layers import downward only: `view → (settings, watch, graph, git, util)`, `graph → git types`, `git`/`watch` import nothing from `src/` except `src/util/`. **No `node:path` or `node:fs` under `src/view` or `src/settings`** (the browser harness bundles them). `src/util/paths.ts` may use both because nothing under `src/view` imports it.
- Timers in `src/` use `window.setTimeout` / `window.clearTimeout`; no `globalThis`; no `eslint-disable` of `obsidianmd/*`; the plugin name never appears in a command name; the settings tab stays declarative; UI strings in sentence case.
- Tests import mock-only members (`App`, `Notice`, `Plugin`, `FileSystemAdapter`) from `tests/helpers/obsidian-mock`, never through `'obsidian'`.
- Temp directories that are compared with git output go through `realpathSync.native` first (`os.tmpdir()` is the 8.3 short path `C:\Users\LUISME~1\...` on this machine).
- Size limits: `src/**` max-lines 300, max-lines-per-function 80, complexity 12, max-params 5; `tests/**` and `harness/**` max-lines 500. LOC backstop 400 code lines per file. **Never raise a limit to fit code**: extract a helper, or add a commented file-scoped override in `eslint.config.mjs` only when extraction is not a trivial behavior-preserving move.
- `npm run check` must be green after every task; `npm run test:e2e` after every task that touches `src/view/**`, `styles.css` or `harness/**` (Tasks 3, 4, 6, 7, 8). Run `npm run harness:install` once if Chromium is missing.
- No `<style>` in `.vue`; plugin classes prefixed `git-graph-`, harness chrome prefixed `harness-`.
- Do not commit `.claude/` (it is untracked; `git add -A` would pick it up: stage explicit paths, or add `.claude/` to `.git/info/exclude` first). Commit after every task with the message given. Do not merge or push.

---

### Task 1: Canonical path identity for the watcher (review finding 1)

**Finding:** `src/watch/gitWatcher.ts` compares `resolve(commonDir) === resolve(gitDir)`. `gitDir` comes from `git rev-parse --absolute-git-dir`, which git canonicalizes (`C:/Users/LuisMendez/…/.git`, on-disk case, symlinks followed). `commonDir` is `resolve(cwd, '.git')` where `cwd` is Obsidian's base path exactly as the user opened it. A vault opened as `C:\USERS\…`, through the 8.3 form `C:\Users\LUISME~1\…`, or through a junction makes the two spellings differ, so a normal repository gets every file watched twice. (Verified on this machine with `git rev-parse --show-toplevel --absolute-git-dir --git-common-dir` from an 8.3 cwd, a junction and an upper-cased cwd: the first two are canonical, the third prints `.git`.)

**Files:**
- Create: `src/util/paths.ts`
- Modify: `src/watch/gitWatcher.ts` (`watchCommonDir`)
- Test: `tests/util/paths.test.ts` (new; runs in the vitest `node` project automatically because it is not under `tests/view|plugin|settings|watch`), `tests/watch/gitWatcher.test.ts`, `tests/plugin/main.test.ts`

**Interfaces:**
- Produces: `realPath(path: string): string` — `realpathSync.native(path)`, falling back to `resolve(path)` when the path does not exist. `samePath(a: string, b: string): boolean` — both sides through `realPath`, compared case-insensitively when `process.platform === 'win32'`. Task 2 consumes `realPath`.

- [ ] **Step 1: Write the failing tests**

`tests/util/paths.test.ts`:
```ts
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { realPath, samePath } from '../../src/util/paths';

describe('paths', () => {
	it('realPath canonicalizes an existing path and resolves a missing one', () => {
		const dir = mkdtempSync(join(tmpdir(), 'git-graph-paths-'));
		try {
			expect(realPath(dir)).toBe(realpathSync.native(dir));
			expect(realPath(join(dir, 'missing'))).toBe(resolve(join(dir, 'missing')));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('samePath treats the short, canonical, differently cased and linked spellings as one directory', () => {
		// tmpdir() is the 8.3 short form on Windows machines with a long profile name; the canonical form differs there.
		const short = mkdtempSync(join(tmpdir(), 'git-graph-paths-'));
		const canonical = realpathSync.native(short);
		const link = join(realpathSync.native(tmpdir()), `git-graph-paths-link-${process.pid}`);
		symlinkSync(canonical, link, 'junction');
		const other = mkdtempSync(join(tmpdir(), 'git-graph-paths-other-'));
		try {
			expect(samePath(short, canonical)).toBe(true);
			expect(samePath(link, canonical)).toBe(true);
			expect(samePath(canonical.toUpperCase(), canonical)).toBe(process.platform === 'win32');
			expect(samePath(other, canonical)).toBe(false);
		} finally {
			rmSync(link, { force: true });
			rmSync(short, { recursive: true, force: true });
			rmSync(other, { recursive: true, force: true });
		}
	});
});
```
(`symlinkSync(…, 'junction')` creates a junction on Windows without elevation and an ordinary symlink elsewhere. `rmSync(link)` without `recursive` unlinks the link itself; the target must survive — the second `rmSync` on `short` proves it still exists by not throwing with `force`.)

`tests/watch/gitWatcher.test.ts` — add at the top, before the imports of `createGitWatcher`, and extend the `node:fs` import with `symlinkSync`, `watch`:
```ts
vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs')>();
	return { ...actual, watch: vi.fn(actual.watch) };
});
```
and add the test:
```ts
	it('does not watch the git dir twice when commonDir is the same directory under another spelling', async () => {
		const watchesFor = (commonDir?: string): number => {
			vi.mocked(watch).mockClear();
			const w = createGitWatcher(gitDir, () => undefined, commonDir === undefined ? {} : { commonDir });
			const n = vi.mocked(watch).mock.calls.length;
			w.dispose();
			return n;
		};
		const plain = watchesFor();
		expect(plain).toBeGreaterThan(0);
		const link = join(realpathSync.native(tmpdir()), `git-graph-watch-link-${process.pid}`);
		symlinkSync(gitDir, link, 'junction');
		try {
			expect(watchesFor(link)).toBe(plain);
			if (process.platform === 'win32') expect(watchesFor(gitDir.toUpperCase())).toBe(plain);
		} finally {
			rmSync(link, { force: true });
		}
	});
```
(`gitDir` here is the `mkdtempSync` path, i.e. the 8.3 form on this machine, and the junction points at it; `realpathSync` needs importing.)

`tests/plugin/main.test.ts` — add the same `vi.mock('node:fs', …)` block (above the imports; extend the `node:fs` import with `watch`) and:
```ts
	it.runIf(process.platform === 'win32')('watches a vault spelled in a different case than git reports exactly once', async () => {
		const watchesDuring = async (basePath: string): Promise<number> => {
			vi.mocked(watch).mockClear();
			const plugin = makePlugin(basePath);
			await plugin.onload();
			await plugin.initRepo();
			expect(plugin.repoState.value.kind).toBe('ready');
			const n = vi.mocked(watch).mock.calls.length;
			plugin.onunload();
			return n;
		};
		const canonical = await watchesDuring(fixture.dir);
		expect(canonical).toBeGreaterThan(0);
		expect(await watchesDuring(fixture.dir.toUpperCase())).toBe(canonical);
	});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/util tests/watch tests/plugin`
Expected: `paths.test.ts` fails to import (`src/util/paths` missing); the watcher test fails with the junction spelling counting more `watch` calls than `plain`; the plugin test fails with the upper-case count above the canonical count.

- [ ] **Step 3: Implement**

`src/util/paths.ts`:
```ts
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The canonical spelling of an existing path: symlinks and junctions followed, Windows 8.3
 * short names expanded and the on-disk case restored (`realpathSync.native`). A path that does
 * not exist falls back to `resolve()`, so callers can still compare it.
 */
export function realPath(path: string): string {
	try {
		return realpathSync.native(path);
	} catch {
		return resolve(path);
	}
}

/** True when both spellings name the same file or directory. Case-insensitive on Windows. */
export function samePath(a: string, b: string): boolean {
	const x = realPath(a);
	const y = realPath(b);
	return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}
```
(If eslint-plugin-obsidianmd rejects `process.platform`, use `import { sep } from 'node:path'` and `sep === '\\'` instead, with a one-line comment.)

`src/watch/gitWatcher.ts`: replace the `resolve` import with `import { samePath } from '../util/paths';` and change `watchCommonDir`'s guard to
```ts
	if (commonDir === undefined || !existsSync(commonDir) || samePath(commonDir, gitDir)) return;
```
Update the `GitWatcherOptions.commonDir` doc comment: "compared by canonical path, so a vault opened under another spelling (case, 8.3 short name, junction) of the same directory is not watched twice."

- [ ] **Step 4: Run tests and gates**

Run: `npx vitest run tests/util tests/watch tests/plugin` then `npm run check`.
Expected: green. If fallow reports `src/util/paths.ts` as unused-export for `realPath` (it is only used by `samePath` until Task 2), keep it exported anyway and confirm fallow passes; if it does not, temporarily un-export `realPath` and export it in Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/util/paths.ts src/watch/gitWatcher.ts tests/util/paths.test.ts tests/watch/gitWatcher.test.ts tests/plugin/main.test.ts
git commit -m "fix(watch): compare gitDir and commonDir by canonical path so a differently spelled vault is watched once"
```

---

### Task 2: `openFile` through a symlinked or junctioned vault (review finding 4)

**Finding:** `GitGraphPlugin.openFile` computes `relative(adapter.getBasePath(), resolve(state.root, path))`. `state.root` is git's canonical toplevel; the base path is the junction/symlink spelling the user opened. `relative()` then starts with `..` and every file is reported as outside the vault (README "Known limitations").

**Files:**
- Modify: `src/main.ts` (`openFile`), `README.md` (remove the "Known limitations" section)
- Test: `tests/plugin/main.test.ts`

**Interfaces:**
- Consumes: `realPath` from `src/util/paths.ts` (Task 1).

- [ ] **Step 1: Write the failing test**

In `tests/plugin/main.test.ts`, inside `describe('openFile')` (extend the `node:fs` import with `existsSync`, `realpathSync`, `symlinkSync`):
```ts
		it('opens a file from a vault reached through a junction or symlink to the repository', async () => {
			const link = join(realpathSync.native(tmpdir()), `git-graph-vault-link-${process.pid}`);
			symlinkSync(fixture.dir, link, 'junction');
			try {
				const plugin = makePlugin(link);
				await plugin.onload();
				await plugin.initRepo();
				expect(plugin.repoState.value.kind).toBe('ready');
				const app = plugin.app as unknown as App;
				app.vault.files.set('renamed.md', { path: 'renamed.md' });
				Notice.shown.length = 0;
				plugin.openFile('renamed.md');
				expect(Notice.shown).toEqual([]);
				expect(app.workspace.opened).toEqual(['renamed.md']);
				plugin.onunload();
			} finally {
				rmSync(link, { force: true });
				expect(existsSync(join(fixture.dir, '.git'))).toBe(true);
			}
		});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/plugin/main.test.ts -t "junction"`
Expected: FAIL — `Notice.shown` contains "outside this vault" and nothing was opened. (git resolves the junction in `--show-toplevel`; the base path stays the link.) If the test unexpectedly passes, print `state.root` and the base path from inside the test to see which side changed, and report that in the task summary before continuing.

- [ ] **Step 3: Implement**

`src/main.ts`: `import { realPath } from './util/paths';` and in `openFile`:
```ts
		const vaultRelative = relative(realPath(adapter.getBasePath()), resolve(realPath(state.root), path)).replaceAll('\\', '/');
```
Update the method's doc comment: "Both the vault base path and the repository root are canonicalized first, so a vault opened through a symlink or junction resolves to the same directory git reports."

`README.md`: delete the whole `## Known limitations` section (it has a single entry, now fixed).

- [ ] **Step 4: Run tests and gates**

Run: `npx vitest run tests/plugin` then `npm run check`.
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts README.md tests/plugin/main.test.ts
git commit -m "fix(plugin): canonicalize the vault base path before deciding a file is outside the vault"
```

---

### Task 3: Sequenced status reads in the store (review finding 2)

**Finding:** three defects in `src/view/store.ts`: (a) while the changes row is expanded, `refreshStatus` goes through `syncDirtyFiles`, which never clears `statusError`; (b) `fetchStatus` resolves immediately with the *current* `dirtyCount` while expanded and defers the real read to `syncDirtyFiles` after `applyLoad`, so a collapse between `load()` start and `applyLoad` skips the read and leaves `dirtyCount` stale; (c) overlapping `status()`/`statusFiles()` reads share the load generation, so the last one to *settle* wins rather than the last one *requested*.

**Design:** move every status read into `src/view/statusSync.ts`. Each read takes `++seq`; `apply()` ignores a read whose `seq` is no longer the newest. A read goes through `statusFiles()` when the row is expanded at request time (deriving the count from the list, so still one git process), else through `status()`. On success: `statusError = null`, `dirtyCount = changed`; a count of 0 collapses the row; a file list is stored only if the row is still expanded. On failure: `dirtyError` when the read was a file read and the row is still expanded, else `statusError`. `load()` runs the read in parallel with `log`/`refs` and applies it after `applyLoad`; there is no second read anymore.

**Files:**
- Create: `src/view/statusSync.ts`, `src/view/errors.ts` (`errorMessage`, moved out of `store.ts`)
- Modify: `src/view/store.ts`, `tests/helpers/fakeReader.ts`, `eslint.config.mjs` (the `src/view/store.ts` override: lower or delete it to match the new size, never raise)
- Test: `tests/view/store.test.ts`

**Interfaces:**
- Produces: `src/view/errors.ts`: `errorMessage(e: unknown): string`. `src/view/statusSync.ts`:
  ```ts
  export interface StatusState { statusError: string | null; dirtyCount: number; dirtyExpanded: boolean; dirtyFiles: ChangedFile[] | null; dirtyError: string | null }
  export interface StatusSyncDeps { reader: GitReader; showDirtyRow: () => boolean; state: StatusState; currentGeneration: () => number; isDisposed: () => boolean }
  export interface StatusRead { seq: number; via: 'status' | 'files'; result: { ok: true; changed: number; files: ChangedFile[] | null } | { ok: false; error: string } }
  export interface StatusSync { fetch(): Promise<StatusRead>; apply(read: StatusRead): void; refresh(): Promise<void>; toggleDirty(): Promise<void> }
  export function createStatusSync(deps: StatusSyncDeps): StatusSync
  ```
  `GraphState extends StatusState`; `GraphStore.refreshStatus` and `toggleDirty` keep their names and delegate. `FakeReader` gains `deferStatus`, `pendingStatus: ((changed: number) => void)[]`, `deferStatusFiles`, `pendingStatusFiles: ((files: ChangedFile[]) => void)[]`.

- [ ] **Step 1: Write the failing tests**

`tests/helpers/fakeReader.ts`:
```ts
	deferStatus = false;
	pendingStatus: ((changed: number) => void)[] = [];
	deferStatusFiles = false;
	pendingStatusFiles: ((files: ChangedFile[]) => void)[] = [];

	status(): Promise<{ changed: number }> {
		this.statusCalls++;
		if (this.failStatus) return Promise.reject(this.failStatus);
		if (this.deferStatus) return new Promise((resolve) => this.pendingStatus.push((changed) => resolve({ changed })));
		return Promise.resolve({ changed: this.changed });
	}
	statusFiles(): Promise<ChangedFile[]> {
		this.statusFilesCalls++;
		if (this.deferStatusFiles) return new Promise((resolve) => this.pendingStatusFiles.push(resolve));
		return Promise.resolve(this.dirtyFiles);
	}
```

`tests/view/store.test.ts`:
```ts
	it('clears statusError on a successful statusFiles() read while the changes row is expanded', async () => {
		const reader = new FakeReader();
		reader.commits = linear(1);
		reader.changed = 2;
		reader.dirtyFiles = [{ path: 'a.md', status: 'M' }, { path: 'b.md', status: 'A' }];
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		reader.failStatus = new Error('fatal: index locked');
		await store.refreshStatus();
		expect(store.state.statusError).toBe('fatal: index locked');
		await store.toggleDirty();
		expect(store.state.dirtyExpanded).toBe(true);
		expect(store.state.dirtyFiles).toHaveLength(2);
		expect(store.state.statusError).toBeNull();
		await store.refreshStatus();
		expect(store.state.statusError).toBeNull();
		expect(reader.statusCalls).toBe(2);
	});

	it('applies the count of a load whose status read started while expanded but landed after a collapse', async () => {
		const reader = new FakeReader();
		reader.commits = linear(1);
		reader.changed = 2;
		reader.dirtyFiles = [{ path: 'a.md', status: 'M' }, { path: 'b.md', status: 'A' }];
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		await store.toggleDirty();
		reader.deferStatusFiles = true;
		const reload = store.load();
		await store.toggleDirty();
		reader.pendingStatusFiles[0]?.([{ path: 'a.md', status: 'M' }]);
		await reload;
		expect(store.state.dirtyExpanded).toBe(false);
		expect(store.state.dirtyFiles).toBeNull();
		expect(store.state.dirtyCount).toBe(1);
	});

	it('lets the newest of two overlapping status reads win, whichever settles first', async () => {
		const reader = new FakeReader();
		reader.commits = linear(1);
		reader.changed = 1;
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		reader.deferStatus = true;
		const older = store.refreshStatus();
		const newer = store.refreshStatus();
		reader.pendingStatus[1]?.(5);
		await newer;
		expect(store.state.dirtyCount).toBe(5);
		reader.pendingStatus[0]?.(3);
		await older;
		expect(store.state.dirtyCount).toBe(5);
		reader.deferStatus = false;
		reader.dirtyFiles = [{ path: 'a.md', status: 'M' }];
		await store.toggleDirty();
		reader.deferStatusFiles = true;
		const olderFiles = store.refreshStatus();
		const newerFiles = store.refreshStatus();
		reader.pendingStatusFiles[1]?.([{ path: 'a.md', status: 'M' }, { path: 'b.md', status: 'A' }]);
		await newerFiles;
		reader.pendingStatusFiles[0]?.([{ path: 'a.md', status: 'M' }]);
		await olderFiles;
		expect(store.state.dirtyCount).toBe(2);
		expect(store.state.dirtyFiles?.map((f) => f.path)).toEqual(['a.md', 'b.md']);
	});

	it('reports a failed file read in the details block while expanded, not in the banner', async () => {
		const reader = new FakeReader();
		reader.commits = linear(1);
		reader.changed = 1;
		reader.dirtyFiles = [{ path: 'a.md', status: 'M' }];
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		await store.toggleDirty();
		reader.statusFiles = () => Promise.reject(new Error('fatal: cannot read index'));
		await store.refreshStatus();
		expect(store.state.dirtyExpanded).toBe(true);
		expect(store.state.dirtyError).toBe('fatal: cannot read index');
		expect(store.state.statusError).toBeNull();
	});
```
- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/view/store.test.ts`
Expected: the first three new tests fail (`statusError` stays set; `dirtyCount` stays 2; `dirtyCount` ends at 3 / files at one entry). The fourth passes already (it pins behavior the refactor must keep).

- [ ] **Step 3: Implement**

`src/view/errors.ts`:
```ts
import { GitError } from '../git/GitError';

export function errorMessage(e: unknown): string {
	if (e instanceof GitError || e instanceof Error) return e.message;
	return String(e);
}
```

`src/view/statusSync.ts`:
```ts
import type { ChangedFile, GitReader } from '../git/types';
import { errorMessage } from './errors';

export interface StatusState {
	statusError: string | null;
	dirtyCount: number;
	dirtyExpanded: boolean;
	dirtyFiles: ChangedFile[] | null;
	dirtyError: string | null;
}

export interface StatusSyncDeps {
	reader: GitReader;
	showDirtyRow: () => boolean;
	state: StatusState;
	currentGeneration: () => number;
	isDisposed: () => boolean;
}

type StatusResult = { ok: true; changed: number; files: ChangedFile[] | null } | { ok: false; error: string };

/** One settled status read, tagged with the sequence number it was requested under. */
export interface StatusRead {
	seq: number;
	/** `files` reads went through `statusFiles()` (the row was expanded when requested). */
	via: 'status' | 'files';
	result: StatusResult;
}

export interface StatusSync {
	/** Requests a status read. Never rejects; failures are carried in the result. */
	fetch(): Promise<StatusRead>;
	/** Applies a read unless a newer one has been requested since (per-request sequence: the newest request wins). */
	apply(read: StatusRead): void;
	/** fetch + apply, dropped if the store generation moved or the store was disposed meanwhile. */
	refresh(): Promise<void>;
	toggleDirty(): Promise<void>;
}

function collapseDirty(state: StatusState): void {
	state.dirtyExpanded = false;
	state.dirtyFiles = null;
	state.dirtyError = null;
}

/**
 * Owns every status read for the store. While the changes row is expanded a read goes through
 * `statusFiles()` and derives `dirtyCount` from the list, so there is still exactly one git
 * process per refresh; otherwise it goes through `status()`. Every successful read clears
 * `statusError`; a count of 0 collapses the row.
 */
export function createStatusSync(deps: StatusSyncDeps): StatusSync {
	const { reader, state } = deps;
	let seq = 0;

	async function fetch(): Promise<StatusRead> {
		const mine = ++seq;
		const via = state.dirtyExpanded ? 'files' : 'status';
		if (!deps.showDirtyRow()) return { seq: mine, via, result: { ok: true, changed: 0, files: null } };
		try {
			if (via === 'files') {
				const files = await reader.statusFiles();
				return { seq: mine, via, result: { ok: true, changed: files.length, files } };
			}
			const { changed } = await reader.status();
			return { seq: mine, via, result: { ok: true, changed, files: null } };
		} catch (e) {
			return { seq: mine, via, result: { ok: false, error: errorMessage(e) } };
		}
	}

	function apply(read: StatusRead): void {
		if (read.seq !== seq) return;
		const { result } = read;
		if (!result.ok) {
			if (read.via === 'files' && state.dirtyExpanded) state.dirtyError = result.error;
			else state.statusError = result.error;
			return;
		}
		state.statusError = null;
		state.dirtyCount = result.changed;
		if (result.changed === 0) {
			collapseDirty(state);
			return;
		}
		if (result.files !== null && state.dirtyExpanded) {
			state.dirtyFiles = result.files;
			state.dirtyError = null;
		}
	}

	async function refresh(): Promise<void> {
		if (deps.isDisposed() || !deps.showDirtyRow()) return;
		const gen = deps.currentGeneration();
		const read = await fetch();
		if (gen !== deps.currentGeneration() || deps.isDisposed()) return;
		apply(read);
	}

	async function toggleDirty(): Promise<void> {
		if (state.dirtyExpanded) {
			collapseDirty(state);
			return;
		}
		state.dirtyExpanded = true;
		state.dirtyFiles = null;
		state.dirtyError = null;
		await refresh();
	}

	return { fetch, apply, refresh, toggleDirty };
}
```

`src/view/store.ts`:
- Delete `errorMessage` (import it from `./errors`), `collapseDirty`, `createDirtySync`, `createDirtyToggler`, `StatusResult`, `fetchStatus`, `createStatusRefresher`.
- `export interface GraphState extends StatusState { … }` with the five status fields removed from the body (they come from `StatusState`); import `createStatusSync, type StatusState` from `./statusSync`.
- `applyLoad(state, byHash, result: { commits; refs; count }, collapse)` no longer takes or applies `status`.
- In `createGraphStore`, after `byHash`/`generation`/`disposed`:
  ```ts
  	const status = createStatusSync({ reader: deps.reader, showDirtyRow: () => deps.settings().showDirtyRow, state, currentGeneration: () => generation, isDisposed: () => disposed });
  ```
  `load()` becomes:
  ```ts
  		const [commits, refs, read] = await Promise.all([deps.reader.log({ skip: 0, count, refs: refFilter }), deps.reader.refs(), status.fetch()]);
  		if (gen !== generation || disposed) return;
  		state.error = null;
  		applyLoad(state, byHash, { commits, refs, count }, collapse);
  		status.apply(read);
  ```
  and the returned object uses `refreshStatus: status.refresh, toggleDirty: status.toggleDirty`.
- `createExpandToggler` stays as is.
- `eslint.config.mjs`: measure `createGraphStore` after the change (`npx eslint src/view/store.ts` with the override removed). If it is ≤ 80 non-blank, non-comment lines, delete the `src/view/store.ts` override block. If it is still above 80, keep the block but set `max` to the new measured value (it must be lower than 125) and rewrite the comment to list what is still inline.

- [ ] **Step 4: Run tests and gates**

Run: `npx vitest run tests/view`, then `npm run check`, then `npm run test:e2e`.
Expected: green, including the existing tests `refreshStatus calls statusFiles once (not status) while the changes row is expanded`, `toggleDirty loads the working-tree files…` and `keeps a load error after a later successful refreshStatus`. If coverage `functions` dips, check that `statusSync.ts`'s `fetch` early-return (`showDirtyRow` off) is exercised by `does not ask for status when the dirty row is off` — it is, via `load()`.

- [ ] **Step 5: Commit**

```bash
git add src/view/statusSync.ts src/view/errors.ts src/view/store.ts tests/helpers/fakeReader.ts tests/view/store.test.ts eslint.config.mjs
git commit -m "fix(view): sequence status reads so the newest request wins, clear statusError on every successful read, apply a count that lands after a collapse"
```

---

### Task 4: Empty repository with a failed status shows only the banner (review finding 3)

**Finding:** `GraphRoot.vue` renders "No commits yet." whenever `rows` is empty and `error` is null, and separately renders the banner whenever `error` or `statusError` is set, so an empty repository whose `git status` fails shows both. **Ruling:** the banner wins, matching the existing load-error precedent (a load error already suppresses "No commits yet."); Retry restores the empty message once status succeeds.

**Files:**
- Modify: `src/view/GraphRoot.vue`
- Test: `tests/view/GraphRoot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
	it('shows the banner, not "No commits yet.", when an empty repository cannot report its status', async () => {
		const reader = new FakeReader();
		reader.commits = [];
		reader.failStatus = new Error('fatal: index locked');
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader });
		await flushPromises();
		expect(w.get('.git-graph-banner').text()).toContain('fatal: index locked');
		expect(w.text()).not.toContain('No commits yet.');
		reader.failStatus = null;
		await w.get('.git-graph-banner button').trigger('click');
		await flushPromises();
		expect(w.find('.git-graph-banner').exists()).toBe(false);
		expect(w.text()).toContain('No commits yet.');
	});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/view/GraphRoot.test.ts -t "empty repository"`
Expected: FAIL on `not.toContain('No commits yet.')`.

- [ ] **Step 3: Implement**

In `GraphRoot.vue`, the empty-state condition becomes
```vue
      v-else-if="!store.state.loading && store.state.rows.length === 0 && store.state.error === null && store.state.statusError === null"
```
Add a one-line HTML comment above it: `<!-- An error banner (load or status) replaces the empty message; Retry brings it back. -->`.

- [ ] **Step 4: Run tests and gates**

Run: `npx vitest run tests/view`, `npm run check`, `npm run test:e2e`.
Expected: green (the `empty` harness scenario has a succeeding status, so its e2e test is unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/view/GraphRoot.vue tests/view/GraphRoot.test.ts
git commit -m "fix(view): an error banner replaces \"No commits yet.\" in an empty repository whose status fails"
```

---

### Task 5: Git docs accuracy and a real rename in `statusFiles()` (review findings 5 and 7)

**Findings:** `docs/superpowers/plans/2026-09-06-git-graph-polish.md` still specifies `rev-parse --path-format=absolute --git-common-dir` (lines 32 and 104) although commit e19dcbe dropped the flag; `src/git/GitRepository.ts` cites `gitrevisions(7)` for `--path-format`, which is documented in `git-rev-parse(1)`. The `statusFiles()` integration test only sees an untracked file and a modification; no rename goes through `parseStatus`'s two-token path against real git output.

**Files:**
- Modify: `src/git/GitRepository.ts` (comment only), `docs/superpowers/plans/2026-09-06-git-graph-polish.md`, `tests/helpers/fixtureRepo.ts` (`createEmptyRepo`)
- Test: `tests/git/GitRepository.test.ts`

**Interfaces:**
- Produces: `createEmptyRepo(prefix?: string): { dir: string; git: (...args: string[]) => string; dispose(): void }` in `tests/helpers/fixtureRepo.ts` — `git init -q -b main` in a `realpathSync.native` temp dir with the fixture's deterministic author/committer/date environment. `createFixtureRepo` is rebuilt on top of it (same history, same hashes).

- [ ] **Step 1: Write the failing test**

`tests/git/GitRepository.test.ts`, new describe after `describe('status')`:
```ts
describe('statusFiles', () => {
	it('reports a staged rename with its old path, from a fresh repository', async () => {
		const tmp = createEmptyRepo('git-graph-rename-');
		try {
			writeFileSync(join(tmp.dir, 'old.md'), 'x\n');
			tmp.git('add', '.');
			tmp.git('commit', '-q', '-m', 'Add old.md');
			tmp.git('mv', 'old.md', 'new.md');
			const fresh = new GitRepository({ gitPath: 'git', cwd: tmp.dir });
			expect(await fresh.statusFiles()).toEqual([{ path: 'new.md', status: 'R', oldPath: 'old.md' }]);
			expect((await fresh.status()).changed).toBe(1);
		} finally {
			tmp.dispose();
		}
	});
});
```
(import `createEmptyRepo` from `../helpers/fixtureRepo`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/git/GitRepository.test.ts -t "staged rename"`
Expected: FAIL — `createEmptyRepo` is not exported.

- [ ] **Step 3: Implement**

`tests/helpers/fixtureRepo.ts`:
```ts
const FIXTURE_ENV = {
	GIT_AUTHOR_NAME: 'Ann Author',
	GIT_AUTHOR_EMAIL: 'ann@example.com',
	GIT_COMMITTER_NAME: 'Cara Committer',
	GIT_COMMITTER_EMAIL: 'cara@example.com',
	GIT_AUTHOR_DATE: '2026-09-01T10:00:00+02:00',
	GIT_COMMITTER_DATE: '2026-09-01T10:00:00+02:00',
};

export interface EmptyRepo {
	dir: string;
	git: (...args: string[]) => string;
	dispose(): void;
}

/** A fresh `git init -b main` in a canonical temp dir, with the fixture's deterministic identity and dates. */
export function createEmptyRepo(prefix = 'git-graph-tmp-'): EmptyRepo {
	const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
	const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...FIXTURE_ENV } }).trim();
	git('init', '-q', '-b', 'main');
	git('config', 'core.autocrlf', 'false');
	return { dir, git, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}
```
`createFixtureRepo` then starts with `const { dir, git, dispose } = createEmptyRepo('git-graph-fixture-');` and drops its own `init`/`autocrlf` lines and inline env; its `dispose` calls the empty repo's `dispose()` plus the remote `rmSync`. Also rewrite the two inline-`git init` tests in `GitRepository.test.ts` (`returns [] for a repository with no commits` and `refs=all still returns real commits when HEAD is an unborn/orphan branch`) on top of `createEmptyRepo` so the file has one way to build a scratch repository.

`src/git/GitRepository.ts` comment: `(git >= 2.31 only, per git-rev-parse(1))`.

`docs/superpowers/plans/2026-09-06-git-graph-polish.md`: in the Task 1 **Interfaces** bullet replace ``(`rev-parse --path-format=absolute --git-common-dir`; equals …`` with ``(`rev-parse --git-common-dir`, resolved against `cwd` when git prints it relative — `--path-format=absolute` needs git 2.31 and was dropped in the final review, commit e19dcbe; equals …``; in the Task 1 Step 3 code block replace the `run([...])` line with
```ts
		const out = (await this.run(['rev-parse', '--git-common-dir'])).trim();
		return resolve(this.cwd, out);
```
and add `(import `resolve` from `node:path`.)` under the block.

- [ ] **Step 4: Run tests and gates**

Run: `npx vitest run tests/git tests/plugin` (the plugin tests share the fixture builder), then `npm run check`.
Expected: green; the shared fixture's status counts (`1` then `2`) unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/git/GitRepository.ts docs/superpowers/plans/2026-09-06-git-graph-polish.md tests/helpers/fixtureRepo.ts tests/git/GitRepository.test.ts
git commit -m "docs(git): cite git-rev-parse(1) and drop --path-format from the polish plan; cover a staged rename in statusFiles()"
```

---

### Task 6: Harness toast — styled, hidden when empty, cleared on the next change or navigation (review finding 6)

**Finding:** `#harness-toast` has no CSS and its "Would open …" text stays until the page reloads. **Ruling:** it is harness chrome, so it is styled in `harness/theme.css` with the `harness-` prefix, hidden while empty, and cleared whenever the graph reloads (`changes`/`statusChanges` emit, which is what the Emit change button and `window.__harness.emitChange()` do) and when the toolbar navigates.

**Files:**
- Modify: `harness/theme.css`, `harness/main.ts`, `harness/README.md`
- Test: `harness/harness.spec.ts`

- [ ] **Step 1: Write the failing e2e test**

```ts
test('the harness toast shows what a file click would open and clears on the next change', async ({ page }) => {
	await open(page, 'scenario=merge');
	const toast = page.locator('.harness-toast');
	await expect(toast).toBeHidden();
	await page.locator('.git-graph-row').first().click();
	await page.locator('.git-graph-file-link').first().click();
	await expect(toast).toBeVisible();
	await expect(toast).toHaveText(/^Would open .+/);
	await page.locator('#harness-emit').click();
	await expect(toast).toBeHidden();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test -g "harness toast"`
Expected: FAIL at the first `toBeHidden()` (an empty div is still "visible" to Playwright only when it has a box; with no CSS it has zero height, so if the first assertion passes, the failure comes at the final `toBeHidden()` instead — either is red).

- [ ] **Step 3: Implement**

`harness/theme.css`, in the "Harness chrome" block:
```css
/* "Would open <path>": what GitGraphPlugin.openFile would have done. Hidden while empty. */
.harness-toast {
	margin-bottom: var(--size-4-3);
	padding: var(--size-2-2) var(--size-4-2);
	border: 1px solid var(--background-modifier-border);
	border-left: 3px solid var(--interactive-accent);
	border-radius: var(--radius-s);
	background: var(--background-primary);
	color: var(--text-muted);
	font-family: var(--font-monospace);
	font-size: var(--font-ui-smaller);
}
.harness-toast:empty {
	display: none;
}
```

`harness/main.ts`:
```ts
const toast = document.querySelector<HTMLElement>('#harness-toast');

function showToast(text: string): void {
	if (toast !== null) toast.textContent = text;
}

function clearToast(): void {
	if (toast !== null) toast.textContent = '';
}

/** Stands in for GitGraphPlugin.openFile: no vault to open a file in, so it records the path and says so. */
function onOpenFile(path: string): void {
	opened.push(path);
	showToast(`Would open ${path}`);
}

changes.on(clearToast);
statusChanges.on(clearToast);
```
and `navigate()` calls `clearToast()` before assigning `window.location.search`.

`harness/README.md`: the paragraph under `window.__harness` becomes: "… pushes the path onto `window.__harness.opened` and shows "Would open &lt;path&gt;" in the `.harness-toast` strip under the toolbar. The strip is hidden while empty and clears on the next `changes`/`statusChanges` emit (the Emit change button, `emitChange()`, `emitStatusChange()`) or toolbar navigation."

- [ ] **Step 4: Run gates**

Run: `npm run check`, `npm run test:e2e`.
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add harness/theme.css harness/main.ts harness/README.md harness/harness.spec.ts
git commit -m "feat(harness): styled toast that hides when empty and clears on the next change or navigation"
```

---

### Task 7: Deleted files muted and unopenable; stable `v-for` keys (improvements)

**Ruling:** a `D` entry is rendered muted (struck through, faint) with a title explaining it cannot be opened, and is not focusable or clickable — `openFile` on a deleted path could only ever produce the "not in the vault" notice. File rows are keyed on `status:oldPath:path` (a rename and a later modification of the same path in one list no longer share a key); lane segments are keyed on `kind:fromLane:toLane`, which the layout guarantees unique per row (a layout test pins that invariant).

**Files:**
- Modify: `src/view/FileList.vue`, `src/view/LaneCell.vue`, `styles.css`, `README.md` (one sentence), `harness/README.md` (the `dirty` scenario line mentions the deleted entry)
- Test: `tests/view/FileList.test.ts` (new), `tests/graph/layout.test.ts`, `harness/harness.spec.ts`

- [ ] **Step 1: Write the failing tests**

`tests/view/FileList.test.ts`:
```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import FileList from '../../src/view/FileList.vue';
import type { ChangedFile } from '../../src/git/types';

const mountList = (files: ChangedFile[]) => mount(FileList, { props: { files } });

describe('FileList', () => {
	it('opens a file on click, Enter and Space, and ignores other keys', async () => {
		const w = mountList([{ path: 'a.md', status: 'M' }]);
		const link = w.get('.git-graph-file-link');
		await link.trigger('click');
		await link.trigger('keydown', { key: 'Enter' });
		await link.trigger('keydown', { key: ' ' });
		await link.trigger('keydown', { key: 'x' });
		expect(w.emitted('openFile')).toEqual([['a.md'], ['a.md'], ['a.md']]);
	});

	it('renders a deleted file muted, unfocusable and inert, with a title saying why', async () => {
		const w = mountList([{ path: 'gone.md', status: 'D' }]);
		const link = w.get('.git-graph-file-link');
		expect(link.classes()).toContain('git-graph-file-deleted');
		expect(link.attributes('tabindex')).toBeUndefined();
		expect(link.attributes('role')).toBeUndefined();
		expect(link.attributes('aria-disabled')).toBe('true');
		expect(link.attributes('title')).toContain('cannot be opened');
		await link.trigger('click');
		await link.trigger('keydown', { key: 'Enter' });
		expect(w.emitted('openFile')).toBeUndefined();
	});

	it('shows the empty message when there are no files', () => {
		expect(mountList([]).get('.git-graph-files-empty').text()).toBe('No file changes');
	});

	it('keeps a rename and a modification of the same path apart when the list updates', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			const w = mountList([{ path: 'a.md', status: 'M' }]);
			await w.setProps({ files: [{ path: 'a.md', status: 'R', oldPath: 'b.md' }, { path: 'a.md', status: 'M' }] });
			expect(w.findAll('.git-graph-file')).toHaveLength(2);
			expect(warn.mock.calls.flat().some((arg) => String(arg).includes('Duplicate keys'))).toBe(false);
		} finally {
			warn.mockRestore();
		}
	});
});
```

`tests/graph/layout.test.ts`:
```ts
	it('never emits two segments with the same kind and lanes in one row (LaneCell keys on that triple)', () => {
		const histories = [
			[c('A', 'B'), c('B', 'C'), c('C')],
			[c('M', 'A', 'B'), c('A', 'R'), c('B', 'R'), c('R')],
			[c('M', 'A', 'B', 'C'), c('A'), c('B'), c('C')],
			[c('A', 'B'), c('B'), c('C')],
			[c('X', 'P'), c('Y', 'P'), c('P')],
		];
		for (const history of histories) {
			for (const row of layoutGraph(history, emptyLayoutState()).rows) {
				const keys = row.segments.map((s) => `${s.kind}:${s.fromLane}:${s.toLane}`);
				expect(new Set(keys).size).toBe(keys.length);
			}
		}
	});
```

`harness/harness.spec.ts`:
```ts
test('a deleted file in the dirty changes row is muted and cannot be opened', async ({ page }) => {
	await open(page, 'scenario=dirty');
	await page.locator('.git-graph-row-dirty').click();
	const deleted = page.locator('.git-graph-dirty-details .git-graph-file-deleted');
	await expect(deleted).toHaveCount(1);
	await expect(deleted).toHaveAttribute('title', /cannot be opened/);
	await deleted.click();
	expect(await page.evaluate(() => window.__harness.opened)).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/view/FileList.test.ts tests/graph/layout.test.ts` and `npx playwright test -g "deleted file"`.
Expected: the deleted-file unit test and the e2e test fail (no `git-graph-file-deleted`); the keyboard, empty and layout tests pass already (they pin behavior the change must keep). If the "Duplicate keys" assertion does not go red before the fix (Vue only warns in dev on keyed patches), note that in the task summary and keep the test as a guard.

- [ ] **Step 3: Implement**

`src/view/FileList.vue` (one row template; a deleted entry loses its role, tabindex and handlers instead of getting a second copy of the row):
```vue
<script setup lang="ts">
import type { ChangedFile } from '../git/types';

defineProps<{ files: ChangedFile[] }>();
const emit = defineEmits<{ openFile: [path: string] }>();

const isDeleted = (f: ChangedFile): boolean => f.status === 'D';
const keyOf = (f: ChangedFile): string => `${f.status}:${f.oldPath ?? ''}:${f.path}`;

function fileLabel(f: ChangedFile): string {
	return f.oldPath ? `${f.path} ← ${f.oldPath}` : f.path;
}

function titleFor(f: ChangedFile): string {
	return isDeleted(f) ? `${f.path} is deleted and cannot be opened` : `Open ${fileLabel(f)}`;
}

function open(f: ChangedFile): void {
	if (!isDeleted(f)) emit('openFile', f.path);
}

function onFileKey(e: KeyboardEvent, f: ChangedFile): void {
	if (e.key === 'Enter' || e.key === ' ') {
		e.preventDefault();
		e.stopPropagation();
		open(f);
	}
}
</script>

<template>
  <ul class="git-graph-files">
    <li
      v-for="f in files"
      :key="keyOf(f)"
      class="git-graph-file"
    >
      <span
        :class="['git-graph-file-link', { 'git-graph-file-deleted': isDeleted(f) }]"
        :role="isDeleted(f) ? undefined : 'link'"
        :tabindex="isDeleted(f) ? undefined : 0"
        :aria-disabled="isDeleted(f) ? 'true' : undefined"
        :title="titleFor(f)"
        @click.stop="open(f)"
        @keydown="onFileKey($event, f)"
      >
        <span :class="['git-graph-file-status', `git-graph-file-status-${f.status}`]">{{ f.status }}</span>
        <span class="git-graph-file-path">{{ fileLabel(f) }}</span>
      </span>
    </li>
  </ul>
  <div
    v-if="files.length === 0"
    class="git-graph-files-empty"
  >
    No file changes
  </div>
</template>
```
(Vue omits an attribute bound to `undefined`, so the deleted entry renders without `role`/`tabindex`.)

`src/view/LaneCell.vue`: `:key="`${s.kind}:${s.fromLane}:${s.toLane}`"` on the segment `<path>`.

`styles.css`, after `.git-graph-file-link:focus-visible`:
```css
.git-graph-file-deleted {
	cursor: default;
}
.git-graph-file-deleted:hover {
	background: none;
}
.git-graph-file-deleted .git-graph-file-path,
.git-graph-file-deleted:hover .git-graph-file-path {
	color: var(--text-faint);
	text-decoration: line-through;
}
```

`README.md`, in the second paragraph after "click a file to open it.": "Deleted files are shown struck through and cannot be opened." `harness/README.md`, the `dirty` row: "… three uncommitted working tree changes (one of them deleted); the changes row expands into their file list."

- [ ] **Step 4: Run tests and gates**

Run: `npx vitest run tests/view tests/graph`, `npm run check`, `npm run test:e2e`. Existing `CommitDetails`, `GraphRoot` and the e2e file-click tests must still pass (they click `M`/`A` entries).
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/view/FileList.vue src/view/LaneCell.vue styles.css README.md harness/README.md tests/view/FileList.test.ts tests/graph/layout.test.ts harness/harness.spec.ts
git commit -m "feat(view): muted, unopenable deleted files; stable keys for file rows and lane segments"
```

---

### Task 8: Calendar-aware relative months and years (improvement)

**Ruling:** keep the English "N unit(s) ago" strings (Obsidian has its own language setting; `Intl.RelativeTimeFormat` with the system locale could disagree with it, and its output would not be deterministic in tests and screenshots) and fix the arithmetic: months and years are counted on the UTC calendar, a month counting only once its day-of-month has passed. 364 days becomes "11 months ago", 30 days stays "30 days ago", one calendar year is "1 year ago".

**Files:**
- Modify: `src/view/dates.ts`
- Test: `tests/view/dates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
	it('counts months and years by the calendar, not by 30-day blocks', () => {
		expect(formatDate('2025-09-07T12:00:00Z', 'relative', now)).toBe('11 months ago'); // 364 days
		expect(formatDate('2025-09-06T12:00:00Z', 'relative', now)).toBe('1 year ago');
		expect(formatDate('2026-08-07T12:00:00Z', 'relative', now)).toBe('30 days ago');
		expect(formatDate('2026-08-06T12:00:00Z', 'relative', now)).toBe('1 month ago');
		expect(formatDate('2026-03-06T12:00:00Z', 'relative', now)).toBe('6 months ago');
		expect(formatDate('2024-09-07T12:00:00Z', 'relative', now)).toBe('1 year ago'); // one day short of two
	});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/view/dates.test.ts`
Expected: FAIL — `12 months ago`, `1 month ago` (for 30 days) and `2 years ago` (for 729 days) under the current 30/365-day buckets.

- [ ] **Step 3: Implement**

`src/view/dates.ts`:
```ts
import type { DateFormat } from '../settings/types';

/** Sub-month buckets, largest first. Months and years are counted on the calendar instead (see `calendarMonths`). */
const UNITS: [name: string, seconds: number][] = [
	['day', 24 * 3600],
	['hour', 3600],
	['minute', 60],
];

const pad = (n: number): string => String(n).padStart(2, '0');
const ago = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'} ago`;

/** Whole calendar months from `from` to `to` on the UTC calendar; a month counts only once its day-of-month has passed. */
function calendarMonths(from: Date, to: Date): number {
	const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
	return to.getUTCDate() < from.getUTCDate() ? months - 1 : months;
}

export function formatAbsolute(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDate(iso: string, format: DateFormat, now: Date = new Date()): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	if (format === 'absolute') return formatAbsolute(iso);
	const seconds = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
	const months = seconds === 0 ? 0 : calendarMonths(d, now);
	if (months >= 12) return ago(Math.floor(months / 12), 'year');
	if (months >= 1) return ago(months, 'month');
	for (const [name, size] of UNITS) {
		if (seconds >= size) return ago(Math.floor(seconds / size), name);
	}
	return 'just now';
}
```

- [ ] **Step 4: Run tests and gates**

Run: `npx vitest run tests/view/dates.test.ts`, `npm run check`, `npm run test:e2e` (the harness renders relative dates against the wall clock; no e2e asserts a relative string, so this is a smoke run).
Expected: green, including the existing `formats relative distances` cases.

- [ ] **Step 5: Commit**

```bash
git add src/view/dates.ts tests/view/dates.test.ts
git commit -m "fix(view): count relative months and years on the calendar"
```

---

### Task 9: Cover the not-ready status refresh and the superseded common-dir resolution (improvement)

**Finding:** two branches in `src/main.ts` have no test: `scheduleStatusRefresh` returning early when `repoState.kind !== 'ready'` while a view is open, and `resolveWatcher` returning `null` when a newer `initRepo()` started while `gitCommonDir()` was pending.

**Files:**
- Test: `tests/plugin/main.test.ts` only

- [ ] **Step 1: Write the tests**

Add a `createGitWatcher` wrapper mock at the top of the file (next to the `node:fs` mock from Task 1) and import `createGitWatcher` and `GitRepository`:
```ts
vi.mock('../../src/watch/gitWatcher', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/watch/gitWatcher')>();
	return { ...actual, createGitWatcher: vi.fn(actual.createGitWatcher) };
});
import { createGitWatcher } from '../../src/watch/gitWatcher';
import { GitRepository } from '../../src/git/GitRepository';
import GitGraphPlugin, { GIT_PATH_DEBOUNCE_MS, STATUS_DEBOUNCE_MS } from '../../src/main';
```
Inside `describe('lifecycle and vault-driven status refresh')`:
```ts
		it('ignores vault edits while the repository is not ready, even with a view open', async () => {
			vi.useFakeTimers();
			const outside = mkdtempSync(join(tmpdir(), 'git-graph-plugin-'));
			try {
				const plugin = makePlugin(outside);
				await plugin.onload();
				await plugin.initRepo();
				expect(plugin.repoState.value.kind).toBe('none');
				let statusChanges = 0;
				plugin.statusChanges.on(() => statusChanges++);
				plugin.viewOpened();
				(plugin.app as unknown as App).vault.trigger('modify');
				await vi.advanceTimersByTimeAsync(STATUS_DEBOUNCE_MS + 100);
				expect(statusChanges).toBe(0);
				plugin.onunload();
			} finally {
				rmSync(outside, { recursive: true, force: true });
			}
		});

		it('drops the watcher of an init that was superseded while resolving the common dir', async () => {
			const plugin = makePlugin(fixture.dir);
			await plugin.onload();
			await plugin.initRepo();
			let release = (): void => undefined;
			const original = GitRepository.prototype.gitCommonDir;
			const spy = vi.spyOn(GitRepository.prototype, 'gitCommonDir').mockImplementationOnce(function (this: GitRepository) {
				return new Promise<void>((resolve) => {
					release = resolve;
				}).then(() => original.call(this));
			});
			vi.mocked(createGitWatcher).mockClear();
			const stalled = plugin.initRepo();
			await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
			const fresh = plugin.initRepo();
			release();
			await Promise.all([stalled, fresh]);
			expect(plugin.repoState.value.kind).toBe('ready');
			expect(createGitWatcher).toHaveBeenCalledTimes(1);
			spy.mockRestore();
			plugin.onunload();
		});
```

- [ ] **Step 2: Run to verify they pass and cover the branches**

Run: `npx vitest run tests/plugin/main.test.ts` then `npx vitest run --coverage --coverage.include=src/main.ts` and open `coverage/index.html` (or read the text summary): `src/main.ts` branch coverage must be higher than before this task (record both numbers in the task summary). To confirm the second test really exercises the guard, temporarily change `if (gen !== this.initGeneration) return null;` after `gitCommonDir` to `if (false) return null;` — the test must then fail with two `createGitWatcher` calls — and revert.

- [ ] **Step 3: Gates**

Run: `npm run check`.
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add tests/plugin/main.test.ts
git commit -m "test(plugin): cover the not-ready status refresh and the superseded common-dir resolution"
```

---

### Task 10: Finish — gates, vault build, whole-branch review

Not a subagent task; run in the main session after Task 9.

- [ ] `npm run check` (full output kept), `npm run test:e2e` (full output kept), `npm run test-build`.
- [ ] Whole-branch review of the commits from this plan (`git log --oneline e19dcbe..HEAD`, `git diff e19dcbe..HEAD`) with a fresh reviewer subagent; fix anything blocking with a follow-up commit and rerun the gates.
- [ ] Report: the commit list, every ruling (Tasks 1, 4, 6, 7, 8 and the reflow item below), and the superpowers:finishing-a-development-branch menu.

**Not implemented in this pass — "[Violation] Forced reflow" at Obsidian startup:** this needs a Performance profile inside Obsidian with the plugin toggled, which cannot be automated from this session. Static audit: the only layout reads under `src/view` are `el.offsetHeight` inside a `ResizeObserver` callback (`measuredHeight.ts`), `clientHeight` inside a `ResizeObserver` callback (`CommitList.vue`) and `scrollTop` in the scroll handler; `ResizeObserver` callbacks run after layout, so none of these force a synchronous reflow by construction. To attribute the warning: DevTools (Ctrl+Shift+I) → Performance → record a reload with the plugin enabled and disabled, and look for `git-graph`/`GraphRoot` frames under the long task. Left open.

## Self-review notes

- Coverage of the request: findings 1 (T1), 2 (T3), 3 (T4), 4 (T2), 5 and 7 (T5), 6 (T6); improvements: deleted files and keys (T7), calendar dates (T8), coverage (T9); the reflow item is ruled out with reasons (T10).
- Type consistency: `realPath`/`samePath` (T1) consumed by T2 under the same names; `StatusState`/`createStatusSync`/`StatusRead` (T3) are only used inside `store.ts`; `createEmptyRepo` (T5) is used by T5 only; `STATUS_DEBOUNCE_MS` already exists in `src/main.ts`.
- Placeholder scan: every code step has its code.
