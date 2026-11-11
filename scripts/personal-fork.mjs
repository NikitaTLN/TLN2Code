import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const checkout = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const fork = "NikitaTLN/t3code";
const upstream = "pingdotgg/t3code";

function run(command, args, cwd = checkout, capture = false) {
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `${command} exited with ${result.status}`);
  }
  return result.stdout?.trim() ?? "";
}

const git = (...args) => run("git", args, checkout, true);
const primary = () =>
  NodePath.dirname(git("rev-parse", "--path-format=absolute", "--git-common-dir"));

function configure() {
  const origin = git("remote", "get-url", "origin");
  if (
    !/^https:\/\/github\.com\/NikitaTLN\/t3code(?:\.git)?\/?$/i.test(origin) &&
    !/^git@github\.com:NikitaTLN\/t3code(?:\.git)?$/i.test(origin)
  ) {
    throw new Error(`Expected origin to be ${fork}; found ${origin}. No configuration changed.`);
  }
  if (!git("remote").split("\n").includes("upstream")) {
    run("git", ["remote", "add", "upstream", `https://github.com/${upstream}.git`]);
  } else {
    run("git", ["remote", "set-url", "upstream", `https://github.com/${upstream}.git`]);
  }
  for (const [key, value] of Object.entries({
    "remote.upstream.fetch": "+refs/heads/main:refs/remotes/upstream/main",
    "remote.upstream.pushurl": "no-push://upstream",
    "remote.origin.fetch": "+refs/heads/*:refs/remotes/origin/*",
    "remote.pushDefault": "origin",
    "pull.ff": "only",
    "pull.rebase": "false",
    "push.default": "simple",
    "fetch.prune": "true",
    "rerere.enabled": "true",
    "rerere.autoupdate": "true",
  })) {
    run("git", ["config", "--local", "--replace-all", key, value]);
  }
  run("gh", ["repo", "set-default", fork]);
  console.log(`Configured ${primary()}: pushes and PRs target ${fork}; upstream pushes disabled.`);
}

function latestNightly() {
  const releases = JSON.parse(
    run(
      "gh",
      [
        "api",
        `repos/${upstream}/releases?per_page=100`,
        "--jq",
        "map({tag_name,draft,prerelease,published_at,html_url})",
      ],
      checkout,
      true,
    ),
  );
  const latest = releases
    .filter(
      (release) =>
        !release.draft &&
        release.prerelease &&
        /^v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/.test(release.tag_name),
    )
    .sort((a, b) => b.published_at.localeCompare(a.published_at))[0];
  if (!latest)
    throw new Error("No published nightly found among the latest 100 upstream releases.");
  return latest;
}

function addWorktree(branch) {
  if (!/^(?:feat|fix|chore|shared)\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(branch ?? "")) {
    throw new Error("Use a task branch such as fix/manual-reset-time or chore/nightly-20261111.");
  }
  run("git", ["check-ref-format", "--branch", branch]);
  const root = primary();
  const target = NodePath.resolve(NodePath.dirname(root), "t3code-worktrees", branch);
  run("git", ["fetch", "--no-tags", "origin", "personal"]);
  run("git", ["worktree", "add", "--no-track", "-b", branch, target, "origin/personal"]);
  return target;
}

try {
  const [command, branch] = process.argv.slice(2);
  if (command === "configure") {
    configure();
  } else if (command === "nightly") {
    const latest = latestNightly();
    console.log(
      `Latest nightly: ${latest.tag_name}\nPublished: ${latest.published_at}\n${latest.html_url}`,
    );
  } else if (command === "worktree") {
    const target = addWorktree(branch);
    console.log(
      `\nWorktree: ${target}\nInstall here: vp i --frozen-lockfile\nCheck: vp run check:changed origin/personal`,
    );
  } else if (command === "sync") {
    const latest = latestNightly();
    run("git", ["fetch", "--no-tags", "upstream", "tag", latest.tag_name]);
    run("git", ["fetch", "--no-tags", "origin", "personal"]);
    const included = NodeChildProcess.spawnSync(
      "git",
      ["merge-base", "--is-ancestor", latest.tag_name, "origin/personal"],
      { cwd: checkout },
    );
    if (included.error) throw included.error;
    if (included.status === 0) {
      console.log(`${latest.tag_name} is already included in origin/personal.`);
    } else if (included.status === 1) {
      const target = addWorktree(`chore/upstream-${latest.tag_name.slice(1)}`);
      console.log(`Nightly update worktree: ${target}`);
      run("git", ["merge", "--no-ff", "--no-commit", latest.tag_name], target);
      console.log(
        `\nNightly update prepared in ${target}.\nInstall, review, check, commit, then open a PR to ${fork}:personal. Nothing was pushed or deployed.`,
      );
    } else {
      throw new Error(`Cannot compare nightly ancestry (git exited with ${included.status}).`);
    }
  } else {
    console.log("Usage: node scripts/personal-fork.mjs <configure|nightly|worktree BRANCH|sync>");
    if (command) process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
