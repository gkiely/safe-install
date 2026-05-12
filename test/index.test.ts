import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNoBlockedExoticSubdeps,
  findInstallScriptDependencies,
  getInstallArgs,
  getSafeInstallConfig,
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

test("parseCommand treats positional package names as npm install args", () => {
  assert.deepEqual(parseCommand(["--no-audit", "--no-fund", "left-pad"]), {
    kind: "install",
    args: ["--no-audit", "--no-fund", "left-pad"],
  });
});

test("parseCommand only runs review-deps after a leading separator", () => {
  assert.deepEqual(parseCommand(["--", "review-deps"]), { kind: "review-deps" });
  assert.deepEqual(parseCommand(["review-deps"]), {
    kind: "install",
    args: ["review-deps"],
  });
});

test("parseCommand supports npm-run appended args with default flags", () => {
  assert.deepEqual(parseCommand(["--no-audit", "--no-fund", "--", "review-deps"]), {
    kind: "install",
    args: ["--no-audit", "--no-fund", "review-deps"],
  });
});
