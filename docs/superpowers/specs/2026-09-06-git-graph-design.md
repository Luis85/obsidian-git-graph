# Git Graph — design

Date: 2026-09-06. Status: approved for planning.

An Obsidian plugin that brings VS Code's Source Control **graph** to a side pane. When the
vault is inside a git repository, the pane shows the commit graph as VS Code draws it:
colored lanes, commit subjects, authors, dates, branch/tag/remote badges, the HEAD marker
and a dirty-working-tree row. Read-only in this version.

## Decisions

| Question | Decision |
|---|---|
| Scope | Graph section only. No changes list, staging, commit, fetch/pull/push. |
| Git backend | System `git` binary via `child_process`. `isDesktopOnly: true`. |
| Commit click | Row expands inline to full details and changed-file list. Files are not clickable. |
| Refresh | `fs.watch` on `.git` metadata, debounced, plus a manual refresh button and command. |
| History depth | Paged, 200 commits per page, next page loads when scrolled to the bottom. |
| Ref filter | `Auto` (HEAD, its upstream, default remote branch) by default; `All` via header dropdown. Persisted. |
| UI stack | Vue 3 + Vite + TypeScript, vitest, matching renovation-planner's toolchain. |
| Graph layout | Own lane layout computed from `git log --topo-order` output, rendered as per-row inline SVG. |
| minAppVersion | 1.13.0 |

Superseded by user request (2026-09-06): changed files are clickable and open in the editor;
the changes row expands to list working-tree files (`statusFiles()`).

Rejected: parsing `git log --graph` ASCII (terminal look, unstable across page boundaries);
a graph library such as `@gitgraph/js` (no virtualization or incremental append);
isomorphic-git (mobile reach at the cost of fidelity and bundle size; may return as a
later backend behind the same `GitRepository` interface).

## Identity

- Plugin id `git-graph`, name `Git Graph`, view type `git-graph`.
- Ribbon icon and command `Git Graph: Open` reveal the leaf in the right sidebar.
- Command `Git Graph: Refresh` forces a reload.

## Architecture

Layers, each importable without the ones above it:

```
src/main.ts          plugin entry: repo detection, registrations, watcher lifecycle
src/settings/        settings tab, defaults, types
src/view/            Obsidian ItemView + Vue app
src/watch/           .git watcher
src/graph/           pure lane layout (no I/O, no DOM)
src/git/             git process adapter (no lanes, no Vue)
```

### `src/git/` — git adapter

`GitRepository` is constructed with `{ gitPath, cwd }` and exposes:

- `resolveRepoRoot(): Promise<string | null>` runs `git rev-parse --show-toplevel`. `null`
  when the vault is not inside a repository. The vault may be the repo or a subdirectory.
- `log({ skip, count, refs }): Promise<Commit[]>` is one process per page:
  ```
  git log --topo-order --date=iso-strict -z
    --format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s
    --skip=<skip> --max-count=<count> <ref selection>
  ```
  `refs` is `'auto' | 'all'`. Auto expands to `HEAD`, `@{upstream}` if it exists, and the
  default remote branch (target of `refs/remotes/origin/HEAD`, if it exists). All is `--all`.
- `refs(): Promise<Ref[]>` runs
  `git for-each-ref --format=%(objectname)%x1f%(refname)%x1f%(upstream:short)%x1f%(HEAD)`
  plus `git symbolic-ref --short HEAD` (detached gives null). Produces
  `{ hash, name, kind: 'branch' | 'remote' | 'tag', isHead, upstream? }`.
- `commitDetails(hash): Promise<CommitDetails>` runs
  `git show --no-patch --format=%H%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%cI%x1f%B <hash>`
  then `git diff-tree --no-commit-id -r --name-status -z -M <hash>` for files with status
  `A | M | D | R | C | T`. For a root commit, `diff-tree` is run with `--root`.
- `status(): Promise<{ changed: number }>` runs `git status --porcelain=v1 -z` and counts
  entries. Drives the dirty-tree row.

All calls go through `runGit(args, { timeoutMs: 15000, maxBuffer: 64 MiB })` using
`execFile`. Failures throw `GitError { code, stderr, args }`. A missing binary is
`GitError` with `code: 'ENOENT'`.

Types:

```ts
interface Commit { hash: string; parents: string[]; author: string; email: string; date: string; subject: string }
interface Ref { hash: string; name: string; kind: 'branch' | 'remote' | 'tag'; isHead: boolean; upstream?: string }
interface CommitDetails {
  hash: string; author: string; email: string; authorDate: string;
  committer: string; commitDate: string; body: string;
  files: { path: string; status: FileStatus; oldPath?: string }[];
}
```

### `src/graph/` — layout

```ts
interface Lane { waitingFor: string; color: number }
interface Segment { fromLane: number; toLane: number; color: number; kind: 'pass' | 'in' | 'out' }
interface Row { hash: string; lane: number; color: number; isMerge: boolean; segments: Segment[]; laneCount: number }
function layoutGraph(commits: Commit[], carry: Lane[]): { rows: Row[]; carry: Lane[] }
```

Algorithm, per commit in input order:

1. Find the lane whose `waitingFor` equals the commit hash. If none, open a new lane at the
   right end with the next color (cycling through 8). This is the commit's lane.
2. Every *other* lane waiting for this hash closes: emit an `in` segment from that lane to
   the commit's lane, and remove it.
3. First parent: the commit's lane now waits for it. If another lane already waits for the
   same parent, the commit's lane instead merges into that lane on the next row: emit an
   `out` segment to it and close the commit's lane.
4. Each further parent: if a lane already waits for it, emit an `out` segment to that lane;
   otherwise open a new lane immediately right of the commit's lane waiting for it, and
   emit an `out` segment to it.
5. Every lane untouched by steps 1 to 4 emits a `pass` segment in its own column.
6. `laneCount` is the maximum column index touched by the row plus one.

Lanes are removed only after the row is emitted so the row still shows the incoming curve.
The returned `carry` is the lane array after the last row; the next page passes it back so
lanes continue across page boundaries. Colors are indexes 0 to 7; the view maps them to
CSS variables.

Unit test cases: linear history; single merge; octopus merge; two independent roots;
branch closing and its column being reused; page boundary with open lanes; commit whose
parent is outside the loaded window (lane stays open in carry).

### `src/watch/` — watcher

`createGitWatcher(gitDir, onChange, { debounceMs: 500 })` watches `HEAD`, `packed-refs`,
`refs/` (recursive where supported, else the `heads`, `remotes`, `tags` subdirectories),
`logs/HEAD` and `index`. Any event schedules one `onChange` after the debounce. Returns
`{ pause(), resume(), dispose() }`. If `fs.watch` throws, the watcher reports it once and the
view falls back to manual refresh. For a worktree or submodule, `gitDir` is resolved with
`git rev-parse --git-dir` so the `.git` file case is handled.

### `src/view/` — view and rendering

`GitGraphView extends ItemView` mounts one Vue app on open and unmounts on close. The Vue
tree:

- `GraphRoot.vue` owns the store (below) and decides between empty, error and graph states.
- `GraphHeader.vue` shows repo name, ref-filter dropdown (Auto/All), refresh button, and a
  filter input (substring match on subject, author, hash over loaded rows).
- `CommitList.vue` is the virtualized list. Row height 22px; an expanded row adds its
  details height. A bottom sentinel triggers `loadMore`.
- `CommitRow.vue` is a grid: `LaneCell`, subject, `RefBadge`s, author, date.
- `LaneCell.vue` is inline SVG, width `laneCount × 16`, height 22. Draws `pass` as a
  vertical line, `in`/`out` as cubic curves, and the commit node as a circle: filled for a
  normal commit, hollow for a merge, ring-highlighted for HEAD.
- `RefBadge.vue` is a pill with icon: branch, cloud (remote), tag. HEAD badge highlighted,
  upstream badge in accent color.
- `CommitDetails.vue` shows full hash with copy button, author, absolute dates, full
  message, changed files with status letter. Files are not clickable.
  (Superseded by user request (2026-09-06): changed files are clickable and open in the
  editor; the changes row expands to list working-tree files (`statusFiles()`).)
- `DirtyRow.vue` is the synthetic first row "N changes" with a dashed connector into HEAD's
  lane, shown when `status().changed > 0` and the setting is on.

Colors are Obsidian CSS variables. Lane colors are `--git-graph-lane-0` to `-7` with
defaults in `styles.css`.

### State and refresh

One reactive store in `GraphRoot`:

```
repoRoot, refFilter, commits[], rows[], carry, refs[], headHash, dirtyCount,
pageCount, hasMore, loading, error, expandedHash, expandedDetails, filterText
```

- **Initial load**: `refs()`, `status()` and `log(page 0)` in parallel, then layout, then
  render.
- **Load more**: on sentinel, `log(next page)` with `carry`, append rows.
- **Reload** (watcher event, refresh click, command, ref-filter change): re-run the initial
  load, then re-fetch pages up to the previous page count, preserve scroll offset and
  `expandedHash` if the hash is still present.
- **Generation counter**: each load increments it; responses carrying a stale generation
  are dropped.
- Watcher is paused while the view is closed and resumed on open.

### `src/settings/`

| Setting | Default | Effect |
|---|---|---|
| `gitPath` | `git` | Executable used by `runGit`. |
| `refFilter` | `auto` | Header dropdown value; the dropdown writes back here. |
| `pageSize` | 200 | Commits per `log` page. |
| `showDirtyRow` | true | Show the synthetic changes row. |
| `dateFormat` | `relative` | `relative` ("3 days ago") or `absolute` (ISO date). |

Saved through `saveData`; every change triggers a reload so it applies immediately.

### Errors

| Situation | Behavior |
|---|---|
| Not a repository | Empty state: "This vault is not a git repository." No watcher. |
| Git not found (`ENOENT`) | Empty state naming the git path setting. |
| Git command failure or timeout | Banner with the stderr text and a Retry button; last good rows stay. |
| Watcher creation fails | One `Notice`; manual refresh still works. |
| View disposed mid-load | Response dropped via generation counter. |

Nothing throws out of the view; `main.ts` catches setup failures and logs them.

## Testing

- `tests/graph/`: layout unit tests (pure, no git).
- `tests/git/`: adapter tests against a fixture repository the test builds in a temp
  directory with real `git` (init, commits, branch, merge, tag, remote-tracking ref).
  Skipped with a clear message if `git` is absent.
- `tests/watch/`: watcher with a temp directory and fake timers.
- `tests/view/`: Vue components under jsdom with `@vue/test-utils`: badge rendering, row
  expansion, empty and error states, lane SVG segment paths.
- Gates: `vue-tsc -noEmit`, `oxlint` + `eslint` with `eslint-plugin-obsidianmd`, `vitest run`.

## Tooling

Mirrors renovation-planner: Vite library build to `dist/main.js` (CJS, externals
`obsidian`, `electron`, codemirror packages, node builtins), `styles.css` copied to
`dist/`, `scripts/test-build.mjs` installing into `.obsidian/plugins/git-graph/` with this
repository as the vault and adding the id to `community-plugins.json`. `.obsidian/` and
`dist/` are gitignored. `manifest.json`, `versions.json`, and `package.json` scripts
`dev`, `build`, `test-build`, `test`, `lint`, `check`.

## Out of scope for this version

Changes list, staging, committing, fetch/pull/push, checkout or any write operation,
opening diffs, mobile support, submodule graphs, stashes, reflog.
