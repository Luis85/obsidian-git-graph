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
npm run check        # build + lint + tests
```

Lane colors can be changed by a CSS snippet overriding `--git-graph-lane-0` … `--git-graph-lane-7`.
