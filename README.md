# Git Graph for Obsidian

VS Code's Source Control graph as an Obsidian side pane. If your vault is a git repository
(or sits inside one), the pane shows the commit graph: colored lanes, commit subjects,
authors, dates, branch/tag/remote badges, the current HEAD, and a row for uncommitted
changes. Click a commit to see its full message and changed files.

Read-only: the plugin never runs a git command that modifies the repository.

## Requirements

- Obsidian 1.13 or newer, desktop only.
- `git` installed. If it is not on your PATH, set the executable in the plugin settings.

## Usage

Open the pane from the ribbon icon, or from the command palette: **Git Graph: Open**.
**Git Graph: Refresh** re-reads the repository on demand; the pane also refreshes on its
own when files change.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| Git executable | `git` | Command or path used to run git. |
| Refs to show | Auto | Auto: current branch, its upstream, default remote branch. All: every branch and tag. |
| Commits per page | 200 | Loaded at once; more load as you scroll. |
| Show working tree changes | on | Row above the newest commit with the uncommitted change count. |
| Date format | Relative | "3 days ago" or `YYYY-MM-DD HH:mm`. |

## Development

```bash
npm install
npm run test-build   # builds and installs into .obsidian/plugins/git-graph/ — open this repo as a vault
npm run check        # build + lint + dead-code check + LOC backstop + coverage: the pre-commit gate
```

`npm run check` runs, in order: `build` (typecheck + vite build), `lint` (oxlint then eslint),
`deadcode` (fallow), `loc` (the LOC report and per-file backstop), then `test:coverage`
(`vitest run --coverage`, which also runs every test). `tsconfig.json` includes both `src/**`
and `tests/**`, so `npm run typecheck` (`vue-tsc --noEmit`) type-checks both; `build` and
`test-build` call it instead of inlining `vue-tsc`.

| Gate | Command | What fails it |
|---|---|---|
| Typecheck | `npm run typecheck` | A type error anywhere under `src/**` or `tests/**` (strict, `noUncheckedIndexedAccess`). |
| Build | `npm run build` | `typecheck`, or the vite build itself, failing. |
| oxlint | `npm run lint:oxlint` | Any oxlint correctness/suspicious finding. |
| eslint | `npm run lint:eslint` | Any obsidianmd/typescript-eslint/vue rule, at `--max-warnings 0` — including the size/complexity limits: `src/**` caps `max-lines` (300), `max-lines-per-function` (80), `complexity` (12), `max-depth` (4), `max-params` (5), `max-nested-callbacks` (4); `tests/**` and `scripts/**` cap `max-lines` (500), `complexity` (15), `max-depth` (4) (no per-function line limit — a `describe` body is one function). A handful of pre-existing functions exceed these by a small, documented margin; each has a file-scoped override in `eslint.config.mjs` with a `// TODO(quality)` comment explaining why an extraction isn't trivial. |
| deadcode | `npm run deadcode` | fallow finding an unused export, file, component prop, or dependency. |
| LOC | `npm run loc` | Any tracked file (`src/`, `tests/`, `scripts/`, `harness/` if present) exceeding 400 code lines — a backstop for file types eslint's size rules don't cover (`.css`, `.mjs` configs). Also prints a per-directory and top-10-files LOC table; `--json` for machine-readable output. |
| Coverage thresholds | `npm run test:coverage` | v8 coverage over `src/**/*.{ts,vue}` dropping below thresholds: statements 90%, branches 80%, functions 90%, lines 90% (rounded down from the measured baseline, floored at 80/80/80/70). |
| Tests | `npm run test` | Any vitest failure (`dom` and `node` projects). |
| Test build | `npm run test-build` | `typecheck`, the dev-mode vite build, or `scripts/test-build.mjs` (installs into `.obsidian/plugins/git-graph/`) failing. |

Lane colors can be changed by a CSS snippet overriding `--git-graph-lane-0` … `--git-graph-lane-7`.
