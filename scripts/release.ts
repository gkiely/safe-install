import { execFileSync, spawnSync } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { readFileSync, writeFileSync } from "node:fs";

type ShellArg = string | number | boolean | Array<string | number | boolean>;

function $(strings: TemplateStringsArray, ...values: ShellArg[]): string {
  const [command, args] = commandArgs(strings, values);
  return execFileSync(command, args, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] }).trim();
}

$.status = function status(strings: TemplateStringsArray, ...values: ShellArg[]): number {
  const [command, args] = commandArgs(strings, values);
  return spawnSync(command, args, { stdio: "inherit" }).status ?? 1;
};

$.statusExit = function statusExit(strings: TemplateStringsArray, ...values: ShellArg[]): void {
  const status = $.status(strings, ...values);
  if (status !== 0) process.exit(status);
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
  const status = $`git status --porcelain`;
  if (status) {
    throw new Error("Release requires a clean worktree before uncommitting HEAD.");
  }
}

function changedFilesInHead(): string[] {
  const files = $`git diff-tree --no-commit-id --name-only -r HEAD`;
  return files ? files.split("\n").filter(Boolean) : [];
}

function packageVersion(): string {
  return (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
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

const head = $`git rev-parse --short HEAD`;
const headSubject = $`git log -1 --pretty=%s`;
const parent = $`git rev-parse --verify HEAD^`;
// Fail before publishing if this branch has nowhere to push the release commit/tag.
$`git rev-parse --abbrev-ref --symbolic-full-name @{u}`;
$`npm whoami`;

if (/^v\d+\.\d+\.\d+$/.test(headSubject)) {
  throw new Error("HEAD is already a release commit.");
}

const filesToRestage = [
  ...changedFilesInHead(),
  "package.json",
  "package-lock.json",
  "README.md",
];

$.statusExit`npm run typecheck`;
$.statusExit`npm test`;

console.log(`Uncommitting ${head} and restaging release changes...`);
$`git reset --mixed ${parent}`;

$`npm version patch --no-git-tag-version`;
syncReadmeVersion(packageVersion());
$`git add -- ${filesToRestage}`;

const version = packageVersion();
$`git commit -m ${`v${version}`}`;
$`git tag -a ${`v${version}`} -m ${`v${version}`}`;
await publish();
$`git push --follow-tags`;
