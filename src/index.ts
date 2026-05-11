#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type PackageJson = {
  trustedDependencies?: unknown;
};

type LockPackage = {
  dependencies?: Record<string, string>;
  hasInstallScript?: boolean;
  link?: boolean;
  name?: string;
  scripts?: Record<string, unknown>;
};

type PackageLock = {
  packages?: Record<string, LockPackage>;
};

const installScriptNames = ["preinstall", "install", "postinstall"];
const exoticSpecifiers = [
  "file:",
  "git:",
  "http:",
  "https:",
  "link:",
];

export function getTrustedDependencies(pkg: PackageJson): string[] {
  if (pkg.trustedDependencies === undefined) {
    return [];
  }

  if (!Array.isArray(pkg.trustedDependencies)) {
    throw new Error("package.json trustedDependencies must be an array.");
  }

  return pkg.trustedDependencies.map((dependency) => {
    if (typeof dependency !== "string" || dependency.length === 0) {
      throw new Error("package.json trustedDependencies must contain package names.");
    }

    return dependency;
  });
}

function packageNameFromPath(path: string): string | undefined {
  if (!path.startsWith("node_modules/")) {
    return undefined;
  }

  const parts = path.split("/");
  if (parts[1]?.startsWith("@")) {
    return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : undefined;
  }

  return parts[1] || undefined;
}

export function findInstallScriptDependencies(
  packageLock: PackageLock,
  trustedDependencies: readonly string[] = [],
): string[] {
  const trusted = new Set(trustedDependencies);
  const found = new Set<string>();

  for (const [path, pkg] of Object.entries(packageLock.packages ?? {})) {
    if (pkg.link) {
      continue;
    }

    const name = pkg.name ?? packageNameFromPath(path);
    if (!name || trusted.has(name)) {
      continue;
    }

    const hasInstallScript =
      pkg.hasInstallScript === true ||
      installScriptNames.some((scriptName) => typeof pkg.scripts?.[scriptName] === "string");

    if (hasInstallScript) {
      found.add(name);
    }
  }

  return [...found].sort((a, b) => a.localeCompare(b));
}

type ExoticSubdependency = {
  dependency: string;
  from: string;
  specifier: string;
};

type NpmrcConfig = {
  blockExoticSubdeps: boolean;
};

export function parseNpmrc(content: string): NpmrcConfig {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === "block-exotic-subdeps") {
      if (value !== "true" && value !== "false") {
        throw new Error(".npmrc block-exotic-subdeps must be true or false.");
      }

      return { blockExoticSubdeps: value === "true" };
    }
  }

  return { blockExoticSubdeps: false };
}

function findExoticSubdependencies(packageLock: PackageLock): ExoticSubdependency[] {
  const found: ExoticSubdependency[] = [];

  for (const [path, pkg] of Object.entries(packageLock.packages ?? {})) {
    if (path === "" || pkg.link) {
      continue;
    }

    const from = pkg.name ?? packageNameFromPath(path) ?? path;
    for (const [dependency, specifier] of Object.entries(pkg.dependencies ?? {})) {
      if (exoticSpecifiers.some((prefix) => specifier.startsWith(prefix))) {
        found.push({ dependency, from, specifier });
      }
    }
  }

  return found.sort((a, b) => {
    const byFrom = a.from.localeCompare(b.from);
    return byFrom === 0 ? a.dependency.localeCompare(b.dependency) : byFrom;
  });
}

export function assertNoBlockedExoticSubdeps(config: NpmrcConfig, packageLock: PackageLock): void {
  if (!config.blockExoticSubdeps) return;

  const exoticSubdeps = findExoticSubdependencies(packageLock);
  if (exoticSubdeps.length === 0) return;

  const lines = exoticSubdeps
    .map(({ dependency, from, specifier }) => `  ${from} -> ${dependency}: ${specifier}`)
    .join("\n");

  throw new Error(`Blocked exotic subdependencies:\n${lines}`);
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readPackageLock(): PackageLock {
  if (!existsSync("package-lock.json")) {
    throw new Error("package-lock.json not found. Run npm install once with scripts disabled first.");
  }

  return readJsonFile<PackageLock>("package-lock.json");
}

function readPackageJson(): PackageJson {
  return existsSync("package.json") ? readJsonFile<PackageJson>("package.json") : {};
}

function readNpmrc(): NpmrcConfig {
  return existsSync(".npmrc") ? parseNpmrc(readFileSync(".npmrc", "utf8")) : parseNpmrc("");
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function printHelp(): void {
  console.log(`safe-install

Usage:
  safe-install          Run npm install with scripts disabled, then rebuild trusted dependencies
  safe-install find     List dependencies that declare install-time scripts
`);
}

export function findCommand(): void {
  const dependencies = findInstallScriptDependencies(
    readPackageLock(),
    getTrustedDependencies(readPackageJson()),
  );

  if (dependencies.length === 0) {
    console.log("No untrusted dependencies with install-time scripts found.");
    return;
  }

  console.log("Dependencies with install-time scripts:");
  for (const dependency of dependencies) {
    console.log(`  ${dependency}`);
  }
  console.log("");
  console.log("Review these packages before adding them to trustedDependencies.");
}

export function installCommand(): void {
  const pkg = readPackageJson();
  const trustedDependencies = getTrustedDependencies(pkg);

  run("npm", ["install", "--ignore-scripts"]);

  if (existsSync("package-lock.json")) {
    assertNoBlockedExoticSubdeps(readNpmrc(), readPackageLock());
  }

  if (trustedDependencies.length > 0) {
    run("npm", ["rebuild", "--ignore-scripts=false", ...trustedDependencies]);
  }
}

export function main(args = process.argv.slice(2)): void {
  const [command] = args;

  if (command === undefined) {
    installCommand();
    return;
  }

  if (command === "find") {
    findCommand();
    return;
  }

  if (command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
