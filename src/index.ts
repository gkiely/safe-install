#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type PackageJson = {
  blockExoticSubDeps?: unknown;
  scripts?: Record<string, unknown>;
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
  | { kind: "init" }
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

function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
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

function getRootInstallScripts(pkg: PackageJson): string[] {
  return installScriptNames.filter((scriptName) => typeof pkg.scripts?.[scriptName] === "string");
}

type NpmRunInstallConfig =
  | "npm_config_save"
  | "npm_config_save_bundle"
  | "npm_config_save_dev"
  | "npm_config_save_exact"
  | "npm_config_save_optional"
  | "npm_config_save_peer";
type NpmRunEnv = Partial<Record<NpmRunInstallConfig, string>>;
type RunScriptEnv = NpmRunEnv & Partial<Record<"NODE_RUN_SCRIPT_NAME" | "npm_command", string>>;

const npmRunInstallFlags: { config: keyof NpmRunEnv; flag: string; aliases: string[]; value: string }[] = [
  { config: "npm_config_save_dev", flag: "--save-dev", aliases: ["--save-dev", "-D"], value: "true" },
  { config: "npm_config_save_optional", flag: "--save-optional", aliases: ["--save-optional", "-O"], value: "true" },
  { config: "npm_config_save_peer", flag: "--save-peer", aliases: ["--save-peer"], value: "true" },
  { config: "npm_config_save_exact", flag: "--save-exact", aliases: ["--save-exact", "-E"], value: "true" },
  { config: "npm_config_save_bundle", flag: "--save-bundle", aliases: ["--save-bundle", "-B"], value: "true" },
  { config: "npm_config_save", flag: "--no-save", aliases: ["--no-save"], value: "" },
];

function getNpmRunInstallFlags(args: readonly string[], env: RunScriptEnv): string[] {
  return npmRunInstallFlags
    .filter(({ aliases, config, value }) =>
      env[config] === value && aliases.every((alias) => !args.includes(alias))
    )
    .map(({ flag }) => flag);
}

export function getInstallArgs(args: readonly string[] = []): string[] {
  return ["install", "--ignore-scripts", ...getNpmRunInstallFlags(args, process.env), ...args];
}

export function getUpdateArgs(args: readonly string[] = []): string[] {
  return ["update", "--ignore-scripts", ...args];
}

export function parseCommand(args: readonly string[], env: RunScriptEnv = process.env): ParsedCommand {
  if (args.includes("--help") || args.includes("-h")) {
    return { kind: "help" };
  }

  const isRunScript = env.npm_command === "run" || env.NODE_RUN_SCRIPT_NAME === "safe-install";

  if ((args[0] === "--" && args[1] === "review-deps") || (isRunScript && args[0] === "review-deps")) {
    return { kind: "review-deps" };
  }

  if ((args[0] === "--" && args[1] === "update") || args[0] === "update") {
    return {
      kind: "update",
      args: args[0] === "--" ? args.slice(2) : args.slice(1),
    };
  }

  if (
    (args[0] === "--" && args[1] === "init") ||
    args[0] === "init"
  ) {
    return { kind: "init" };
  }

  return { kind: "install", args: args.filter((arg) => arg !== "--") };
}

function printHelp(): void {
  console.log(`safe-install

Usage:
  safe-install [npm install args]
                        Run npm install with dependency scripts disabled, then rebuild trusted dependencies
  safe-install -- review-deps
                        List dependencies that declare install-time scripts
  safe-install -- update [npm update args]
                        Run npm update with dependency scripts disabled, then rebuild trusted dependencies
  safe-install -- init
                        Add package scripts and scripts/review-deps.mjs to the current project
`);
}

function initPackageJson(): void {
  if (!existsSync("package.json")) {
    throw new Error("package.json not found.");
  }

  const pkg = readJsonFile<PackageJson>("package.json");
  const scripts = typeof pkg.scripts === "object" && pkg.scripts !== null ? { ...pkg.scripts } : {};

  scripts["safe-install"] = "([ -n \"$CI\" ] && npm ci --ignore-scripts || npm install --ignore-scripts) && npm run --ignore-scripts rebuild-trusted-dependencies && npm run --ignore-scripts --if-present preinstall && npm run --ignore-scripts --if-present install && npm run --ignore-scripts --if-present postinstall";
  scripts["review-deps"] = "node scripts/review-deps.mjs";
  scripts["rebuild-trusted-dependencies"] = "npm rebuild --ignore-scripts=false $(node -p \"require('./package.json').trustedDependencies.join(' ')\")";

  pkg.scripts = scripts;
  if (pkg.trustedDependencies === undefined) {
    pkg.trustedDependencies = [];
  }

  writeJsonFile("package.json", pkg);
}

function initReviewDepsScript(): void {
  mkdirSync("scripts", { recursive: true });
  writeFileSync("scripts/review-deps.mjs", `import { readFileSync } from 'node:fs';

/**
 * @typedef {{ hasInstallScript?: boolean }} LockPackage
 * @typedef {{ packages?: Record<string, LockPackage> }} PackageLock
 */

/** @type {PackageLock} */
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
/** @type {Set<string>} */
const names = new Set();

for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
  if (!pkg.hasInstallScript) continue;

  const [, name] = path.match(/^node_modules\\/(@[^/]+\\/[^/]+|[^/]+)/) ?? [];
  if (name) names.add(name);
}

console.log([...names].sort().join('\\n'));
`);
}

export function initCommand(): void {
  initPackageJson();
  initReviewDepsScript();
  console.log("Initialized safe-install scripts.");
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

  for (const scriptName of getRootInstallScripts(pkg)) {
    run("npm", ["run", "--ignore-scripts", scriptName]);
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

  if (command.kind === "init") {
    initCommand();
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
