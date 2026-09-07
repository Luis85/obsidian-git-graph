# File history toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A toggle button in the pane header that, while on, lists only the commits touching the file currently open in Obsidian (following renames), as a flat list. Switching the active file re-filters; switching the toggle off restores the full graph.

**Architecture:** The plugin tracks the active file (`workspace.on('file-open')`) as a repository-relative path on a `shallowRef`, handed to `GraphRoot` as a prop like `repoState`/`settings`. `GraphRoot` owns the toggle state (per view session, not persisted) and pushes `toggle × activeFile` into the store as `historyPath`. The store passes `path` to `GitReader.log`, and `GitRepository` translates that to `--follow -- <path>`. No new modules except a small path helper; no new settings; no new dependencies.

**Tech Stack:** TypeScript 6, Vue 3.5, Vitest 4 (`dom` + `node` projects), Playwright harness, eslint-plugin-obsidianmd, oxlint, fallow. Obsidian API 1.13.

**Spec:** The approved in-chat design (2026-09-07). Decisions: commit click in file mode shows the normal commit details (all files of the commit) — no per-file diff view. Flat list (no lanes) in file mode. Header shows the file name instead of the branch while the toggle is on. Changes row hidden in file mode. Toggle state lives in the view session only. Text filter and Auto/All keep working in file mode.

## Global Constraints

- Branch: `feat/file-history` off `main`. One commit per task; conventional-commit subjects; commit body ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Every task must leave `npm run check` green (typecheck + build, oxlint, eslint at `--max-warnings 0` including the size/complexity caps: `src/**` `max-lines` 300, `max-lines-per-function` 80, `complexity` 12, `max-depth` 4, `max-params` 5; `tests/**`/`harness/**` `max-lines` 500; fallow dead-code; LOC ≤ 400 per file; coverage thresholds). Run at least the touched test files during the task, and `npm run check` before committing.
- TDD: write the failing test first, see it fail for the expected reason, then implement. Report RED/GREEN evidence.
- `src/**` runs in Obsidian's Electron renderer: timers go through `window.*`. No `console.log`. UI copy in sentence case. No `innerHTML`, no `as any`, no `globalThis`. Icons are Lucide names via `Icon.vue` / `setIcon`.
- `tests/**` use `tests/helpers/fakeReader.ts`, `tests/helpers/fixtureRepo.ts` and `tests/helpers/obsidian-mock.ts`; the mock is extended only for API surface `src/` newly uses. Follow the neighbouring test's style.
- Every `GitReader` implementation (`src/git/GitRepository.ts`, `tests/helpers/fakeReader.ts`, `harness/fixtures.ts`) must keep compiling — `npm run typecheck` covers all three.
- CHANGELOG entries are one sentence each, under `## [Unreleased]`, in a single `### Added` heading created by the task that first needs it (`tests/release/changelogVersion.test.ts` fails on a repeated group heading).
- Do NOT merge, push, tag or release from a task.
- Windows checkout with CRLF: keep each file's existing line endings; do not reformat whole files.
- Class names for new DOM: `git-graph-history-toggle` (the button), `git-graph-file` is already taken by file rows — the header's file label is `git-graph-history-file`.

---

### Task 1: `GitReader.log` takes an optional path; `GitRepository` follows the file's history

**Files:**
- Modify: `src/git/types.ts` (the `GitReader.log` signature)
- Modify: `src/git/GitRepository.ts:55-60` (`log`)
- Modify: `tests/helpers/fakeReader.ts` (`logCalls` records `path` when given)
- Test: `tests/git/GitRepository.test.ts`

**Interfaces:**
- Produces: `log(opts: { skip: number; count: number; refs: RefFilter; path?: string }): Promise<Commit[]>`. `path` is repository-relative with forward slashes. When set, `GitRepository.log` runs `git log --topo-order -z --format=… --skip=… --max-count=… <selection> --follow -- <path>`; otherwise the command is unchanged (`--` with no pathspec).
- Consumed by: Task 2 (store).

- [ ] **Step 1: Failing tests** in `tests/git/GitRepository.test.ts`, in a new `describe('log with a path')` next to the existing `log` tests, against the shared fixture (`tests/helpers/fixtureRepo.ts` documents the history: `tip` renames `note.md` → `renamed.md`, `second` edits `note.md`, `root` adds it; `feature` adds `feature.md` on branch `feature`, merged by `merge`):
  - `renamed.md` with `refs: 'all'` → hashes `[tip, second, root]` in that order (rename followed — without `--follow` this would be `[tip]` only).
  - `feature.md` with `refs: 'all'` → `[feature]` (the merge commit does not touch the file on its first parent… note: `git log -- path` without `-m` lists the merge only if it changes the path relative to all parents; assert `[feature]` and, if the merge shows up, report it — do not silently widen the assertion).
  - `no-such.md` → `[]`.
  - `skip: 1, count: 1` for `renamed.md` → `[second]` (paging still works with a path).
  - Omitting `path` still yields the full history (the existing tests already cover this; add one assertion that the call count of commits for `refs: 'all'` is 5 to pin it).
  Run `npx vitest run tests/git/GitRepository.test.ts` — the new tests must fail (`path` is ignored today, so `renamed.md` returns all 5 commits).
- [ ] **Step 2: Implement** — add `path?: string` to the `GitReader.log` opts type in `src/git/types.ts`; in `GitRepository.log` build the argument list so `--follow`, `--`, `path` are appended only when `opts.path !== undefined`. Keep the method under the complexity cap (a small `pathspec(opts.path)` helper returning `string[]` is fine).
- [ ] **Step 3: FakeReader** — `logCalls` entries include `path` only when the caller passed one (so the existing `toEqual({ skip, count, refs })` assertions in `tests/view/store.test.ts` keep passing).
- [ ] **Step 4:** `npm run check` green. Commit: `feat(git): let log() follow a single file's history`.

---

### Task 2: Store gains `historyPath`

**Files:**
- Modify: `src/view/store.ts`
- Test: `tests/view/store.test.ts`

**Interfaces:**
- Produces: `GraphState.historyPath: string | null` (initially `null`); `GraphStore.setHistoryPath(path: string | null): void`. Setting the same value is a no-op. Setting a different value stores it, resets `state.loadedCount` to `0` (the new history starts at one page), collapses any expanded commit, and calls `load()` (fire-and-forget, like `changes.on(() => void s.load())` in `GraphRoot`). `load()` and `loadMore()` pass `path: state.historyPath` to `reader.log` only when it is not null (do not send `path: undefined`).
- Consumed by: Task 3.

- [ ] **Step 1: Failing tests** in `tests/view/store.test.ts`:
  - `setHistoryPath('notes/a.md')` → the next `reader.logCalls` entry equals `{ skip: 0, count: 3, refs: 'auto', path: 'notes/a.md' }` and `state.historyPath === 'notes/a.md'`; `loadMore()` afterwards also carries `path`.
  - `setHistoryPath(null)` afterwards → a log call without a `path` key (`expect(call).not.toHaveProperty('path')`).
  - Setting the same path twice triggers exactly one load.
  - After `loadMore()` grew `loadedCount` to 6, `setHistoryPath('x.md')` requests `count: 3` (page size), not 6.
  - An expanded commit is collapsed when the path changes (`expandedHash` becomes `null`).
  - Stale result guard: with `reader.deferLog = true`, call `setHistoryPath('a.md')` then `setHistoryPath('b.md')`; resolve the first pending log with `linear(2)` and the second with `linear(1)`; `rows` must have length 1 (the generation counter already does this — the test pins it for the new entry point).
  Run `npx vitest run tests/view/store.test.ts`; the new tests fail (`setHistoryPath` does not exist).
- [ ] **Step 2: Implement** in `src/view/store.ts`. Keep `createGraphStore` under the 80-line function cap — if it is close, move the `log` options assembly into a small `logOptions(state, settings, skip, count)` helper.
- [ ] **Step 3:** `npm run check` green. Commit: `feat(view): store filters history by a file path`.

---

### Task 3: Header toggle and `GraphRoot` wiring

**Files:**
- Modify: `src/view/GraphHeader.vue`
- Modify: `src/view/GraphRoot.vue`
- Modify: `styles/header.css`
- Test: `tests/view/GraphHeader.test.ts`, `tests/view/GraphRoot.test.ts`

**Interfaces:**
- `GraphHeader` new props: `historyActive: boolean`, `historyFile: string | null` (repository-relative path of the active file, or null). New emit: `'update:historyActive': [value: boolean]`. The toggle is `<button type="button" class="git-graph-history-toggle clickable-icon" aria-label="Show history of the active file" :aria-pressed="historyActive" :class="{ 'is-active': historyActive }">` with `<Icon name="file-clock" />`, placed after the refresh button. While `historyActive` is true and `historyFile` is not null, the title row shows `<span class="git-graph-history-file" :title="historyFile">{{ basename }}</span>` (the part after the last `/`) **instead of** the `.git-graph-branch` span; otherwise the branch span renders as today.
- `GraphRoot` new prop: `activeFile: string | null` (repository-relative, forward slashes; provided by Task 4 — until then the tests pass it directly). `GraphRoot` owns `const historyActive = ref(false)`. A watcher on `[historyActive, () => props.activeFile, store]` calls `store.setHistoryPath(historyActive.value ? props.activeFile : null)` — including right after a new store is created for a `ready` repoState, so a repo re-resolve keeps the mode.
  - `showGraph` is false when `historyActive` is true (in addition to the text-filter case).
  - `dirty` is `null` when `historyActive` is true.
  - Empty states (all `.git-graph-empty`, sentence case): `historyActive && activeFile === null` → `Open a file to see its history.` (takes precedence over the list and over "No commits yet."); `historyActive && activeFile !== null && !loading && rows.length === 0 && error === null` → `No commits for this file yet.`
- Styles: `.git-graph-history-toggle.is-active { color: var(--text-accent); }` plus whatever `.git-graph-history-file` needs to match `.git-graph-branch` (muted, `·` separator, ellipsis). Styles live in `styles/*.css`, never in the SFC (`tests/build/no-sfc-styles.test.ts`).

- [ ] **Step 1: Failing header tests** in `tests/view/GraphHeader.test.ts` (extend `mountHeader` defaults with `historyActive: false, historyFile: null`): the button exists with `aria-pressed="false"`; clicking emits `update:historyActive` with `[true]` when inactive and `[false]` when mounted active; with `historyActive: true, historyFile: 'notes/daily/2026-09-07.md'` the title shows `2026-09-07.md` in `.git-graph-history-file`, has the full path as `title`, and `.git-graph-branch` is absent; with `historyActive: true, historyFile: null` the branch span still renders.
- [ ] **Step 2: Failing root tests** in `tests/view/GraphRoot.test.ts` (extend `mountRoot` to accept `activeFile`, default `null`):
  - Clicking the toggle with `activeFile: 'notes/a.md'` → `reader.logCalls.at(-1)` has `path: 'notes/a.md'`; rows render without `svg.git-graph-lanes`; `.git-graph-row-dirty` is absent even with `reader.changed = 2`.
  - `setProps({ activeFile: 'notes/b.md' })` while active → another log call with the new path; `setProps({ activeFile: 'notes/b.md' })` again → no extra call.
  - Toggle off → log call without `path`, lanes back.
  - Active with `activeFile: null` → text contains `Open a file to see its history.` and no rows; no log call carries a path.
  - Active with a file and `reader.commits = []` → `No commits for this file yet.`
- [ ] **Step 3: Implement** header, root, styles. Keep `GraphRoot.vue`'s script small: the empty-state predicates may become computed refs (`emptyMessage: ComputedRef<string | null>`) if the template `v-if` chain grows past readability.
- [ ] **Step 4:** `npm run check` green. Commit: `feat(view): toggle the pane to the active file's history`.

---

### Task 4: Plugin tracks the active file; the view passes it through

**Files:**
- Modify: `src/util/paths.ts` (new helper)
- Modify: `src/main.ts`
- Modify: `src/view/GitGraphView.ts` (`ViewHost.activeFile`, render prop)
- Modify: `tests/helpers/obsidian-mock.ts` (workspace `on`/`trigger`/`getActiveFile`, `TFile`-shaped `{ path }`)
- Test: `tests/util/paths.test.ts` (create if absent), `tests/plugin/main.test.ts`, `tests/view/GitGraphView.test.ts`

**Interfaces:**
- `src/util/paths.ts`: `export function relativeWithin(base: string, target: string): string | null` — both canonicalized with `realPath`, `relative(base, target)` with backslashes turned into `/`; returns `null` when the result is `..`, starts with `../`, or is absolute (the exact rule `openFile` uses today, so `..notes.md` stays valid). Refactor `GitGraphPlugin.openFile` to use it (behavior unchanged; its existing tests pin that).
- `ViewHost.activeFile: ShallowRef<string | null>` — repository-relative path of Obsidian's active file, `null` when no file is open, the repository is not `ready`, or the file lies outside the repository root (cannot happen for a vault inside the repo, but the helper says so anyway).
- `GitGraphPlugin`: in `onload` register `this.app.workspace.on('file-open', (file) => …)` via `registerEvent`; keep the vault-relative path of the last event in a private field; recompute `activeFile` from that field whenever it changes **and** whenever `repoState` becomes `ready` (so a file opened before the repo resolved is picked up). On `onLayoutReady`, seed the field from `workspace.getActiveFile()?.path ?? null`. Conversion: `relativeWithin(state.root, resolve(adapter.getBasePath(), vaultPath))`.
- `GitGraphView.onOpen` passes `activeFile: host.activeFile.value` to `GraphRoot`.

- [ ] **Step 1: Failing tests**
  - `tests/util/paths.test.ts`: `relativeWithin(root, join(root, 'a', 'b.md'))` → `'a/b.md'`; parent directory → `null`; `..notes.md` inside → `'..notes.md'`; a sibling directory → `null`.
  - `tests/plugin/main.test.ts` (fixture repo as vault): after `onload` + `initRepo`, `workspace.trigger('file-open', { path: 'renamed.md' })` → `plugin.activeFile.value === 'renamed.md'`; `trigger('file-open', null)` → `null`; a file opened **before** `initRepo` resolves is reported once the state is `ready`; with the vault at `join(fixture.dir, 'sub')` (see the existing sub-vault test) a file `x.md` in the sub-vault → `'sub/x.md'`.
  - `tests/view/GitGraphView.test.ts`: with a ready host and `host.activeFile.value = 'notes/a.md'`, clicking `.git-graph-history-toggle` makes the reader's last `logCalls` entry carry `path: 'notes/a.md'`; changing `host.activeFile.value` re-renders with the new path.
  Extend the mock minimally: `workspace.on(name, cb)` returning an `EventRef`, `workspace.trigger(name, ...args)`, `workspace.getActiveFile(): { path: string } | null` (default `null`, settable).
- [ ] **Step 2: Implement.** `main.ts` is at ~200 lines; if the new code pushes a function over the caps, extract a `resolveActiveFile()` private method rather than growing `initRepo`.
- [ ] **Step 3:** `npm run check` green. Commit: `feat(plugin): track the active file for the history toggle`.

---

### Task 5: Harness, docs and changelog

**Files:**
- Modify: `harness/fixtures.ts` (`createScenarioReader().log` honours `path`)
- Modify: `harness/main.ts` (`file=` parameter, `activeFile` prop, `__harness.setActiveFile(path)`)
- Modify: `harness/index.html` only if a toolbar control is added (optional; a URL parameter is enough)
- Modify: `harness/harness.spec.ts`
- Modify: `harness/README.md` (URL-parameter row, `__harness` block)
- Modify: `README.md` (Usage paragraph)
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Added`)

**Interfaces:**
- Scenario reader: when `path` is given, serve `f.commits.filter((c) => detailsFor(c).files.some((file) => file.path === path))` before applying skip/count, so the harness shows a real subset (the fixture's file list is a function of the hash, see `FILES`/`detailsFor`).
- `harness/main.ts`: `activeFile = shallowRef<string | null>(params.get('file'))`, passed to `GraphRoot` as `activeFile: activeFile.value`; when `file=` is present, `becomeReady()` clicks `.git-graph-history-toggle` after the first load settles and waits until `.git-graph-history-file` is rendered. `window.__harness.setActiveFile(path: string | null)` updates the ref for interactive use.
- Playwright: `scenario=merge&file=README.md` → fewer `.git-graph-row` than 8 and more than 0 (compute the expected count in the test from `window.__harness` if exposed, or assert `toHaveCount` against a number you derive once by running the harness and pin with a comment naming how it was derived), no `svg.git-graph-lanes`, `.git-graph-history-file` reads `README.md`, and `[aria-pressed="true"]` on the toggle. A second test: `scenario=merge&file=no/such.md` → `.git-graph-empty` reads `No commits for this file yet.`
- CHANGELOG: `### Added` under `## [Unreleased]`: `- A "Show history of the active file" toggle in the pane header lists only the commits that touched the file open in the editor (renames followed), as a flat list; switching files re-filters, and turning it off restores the graph.`
- README Usage: one or two sentences describing the toggle, in the existing paragraph's voice.

- [ ] **Step 1:** Add the Playwright tests first; run `npm run test:e2e` (needs `npm run harness:install` once) and see them fail because `file=` does nothing yet.
- [ ] **Step 2:** Implement the harness pieces; re-run `npm run test:e2e` green.
- [ ] **Step 3:** Docs and changelog. `npm run check` green (it includes `tests/release/changelogVersion.test.ts`). Commit: `docs(harness): file= parameter, README and changelog for the history toggle`.
