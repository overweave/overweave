# Contributing

Thanks for wanting to help. Issues and pull requests are welcome; for anything larger than a fix, open an
issue first, so the design can be agreed before the work.

## Setting up

Only Docker is needed: `make` runs Node (`node:24-alpine`) in a container, with the repository mounted.

```sh
make check      # what CI checks: lint and format, types, tests, the build, the built packages imported by Node
make test       # one of them: lint, format (rewrites the files), typecheck, test, coverage
make bench      # core and UI under a real app's load, each run against the one before
```

With Node 24 on your machine, the npm scripts do the same: `npm ci`, then `npm run lint`,
`npm run typecheck`, `npm test`, `npm run build`, `npm run check:dist`.

## A change

- **Tests with it.** A fix comes with the test that failed before it; a feature, with tests of what it
  promises. Tests sit beside the code (`*.test.ts`).
- **Small public API.** Every export is a promise: add one only when it is needed, and document it in
  its package's README.
- **No new runtime dependencies** in `@overweave/core` (it has none) without an issue agreeing to it.
- **Formatting** is Biome's: `make format`.
- **Commits** say what changed and why, as the history does: `feat(ui): …`, `fix(core): …`,
  `docs: …`, `ci: …`.

A pull request runs the checks (lint, types, tests, the build, the packages packed) and an audit of the
dependencies; both have to pass.

## Releases

Maintainers release: every package gets the same version (`scripts/check-version.mjs` checks it), and
a `v<version>` tag publishes each package to npmjs.com and to GitHub's npm registry, with a GitHub
release. Its notes are made from the pull requests' titles — so a title says what changed for those who
use it; what breaks, and how to move on, is added to the release by hand.

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues are reported
privately: see [SECURITY.md](SECURITY.md).

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
