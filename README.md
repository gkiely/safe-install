# safe-install

Run npm install with dependency lifecycle scripts disabled by default, then
rebuild only the packages you explicitly trust.

`safe-install` is for npm projects that want trusted dependency installs without
switching package managers.

## Why

npm lifecycle scripts can run arbitrary code during install. Setting
`ignore-scripts=true` blocks that whole class of install-time execution, but it
also breaks packages that legitimately need `postinstall`, `install`, or
`preinstall` scripts to build native bindings, download binaries, or finish
setup.

This package keeps the default install locked down and moves script execution
behind a reviewed allowlist in `package.json`.

## Setup

1. Add this to `.npmrc`:

```txt
ignore-scripts=true
```

Optionally enable (requires npm v11.10.0+):

```txt
allow-git=root
```

2. Add script to `package.json`:

```json
{
  "scripts": {
    "safe-install": "npx -y @gkiely/safe-install@0.1.26"
  }
}
```

3. Find dependencies that declare install-time scripts:

```sh
npm run safe-install -- review-deps
```

5. Review the output, then add trusted packages to `package.json`. You can also
enable `blockExoticSubDeps` as a lockfile-level backstop for transitive
dependencies that point outside the npm registry with `git:`, `file:`, `link:`,
or remote tarball URL specifiers.

```json
{
  "blockExoticSubDeps": true,
  "trustedDependencies": [
    "esbuild",
    "sharp"
  ]
}
```

6. Use `safe-install` for future installs:

```sh
npm run safe-install
```

7. If your project defines its own install lifecycle scripts, `safe-install`
runs them after dependency installation:

```json
{
  "scripts": {
    "preinstall": "node scripts/preinstall.js",
    "install": "node scripts/install.js",
    "postinstall": "node scripts/setup.js"
  }
}
```

You can pass npm install args through:

```sh
npm run safe-install left-pad@latest
npm run safe-install --save-dev left-pad@latest
```

You can run npm update through the same command:

```sh
npm run safe-install update
```

## What `safe-install` does

`safe-install` runs npm install with scripts blocked, then runs install scripts only for packages listed in
`trustedDependencies`.

It also runs your project's own `preinstall`, `install`, and `postinstall`
scripts when they are defined in the root `package.json`.

If `blockExoticSubDeps` is set to `true` in `package.json`, `safe-install` also
fails the install before rebuilding trusted dependencies when a transitive
dependency points outside the npm registry with a `git:`, `file:`, `link:`, or
remote tarball URL specifier.

Equivalent manual flow:

```sh
npm install --ignore-scripts
npm rebuild --ignore-scripts=false esbuild sharp
npm run --ignore-scripts --if-present preinstall
npm run --ignore-scripts --if-present install
npm run --ignore-scripts --if-present postinstall
```

## Notes

Only add a package to `trustedDependencies` after reviewing why it needs an
install script. This does not make dependency scripts safe; it makes the trust
decision explicit and version-controlled.

## Generate local scripts

If you do not want your install script to call `npx -y @gkiely/safe-install`,
run the initializer once:

```sh
npx -y @gkiely/safe-install@0.1.26 init
```

It creates `safe-install`, `review-deps`, and
`rebuild-trusted-dependencies` package.json scripts, plus `scripts/review-deps.mjs`.
