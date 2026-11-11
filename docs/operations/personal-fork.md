# Nikita's T3 Code fork

`NikitaTLN/t3code` follows **published upstream nightlies**, with personal fixes
on `personal`. `main` is an upstream reference, not the base for personal work.
Keep the normal checkout on `personal`; create task worktrees for every change.
Merge PRs into `personal` with merge commits. Do not rebase shared history.

## Another machine

Install Git, GitHub CLI (`gh auth login`), and Vite+ using the
[development setup](development.md#first-checkout). Then:

```sh
git clone --filter=blob:none --branch personal https://github.com/NikitaTLN/t3code.git
cd t3code
node scripts/personal-fork.mjs configure
git fetch --no-tags upstream main
vp i --frozen-lockfile
```

These commands work in PowerShell too; choose the destination under your local
Projects directory. The configure command keeps pushes/PRs on Nikita's fork,
disables upstream pushes, and overrides global automatic rebasing for this repo.
Run `tlnstack sync` separately to install your global instructions and skills;
native and CLI-proxy provider configs remain separate and machine-local.

## A feature or fix

```sh
node scripts/personal-fork.mjs worktree fix/manual-reset-time
```

The command prints the new path under `../t3code-worktrees/fix/manual-reset-time`.
Open that path and run `vp i --frozen-lockfile` (T3 Code does worktree setup
automatically). `vp run dev` starts an isolated development server and web UI;
`vp run dev:desktop` starts Electron. Keep the existing installed app running.
Never point development at the live `~/.t3/userdata`.

Before pushing, run `vp run check:changed origin/personal` plus the focused tests
or runtime verification appropriate to the behavior. Stage named paths and use
Conventional Commits. Follow the global `git-workflow` and `file-pr` skills,
substituting `personal` for their usual `main` base. For example:

```sh
git push -u origin HEAD
gh pr create --repo NikitaTLN/t3code --base personal --body-file /path/to/pr-body.md
```

Link and watch PRs through T3 Code. After an authorized merge, fast-forward the
clean primary checkout with `git pull --ff-only`. Keep task branches/worktrees
unless cleanup was requested. Upstream contributions are optional and explicit.

## Bring in a newer nightly

```sh
node scripts/personal-fork.mjs nightly
node scripts/personal-fork.mjs sync
```

`nightly` reports the newest published nightly, excluding stable and preview
releases. `sync` fetches that tag and creates a task worktree based on the latest
`origin/personal`, then merges the tag without committing. If already included,
it leaves the worktrees alone. If a merge conflicts, Git leaves it in the printed
worktree for you to resolve; rerunning does not overwrite it. Existing task
branches and worktrees are never deleted or reused silently.

Do not use GitHub's **Sync fork** button on `personal`: it follows upstream's
default branch, which can contain changes beyond the published nightly.

Install dependencies, resolve conflicts, verify carried fixes, commit the merge,
and open a PR against `personal`. Review upstream changes to workflows before
enabling any new inherited workflow. Source updates do not install binaries,
change the running T3 service, or publish a release.

## CI and distribution

`personal-ci.yml` uses GitHub-hosted Ubuntu runners and upstream's dependency
setup with no private cache credentials. It runs changed-file checks against the
actual PR base (or the previous personal commit). It does not build installers,
run the entire upstream test matrix, sign apps, or publish releases. Upstream's
other workflows are disabled in this fork; keep them disabled unless adapted.

For builds, use the [platform packaging runbook](development.md#desktop-artifacts).
Select only the OS/CPU targets you use and build each release from the same
tested commit. Windows with bundled WSL also needs its matching Linux archive.
Use a fresh fork version for each distributed runtime; caches use version IDs.

Initially install artifacts manually. Desktop feeds, CLI release discovery,
and OS package-manager updates are separate: configure them before relying on
automatic updates. The official mobile app can remain in use while your fork
preserves protocol compatibility. T3 Connect needs the documented public build
configuration; it is not enabled here. Neither provider credentials nor signing
credentials belong in Git.
