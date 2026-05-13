import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertNoBlockedExoticSubdeps,
  findInstallScriptDependencies,
  getInstallArgs,
  getSafeInstallConfig,
  getUpdateArgs,
  parseCommand,
} from "../src/index.ts";

test("findInstallScriptDependencies returns untrusted lockfile packages with install scripts", () => {
  assert.deepEqual(
    findInstallScriptDependencies(
      {
        packages: {
          "": { name: "my-app", hasInstallScript: true },
          "node_modules/esbuild": { hasInstallScript: true },
          "node_modules/sharp": { scripts: { install: "node install/check" } },
          "node_modules/react": {},
          "node_modules/@swc/core": { hasInstallScript: true },
          "node_modules/local-link": { hasInstallScript: true, link: true },
        },
      },
      ["sharp"],
    ),
    ["@swc/core", "esbuild"],
  );
});

test("assertNoBlockedExoticSubdeps only fails when block-exotic-subdeps is enabled", () => {
  const packageLock = {
    packages: {
      "": {
        dependencies: {
          direct: "git+https://github.com/example/direct.git",
        },
      },
      "node_modules/parent": {
        dependencies: {
          tarball: "https://example.com/tarball.tgz",
        },
      },
      "node_modules/local-link": {
        link: true,
        dependencies: {
          ignored: "git:https://example.com/ignored.git",
        },
      },
    },
  };

  assert.doesNotThrow(() =>
    assertNoBlockedExoticSubdeps({ blockExoticSubdeps: false }, packageLock),
  );
  assert.throws(() => assertNoBlockedExoticSubdeps({ blockExoticSubdeps: true }, packageLock), {
    message: /Blocked exotic subdependencies/,
  });
});

test("getSafeInstallConfig reads blockExoticSubDeps", () => {
  assert.deepEqual(getSafeInstallConfig({ blockExoticSubDeps: true }), {
    blockExoticSubdeps: true,
  });
  assert.deepEqual(getSafeInstallConfig({}), {
    blockExoticSubdeps: false,
  });
});

test("getInstallArgs passes npm install args through", () => {
  assert.deepEqual(getInstallArgs(["--no-audit", "--no-fund", "left-pad@latest"]), [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "left-pad@latest",
  ]);
});

test("getUpdateArgs adds ignore-scripts and passes npm update args through", () => {
  assert.deepEqual(getUpdateArgs(["--no-audit", "--no-fund"]), [
    "update",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
});

test("parseCommand treats positional package names as npm install args", () => {
  assert.deepEqual(parseCommand(["--no-audit", "--no-fund", "left-pad"]), {
    kind: "install",
    args: ["--no-audit", "--no-fund", "left-pad"],
  });
});

test("parseCommand runs review-deps with or without a leading separator", () => {
  assert.deepEqual(parseCommand(["--", "review-deps"]), { kind: "review-deps" });
  assert.deepEqual(parseCommand(["review-deps"]), { kind: "review-deps" });
});

test("parseCommand supports update with or without a leading separator", () => {
  assert.deepEqual(parseCommand(["--", "update", "--no-audit", "--no-fund"]), {
    kind: "update",
    args: ["--no-audit", "--no-fund"],
  });
  assert.deepEqual(parseCommand(["update", "--no-audit", "--no-fund"]), {
    kind: "update",
    args: ["--no-audit", "--no-fund"],
  });
});

test("parseCommand supports init with or without a leading separator", () => {
  assert.deepEqual(parseCommand(["--", "init"]), { kind: "init" });
  assert.deepEqual(parseCommand(["init"]), { kind: "init" });
});

test("parseCommand supports install-latest package args", () => {
  assert.deepEqual(parseCommand(["--no-audit", "--no-fund", "react@latest", "vite@latest"]), {
    kind: "install",
    args: ["--no-audit", "--no-fund", "react@latest", "vite@latest"],
  });
});

test("parseCommand supports npm-run appended args with default flags", () => {
  assert.deepEqual(parseCommand(["--no-audit", "--no-fund", "--", "review-deps"]), {
    kind: "install",
    args: ["--no-audit", "--no-fund", "review-deps"],
  });
});

test("cli passes package names through to npm install", () => {
  const cwd = mkdtempSync(join(tmpdir(), "safe-install-"));
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));

  execFileSync("node", [join(import.meta.dirname, "../dist/index.js"), "--package-lock-only", "is-number@7.0.0"], {
    cwd,
    stdio: "pipe",
  });

  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  assert.equal(pkg.dependencies?.["is-number"], "^7.0.0");
});

test("cli runs root install lifecycle scripts when package.json defines them", () => {
  const cwd = mkdtempSync(join(tmpdir(), "safe-install-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      scripts: {
        prepreinstall: "node -e \"require('fs').appendFileSync('install-scripts-ran', 'prepreinstall\\n')\"",
        preinstall: "node -e \"require('fs').appendFileSync('install-scripts-ran', 'preinstall\\n')\"",
        postpreinstall: "node -e \"require('fs').appendFileSync('install-scripts-ran', 'postpreinstall\\n')\"",
        install: "node -e \"require('fs').appendFileSync('install-scripts-ran', 'install\\n')\"",
        postinstall: "node -e \"require('fs').appendFileSync('install-scripts-ran', 'postinstall\\n')\"",
      },
    }),
  );

  execFileSync("node", [join(import.meta.dirname, "../dist/index.js"), "--package-lock-only"], {
    cwd,
    stdio: "pipe",
  });

  assert.equal(
    readFileSync(join(cwd, "install-scripts-ran"), "utf8"),
    "preinstall\ninstall\npostinstall\n",
  );
});

test("cli runs review-deps after separator", () => {
  const output = execFileSync("node", [join(import.meta.dirname, "../dist/index.js"), "--", "review-deps"], {
    encoding: "utf8",
  });

  assert.match(output, /No untrusted dependencies with install-time scripts found/);
});

test("node --run script can forward review-deps through npx-style script", () => {
  const cwd = mkdtempSync(join(tmpdir(), "safe-install-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      scripts: {
        "safe-install": `node ${JSON.stringify(join(import.meta.dirname, "../dist/index.js"))}`,
      },
    }),
  );
  writeFileSync(join(cwd, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {} }));

  const output = execFileSync("node", ["--run", "safe-install", "--", "review-deps"], {
    cwd,
    encoding: "utf8",
  });

  assert.match(output, /No untrusted dependencies with install-time scripts found/);
});

test("cli init writes package scripts, trustedDependencies, and review-deps script without changing npmrc", () => {
  const cwd = mkdtempSync(join(tmpdir(), "safe-install-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      scripts: {
        test: "node --test",
      },
    }),
  );
  writeFileSync(join(cwd, ".npmrc"), "ignore-scripts=false\n");

  execFileSync("node", [join(import.meta.dirname, "../dist/index.js"), "--", "init"], {
    cwd,
    stdio: "pipe",
  });

  assert.equal(
    readFileSync(join(cwd, ".npmrc"), "utf8"),
    "ignore-scripts=false\n",
  );

  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
    trustedDependencies?: string[];
  };
  assert.equal(pkg.scripts?.test, "node --test");
  assert.equal(
    pkg.scripts?.["safe-install"],
    "([ -n \"$CI\" ] && npm ci --ignore-scripts || npm install --ignore-scripts) && npm run --ignore-scripts rebuild-trusted-dependencies && npm run --ignore-scripts --if-present preinstall && npm run --ignore-scripts --if-present install && npm run --ignore-scripts --if-present postinstall",
  );
  assert.equal(pkg.scripts?.["review-deps"], "node scripts/review-deps.mjs");
  assert.equal(
    pkg.scripts?.["rebuild-trusted-dependencies"],
    "node -e \"const {spawnSync}=require('node:child_process'); const deps=require('./package.json').trustedDependencies ?? []; if (deps.length === 0) process.exit(0); const result=spawnSync('npm', ['rebuild', '--ignore-scripts=false', ...deps], {stdio:'inherit', shell: process.platform === 'win32'}); process.exit(result.status ?? 1);\"",
  );
  assert.deepEqual(pkg.trustedDependencies, []);
  assert.equal(existsSync(join(cwd, "scripts/review-deps.mjs")), true);
  assert.match(readFileSync(join(cwd, "scripts/review-deps.mjs"), "utf8"), /hasInstallScript/);
});
