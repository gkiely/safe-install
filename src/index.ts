#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type PackageJson = {
  blockExoticSubDeps?: unknown;
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

type ParsedCommand =
  | { kind: "install"; args: string[] }
  | { kind: "update"; args: string[] }
  | { kind: "review-deps" }
  | { kind: "help" };

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
    if (path === "" || pkg.link) {
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

type SafeInstallConfig = {
  blockExoticSubdeps: boolean;
};

export function getSafeInstallConfig(pkg: PackageJson): SafeInstallConfig {
  if (pkg.blockExoticSubDeps === undefined) {
    return { blockExoticSubdeps: false };
  }

  if (typeof pkg.blockExoticSubDeps !== "boolean") {
    throw new Error("package.json blockExoticSubDeps must be a boolean.");
  }

  return { blockExoticSubdeps: pkg.blockExoticSubDeps };
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

export function assertNoBlockedExoticSubdeps(config: SafeInstallConfig, packageLock: PackageLock): void {
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

export function getInstallArgs(args: readonly string[] = []): string[] {
  return ["install", "--ignore-scripts", ...args];
}

export function getUpdateArgs(args: readonly string[] = []): string[] {
  return ["update", "--ignore-scripts", ...args];
}

export function parseCommand(args: readonly string[]): ParsedCommand {
  if (args.includes("--help") || args.includes("-h")) {
    return { kind: "help" };
  }

  if (
    (args[0] === "--" && args[1] === "review-deps") ||
    args[0] === "review-deps"
  ) {
    return { kind: "review-deps" };
  }

  if (
    (args[0] === "--" && args[1] === "update") ||
    args[0] === "update"
  ) {
    return {
      kind: "update",
      args: args[0] === "--" ? args.slice(2) : args.slice(1),
    };
  }

  return { kind: "install", args: args.filter((arg) => arg !== "--") };
}

function printHelp(): void {
  console.log(`safe-install

Usage:
  safe-install [npm install args]
                        Run npm install with scripts disabled, then rebuild trusted dependencies
  safe-install -- review-deps
                        List dependencies that declare install-time scripts
  safe-install -- update [npm update args]
                        Run npm update with scripts disabled, then rebuild trusted dependencies
`);
}

export function reviewDepsCommand(): void {
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

export function installCommand(args: readonly string[] = []): void {
  runPackageManagerThenRebuild(getInstallArgs(args));
}

export function updateCommand(args: readonly string[] = []): void {
  runPackageManagerThenRebuild(getUpdateArgs(args));
}

function runPackageManagerThenRebuild(npmArgs: readonly string[]): void {
  const pkg = readPackageJson();
  const config = getSafeInstallConfig(pkg);
  const trustedDependencies = getTrustedDependencies(pkg);

  run("npm", [...npmArgs]);

  if (existsSync("package-lock.json")) {
    assertNoBlockedExoticSubdeps(config, readPackageLock());
  }

  if (trustedDependencies.length > 0) {
    run("npm", ["rebuild", "--ignore-scripts=false", ...trustedDependencies]);
  }
}

export function main(args = process.argv.slice(2)): void {
  const command = parseCommand(args);

  if (command.kind === "help") {
    printHelp();
    return;
  }

  if (command.kind === "review-deps") {
    reviewDepsCommand();
    return;
  }

  if (command.kind === "update") {
    updateCommand(command.args);
    return;
  }

  installCommand(command.args);
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
