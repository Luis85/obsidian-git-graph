# Review feedback and marketplace polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every open Codex review thread on PRs #1 and #2, clear the three source warnings the Obsidian marketplace scan raised, and disclose the plugin's Node fs / child_process use the way Obsidian's developer policies ask.

**Architecture:** Eight small, independent fixes on top of `main` (0.2.0). Each one is a test-first change to one layer (release workflow, git layer, plugin, view, layout, harness, docs) with its own CHANGELOG line under `## [Unreleased]`. No new modules, no new dependencies, no version bump (releasing is a separate decision).

**Tech Stack:** TypeScript 6, Vue 3.5, Vitest 4 (`dom` + `node` projects), Playwright harness, eslint-plugin-obsidianmd 0.4, oxlint, fallow. Obsidian API 1.13.

**Spec:** The review threads themselves (quoted verbatim in each task) plus the marketplace scan output in the task descriptions; the original design is `docs/superpowers/specs/2026-09-06-git-graph-design.md`.

## Global Constraints

- Branch: `polish/review-feedback` off `main`. One commit per task; conventional-commit subjects; commit body ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Every task must leave `npm run check` green (typecheck + build, oxlint, eslint at `--max-warnings 0` including the size/complexity caps: `src/**` `max-lines` 300, `max-lines-per-function` 80, `complexity` 12; fallow dead-code; LOC ≤ 400 per file; coverage ≥ 90/80/90/90). Run at least the touched test files during the task, and `npm run check` before committing.
- `src/**` runs in Obsidian's Electron renderer: timers go through `window.setTimeout` / `window.requestAnimationFrame` (obsidianmd/prefer-window-timers). No `console.log`; `console.error` only for real errors. UI copy in sentence case. No `innerHTML`, no `as any`.
- `tests/**` use the `node:fs` namespace mocks and the `tests/helpers/obsidian-mock.ts` `App`/`Notice` fakes already in place; follow the neighbouring test's style in each file.
- CHANGELOG entries are one sentence each, for a reader deciding whether to upgrade, under an existing `### Fixed` / `### Changed` heading inside `## [Unreleased]` (never a repeated group heading — `tests/release/changelogVersion.test.ts` fails on that). Task 1 creates the `### Fixed` group; later tasks append lines to it.
- Do NOT reply on the GitHub review threads, merge, tag or release from a task. The plan owner does that.
- Windows checkout with CRLF: keep the file's existing line endings; do not reformat whole files.

---

### Task 1: Release gate waits on the `audit` job too (PR #1, `.github/workflows/release.yml:86`)

Review thread (Codex, P1): *"In the documented direct-push/tag flow, the separate `audit` job in `.github/workflows/ci.yml` can still be pending or can have failed for a critical production advisory, but this query selects only check runs whose names start with `verify`; as soon as the two build/test matrix checks succeed, the workflow can publish anyway. Include the `audit` check in the pending/success/failure verdict so the release actually requires all CI gates to pass."*

The README already claims *"the release workflow refuses to publish a commit that job has not passed"* about the audit job, so this is a bug in the workflow, not a policy change.

**Files:**
- Modify: `.github/workflows/release.yml:83-107` (the CI-gate loop)
- Modify: `.github/workflows/ci.yml:9-13` (the comment above `verify:`) and `:64` (add the same note above `audit:`)
- Modify: `CHANGELOG.md` (`## [Unreleased]`)

**Interfaces:**
- Produces: nothing code-facing. The gate's contract becomes "every check run named `verify*` and the check run named `audit` concluded `success`".

- [ ] **Step 1: Prove the current filter ignores `audit` against a real commit**

Run (any shell with `gh` logged in; `ed88519` is the 0.2.0 squash on `main`):

```bash
gh api repos/Luis85/obsidian-git-graph/commits/ed88519/check-runs --jq '[.check_runs[] | {name, status, conclusion}]'
```

Expected: three runs — `verify (ubuntu-latest)`, `verify (windows-latest)`, `audit`. Now run the workflow's current filter and confirm `audit` is excluded:

```bash
gh api repos/Luis85/obsidian-git-graph/commits/ed88519/check-runs --jq '[.check_runs[] | select(.name | startswith("verify")) | .name]'
```

Expected: only the two `verify (...)` names. That is the bug.

- [ ] **Step 2: Widen the selector**

In `release.yml`, replace the `select(...)` line so the verdict covers both jobs:

```yaml
            verdict="$(gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/check-runs" \
              --jq '[.check_runs[] | select((.name | startswith("verify")) or .name == "audit")]
                    | if length == 0 then "missing"
                      elif ([.[] | select(.name == "audit")] | length) == 0 then "pending"
                      elif any(.status != "completed") then "pending"
                      elif all(.conclusion == "success") then "success"
                      else "failed" end')"
```

The extra `elif` treats "the `verify` runs exist but `audit` has not reported yet" as `pending` rather than `success`, which is the exact race the reviewer described (audit is queued while verify already finished).

Update the two human-facing messages in the same loop:

```yaml
                  echo "'missing' means no job named 'verify' or 'audit' reported at all; if CI's jobs were renamed, this guard needs the new names." >&2
```

and the `pending` explanation stays as is.

- [ ] **Step 3: Keep `ci.yml`'s comments honest**

Replace the comment block above `verify:` (lines 9-13) with:

```yaml
  # Named `verify` on purpose: release.yml refuses to publish a commit unless every check
  # run whose name starts with `verify`, plus the one named `audit` below, concluded
  # successfully on it. Renaming either job means updating that guard in the same edit,
  # or the release workflow refuses everything with "missing".
```

Add one line to the existing comment above `audit:` (before `audit:` on line 64):

```yaml
  # release.yml waits on this job by its exact name, `audit`, alongside the `verify` runs.
```

- [ ] **Step 4: Re-run the new filter against the same commit**

```bash
gh api repos/Luis85/obsidian-git-graph/commits/ed88519/check-runs --jq '[.check_runs[] | select((.name | startswith("verify")) or .name == "audit")] | if length == 0 then "missing" elif ([.[] | select(.name == "audit")] | length) == 0 then "pending" elif any(.status != "completed") then "pending" elif all(.conclusion == "success") then "success" else "failed" end'
```

Expected: `"success"`. Then check the ignored-audit case by filtering audit out of the input and feeding the verdict the same way:

```bash
gh api repos/Luis85/obsidian-git-graph/commits/ed88519/check-runs --jq '[.check_runs[] | select(.name | startswith("verify"))] | if length == 0 then "missing" elif ([.[] | select(.name == "audit")] | length) == 0 then "pending" elif any(.status != "completed") then "pending" elif all(.conclusion == "success") then "success" else "failed" end'
```

Expected: `"pending"` — the verdict no longer publishes on verify alone.

- [ ] **Step 5: CHANGELOG**

Under `## [Unreleased]` add:

```markdown
### Fixed
- The release workflow now also waits for CI's `npm audit` job before publishing, instead of publishing as soon as the build and test runs are green.
```

- [ ] **Step 6: Run the release tests and commit**

```bash
npx vitest run tests/release
git add .github/workflows/release.yml .github/workflows/ci.yml CHANGELOG.md
git commit -m "fix(release): gate publishing on the audit job as well as verify"
```

---

### Task 2: Skip a dangling `origin/HEAD` in the auto ref selection (PR #1, `src/git/GitRepository.ts:79`)

Review thread (Codex, P2): *"When `refs/remotes/origin/HEAD` is a dangling symbolic ref — for example after the remote default branch was renamed or its tracking ref was pruned — `git symbolic-ref` still succeeds and returns the missing target. Adding that target here makes the subsequent default-mode `git log` fail with `fatal: bad revision`, hiding otherwise valid HEAD history. Verify that the returned target resolves before including it, or omit stale default-remote refs."*

**Files:**
- Modify: `src/git/GitRepository.ts:71-81` (`refSelection`)
- Test: `tests/git/GitRepository.test.ts` (inside `describe('log', ...)`)

**Interfaces:**
- Consumes: `GitRepository.tryRun(args): Promise<string | null>` (private; non-zero exit → `null`).
- Produces: a private `defaultRemoteRef(): Promise<string | null>` returning the `origin/HEAD` target only when it resolves to a commit.

- [ ] **Step 1: Write the failing test**

Add after `it('refs=auto covers HEAD, its upstream and origin/HEAD', ...)`:

```ts
	it('refs=auto still lists HEAD history when origin/HEAD points at a pruned branch', async () => {
		const tmp = createFixtureRepo();
		try {
			// A symbolic ref may point at a ref that no longer exists (the remote's default branch
			// was renamed, or the tracking ref was pruned); git log must not be asked for it.
			execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/gone'], { cwd: tmp.dir });
			const dangling = new GitRepository({ gitPath: 'git', cwd: tmp.dir });
			const commits = await dangling.log({ skip: 0, count: 200, refs: 'auto' });
			expect(commits.map((c) => c.hash)).toContain(tmp.hashes.tip);
			expect(commits).toHaveLength(5);
		} finally {
			tmp.dispose();
		}
	});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/git/GitRepository.test.ts -t "pruned branch"
```

Expected: FAIL with a `GitError` whose stderr contains `bad revision 'refs/remotes/origin/gone'`.

- [ ] **Step 3: Implement**

In `GitRepository.ts`, replace the two `defaultRemote` lines in `refSelection` with a call to a new private method, and add that method directly below `refSelection`:

```ts
		const selection = ['HEAD'];
		const upstream = await this.tryRun(['rev-parse', '--symbolic-full-name', '@{upstream}']);
		if (upstream !== null && upstream.trim().length > 0) selection.push(upstream.trim());
		const defaultRemote = await this.defaultRemoteRef();
		if (defaultRemote !== null) selection.push(defaultRemote);
		return [...new Set(selection)];
	}

	/**
	 * The ref `origin/HEAD` points at, or null when there is none or it dangles: `symbolic-ref`
	 * happily reports a target that no longer exists (a renamed or pruned default branch), and
	 * handing that to `git log` fails the whole listing with "bad revision".
	 */
	private async defaultRemoteRef(): Promise<string | null> {
		const target = (await this.tryRun(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']))?.trim() ?? '';
		if (target.length === 0) return null;
		const resolves = await this.tryRun(['rev-parse', '--verify', '-q', `${target}^{commit}`]);
		return resolves === null ? null : target;
	}
```

- [ ] **Step 4: Run tests and gates**

```bash
npx vitest run tests/git/GitRepository.test.ts
npm run check
```

Expected: all green.

- [ ] **Step 5: CHANGELOG and commit**

Append under `### Fixed` in `## [Unreleased]`:

```markdown
- With "Refs to show" on Auto, a stale `origin/HEAD` (the remote's default branch renamed or pruned) no longer makes the whole graph fail with "bad revision".
```

```bash
git add src/git/GitRepository.ts tests/git/GitRepository.test.ts CHANGELOG.md
git commit -m "fix(git): ignore a dangling origin/HEAD in the auto ref selection"
```

---

### Task 3: Vault files whose name starts with `..` open (PR #1, `src/main.ts:190`)

Review thread (Codex, P2): *"For a valid vault file whose name begins with two dots, such as `..notes.md`, `relative()` returns `..notes.md`, so this prefix test incorrectly classifies the file as outside the vault and prevents it from opening. Only the exact parent path `..` or a `../`-prefixed path should be rejected after separator normalization."*

**Files:**
- Modify: `src/main.ts:186-193` (`openFile`)
- Test: `tests/plugin/main.test.ts` (inside `describe('openFile', ...)`)

- [ ] **Step 1: Write the failing test**

Add after `it('opens a vault file in the current leaf, and notices for missing or outside paths', ...)`:

```ts
		it('opens a vault file whose name starts with two dots, and still rejects the parent directory', async () => {
			const plugin = makePlugin(fixture.dir);
			await plugin.onload();
			await plugin.initRepo();
			const app = plugin.app as unknown as App;
			app.vault.files.set('..notes.md', { path: '..notes.md' });
			Notice.shown.length = 0;
			plugin.openFile('..notes.md');
			expect(Notice.shown).toEqual([]);
			expect(app.workspace.opened).toEqual(['..notes.md']);
			plugin.openFile('..');
			expect(Notice.shown.at(-1)).toContain('outside this vault');
			expect(app.workspace.opened).toHaveLength(1);
			plugin.onunload();
		});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/plugin/main.test.ts -t "two dots"
```

Expected: FAIL — `Notice.shown` contains `"Git graph: ..notes.md is outside this vault."` and nothing was opened.

- [ ] **Step 3: Implement**

Replace the check in `openFile`:

```ts
		const vaultRelative = relative(realPath(adapter.getBasePath()), resolve(realPath(state.root), path)).replaceAll('\\', '/');
		// Only the parent directory itself or a path that climbs out of it is outside; a file
		// named `..notes.md` is a legitimate vault file.
		if (vaultRelative === '..' || vaultRelative.startsWith('../') || isAbsolute(vaultRelative)) {
```

- [ ] **Step 4: Run tests and gates**

```bash
npx vitest run tests/plugin/main.test.ts
npm run check
```

- [ ] **Step 5: CHANGELOG and commit**

Append under `### Fixed`:

```markdown
- A file whose name begins with two dots (such as `..notes.md`) now opens from the commit and changes lists instead of being reported as outside the vault.
```

```bash
git add src/main.ts tests/plugin/main.test.ts CHANGELOG.md
git commit -m "fix(plugin): only reject a real parent path when opening a file"
```

---

### Task 4: The changes row counts the vault, not the whole worktree (PR #1, `src/main.ts:74`)

Review thread (Codex, P2): *"When the vault is a subdirectory of a larger repository, `GitRepository.status()` counts changes across the entire worktree, but these subscriptions observe only files inside the vault. An unstaged edit to a sibling path changes no `.git` metadata and emits no vault event, leaving the displayed dirty count and expanded file list stale until a manual refresh; watch the repository worktree as well or scope status to the vault."*

Decision: scope status to the vault. Watching an arbitrary worktree recursively (node_modules, build output) is the expensive option, and a vault-scoped count is what the pane's vault events can keep fresh. `git status -- .` with cwd already set to the vault base path does exactly this, and porcelain v1 paths stay repository-root-relative, so `openFile` is unaffected. For a vault at the repository root, `.` is the whole worktree and nothing changes.

**Files:**
- Modify: `src/git/GitRepository.ts:96-103` (`status`, `statusFiles`)
- Modify: `README.md` (the "Show working tree changes" setting row and the usage paragraph)
- Test: `tests/git/GitRepository.test.ts` (inside `describe('status', ...)`)

- [ ] **Step 1: Write the failing test**

Add at the end of `describe('status', ...)`:

```ts
	it('counts and lists only the files under cwd when cwd is a subdirectory of the repository', async () => {
		const tmp = createFixtureRepo();
		try {
			mkdirSync(join(tmp.dir, 'sub'));
			writeFileSync(join(tmp.dir, 'sub', 'inside.md'), 'inside\n');
			writeFileSync(join(tmp.dir, 'outside.md'), 'outside\n');
			const subRepo = new GitRepository({ gitPath: 'git', cwd: join(tmp.dir, 'sub') });
			expect(await subRepo.status()).toEqual({ changed: 1 });
			expect(await subRepo.statusFiles()).toEqual([{ path: 'sub/inside.md', status: 'A' }]);
		} finally {
			tmp.dispose();
		}
	});
```

(`'A'` is how `parseStatus` reports an untracked file — see the existing `x.txt` expectation in the same describe.)

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/git/GitRepository.test.ts -t "subdirectory of the repository"
```

Expected: FAIL — `changed` is 2 and `outside.md` is listed.

- [ ] **Step 3: Implement**

```ts
	/**
	 * Both status reads are scoped to `cwd` (the vault) with a `.` pathspec: for a vault nested
	 * inside a larger repository, the plugin only sees vault file events, so counting sibling
	 * paths would leave the row stale. For a vault at the repository root `.` is everything.
	 */
	async status(): Promise<{ changed: number }> {
		const out = await this.run(['status', '--porcelain=v1', '--untracked-files=all', '--', '.']);
		return { changed: countStatus(out) };
	}

	async statusFiles(): Promise<ChangedFile[]> {
		return parseStatus(await this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']));
	}
```

- [ ] **Step 4: README**

In the Settings table change the "Show working tree changes" meaning cell to:

```markdown
| Show working tree changes | on | Row above the newest commit with the uncommitted change count for files inside the vault; click it for the file list. |
```

In the Usage paragraph, after *"Working-tree edits (unstaged/staged file changes) refresh the changes row within about half a second while the pane is open"*, add the sentence: `When the vault is a folder inside a larger repository, the row counts only files under the vault.`

- [ ] **Step 5: Run tests and gates**

```bash
npx vitest run tests/git tests/plugin
npm run check
```

- [ ] **Step 6: CHANGELOG and commit**

Append under `### Fixed`:

```markdown
- For a vault that is a folder inside a larger repository, the changes row now counts and lists only files under the vault, so it no longer goes stale on edits the pane cannot see.
```

```bash
git add src/git/GitRepository.ts tests/git/GitRepository.test.ts README.md CHANGELOG.md
git commit -m "fix(git): scope the working tree status to the vault folder"
```

---

### Task 5: Show the changes row before the first commit (PR #1, `src/view/GraphRoot.vue:124`)

Review thread (Codex, P2): *"When an initialized repository has no commits but contains untracked or staged files, `load()` returns zero rows while successfully setting `dirtyCount`; this branch nevertheless renders only 'No commits yet,' so the `CommitList` and its changes row are never mounted. Account for a non-null dirty row here so users can inspect working-tree changes before creating the initial commit."*

**Files:**
- Modify: `src/view/GraphRoot.vue:122-128` (the "No commits yet." branch)
- Modify: `harness/fixtures.ts` (`empty` fixture gets a sibling `empty-dirty` scenario)
- Test: `tests/view/GraphRoot.test.ts`

- [ ] **Step 1: Write the failing test**

Add after `it('shows the dirty row when there are changes and hides it when the setting is off', ...)`:

```ts
	it('shows the changes row, not "No commits yet.", for a repository with changes but no commits', async () => {
		const reader = new FakeReader();
		reader.commits = [];
		reader.refsSnapshot = { refs: [], headHash: null, headBranch: 'main' };
		reader.changed = 2;
		reader.dirtyFiles = [{ path: 'first.md', status: 'A' }];
		const w = mountRoot({ kind: 'ready', root: 'C:/vault', reader });
		await flushPromises();
		expect(w.text()).not.toContain('No commits yet');
		expect(w.get('.git-graph-row-dirty').text()).toContain('2 changes');
		await w.get('.git-graph-row-dirty').trigger('click');
		await flushPromises();
		expect(w.text()).toContain('first.md');
	});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/view/GraphRoot.test.ts -t "no commits"
```

Expected: FAIL — the text contains `No commits yet` and `.git-graph-row-dirty` is not found.

- [ ] **Step 3: Implement**

Change the empty-state condition so a non-null `dirty` mounts the list:

```vue
      <!-- An error banner (load or status) replaces the empty message; Retry brings it back.
           A repository with changes but no commits yet still mounts the list for its changes row. -->
      <div
        v-else-if="!store.state.loading && store.state.rows.length === 0 && dirty === null && store.state.error === null && store.state.statusError === null"
        class="git-graph-empty"
      >
        No commits yet.
      </div>
```

- [ ] **Step 4: Harness scenario**

In `harness/fixtures.ts`, add next to `dirty` in `FIXTURES`:

```ts
	'empty-dirty': () => ({ ...empty(), changed: 2, dirtyFiles: DIRTY_FILES.slice(0, 2) }),
```

and to `SCENARIOS`, after the `empty` entry:

```ts
	{ name: 'empty-dirty', description: 'No commits yet, but two uncommitted files: only the changes row shows.' },
```

Then confirm it renders in the harness (`npm run harness:install` once if Chromium is missing):

```bash
npx playwright test -g "dirty"
```

Expected: the existing dirty tests still pass. Add one Playwright test in `harness/harness.spec.ts` next to `'dirty adds a working tree row above the commits'`, following that test's `open(page, ...)` helper style:

```ts
test('empty-dirty shows the changes row and no commit rows', async ({ page }) => {
	await open(page, 'empty-dirty');
	await expect(page.locator('.git-graph-row-dirty')).toHaveCount(1);
	await expect(page.locator('.git-graph-row:not(.git-graph-row-dirty)')).toHaveCount(0);
	await expect(page.locator('.git-graph-empty')).toHaveCount(0);
});
```

(Read the top of `harness.spec.ts` first and reuse whatever the file's navigation helper is actually called; if there is none, use `page.goto('/?scenario=empty-dirty')` followed by `await page.evaluate(() => window.__harness.ready)` like the other tests.)

- [ ] **Step 5: Run tests and gates**

```bash
npx vitest run tests/view/GraphRoot.test.ts
npx playwright test
npm run check
```

- [ ] **Step 6: CHANGELOG and commit**

Append under `### Fixed`:

```markdown
- A repository with uncommitted files but no commits yet shows the changes row instead of only "No commits yet".
```

```bash
git add src/view/GraphRoot.vue tests/view/GraphRoot.test.ts harness/fixtures.ts harness/harness.spec.ts CHANGELOG.md
git commit -m "fix(view): mount the changes row for a repository with no commits yet"
```

---

### Task 6: Distinct off-bottom lanes for a page-ending merge (PR #2, `src/graph/layout.ts:138`)

Review thread (Codex, P2): *"When a page ends on a merge whose distinct parents are all outside the loaded window, each `followChain` call reaches this fallback with `lastX` equal to the already-placed commit lane, so every parent emits the same `out` segment. The paths therefore overlap completely, and they also produce duplicate Vue keys because `LaneCell.vue:48` keys segments only by kind and lanes; an octopus merge at a page boundary appears to have only one parent line until another page loads. Assign each external path a distinct off-bottom target column."*

Mechanism: a line that crosses at least one row below its start gets a unique column on the last row through `registerPoint` (see the existing test `'runs a line off the bottom for a parent outside the loaded commits'`, where the second parent leaves at lane 1). Only a path that starts on the last row and never crosses another row reuses `v.x` for every parent. Fix: keep a per-graph set of off-bottom columns already taken; the first line to leave at a column keeps it (straight down), any later line asks the last row's allocator (`nextX`) for the next free column.

**Files:**
- Modify: `src/graph/layout.ts` (`Graph` interface, `tracePaths`, `followChain`)
- Modify: `src/view/LaneCell.vue:48` (key gains the color, cheap insurance)
- Test: `tests/graph/layout.test.ts`

- [ ] **Step 1: Write the failing tests**

Add after `it('runs a line off the bottom for a parent outside the loaded commits', ...)`:

```ts
	it('fans out the parents of a merge that ends the page, one off-bottom column each', () => {
		const [row] = layoutGraph([c('M', 'A', 'B')]);
		expect(row?.segments).toEqual([seg('out', 0, 0, 0), seg('out', 0, 1, 1)]);
		expect(row?.laneCount).toBe(2);
		const [octopus] = layoutGraph([c('O', 'A', 'B', 'C')]);
		expect(octopus?.segments).toEqual([seg('out', 0, 0, 0), seg('out', 0, 1, 1), seg('out', 0, 2, 2)]);
		expect(octopus?.laneCount).toBe(3);
	});

	it('keeps a page-ending merge from colliding with a line already passing its row', () => {
		// X's line to R passes M's row in lane 1; M's own off-page parents take lanes 0 and 2.
		const rows = layoutGraph([c('X', 'R'), c('M', 'P', 'Q')]);
		expect(rows[1]?.segments).toEqual([seg('in', 0, 0, 0), seg('pass', 0, 0, 0), seg('out', 1, 1, 1), seg('out', 1, 2, 2)]);
	});
```

Also extend the histories in `'never emits two segments with the same kind and lanes in one row ...'` with:

```ts
			[c('M', 'A', 'B')],
			[c('O', 'A', 'B', 'C')],
			[c('X', 'R'), c('M', 'P', 'Q')],
```

Run the second new test first as written, and if the `pass`/`in` expectation for row 1 does not match what the algorithm legitimately produces for the *unchanged* first line (X→R), adjust only that part of the expectation to the observed `in`/`pass` segment; the assertion that matters is the two distinct `out` lanes for M.

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/graph/layout.test.ts
```

Expected: the two new tests fail (both `out` segments read `0→0`), and the duplicate-key test fails on the new histories.

- [ ] **Step 3: Implement**

In `layout.ts`:

```ts
interface Graph {
	vertices: Vertex[];
	lines: Line[];
	branchColors: number[];
	/** Per color: the last row a path of that color touched, or Infinity while one is still running. */
	colorEnds: number[];
	/** Columns already carrying a line off the bottom of the last row. */
	bottomColumns: Set<number>;
}
```

In `tracePaths`, initialise it: `const g: Graph = { vertices: buildVertices(commits), lines: [], branchColors: [], colorEnds: [], bottomColumns: new Set() };`

Replace the fallback at the end of `followChain`:

```ts
	// The parent is outside the loaded commits (or, with a malformed order, above its child):
	// the line runs off the bottom of the last row, and the parent counts as handled. A line that
	// crossed rows below its start already owns a unique column there; one that starts on the
	// last row would otherwise leave at the commit's own column for every parent, so each after
	// the first takes the next free column instead.
	if (parent !== null) {
		v.nextParent++;
		const x2 = offBottomColumn(g, lastX);
		g.lines.push({ row: g.vertices.length - 1, x1: lastX, x2, color });
	}
	g.colorEnds[color] = end;
}

function offBottomColumn(g: Graph, preferred: number): number {
	const last = g.vertices[g.vertices.length - 1] as Vertex;
	let x = preferred;
	if (g.bottomColumns.has(x)) {
		x = last.nextX;
		last.nextX = x + 1;
	}
	g.bottomColumns.add(x);
	return x;
}
```

Note `lastX` in the merge-on-last-row case equals `v.x`; the first parent keeps it (straight down), the second finds it taken and receives `last.nextX`. `registerPoint` on the last row already bumped `nextX` past every column a passing line took, so the new column never collides with one of those either. Lines that pass through the last row and continue off-bottom reach `offBottomColumn` with a `lastX` that is unique on that row; they register it and keep it.

In `LaneCell.vue`, make the key `:key="`${s.kind}:${s.fromLane}:${s.toLane}:${s.color}`"` and update the test name in `layout.test.ts` to `'... (LaneCell keys on kind, lanes and color)'` with the key string in that test extended to include `s.color` as well.

- [ ] **Step 4: Run tests and gates**

```bash
npx vitest run tests/graph tests/view/LaneCell.test.ts
npm run check
```

Expected: every layout test green, including `'lays out the feature branch the way VS Code Git Graph does'` (the change touches only lines that leave the last row).

- [ ] **Step 5: Screenshot sanity**

```bash
npm run harness:build && npm run screenshot
```

Open `screenshots/octopus-light.png` and `screenshots/merge-light.png` and confirm the graphs look unchanged (their merges are not on the last row). Do not commit the screenshots unless the repository already tracks them (`git status` will show).

- [ ] **Step 6: CHANGELOG and commit**

Append under `### Fixed`:

```markdown
- When a page of commits ends on a merge whose parents are all on the next page, each parent now gets its own line off the bottom of the graph instead of all of them overlapping in one.
```

```bash
git add src/graph/layout.ts src/view/LaneCell.vue tests/graph/layout.test.ts CHANGELOG.md
git commit -m "fix(layout): give each off-page parent of a page-ending merge its own lane"
```

---

### Task 7: Clear the marketplace source-scan warnings in the harness

Marketplace scan output:

- *Use 'window.setTimeout()' instead of 'setTimeout()' for popout window compatibility.* — `harness/fixtures.ts:347` (the `delay` helper, line 382 on `main`)
- *Uses `document.createElement` instead of Obsidian's `createEl` helpers* (obsidianmd/prefer-create-el) — `harness/main.ts:124`
- *Use 'window.requestAnimationFrame()' instead of 'requestAnimationFrame()' for popout window compatibility.* — `harness/main.ts:151`

The harness is not plugin code (it runs in Vite, never in Obsidian), but the scan reads the whole repository and there is no cost to writing it the way the scan wants. Turn the two rules on for `harness/**` in eslint so the scan cannot regress.

**Files:**
- Modify: `harness/fixtures.ts:382` (`delay`)
- Modify: `harness/main.ts:120-130` (`fillSelect`), `:151` (`nextFrame`)
- Modify: `eslint.config.mjs` (a new entry for `harness/**/*.ts`)

- [ ] **Step 1: Turn the rules on first, so eslint fails**

Add to `eslint.config.mjs`, directly after the `files: TESTS` entry (before the root-config entry):

```js
	{
		// The harness never runs inside Obsidian, but the community-plugin scan reads every
		// file in the repository and reports these two rules on it, so it follows them.
		files: ['harness/**/*.ts'],
		plugins: { obsidianmd },
		rules: {
			'obsidianmd/prefer-window-timers': 'error',
			'obsidianmd/prefer-create-el': 'error',
		},
	},
```

Run:

```bash
npm run lint:eslint
```

Expected: FAIL with exactly the three findings above (fixtures.ts `setTimeout`, main.ts `document.createElement`, main.ts `requestAnimationFrame`). If `prefer-create-el` also flags `document.createElementNS` in `harness/obsidian-stub.ts:30`, that file builds a Lucide SVG where no Obsidian helper exists — add a one-line `// eslint-disable-next-line obsidianmd/prefer-create-el -- SVG namespace element; no Obsidian helper builds one` above it rather than rewriting it.

- [ ] **Step 2: Fix the three sites**

`harness/fixtures.ts`:

```ts
const delay = (ms: number): Promise<void> => (ms <= 0 ? Promise.resolve() : new Promise((resolve) => window.setTimeout(resolve, ms)));
```

`harness/main.ts` — `fillSelect` builds options with the DOM's own `Option` constructor, which the rule does not flag and which needs no Obsidian helper:

```ts
	select.replaceChildren(...options.map((option) => new Option(option.label, option.value)));
```

and

```ts
const nextFrame = (): Promise<void> => new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
```

- [ ] **Step 3: Run the gates and the harness smoke tests**

```bash
npm run lint
npx playwright test
npm run check
```

Expected: green. The toolbar `<select>` elements still list every scenario (the Playwright tests navigate by URL, so also load `http://localhost:5174/?scenario=merge` once via `npm run harness` and confirm the scenario dropdown is populated — or rely on `scripts/screenshot.mjs` having run in Task 6, which drives the same page).

- [ ] **Step 4: Commit**

No CHANGELOG line: nothing shipped to a vault changes.

```bash
git add harness/fixtures.ts harness/main.ts eslint.config.mjs
git commit -m "chore(harness): satisfy the obsidianmd window-timer and create-el rules"
```

---

### Task 8: Disclose fs and child_process use per Obsidian's developer policies

Marketplace scan output (Behavior):

- *Direct Filesystem Access: Uses the Node.js `fs` module to access the filesystem outside of the Obsidian vault API. Can read and write any file on the system.*
- *Shell Execution: Executes shell commands via `child_process`. Gives the plugin full control over the system.*

Both are inherent to what the plugin does (`src/watch/gitWatcher.ts` watches the `.git` directory with `fs.watch`; `src/git/runGit.ts` runs the git executable with `execFile`; `src/util/paths.ts` canonicalises paths with `realpathSync`). Obsidian's developer policies require a plugin to disclose in its README when it accesses files outside the vault or executes external binaries, so the fix is a README section that states exactly what is touched and that nothing is written. The manifest already sets `isDesktopOnly: true`.

Also fold in the Obsidian plugin-guideline sweep done while planning (all already satisfied, listed so the executor does not re-audit): `this.app` only, `registerEvent` for every vault event, `window.*` timers, `registerView` + `getLeavesOfType` without cached leaf references, no `detach` in `onunload`, `getFileByPath` instead of iterating files, declarative settings tab without headings, sentence-case copy, no `innerHTML`, no inline styles, `console.error` only.

**Files:**
- Modify: `README.md` (new section after "Requirements")
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the disclosure section**

Insert after the "Requirements" list in `README.md`:

```markdown
## What the plugin touches

Obsidian's community-plugin review flags any plugin that uses Node's `fs` module or runs
external programs. This one does both, for exactly these purposes, and nothing else:

- **Runs the `git` executable** (the one from the *Git executable* setting) with
  `child_process.execFile` — never through a shell — to read the repository: `rev-parse`,
  `log`, `for-each-ref`, `status`, `show`, `symbolic-ref`. No command writes to the
  repository or the working tree; the plugin has no commit, checkout, fetch or push.
- **Reads the repository's `.git` directory** with `fs.watch` so the pane refreshes when a
  commit, branch or checkout happens. For a vault that is a folder inside a larger
  repository, that directory sits outside the vault. The plugin never writes there.
- **Resolves real paths** (`fs.realpathSync`) of the vault folder and the repository root so
  a vault opened through a symlink or junction matches the paths git reports.

Files are opened in the editor through Obsidian's vault API only. The plugin makes no
network requests and collects no telemetry.
```

- [ ] **Step 2: Check the README renders and the copy is sentence case**

```bash
npx vitest run tests/release
```

Expected: green (the README is not under test; this just proves nothing else moved). Re-read the section once for a stray Title Case heading — "What the plugin touches" is sentence case.

- [ ] **Step 3: CHANGELOG and commit**

Append a new group under `## [Unreleased]`, after `### Fixed`:

```markdown
### Changed
- The README now spells out which git commands the plugin runs and which files outside the vault it reads, for the community-plugin review.
```

```bash
git add README.md CHANGELOG.md
git commit -m "docs(readme): disclose git execution and .git directory access"
```

---

## Self-review notes

- **Coverage:** Six review threads → Tasks 1-6, one each. Three scan warnings → Task 7. Two scan behaviour warnings → Task 8. Guideline sweep → folded into Task 8's description (nothing left to change in code).
- **Types:** `defaultRemoteRef(): Promise<string | null>` (Task 2) is private and used only inside `refSelection`. `bottomColumns: Set<number>` and `offBottomColumn(g, preferred): number` (Task 6) are module-private in `layout.ts`. `FakeReader.dirtyFiles: ChangedFile[]` (Task 5) already exists in `tests/helpers/fakeReader.ts`.
- **Complexity caps:** Task 2 moves the symbolic-ref handling out of `refSelection`, keeping its complexity flat. Task 6 adds one helper rather than branching inside `followChain`. Task 3's condition adds one `||`, well under the cap.
- **Not in scope:** replying on the GitHub threads, bumping the version, releasing, and the live-vault sweep in Obsidian (RELEASING.md step 2) — all are the owner's calls after the branch is reviewed.
