import { readFileSync, writeFileSync } from "node:fs";

function nextPatch(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Unsupported package version: ${version}`);

  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number(patch) + 1}`;
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const readmePath = "README.md";
const readme = readFileSync(readmePath, "utf8");


const versionedCommandPattern = /npx -y @gkiely\/safe-install@?\d+\.\d+\.\d+/g;

if (!versionedCommandPattern.test(readme)) {
  throw new Error("README.md does not contain a versioned safe-install npx command");
}

const updated = readme.replace(
  versionedCommandPattern,
  `npx -y @gkiely/safe-install${nextPatch(packageJson.version)}`,
);

writeFileSync(readmePath, updated);
