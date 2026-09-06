# Changelog

All notable changes to this plugin are documented here, for someone deciding whether to
upgrade — not the commit log. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/). Before 1.0, a breaking change gets a line here
rather than a deprecation window.

**One entry is one sentence: what changed, for the reader.** The reasoning behind a change
belongs in the pull request that argued it, not here — a changelog that repeats it is a
second copy to keep in step. A breaking change is the exception and keeps the room it
needs, because what an upgrader has to *do* is the whole reason they opened this file.

Add the entry in the pull request that earns it, under the section's existing `### Added` /
`### Changed` / `### Removed` / `### Fixed` heading rather than a second copy of one —
`tests/release/changelogVersion.test.ts` fails on a repeated group heading, because the
whole section is what the release workflow publishes as the release body.

See [RELEASING.md](RELEASING.md) for how this file is kept in step with a release.

## [Unreleased]

## [0.1.0] - 2026-09-06

### Added

- **Git Graph**, a read-only side pane drawing the vault's git repository as VS Code's
  Source Control graph does: colored lanes, commit subjects, authors, dates, branch, tag
  and remote badges, and the current HEAD. Open it from the ribbon or **Git Graph: Open**.
- Clicking a commit expands its full message and the files it touched; clicking one of
  those files opens it in the editor, with a notice when it is outside the vault or gone.
- A changes row above the newest commit carries the uncommitted change count; expanding it
  lists the working-tree files with their status, and clicking one opens it.
- The pane refreshes itself when the repository's git state changes, and picks up
  working-tree edits within about half a second while it is open. **Git Graph: Refresh**
  re-reads on demand.
- Settings for the git executable, which refs to show, commits per page, whether to show
  the working-tree changes row, and relative or absolute dates.
