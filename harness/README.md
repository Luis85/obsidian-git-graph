# Browser harness

A standalone Vite app that mounts the plugin's real view tree — `src/view/GraphRoot.vue`, the
whole component tree under it, and the real stylesheet — in a normal browser, against
in-memory fixture repositories. It exists so an agent (or a human) can look at the pane, drive
it, and screenshot it **without installing the plugin into Obsidian**.

Nothing under `src/` knows the harness exists. The only substitution is the `obsidian` module:
`src/view/Icon.vue` imports `setIcon` from it, and `vite.harness.config.ts` aliases `obsidian`
to `harness/obsidian-stub.ts`, which renders the same Lucide icons Obsidian would.

## Run it

```bash
npm run harness            # dev server on http://localhost:5174 (strict port)
npm run harness:build      # production build into harness-dist/ (gitignored)
npm run harness:install    # once per machine: downloads the Chromium build Playwright drives
npm run screenshot         # PNG per scenario x theme into screenshots/ (gitignored)
npm run test:e2e           # Playwright smoke tests (starts the dev server itself)
```

`npm run check` does **not** run `test:e2e` or `screenshot`: both need a ~200 MB Chromium
download. Run `harness:install` once, then `npm run test:e2e` before merging any change to
`src/view/**` or `styles/**`.

## URL parameters

Everything is driven by the query string, so a screenshot or a test is one URL.

| Parameter | Values | Default | Effect |
|---|---|---|---|
| `scenario` | see the table below | `merge` | Which fixture repository to mount. |
| `theme` | `light`, `dark` | `light` | Adds `theme-dark` to `<body>`, like Obsidian's dark theme. |
| `refs` | `auto`, `all` | `auto` | `settings.refFilter` — what the header dropdown shows and what the store passes to `log()`. |
| `filter` | any text | none | Types the text into the commit filter box once the first load settles. |
| `expand` | hash prefix or subject text | none | Opens that commit's details once the first load settles. The row has to be rendered (they are virtualized, so pick one near the top). An `expand` that matches no commit, or matches one whose row isn't rendered, rejects `ready` instead of silently rendering a plausible page. |
| `file` | a file path | none | Sets `activeFile` and clicks the history toggle once the first load settles, so the pane shows only the commits that touched that path. Rejects `ready` if `.git-graph-history-toggle` never renders `.git-graph-history-file` (same fail-loudly rule as `expand`). |
| `dateFormat` | `relative`, `absolute` | `relative` | `settings.dateFormat`. Use `absolute` when you want a stable date column. |
| `dirtyRow` | `0`, `1` | `1` | `settings.showDirtyRow`. |
| `pageSize` | number ≥ 10 | `200` | `settings.pageSize`; lower it to make paging happen sooner. |
| `width` | pixels | `420` | Width of the pane frame — the default is roughly an Obsidian side pane. |
| `height` | pixels | `700` | Height of the pane frame. The list scrolls inside it, so virtualization is real. |

Examples:

```
http://localhost:5174/?scenario=branches&theme=dark
http://localhost:5174/?scenario=merge&expand=Initial+commit&dateFormat=absolute
http://localhost:5174/?scenario=long&pageSize=25&height=400
http://localhost:5174/?scenario=dirty&filter=Fix
http://localhost:5174/?scenario=merge&file=README.md
```

## Scenarios

| Name | What it shows |
|---|---|
| `linear` | 12 commits on `main`, with an upstream remote branch and a tag. |
| `merge` | A feature branch merged back into `main` — 8 commits, two lanes. |
| `octopus` | A three-parent octopus merge. |
| `branches` | Four open lanes, remotes and tags, with HEAD below the first row. |
| `stacked` | Nested feature merges: the left lane stays with the tip, side lanes slide in as lines end. |
| `page-end-merge` | The page ends on a three-parent merge whose parents are not loaded: three lines leave the bottom. |
| `long` | 600 commits, so scrolling to the bottom pages in more (`log` honours skip/count). |
| `dirty` | The `merge` history plus three uncommitted working tree changes (one of them deleted); the changes row expands into their file list. |
| `empty` | A repository with no commits yet. |
| `empty-dirty` | No commits yet, but two uncommitted files: only the changes row shows. |
| `error` | The first load succeeds, every later one fails: the error banner over kept rows. |
| `slow` | Commit details take 1.5 s to resolve, for the details loading state. |
| `none` | `RepoState { kind: 'none' }` — the vault is not inside a git repository. |
| `no-git` | `RepoState { kind: 'no-git' }` — git was not found at the configured path. |
| `unresolved` | `RepoState { kind: 'unresolved' }` — the repository has not been located yet. |

The fixtures are deterministic: hashes, dates, authors and file lists are pure functions of the
fixture id, with no `Date.now()` and no randomness. Two runs produce the same pixels — except
for the relative date column, which `src/view/dates.ts` renders against the wall clock; pass
`dateFormat=absolute` when that matters.

## `window.__harness`

```ts
window.__harness = {
  scenarios,          // [{ name, description, state?, refreshAfterLoad? }, ...]
  params,             // the query string as a plain object
  ready,              // Promise<void>, resolves once the first load has settled
  opened,             // string[] — paths passed to GraphRoot's openFile emit, in click order
  emitChange(),       // fires the `changes` emitter — the plugin's "files changed" signal
  emitStatusChange(), // fires the `statusChanges` emitter — the plugin's debounced vault-edit signal
  setFilter(text),    // types into the commit filter box
  setActiveFile(path),// sets (or clears, with null) the active file GraphRoot receives; does not click the toggle itself
};
```

Clicking (or pressing Enter/Space on) a changed file in the expanded commit's file list stands in
for `GitGraphPlugin.openFile`: there is no real vault to open a file in, so `harness/main.ts`'s
`onOpenFile` handler just pushes the path onto `window.__harness.opened` and shows
"Would open &lt;path&gt;" in the `.harness-toast` strip under the toolbar. The strip is hidden
while empty and clears on the next `changes`/`statusChanges` emit (the Emit change button,
`emitChange()`, `emitStatusChange()`) or toolbar navigation.

`ready` is the thing to wait on. It resolves after the view reaches a terminal state (rows
rendered, or an empty/error state shown), after any `filter=`/`expand=`/`file=` parameter has
been applied, and after two animation frames so Vue has flushed. It **rejects** (after 15 s) if
the view never settles, and it also rejects immediately if `expand=` names no commit in the
scenario or a commit whose row isn't rendered, or if `file=` is set but the history toggle
never renders `.git-graph-history-file` — so a broken harness fails loudly instead of
screenshotting a blank or merely plausible frame. Never `waitForTimeout`; do this:

```js
await page.goto('http://localhost:5174/?scenario=branches&theme=dark');
await page.evaluate(() => window.__harness.ready);
```

## Screenshots

```bash
node scripts/screenshot.mjs [--scenario=name|all] [--theme=light|dark|both] \
                            [--out=screenshots] [--url=http://host:port] \
                            [--width=420] [--height=700]
```

Defaults to every scenario in both themes. Without `--url` it reuses a harness already
listening on port 5174 (`npm run harness`), and otherwise starts one itself and shuts it down
afterwards. Each image is the pane frame (`#app`) only, written to
`<out>/<scenario>-<theme>.png`; the paths and byte sizes are printed. Pass `--url` to shoot
some other server, for example a `harness:build` preview.

## Adding a scenario

1. In `harness/fixtures.ts`, add a builder that returns a `Fixture` — commits are written
   newest-first as `{ id, subject, parents }` specs and ids are resolved to stable fake hashes,
   so you never type a sha.
2. Register it in the `FIXTURES` map and add a one-line entry to `SCENARIOS` (the toolbar, the
   screenshot script and `window.__harness.scenarios` all read that array).
3. For a non-repository state, set `state: 'none' | 'no-git' | 'unresolved'` on the `SCENARIOS`
   entry instead and skip the fixture — `harness/main.ts` maps those straight to a `RepoState`.
4. Add a case to `harness/harness.spec.ts` if the scenario is meant to pin a behavior.
5. Add a row to the scenario table above.

## Caveats

- **The theme is an approximation.** Obsidian is not running, so `harness/theme.css` supplies
  stand-in values for the CSS variables the plugin's own styles read (`--background-*`, `--text-*`,
  `--color-*`, `--size-*`, `--font-*`, `--radius-s`) plus base looks for `.clickable-icon`,
  `.mod-cta` and `.dropdown`. They are close to Obsidian's defaults, but a harness screenshot
  proves the layout and the states, not the exact colors a user will see.
- **`refs=auto|all` does not change which commits come back.** A fixture is a pre-baked commit
  list rather than a graph walk, so the parameter changes the header dropdown and what the
  store asks `log()` for, not the history. Use `branches` when you want many lanes.
- **The harness is not covered by `npm run check`'s coverage thresholds** (`vitest`'s coverage
  `include` is `src/**` only), but it *is* covered by typecheck, oxlint, eslint, fallow and the
  LOC backstop.
