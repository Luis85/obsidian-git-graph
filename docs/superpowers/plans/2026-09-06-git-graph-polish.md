# Git Graph Polish Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the review ledger's deferred items after the first verified version: worktree-aware watching, lifecycle and input hardening, a live "N changes" row on vault edits, cheaper reactivity, and doc/config accuracy.

**Architecture:** Each task is a self-contained slice of the existing layers (`src/git`, `src/watch`, `src/main.ts`, `src/view/store.ts`, `src/view/GraphRoot.vue`, `harness/`). No new layers; interfaces widen additively (a `commonDir` option, a `statusChanges` emitter, a `refreshStatus()` store method). Every behavior change lands with a failing test first.

**Tech Stack:** unchanged — TypeScript strict, Vue 3.5, vitest 4 (dom/node projects, coverage thresholds 90/80/90/90), eslint 10 + eslint-plugin-obsidianmd (declarative settings, `window` timers, no `globalThis`, no `eslint-disable` of its rules, sentence case), oxlint, fallow, Playwright chromium harness.

**Spec:** `docs/superpowers/specs/2026-09-06-git-graph-design.md` (binding), plus the final-review findings recorded in the previous run's ledger (summarized in each task).

## Global Constraints

- Read-only git: only `rev-parse`, `log`, `for-each-ref`, `symbolic-ref`, `status`, `show`, `diff-tree` in `src/`; every rev list terminated with `--`.
- Layers import downward only: `view → (settings, watch, graph, git)`, `graph → git types`, `git`/`watch` import nothing from `src/` except `src/util/`.
- Timers in `src/` use `window.setTimeout` / `window.clearTimeout`; no `globalThis`; no `eslint-disable` of `obsidianmd/*`; UI strings in sentence case.
- Size limits: src max-lines 300 / max-lines-per-function 80 / complexity 12; tests and harness max-lines 500; LOC backstop 400 code lines per file. Do not raise a limit; extract a helper instead.
- `npm run check` must stay green after every task (typecheck, build, oxlint, eslint `--max-warnings 0`, fallow, loc, coverage thresholds). `npm run test:e2e` must stay green after Tasks 2–4.
- No `<style>` in `.vue`; classes prefixed `git-graph-` (Obsidian's `clickable-icon`, `mod-cta`, `dropdown` allowed).
- Commit after every task with the message given.

---

### Task 1: Git layer hardening — common dir for worktrees, honest maxBuffer message, absolute-or-command gitPath

**Files:**
- Modify: `src/git/GitRepository.ts` (add `gitCommonDir()`), `src/git/runGit.ts` (message uses the real `maxBuffer`), `src/watch/gitWatcher.ts` (optional `commonDir`), `src/settings/types.ts` (`isValidGitPath`, used by `normalizeSettings`), `src/settings/GitGraphSettingTab.ts` (`validate` on the git executable control), `src/main.ts` (pass `commonDir`)
- Test: `tests/git/GitRepository.test.ts`, `tests/git/runGit.test.ts`, `tests/watch/gitWatcher.test.ts`, `tests/settings/settings.test.ts`, `tests/plugin/main.test.ts`

**Interfaces:**
- Produces: `GitRepository.gitCommonDir(): Promise<string>` — absolute path of the shared git dir (`rev-parse --git-common-dir`, resolved against `cwd` when git prints it relative — `--path-format=absolute` needs git 2.31 and was dropped in the final review, commit e19dcbe; equals `gitDir()` for a normal checkout, `<main>/.git` for a linked worktree). `GitWatcherOptions.commonDir?: string` — when given and different from `gitDir`, `refs/` and `packed-refs` are watched there as well. `isValidGitPath(value: string): boolean` from `src/settings/types.ts` — true for a bare command (no path separator) or an absolute path.

- [ ] **Step 1: Failing tests**

`tests/git/GitRepository.test.ts` — inside `describe('gitDir')` add:
```ts
	it('reports the common dir, which differs for a linked worktree', async () => {
		expect((await repo.gitCommonDir()).replaceAll('\\', '/').toLowerCase()).toBe((await repo.gitDir()).replaceAll('\\', '/').toLowerCase());
		const wt = realpathSync.native(mkdtempSync(join(tmpdir(), 'git-graph-wt-')));
		rmSync(wt, { recursive: true, force: true });
		try {
			execFileSync('git', ['worktree', 'add', '-q', wt, 'feature'], { cwd: fixture.dir });
			const linked = new GitRepository({ gitPath: 'git', cwd: wt });
			const gitDir = (await linked.gitDir()).replaceAll('\\', '/').toLowerCase();
			const common = (await linked.gitCommonDir()).replaceAll('\\', '/').toLowerCase();
			expect(gitDir).toContain('/.git/worktrees/');
			expect(common).toBe(join(fixture.dir, '.git').replaceAll('\\', '/').toLowerCase());
		} finally {
			execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: fixture.dir });
		}
	});
```
(add `realpathSync` and `execFileSync` imports; `rmSync` of the empty temp dir first because `git worktree add` refuses an existing directory.)

`tests/git/runGit.test.ts` — change the maxBuffer assertion to `expect((err as GitError).stderr).toMatch(/exceeded the 0 MiB buffer/)` for `maxBuffer: 100`, and add a second call with `maxBuffer: 2 * 1024 * 1024` writing 3 MiB (`'x'.repeat(3 * 1024 * 1024)`) expecting `/2 MiB/`.

`tests/watch/gitWatcher.test.ts` — add:
```ts
	it('watches refs and packed-refs in the common dir when it differs from gitDir', async () => {
		const common = mkdtempSync(join(tmpdir(), 'git-graph-common-'));
		mkdirSync(join(common, 'refs', 'heads'), { recursive: true });
		const onChange = vi.fn();
		watcher = createGitWatcher(gitDir, onChange, { debounceMs: 50, commonDir: common });
		await settle();
		writeFileSync(join(common, 'refs', 'heads', 'shared'), 'abc\n');
		await settle();
		expect(onChange).toHaveBeenCalledTimes(1);
		writeFileSync(join(common, 'packed-refs'), '# pack-refs\n');
		await settle();
		expect(onChange).toHaveBeenCalledTimes(2);
		watcher.dispose();
		watcher = null;
		rmSync(common, { recursive: true, force: true });
	});
```

`tests/settings/settings.test.ts` — in the `normalizeSettings` describe:
```ts
	it('rejects a relative path as the git executable but keeps commands and absolute paths', () => {
		expect(normalizeSettings({ gitPath: './tools/git' }).gitPath).toBe('git');
		expect(normalizeSettings({ gitPath: 'tools\\git.exe' }).gitPath).toBe('git');
		expect(normalizeSettings({ gitPath: 'git.exe' }).gitPath).toBe('git.exe');
		expect(normalizeSettings({ gitPath: 'C:\\Git\\bin\\git.exe' }).gitPath).toBe('C:\\Git\\bin\\git.exe');
		expect(normalizeSettings({ gitPath: '/usr/bin/git' }).gitPath).toBe('/usr/bin/git');
		expect(isValidGitPath('../git')).toBe(false);
	});
```
and in the tab test: the `Git executable` definition's `control.validate` returns a string for `'./git'` and `undefined` for `'git'` and for `'C:\\Git\\bin\\git.exe'`.

`tests/plugin/main.test.ts` — extend `'resolves the repository on load and exposes a ready state'` to also assert that a spy on `createGitWatcher` is not needed; instead assert through behavior: after `initRepo()`, `plugin.repoState.value.kind === 'ready'` (unchanged) — the common-dir wiring is covered by the watcher and repository tests; add one assertion that `updateSettings({ gitPath: './relative/git' })` leaves `plugin.settings.gitPath` at `'git'` and schedules no re-init (spy `initRepo`, advance timers 600 ms, expect not called).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/git tests/watch tests/settings tests/plugin`
Expected: the new tests fail (`gitCommonDir is not a function`, message mismatch, `isValidGitPath` not exported, no common-dir watch).

- [ ] **Step 3: Implement**

`src/git/GitRepository.ts`:
```ts
	/** Shared git dir: same as gitDir() for a normal checkout, the main repository's .git for a linked worktree. */
	async gitCommonDir(): Promise<string> {
		const out = (await this.run(['rev-parse', '--git-common-dir'])).trim();
		return resolve(this.cwd, out);
	}
```
(import `resolve` from `node:path`.)

`src/git/runGit.ts` — replace the fixed message:
```ts
				} else if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
					reject(new GitError('EXIT', args, `git output exceeded the ${Math.floor(maxBuffer / (1024 * 1024))} MiB buffer`, null));
```

`src/watch/gitWatcher.ts` — `GitWatcherOptions` gains `commonDir?: string`; after the existing `refs/` handling add:
```ts
	const commonDir = opts.commonDir;
	if (commonDir !== undefined && existsSync(commonDir) && resolve(commonDir) !== resolve(gitDir)) {
		add(join(commonDir, 'packed-refs'), false);
		add(commonDir, false, onGitDirEvent);
		if (!add(join(commonDir, 'refs'), true)) {
			for (const dir of REF_DIRS) add(join(commonDir, dir), false);
		}
	}
```
(import `resolve` from `node:path`; keep the function under 80 lines — extract `watchRefs(dir)` for the shared "refs recursive else three subdirs" logic used by both dirs.)

`src/settings/types.ts`:
```ts
import { isAbsolute } from 'node:path';

/** A bare command (looked up on PATH) or an absolute path; relative paths would resolve inside the vault. */
export function isValidGitPath(value: string): boolean {
	const trimmed = value.trim();
	if (trimmed.length === 0) return false;
	return !/[\\/]/.test(trimmed) || isAbsolute(trimmed);
}
```
and in `normalizeSettings`: `if (typeof r['gitPath'] === 'string' && isValidGitPath(r['gitPath'])) out.gitPath = r['gitPath'].trim();`

`src/settings/GitGraphSettingTab.ts` — the `gitPath` text control gets `validate: (v) => (isValidGitPath(v) ? undefined : 'Enter a command on your PATH or an absolute path.')`, and `setControlValue('gitPath', …)` ignores invalid values (no `updateSettings` call) instead of coercing.

`src/main.ts` — in `initRepo`, after `gitDir`: `const commonDir = await reader.gitCommonDir(); if (gen !== this.initGeneration) return;` and pass `{ commonDir, onError }` to `createGitWatcher`. Keep `initRepo` under the complexity limit (extract `resolveWatcher(reader)` if needed).

- [ ] **Step 4: Run tests and gates**

Run: `npx vitest run tests/git tests/watch tests/settings tests/plugin` then `npm run check`.
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(git): watch the worktree common dir, report the real maxBuffer, reject relative git paths"
```

---

### Task 2: Plugin lifecycle — unload cancels an in-flight init, vault edits refresh the changes row, dirty-row width fallback

**Files:**
- Modify: `src/main.ts`, `src/view/GitGraphView.ts` (`ViewHost.statusChanges`), `src/view/GraphRoot.vue` (prop `statusChanges`, dirty fallback), `src/view/store.ts` (`refreshStatus()`), `harness/main.ts` (pass an emitter), `tests/helpers/obsidian-mock.ts` (`vault.on`, `Plugin.registerEvent`)
- Test: `tests/plugin/main.test.ts`, `tests/view/store.test.ts`, `tests/view/GraphRoot.test.ts`, `tests/view/GitGraphView.test.ts`

**Interfaces:**
- Produces: `GraphStore.refreshStatus(): Promise<void>` — runs `reader.status()` only (when `showDirtyRow`), updates `dirtyCount`, generation-guarded like `load()`, never touches `rows`. `ViewHost.statusChanges: Emitter<void>`; `GraphRoot` prop `statusChanges: Emitter<void>` (required). `export const STATUS_DEBOUNCE_MS = 500` in `src/main.ts`.

- [ ] **Step 1: Failing tests**

`tests/view/store.test.ts`:
```ts
	it('refreshStatus updates only the dirty count', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		reader.changed = 5;
		await store.refreshStatus();
		expect(store.state.dirtyCount).toBe(5);
		expect(reader.logCalls).toHaveLength(1);
		expect(reader.statusCalls).toBe(2);
	});

	it('refreshStatus is a no-op when the dirty row is off or after dispose', async () => {
		const reader = new FakeReader();
		reader.commits = linear(1);
		reader.changed = 2;
		const store = createGraphStore({ reader, settings: settings({ showDirtyRow: false }) });
		await store.load();
		await store.refreshStatus();
		expect(reader.statusCalls).toBe(0);
		const live = createGraphStore({ reader, settings: settings() });
		await live.load();
		live.dispose();
		await live.refreshStatus();
		expect(live.state.dirtyCount).toBe(2);
	});
```

`tests/view/GraphRoot.test.ts` — `mountRoot` gains a `statusChanges` emitter argument; add:
```ts
	it('refreshes only the changes row on a status change event', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		reader.changed = 1;
		const statusChanges = createEmitter<void>();
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader }, createEmitter<void>(), statusChanges);
		await flushPromises();
		reader.changed = 4;
		statusChanges.emit();
		await flushPromises();
		expect(w.find('.git-graph-row-dirty').text()).toContain('4 changes');
		expect(reader.logCalls).toHaveLength(1);
	});

	it('sizes the dirty row by the first loaded row when HEAD is not loaded', async () => {
		const reader = new FakeReader();
		reader.commits = [commit('a', 'b'), commit('b', null)];
		reader.refsSnapshot = { refs: [], headHash: 'zzz', headBranch: 'main' };
		reader.changed = 1;
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader });
		await flushPromises();
		const rowSvg = w.get('.git-graph-row:not(.git-graph-row-dirty) svg');
		expect(w.get('.git-graph-row-dirty svg').attributes('width')).toBe(rowSvg.attributes('width'));
	});
```

`tests/plugin/main.test.ts` (fake timers as in the existing gitPath tests):
```ts
	it('unloading cancels an in-flight repository resolution', async () => {
		const plugin = makePlugin(fixture.dir);
		await plugin.onload();
		const pending = plugin.initRepo();
		plugin.onunload();
		await pending;
		expect(plugin.repoState.value.kind).toBe('unresolved');
	});

	it('debounces vault edits into one status change while a view is open', async () => {
		vi.useFakeTimers();
		const plugin = makePlugin(fixture.dir);
		await plugin.onload();
		await plugin.initRepo();
		let statusChanges = 0;
		plugin.statusChanges.on(() => statusChanges++);
		const app = plugin.app as unknown as App;
		app.vault.trigger('modify');
		await vi.advanceTimersByTimeAsync(600);
		expect(statusChanges).toBe(0); // no view open
		plugin.viewOpened();
		app.vault.trigger('modify');
		app.vault.trigger('create');
		await vi.advanceTimersByTimeAsync(600);
		expect(statusChanges).toBe(1);
		plugin.onunload();
	});
```
Mock changes: `App.vault` gets `handlers: Record<string, (() => void)[]>`, `on(name, cb)` pushing and returning `{ name, cb }` as an `EventRef`, and `trigger(name)`; `Plugin.registerEvent(ref)` records it.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/view/store.test.ts tests/view/GraphRoot.test.ts tests/plugin/main.test.ts`
Expected: failures on `refreshStatus`, `statusChanges`, the dirty width, and the unload cancellation.

- [ ] **Step 3: Implement**

`src/view/store.ts`:
```ts
	async function refreshStatus(): Promise<void> {
		if (disposed || !deps.settings().showDirtyRow) return;
		const gen = generation;
		try {
			const status = await deps.reader.status();
			if (gen !== generation || disposed) return;
			state.dirtyCount = status.changed;
		} catch (e) {
			if (gen !== generation || disposed) return;
			state.error = errorMessage(e);
		}
	}
```
(export it on the store object and interface.)

`src/main.ts`:
- `readonly statusChanges = createEmitter<void>();` `private statusTimer: number | null = null;` `export const STATUS_DEBOUNCE_MS = 500;`
- in `onload`, after the setting tab: register `modify`, `create`, `delete`, `rename` via `this.registerEvent(this.app.vault.on(name, () => this.scheduleStatusRefresh()))`.
- `private scheduleStatusRefresh(): void { if (this.openViews === 0 || this.repoState.value.kind !== 'ready') return; if (this.statusTimer !== null) window.clearTimeout(this.statusTimer); this.statusTimer = window.setTimeout(() => { this.statusTimer = null; this.statusChanges.emit(); }, STATUS_DEBOUNCE_MS); }`
- `onunload`: `this.initGeneration++;` first, and clear `statusTimer`.

`src/view/GitGraphView.ts`: `ViewHost` gains `readonly statusChanges: Emitter<void>`; pass `statusChanges: host.statusChanges` to `GraphRoot`.

`src/view/GraphRoot.vue`: prop `statusChanges: Emitter<void>`; subscribe next to `changes` (`props.statusChanges.on(() => void s.refreshStatus())`), unsubscribe in `teardown`. Dirty fallback: `laneCount: head?.laneCount ?? s.state.rows[0]?.laneCount ?? 1`.

`harness/main.ts`: create `statusChanges = createEmitter<void>()` and pass it; expose `window.__harness.emitStatusChange()`. Update `harness/README.md` API list.

- [ ] **Step 4: Run tests and gates**

Run: `npx vitest run`, `npm run check`, `npm run test:e2e`.
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(plugin): live changes row on vault edits, cancel init on unload, dirty row width fallback"
```

---

### Task 3: Store performance — shallow reactivity and a status failure that does not hide the graph

**Files:**
- Modify: `src/view/store.ts`
- Test: `tests/view/store.test.ts`

**Interfaces:**
- Produces: unchanged `GraphStore` API. `state` becomes `shallowReactive`; `rows`, `commits`, `layout`, `refsByHash`, `expandedDetails` are replaced wholesale (never mutated in place) so top-level tracking suffices.

- [ ] **Step 1: Failing tests**

```ts
	it('does not deep-proxy rows and commits', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		expect(isReactive(store.state.rows)).toBe(false);
		expect(isReactive(store.state.rows[0])).toBe(false);
		expect(isReactive(store.state.commits[0])).toBe(false);
		expect(isReactive(store.state)).toBe(true);
	});

	it('keeps the graph when only status fails, and reports the status error', async () => {
		const reader = new FakeReader();
		reader.commits = linear(2);
		reader.changed = 1;
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		reader.failStatus = new Error('fatal: index locked');
		await store.load();
		expect(store.state.rows).toHaveLength(2);
		expect(store.state.dirtyCount).toBe(1);
		expect(store.state.error).toBe('fatal: index locked');
	});
```
(`FakeReader` gains `failStatus: Error | null = null`, rejecting in `status()` when set; import `isReactive` from `vue`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/view/store.test.ts`
Expected: both new tests fail (rows are reactive proxies; a status failure currently rejects the whole load and keeps `dirtyCount` but also drops the refreshed rows).

- [ ] **Step 3: Implement**

- `reactive<GraphState>` → `shallowReactive<GraphState>`; replace every in-place mutation with reassignment (audit: `state.commits = [...]`, `state.rows = [...]` already reassign; `refsByHash` reassigned; nothing pushes into `state.rows`).
- In `load()`, fetch status with `Promise.allSettled` semantics: run `log` and `refs` in `Promise.all`, and `status` separately as `showDirtyRow ? deps.reader.status().then((s) => ({ ok: true as const, changed: s.changed })).catch((e: unknown) => ({ ok: false as const, error: errorMessage(e) })) : Promise.resolve({ ok: true as const, changed: 0 })`. On `ok: false` keep `state.dirtyCount` and set `state.error` to the status error after the rows are applied. Keep `load()` under 80 lines: extract `applyLoad(commits, refs, count)`.

- [ ] **Step 4: Run tests and gates**

Run: `npx vitest run tests/view`, `npm run check`.
Expected: green; coverage thresholds still met.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "perf(view): shallow store state and a status failure that keeps the graph"
```

---

### Task 4: Docs and config accuracy — README typecheck scope, stub comment, harness expand fails loudly, oxlint/fallow config

**Files:**
- Modify: `README.md`, `harness/obsidian-stub.ts`, `harness/main.ts`, `harness/README.md`, `.oxlintrc.json`, `.fallowrc.json`
- Test: `harness/harness.spec.ts`

**Interfaces:** none new.

- [ ] **Step 1: Failing e2e test**

`harness/harness.spec.ts`:
```ts
test('an expand= that matches nothing fails loudly instead of rendering a plausible page', async ({ page }) => {
	const errors: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});
	await page.goto('/?scenario=merge&expand=no-such-commit');
	await page.waitForFunction(() => window.__harness !== undefined);
	const outcome = await page.evaluate(() => window.__harness.ready.then(() => 'resolved', (e: unknown) => `rejected: ${String(e)}`));
	expect(outcome).toMatch(/^rejected: .*no-such-commit/);
	expect(errors.some((t) => t.includes('no-such-commit'))).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test -g "fails loudly"`
Expected: FAIL (`ready` resolves).

- [ ] **Step 3: Implement**

- `harness/main.ts` `expandRow`: throw `new Error(\`expand=${needle} matched no commit in scenario ${scenario.name}\`)` when no commit matches, and `new Error(\`expand=${needle} matched "${commit.subject}" but that row is not rendered (scroll window)\`)` when no row matches. `becomeReady` propagates it (the existing `ready.catch` logs it). Document in `harness/README.md`.
- `harness/obsidian-stub.ts` comment: "the harness's module graph (`harness/main.ts → GraphRoot.vue → …`) imports exactly one name from `obsidian` (`setIcon`, in Icon.vue); `src/view/GitGraphView.ts` also imports `ItemView` but is never reached from the harness."
- `README.md`: typecheck rows say `src/**`, `tests/**`, `harness/**` and the root configs.
- `.oxlintrc.json`: remove the empty top-level `"rules": {}`.
- `.fallowrc.json`: check the installed fallow's schema (`node_modules/fallow/schema.json`) for a per-entry role or a scoped dependency ignore; if one exists, replace `ignoreDependencies: ["lucide"]` with it; if not, leave it and shorten the comment to say so with the schema version checked.
- `eslint.config.mjs`: confirm the size-rule tier already spreads `TESTS`; no change if so.

- [ ] **Step 4: Run gates**

Run: `npm run check`, `npm run test:e2e`.
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(docs): accurate typecheck scope, loud harness expand errors, config tidy-ups"
```

---

### Task 5: Open a changed file from the expanded commit (user request; supersedes the spec's "files are not clickable")

**Files:**
- Modify: `src/view/CommitDetails.vue` (files become buttons, emit `openFile`), `src/view/CommitList.vue` and `src/view/GraphRoot.vue` (re-emit `openFile`), `src/view/GitGraphView.ts` (`ViewHost.openFile`, pass `onOpenFile`), `src/main.ts` (`openFile(path)`), `styles.css` (`.git-graph-file` as a button), `harness/main.ts` (record opened paths on `window.__harness.opened`), `harness/README.md`, `README.md` (one line), `tests/helpers/obsidian-mock.ts` (`vault.getFileByPath`, `workspace.getLeaf`, `Notice.shown` reset helper)
- Test: `tests/view/CommitDetails.test.ts`, `tests/view/GraphRoot.test.ts`, `tests/plugin/main.test.ts`, `harness/harness.spec.ts`

**Interfaces:**
- Produces: `CommitDetails` emits `openFile(path: string)` (the new path for renames/copies); `CommitList` and `GraphRoot` re-emit `openFile(path)`; `ViewHost.openFile(path: string): void`; `GitGraphPlugin.openFile(path)` resolves `path` against the repository root, converts it to a vault-relative path, opens the `TFile` in the current leaf (`workspace.getLeaf(false).openFile(file)`), and shows a `Notice` when the file is outside the vault or not in it (deleted files, non-vault paths).

- [ ] **Step 1: Failing tests**

`tests/view/CommitDetails.test.ts`:
```ts
	it('emits openFile with the current path when a file is clicked or activated with Enter', async () => {
		const w = mount(CommitDetails, { props: { details, error: null } });
		const files = w.findAll('.git-graph-file');
		expect(files).toHaveLength(2);
		await files[0]!.trigger('click');
		await files[1]!.trigger('click');
		expect(w.emitted('openFile')).toEqual([['a.md'], ['new.md']]);
	});
```
(a `<button>` handles Enter/Space natively; no keydown handler needed.)

`tests/view/GraphRoot.test.ts`:
```ts
	it('re-emits openFile from the expanded commit', async () => {
		const reader = new FakeReader();
		reader.commits = linear(1);
		reader.detailFiles = [{ path: 'notes/a.md', status: 'M' }];
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader });
		await flushPromises();
		await w.get('.git-graph-row').trigger('click');
		reader.resolveDetails();
		await flushPromises();
		await w.get('.git-graph-file').trigger('click');
		expect(w.emitted('openFile')).toEqual([['notes/a.md']]);
	});
```
(`FakeReader` gains `detailFiles: ChangedFile[] = []` returned by `commitDetails`.)

`tests/plugin/main.test.ts`:
```ts
	describe('openFile', () => {
		it('opens a vault file in the current leaf, and notices for missing or outside paths', async () => {
			const plugin = makePlugin(fixture.dir);
			await plugin.onload();
			await plugin.initRepo();
			const app = plugin.app as unknown as App;
			app.vault.files.set('renamed.md', { path: 'renamed.md' });
			Notice.shown.length = 0;
			plugin.openFile('renamed.md');
			expect(app.workspace.opened).toEqual(['renamed.md']);
			plugin.openFile('missing.md');
			expect(Notice.shown.at(-1)).toContain('missing.md');
			plugin.openFile('../outside.md');
			expect(Notice.shown.at(-1)).toContain('outside');
			expect(app.workspace.opened).toHaveLength(1);
			plugin.onunload();
		});
	});
```
Mock: `App.vault.files = new Map<string, { path: string }>()`, `getFileByPath(p)` returning the entry or `null`; `App.workspace.opened: string[]` and `getLeaf(_new: boolean)` returning `{ openFile: (f) => { opened.push(f.path); return Promise.resolve(); } }` (typed loosely; cast in `src/` is not needed because `src/` uses the real types).

`harness/harness.spec.ts`:
```ts
test('clicking a changed file records it on window.__harness.opened', async ({ page }) => {
	await open(page, 'scenario=merge');
	await page.locator('.git-graph-row').first().click();
	await page.locator('.git-graph-file').first().click();
	await expect.poll(() => page.evaluate(() => window.__harness.opened)).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/view/CommitDetails.test.ts tests/view/GraphRoot.test.ts tests/plugin/main.test.ts` and `npx playwright test -g "changed file"`.
Expected: no `.git-graph-file`, no `openFile` emit, `plugin.openFile` undefined.

- [ ] **Step 3: Implement**

`src/view/CommitDetails.vue` — `defineEmits<{ openFile: [path: string] }>()`; the file line itself is the click target (no button chrome — the user explicitly does not want buttons):
```vue
				<li
					v-for="f in details.files"
					:key="f.path"
					class="git-graph-file"
					role="link"
					tabindex="0"
					:title="`Open ${f.path}`"
					@click.stop="emit('openFile', f.path)"
					@keydown="onFileKey($event, f.path)"
				>
					<span :class="['git-graph-file-status', `git-graph-file-status-${f.status}`]">{{ f.status }}</span>
					<span class="git-graph-file-path">{{ fileLabel(f) }}</span>
				</li>
```
with `function onFileKey(e: KeyboardEvent, path: string): void { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); emit('openFile', path); } }`. The Task 5 tests select `.git-graph-file` (the `li`) and trigger `click` and `keydown` with `{ key: 'Enter' }` (expect two emits from one click plus one Enter on the first file: `[['a.md'], ['a.md'], ['new.md']]` — adjust the assertion in Step 1 to click file 0, press Enter on file 0, click file 1). The e2e test clicks `.git-graph-file` instead of `.git-graph-file`.

`src/view/CommitList.vue`: `@open-file="emit('openFile', $event)"` on `CommitDetails`; add `openFile: [path: string]` to its emits. `src/view/GraphRoot.vue`: same re-emit from `CommitList`. `src/view/GitGraphView.ts`: `onOpenFile: (path: string) => host.openFile(path)`; `ViewHost.openFile(path: string): void`.

`src/main.ts`:
```ts
	/** Opens a repository-relative path in the current leaf when it lives inside this vault. */
	openFile(path: string): void {
		const state = this.repoState.value;
		const adapter = this.app.vault.adapter;
		if (state.kind !== 'ready' || !(adapter instanceof FileSystemAdapter)) return;
		const vaultRelative = relative(adapter.getBasePath(), resolve(state.root, path)).replaceAll('\\', '/');
		if (vaultRelative.startsWith('..') || isAbsolute(vaultRelative)) {
			new Notice(`Git graph: ${path} is outside this vault.`);
			return;
		}
		const file = this.app.vault.getFileByPath(vaultRelative);
		if (file === null) {
			new Notice(`Git graph: ${vaultRelative} is not in the vault (deleted or ignored).`);
			return;
		}
		void this.app.workspace.getLeaf(false).openFile(file);
	}
```
(`import { isAbsolute, relative, resolve } from 'node:path'`.)

`styles.css`: `.git-graph-file` stays a plain row but gets `cursor: pointer`, hover `background: var(--background-modifier-hover)` with the path in `var(--text-accent)`, and a `:focus-visible` outline (`outline: 2px solid var(--background-modifier-border-focus)`); no button styling anywhere.

`harness/main.ts`: `opened: string[]` on `window.__harness`; `onOpenFile: (p) => { harness.opened.push(p); }` plus a `.harness-toast` line showing "Would open <path>". `harness/README.md` documents `opened`. `README.md`: "Click a file in an expanded commit to open it in the editor (files outside the vault or no longer present show a notice)."

- [ ] **Step 4: Run tests and gates**

Run: `npx vitest run`, `npm run check`, `npm run test:e2e`.
Expected: green; the class-prefix build test still passes (`git-graph-file*` only).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(view): open a changed file from the expanded commit"
```

---

### Task 6: Expandable changes row listing the working-tree files (user request)

**Files:**
- Create: `src/view/FileList.vue` (shared clickable file list, extracted from `CommitDetails.vue`), `src/view/DirtyDetails.vue`, `src/view/measuredHeight.ts` (the details-height measurement from `CommitList.vue`, generalized so two blocks can be measured)
- Modify: `src/git/types.ts` (`GitReader.statusFiles()`), `src/git/parse.ts` (`parseStatus`), `src/git/GitRepository.ts` (`statusFiles()`), `src/view/store.ts` (`dirtyExpanded`, `dirtyFiles`, `dirtyError`, `toggleDirty()`), `src/view/DirtyRow.vue` (clickable, `expanded` prop, emits `toggle`), `src/view/CommitList.vue` (dirty block + offsets), `src/view/CommitDetails.vue` (uses `FileList`), `src/view/GraphRoot.vue`, `styles.css`, `tests/helpers/fakeReader.ts` (`dirtyFiles`, `statusFiles()`), `harness/fixtures.ts` (`statusFiles()` for `dirty`), `harness/README.md`, `README.md`
- Test: `tests/git/parse.test.ts`, `tests/git/GitRepository.test.ts`, `tests/view/store.test.ts`, `tests/view/CommitList.test.ts`, `tests/view/CommitDetails.test.ts` (unchanged assertions must still pass through `FileList`), `tests/view/GraphRoot.test.ts`, `harness/harness.spec.ts`

**Interfaces:**
- Produces: `parseStatus(stdout: string): ChangedFile[]` for `git status --porcelain=v1 -z --untracked-files=all` output (`XY path\0`, renames/copies `XY new\0old\0`): untracked `??` → `A`; otherwise the worktree column `Y` when it is not a space, else the index column `X`; `R`/`C` carry `oldPath`; `!!` (ignored) entries are skipped. `GitReader.statusFiles(): Promise<ChangedFile[]>`; `GitRepository.statusFiles()` runs that command. Store: `state.dirtyExpanded: boolean`, `state.dirtyFiles: ChangedFile[] | null`, `state.dirtyError: string | null`, `toggleDirty(): Promise<void>` (expand → fetch `statusFiles()`, generation-guarded; collapse → clear). `load()`/`refreshStatus()` re-fetch `dirtyFiles` while expanded and collapse when `dirtyCount` becomes 0. `FileList.vue` props `{ files: ChangedFile[] }`, emits `openFile(path)`. `DirtyRow.vue` props gain `expanded: boolean`, emits `toggle`. `DirtyDetails.vue` props `{ files: ChangedFile[] | null; error: string | null }`, emits `openFile`. `CommitList.vue` props gain `dirtyExpanded`, `dirtyFiles`, `dirtyError`; emits `toggleDirty`. `createMeasuredHeight(container: Ref<HTMLElement | null>, selector: string, fallback: number, key: () => unknown): { height: Ref<number>; onRef(el: unknown): void }` in `src/view/measuredHeight.ts` — the post-flush re-query + ResizeObserver pattern now in `CommitList.vue`, keyed on `key()` and on the mount counter fed by `onRef`.

- [ ] **Step 1: Failing tests**

`tests/git/parse.test.ts`:
```ts
describe('parseStatus', () => {
	it('maps porcelain v1 -z entries to changed files', () => {
		const out = ` M${' '}a.md${Z}?? b.md${Z}R  new.md${Z}old.md${Z}D  gone.md${Z}!! ignored.md${Z}MM both.md${Z}`;
		expect(parseStatus(out)).toEqual([
			{ path: 'a.md', status: 'M' },
			{ path: 'b.md', status: 'A' },
			{ path: 'new.md', status: 'R', oldPath: 'old.md' },
			{ path: 'gone.md', status: 'D' },
			{ path: 'both.md', status: 'M' },
		]);
		expect(parseStatus('')).toEqual([]);
	});
});
```
(`' M'` = worktree modified, `'R  '` = index rename, `'D  '` = index delete, `'MM'` = both.)

`tests/git/GitRepository.test.ts`, after the `status` describe (the fixture then has an untracked `x.txt` and a modified `renamed.md`):
```ts
	it('lists the changed files with their status', async () => {
		const files = await repo.statusFiles();
		expect(files).toEqual(expect.arrayContaining([{ path: 'x.txt', status: 'A' }, { path: 'renamed.md', status: 'M' }]));
	});
```

`tests/view/store.test.ts`:
```ts
	it('toggleDirty loads the working-tree files, collapses on the second call, and follows the dirty count', async () => {
		const reader = new FakeReader();
		reader.commits = linear(1);
		reader.changed = 2;
		reader.dirtyFiles = [{ path: 'a.md', status: 'M' }, { path: 'b.md', status: 'A' }];
		const store = createGraphStore({ reader, settings: settings() });
		await store.load();
		await store.toggleDirty();
		expect(store.state.dirtyExpanded).toBe(true);
		expect(store.state.dirtyFiles?.map((f) => f.path)).toEqual(['a.md', 'b.md']);
		reader.dirtyFiles = [{ path: 'a.md', status: 'M' }];
		reader.changed = 1;
		await store.refreshStatus();
		expect(store.state.dirtyFiles).toHaveLength(1);
		reader.changed = 0;
		reader.dirtyFiles = [];
		await store.refreshStatus();
		expect(store.state.dirtyExpanded).toBe(false);
		expect(store.state.dirtyFiles).toBeNull();
		await store.toggleDirty();
		await store.toggleDirty();
		expect(store.state.dirtyExpanded).toBe(false);
	});
```

`tests/view/CommitList.test.ts`: with `dirty: { count: 2, … }`, `dirtyExpanded: true`, `dirtyFiles: [{ path: 'a.md', status: 'M' }]` and the fake `ResizeObserver` from the existing tests: the `.git-graph-dirty-host` element is observed; after reporting `offsetHeight` 60 the first commit item's transform is `translateY(82px)` (22 + 60) and the spacer height is `22 + 60 + 1000 * 22`; clicking `.git-graph-row-dirty` emits `toggleDirty`.

`tests/view/GraphRoot.test.ts`: with `reader.changed = 2` and `reader.dirtyFiles` set, clicking `.git-graph-row-dirty` shows `.git-graph-dirty-details .git-graph-file` ×2; clicking one emits `openFile` with its path.

`harness/harness.spec.ts`: `scenario=dirty` → click `.git-graph-row-dirty` → `.git-graph-dirty-details .git-graph-file` has count 3; clicking the first records on `window.__harness.opened`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/git tests/view` and `npx playwright test -g "dirty"`.
Expected: `parseStatus`/`statusFiles`/`toggleDirty` missing, no `.git-graph-dirty-host`, no `toggleDirty` emit.

- [ ] **Step 3: Implement**

- `parse.ts`: `parseStatus` splits on `\0`, reads `XY` from the first two chars and the path from index 3, consumes a second token for `R`/`C`; status letter = `Y !== ' ' ? Y : X`, `??` → `'A'`, skip `!!`; only letters in `FileStatus` are emitted (anything else → `'M'`).
- `GitRepository.statusFiles()`: `run(['status', '--porcelain=v1', '-z', '--untracked-files=all'])` → `parseStatus`.
- `measuredHeight.ts`: move the counter + post-flush watch from `CommitList.vue` into `createMeasuredHeight`; `CommitList.vue` uses two instances (`.git-graph-details-host` keyed on `expandedHash`, `.git-graph-dirty-host` keyed on `dirtyExpanded`); `dirtyOffset = dirty === null ? 0 : ROW_HEIGHT + (dirtyExpanded ? dirtyHeight : 0)` so `offsetOf`/`indexAt`/`totalHeight` need no other change; the dirty item renders `DirtyRow` then, when expanded, `<div class="git-graph-dirty-host" :ref="dirtyRef"><DirtyDetails …/></div>`.
- `FileList.vue`: the `<ul class="git-graph-files">` with the clickable `li.git-graph-file` rows from Task 5 and the "No file changes" empty state; `CommitDetails.vue` and `DirtyDetails.vue` render it. `DirtyDetails.vue` root `div.git-graph-details.git-graph-dirty-details` shows "Loading changes…" while `files` is null and no error, the error text, else the list.
- `DirtyRow.vue`: `role="button"`, `tabindex="0"`, `:aria-expanded`, `@click` and Enter/Space → `emit('toggle')`; `git-graph-row-expanded` class when expanded; `cursor: pointer` in `styles.css` (replace the `cursor: default` on `.git-graph-row-dirty`).
- Store: `toggleDirty`, and `load()`/`refreshStatus()` call a shared `syncDirtyFiles(gen)` that fetches `statusFiles()` when expanded and collapses when `dirtyCount === 0`.
- GraphRoot: pass the three props, `@toggle-dirty="store.toggleDirty()"`; `harness/fixtures.ts`: `statusFiles()` returns 3 deterministic files for `dirty`, `[]` otherwise; `FakeReader.statusFiles()` returns `this.dirtyFiles`.
- README: "Click the changes row to see the uncommitted files; click a file to open it."

- [ ] **Step 4: Run tests and gates**

Run: `npx vitest run`, `npm run check`, `npm run test:e2e`, `npm run screenshot -- --scenario=dirty`.
Expected: green; `screenshots/dirty-*.png` show the collapsed row (expansion is exercised by the e2e test).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(view): expandable changes row listing the working-tree files"
```

---

## Self-review notes

- Coverage of the chosen sets: correctness (T1 common dir, maxBuffer, relative gitPath; T2 unload cancel, dirty width; T4 expand fails loudly), dirty row on vault edits (T2), performance (T3), docs/config (T4).
- Type consistency: `gitCommonDir()` (T1) is consumed by `main.ts` in T1; `statusChanges`/`refreshStatus()` (T2) names match across store, view, root, harness; `failStatus` on `FakeReader` is introduced in T3 and used only there.
- Spec conflicts: the spec names `--git-dir` for the watcher; T1 keeps that and adds the common dir — an extension, not a replacement.
