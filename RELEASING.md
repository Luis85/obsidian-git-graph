# Releasing and community directory submission

## Cutting a release

The **Release** workflow builds the plugin and creates a GitHub release with `main.js`,
`manifest.json` and `styles.css` attached as individual assets. It runs on a tag push (the
tag named exactly the `manifest.json` version, no `v` prefix) or on a manual dispatch,
which reads the version straight out of `manifest.json` on the ref you name and creates
that tag itself.

**The release workflow builds rather than gates, and REQUIRES the gate rather than trusting
you to have run it.** Its own npm steps are `npm ci` and `npm run build`, so the lint, the
tests, fallow and the LOC budget are not re-run at publish time; CI is where those run, and
before building anything the workflow demands that run. It refuses, with a message naming
the reason, when:

- the commit is not one `main` contains — which a dispatch on the wrong ref produces in a
  single click;
- CI did not conclude successfully on that exact commit. It **waits** for a run still in
  flight rather than refusing it, because `git push --follow-tags` pushes the branch and
  the tag together and this workflow starts while CI is still starting;
- the tag disagrees with `manifest.json`;
- that version already has a release;
- that version's tag already exists on a *different* commit — what a failed attempt leaves
  behind, since the tag is pushed before the workflow runs. `gh release create` would
  publish the tag's commit while attaching assets built from this one, so the two have to
  be the same commit or nothing else here applies to what gets published.

Nothing below asks you to check those first. That is the point: they were preconditions a
person had to remember and an agent had no way to discover, and they are now the workflow's
own refusals. `manifest.json`, `package.json` and `versions.json` agreeing is checked
earlier still — by `tests/release/versionFiles.test.ts`, so it fails on the pull request
rather than at publish time.

Two of the three assets are built: `npm run build` typechecks with `vue-tsc`, has Vite write
the minified CommonJS bundle to `dist/main.js`, and has the `git-graph-styles` Vite plugin
assemble `styles/` into `dist/styles.css`. Both upload under their basename, so the release
carries `main.js` and `styles.css`. `manifest.json` is the only committed source file among
them. The repository root holds no stylesheet at all — edit the partial in `styles/`, never a
build output. Each asset also gets a signed provenance attestation, verifiable with
`gh attestation verify <file> --repo Luis85/obsidian-git-graph`.

**The release body is required to carry this version's `CHANGELOG.md` entry, and that is
automated rather than a step below to remember.** `gh release create` runs with both
`--notes-file` — the section `scripts/changelog-notes.mjs` extracts for the tag being
published — and `--generate-notes`, which GitHub prepends the extracted entry ahead of: the
release body reads the curated summary first, the auto-generated merged-PR list underneath.
The extraction throws, failing the workflow, if `manifest.json`'s version has no dated
heading in `CHANGELOG.md` — `tests/release/changelogVersion.test.ts` already keeps that off
`main`, so in practice this only fires on a manual dispatch against an unusual ref.

### 1. Get the version bumped onto `main`

Skip this step if the version files are already committed on `main` — the case for the
**first release** (the repository was authored at `0.1.0`), or for any later release where
the bump landed as part of some other merged change and only the tag is missing.

Otherwise, bump it — this updates `package.json`, `manifest.json` and `versions.json`
together and commits them:

```bash
npm version patch
```

`minor` or `major` instead of `patch` as the change deserves. `package.json`'s `version`
script runs `scripts/version-bump.mjs`, which copies the new version into `manifest.json`
and records `minAppVersion` against it in `versions.json`, then stages both so all three
land in one commit.

`.npmrc` sets `tag-version-prefix=""` so `npm version` names its local tag `0.1.1`, not
`v0.1.1` — Obsidian requires the published tag to exactly match the manifest version, and
the release workflow refuses a mismatch as a second line of defense.

**`main` is not a protected branch on this repository** — checked, not assumed: the branch
protection API answers 404 for it. A version bump can therefore be pushed straight to
`main`, and step 3's tag-push path works from the same clone. Going through a pull request
is still the better habit, because that is what runs CI on the commit, and the release
workflow **refuses to publish a commit CI has not passed** — a direct push to `main` still
triggers CI, so the difference is only when you find out.

If you do bump on a branch and merge it, note that `npm version`'s local tag sits on the
pre-merge commit, and the merge commit is what lands on `main`. Leave that local tag alone
rather than pushing it; step 3 creates the real one from `manifest.json` on `main`.

**`npm version` does not touch `CHANGELOG.md`, and cannot be made to in one commit**: it
refuses to run against a dirty working tree, and its own `version` script stages only
`manifest.json` and `versions.json` before committing — so `CHANGELOG.md` would either be
swept in uncommitted, failing the clean-tree check, or left behind. Edit it as a **second
commit right after**: rename `## [Unreleased]` to `## [<version>] - <date>`, using the
version `npm version` just wrote to `manifest.json`, and leave a fresh, empty
`## [Unreleased]` above it for whatever lands next. `[Unreleased]` is not this step's to
fill from scratch — a change that alters what the plugin does adds its own bullet there as
it merges, so this edit only retitles and dates a section that already has content.
`tests/release/changelogVersion.test.ts` is what makes this a check rather than a habit: it
reads `manifest.json` and fails whenever its version is not the first dated heading below
`[Unreleased]`, so a bump that forgot the entry fails `npm run check` before it reaches
`main`.

### 2. Before the tag: the live-vault sweep

Some of this plugin's behaviour cannot be checked here at all. Obsidian does not run in the
jsdom harness, so the pane's real appearance, its theme colours, the ribbon and command
entries, and what a click actually opens are things a person has to look at. Walk this
**before** the tag: after it, the only thing a failure can produce is a second release.

`npm run test-build` builds and installs the plugin into `.obsidian/plugins/git-graph/` in
this repository, so the repository root opens as a vault with a real git history to draw.
That is what makes the sweep cheap enough to actually do. Open it in Obsidian (or reload it
if it is already open) and check:

1. **The pane opens** from the ribbon icon and from **Git Graph: Open** in the command
   palette, and **Git Graph: Refresh** re-reads it.
2. **The graph reads correctly** — lanes are drawn and coloured, branch, tag and remote
   badges sit on the right commits, and HEAD is marked. Compare against `git log --graph`
   in a terminal for the same repository.
3. **A commit expands** to its full message and changed files, and clicking one of those
   files opens it in the editor. Clicking a file that is not in the vault, or no longer
   exists, shows a notice rather than doing nothing.
4. **The changes row** shows the uncommitted count, expands to the working-tree files with
   their status, and opens a file when one is clicked. Make an edit in another window and
   confirm the row updates on its own within about a second.
5. **Both themes.** Switch between light and dark; nothing in the pane should be unreadable
   or hardcoded to one of them.
6. **Settings** — change each of the five settings and confirm the pane honours it: a bad
   git executable path is rejected with a message, `Refs to show: All` adds the other
   branches, a smaller page size shortens the list, turning off the changes row removes it,
   and the date format switches between relative and absolute.

Write down what you saw, in the pull request or the release notes — including "nothing
changed", which is the expected result and the only way the next sweep knows this one
happened. A failure becomes an issue; whether it blocks the release is your call.

### 3. Cut the tag and publish

Once the version files are on `main` — from step 1, or because they were already there —
this is the whole remaining step. Three equivalent ways to trigger it, all of which read
the version from `manifest.json` on the ref you name and take it from there:

- From the browser: **Actions** → **Release** → **Run workflow** on `main`.
- From anything that can reach the API — `gh`, curl, or an agent session with the GitHub
  tools. This needs neither a checkout nor a browser, and takes no inputs:

  ```bash
  gh workflow run release.yml --ref main
  ```

  ```http
  POST /repos/Luis85/obsidian-git-graph/actions/workflows/release.yml/dispatches
  {"ref": "main"}
  ```

  A dispatch returns no run id, so find the run rather than assuming it: list the
  workflow's runs and take the newest, then read its jobs or logs while it goes.

- Or push the tag yourself, reading it from the manifest rather than typing it, so this
  works for whatever version is committed. Pull the merged `main` first — if step 1 ran in
  this same clone, `npm version` already left a local tag with this exact name, and
  `git tag` refuses to reuse a name without `-f`; recreate it on the commit you actually
  mean to release rather than reusing or fighting the stale one:

  ```bash
  git fetch origin main && git checkout main && git merge --ff-only origin/main
  tag="$(node -p "require('./manifest.json').version")"
  git tag -f "$tag" && git push origin "$tag"
  ```

  `-f` only ever moves the LOCAL ref onto the commit just checked out; the push after it is
  a plain, non-forced push of a name that does not yet exist on the remote in the normal
  case, so it fails safely rather than silently overwriting anything there. The dispatch
  path above sidesteps all of this — it never touches a local tag.

What proves it worked is the release, not a green workflow run: check on the releases page
that the tag name **exactly matches** the version in `manifest.json` (`x.y.z`, no `v`
prefix) and that all three assets — `main.js`, `manifest.json`, `styles.css` — are attached.

Publishing is public and a release cannot be un-published without deleting it, so an agent
session should have been told to release, not infer it from a merged PR.

## Submitting to the community plugin directory

This is done **once**, after the first release exists, and not repeated: the directory
tracks the repository's releases from then on, so every later release reaches users with no
further submission.

1. Confirm the first release is published and its three assets are attached — the directory
   review checks exactly this, and a release missing `main.js` is the usual rejection.
2. Fork [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases)
   and add one entry to the end of `community-plugins.json`:

   ```json
   {
     "id": "git-graph",
     "name": "Git Graph",
     "author": "Luis85",
     "description": "VS Code's source control graph as a side pane: lanes, refs, and commit details for the vault's git repository.",
     "repo": "Luis85/obsidian-git-graph"
   }
   ```

   `id`, `name`, `author` and `description` must match `manifest.json` exactly; `repo` is
   `owner/name`, not a URL.
3. Open a pull request against that repository and fill in its checklist. The plugin is
   `isDesktopOnly` and shells out to `git`, so expect the review to ask about both — the
   README's Requirements section is the answer to have ready.
4. Review is a queue, not a same-day process. Nothing here needs doing again while it
   waits, and later releases can be cut normally in the meantime.
