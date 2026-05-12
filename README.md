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

2. Add script to `package.json`:

```json
{
  "scripts": {
    "safe-install": "npx -y @gkiely/safe-install -- --no-audit --no-fund"
  }
}
```

4. Find dependencies that declare install-time scripts:

```sh
npm run safe-install -- review-deps
```

5. Review the output, then add trusted packages to `package.json`. You can also
enable `blockExoticSubDeps` to fail installs when transitive dependencies point
outside the npm registry with `git:`, `file:`, `link:`, or remote tarball URL
specifiers.

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

## What `safe-install` does

`safe-install` runs npm install with scripts blocked, then runs install scripts only for packages listed in
`trustedDependencies`.

If `blockExoticSubDeps` is set to `true` in `package.json`, `safe-install` also
fails the install before rebuilding trusted dependencies when a transitive
dependency points outside the npm registry with a `git:`, `file:`, `link:`, or
remote tarball URL specifier.

Equivalent manual flow:

```sh
npm install --ignore-scripts --no-audit --no-fund
npm rebuild --ignore-scripts=false esbuild sharp
```

## Notes

Only add a package to `trustedDependencies` after reviewing why it needs an
install script. This does not make dependency scripts safe; it makes the trust
decision explicit and version-controlled.
