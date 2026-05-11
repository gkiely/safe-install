import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNoBlockedExoticSubdeps,
  findInstallScriptDependencies,
  getSafeInstallConfig,
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
