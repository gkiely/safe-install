# safe-install

Run npm installs with dependency lifecycle scripts disabled by default, then
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

Optionally block subdependencies that use `git:`, `file:`, `link:`, or remote
tarball URL specifiers:

```txt
block-exotic-subdeps=true
```

2. Install `safe-install` without running dependency scripts:

```sh
npm i --ignore-scripts -D safe-install
```

3. Add scripts to `package.json`:

```json
{
  "scripts": {
    "safe-install": "safe-install"
  }
}
```

4. Find dependencies that declare install-time scripts:

```sh
npm run safe-install -- find
```

5. Review the output, then add trusted packages to `package.json`:

```json
{
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

## What `safe-install` does

`safe-install` runs npm install with scripts blocked, then runs install scripts only for packages listed in
`trustedDependencies`.

If `block-exotic-subdeps=true` is set in `.npmrc`, `safe-install` also
fails the install before rebuilding trusted dependencies when a transitive
dependency points outside the npm registry with a `git:`, `file:`, `link:`, or
remote tarball URL specifier.

Equivalent manual flow:

```sh
npm install --ignore-scripts
npm rebuild --ignore-scripts=false esbuild sharp
```

## Notes

Only add a package to `trustedDependencies` after reviewing why it needs an
install script. This does not make dependency scripts safe; it makes the trust
decision explicit and version-controlled.
