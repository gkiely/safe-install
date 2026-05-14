import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

type ShellArg = string | number | boolean | Array<string | number | boolean>;

function $(strings: TemplateStringsArray, ...values: ShellArg[]): void {
  const [command, args] = commandArgs(strings, values);
  execFileSync(command, args, { encoding: "utf8", stdio: "inherit" });
}

$.value = function value(strings: TemplateStringsArray, ...values: ShellArg[]): string {
  const [command, args] = commandArgs(strings, values);
  return execFileSync(command, args, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] }).trim();
}

$.quiet = function quiet(strings: TemplateStringsArray, ...values: ShellArg[]): void {
  const [command, args] = commandArgs(strings, values);
  execFileSync(command, args, { encoding: "utf8", stdio: ["inherit", "ignore", "inherit"] });
};

$.status = function status(strings: TemplateStringsArray, ...values: ShellArg[]): number {
  const [command, args] = commandArgs(strings, values);
  return spawnSync(command, args, { stdio: "inherit" }).status ?? 1;
};

async function publish(): Promise<void> {
  while (true) {
    if ($.status`npm publish --access public` === 0) return;

    const readline = createInterface({ input, output });
    await readline.question("");
    readline.close();
  }
}

function commandArgs(strings: TemplateStringsArray, values: ShellArg[]): [string, string[]] {
  const parts = strings[0].trim().split(/\s+/).filter(Boolean);

  for (const [index, value] of values.entries()) {
    const after = strings[index + 1];

    if (Array.isArray(value)) {
      parts.push(...value.map(String));
    } else {
      parts.push(String(value));
    }

    parts.push(...after.trim().split(/\s+/).filter(Boolean));
  }

  const [command, ...args] = parts;
  return [command, args];
}

function assertCleanWorktree(): void {
  const status = $.value`git status --porcelain`;
  if (status) {
    throw new Error("Release requires a clean worktree before uncommitting HEAD.");
  }
}

function assertPushable(): void {
  $.quiet`git fetch origin --tags --prune`;

  const upstream = $.value`git rev-parse --abbrev-ref --symbolic-full-name @{u}`;
  const [ahead, behind] = $.value`git rev-list --left-right --count ${`HEAD...${upstream}`}`
    .split(/\s+/)
    .map(Number);

  if (behind > 0) {
    throw new Error(`Release branch is behind ${upstream}. Pull/rebase before publishing.`);
  }

  $.quiet`git push --dry-run --follow-tags`;
}

function changedFilesInHead(): string[] {
  const files = $.value`git diff-tree --no-commit-id --name-only -r HEAD`;
  return files ? files.split("\n").filter(Boolean) : [];
}

function packageVersion(): string {
  return (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
}

function assertHeadReleaseCommitCanResume(headSubject: string): void {
  const version = packageVersion();

  if (headSubject !== `v${version}`) {
    throw new Error(`HEAD release commit ${headSubject} does not match package version ${version}.`);
  }

  $.quiet`git rev-parse --verify ${`v${version}`}`;
}

function syncReadmeVersion(version: string): void {
  const readmePath = "README.md";
  const readme = readFileSync(readmePath, "utf8");
  const versionedCommandPattern = /npx -y @gkiely\/safe-install@?\d+\.\d+\.\d+/g;

  writeFileSync(
    readmePath,
    readme.replace(versionedCommandPattern, `npx -y @gkiely/safe-install@${version}`),
  );
}

assertCleanWorktree();

const head = $.value`git rev-parse --short HEAD`;
const headSubject = $.value`git log -1 --pretty=%s`;
const parent = $.value`git rev-parse --verify HEAD^`;

// Fail before publishing if this branch has nowhere to push the release commit/tag.
assertPushable();
$.quiet`npm whoami`;

if (/^v\d+\.\d+\.\d+$/.test(headSubject)) {
  assertHeadReleaseCommitCanResume(headSubject);
  $`npm run typecheck`;
  $`npm test`;
  assertPushable();
  await publish();
  $`git push --follow-tags`;
  process.exit(0);
}

const filesToRestage = [
  ...changedFilesInHead(),
  "package.json",
  "package-lock.json",
  "README.md",
];

$`npm run typecheck`;
$`npm test`;

console.log(`Uncommitting ${head} and restaging release changes...`);
$`git reset --mixed ${parent}`;

$`npm version patch --no-git-tag-version`;
syncReadmeVersion(packageVersion());
$`git add -- ${filesToRestage}`;

const version = packageVersion();
$`git commit -m ${`v${version}`}`;
$`git tag -a ${`v${version}`} -m ${`v${version}`}`;
assertPushable();
await publish();
$`git push --follow-tags`;
