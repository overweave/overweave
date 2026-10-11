# overweave

> **Experimental — 0.x.** The API will change before 1.0. Not on npmjs.com: the packages are in GitHub's registry (see [Releases](#releases)).

Concepts laid over one another. An app declares kinds of definitions; its contributors — its own code, plugins, the user, a file, a server — add definitions and patch each other's fields, each at its priority and with its rights; what they say is layered, with an owner for every field. The core is only that: what the definitions mean, who contributes and when, how anything is drawn or kept is the app's.

## Packages

| Folder | Package | What |
|---|---|---|
| `packages/core` | `@overweave/core` | Kinds, contributors with priorities and rights, `add` and `patch` (and `unset`), layering with provenance, contracts that always hold. No UI, no domain, no storage, no lifecycle, no dependencies |
| `packages/ui` | `@overweave/ui`, `@overweave/ui/preact`, `@overweave/ui/overlay` | The UI's concepts with no framework (slots, fills, wraps, order, the user's arrangement); drawing them with Preact (signals over `subscribe`, `<Slot>`, error boundaries); the slots over the page, for whoever writes fills |
| `packages/testkit` | `@overweave/testkit`, `@overweave/testkit/preact` | Testing what is built on them: a world of kinds and contributors, an addon run and stopped, what each said; a slot drawn on its own, its renders counted |
| `packages/storybook` | `@overweave/storybook`, `/preact`, `/manager` | Storybook for what is built on them: its config (Preact, one Preact, the workspace's sources); a world drawn in a story, what failed listed below it; the Overweave panel (who says what, addons off and on, renders) |

## Status

- `core` — under review ([README](packages/core/README.md), [the model](packages/core/MODEL.md)).
- `ui` — first version ([README](packages/ui/README.md)).
- `testkit` — first version; the UI's drawing tests are written with it ([README](packages/testkit/README.md)).
- `storybook` — first version, not yet tried in an app's Storybook ([README](packages/storybook/README.md)).

## Checks

Only Docker is needed:

```bash
make check
```

## Benches

The core and the UI under a real app's load — ≈ 4000 columns, 50 addons, the user's 1000 changes, 50 views of 100 filters; 100 slots of 5 fills drawn, 3000 components each reading a column; a virtual table of 10 000 pods streaming, its 60 columns from the registry — and one thing changing in it: how long, how many components drew again, how much memory a world holds and gives back.

```bash
make bench
```

The results land in `bench-results/` (not kept in git), each run read against the one before it. A time is the machine's: compare runs on one machine. What does not depend on it — that one change costs about the same in a world ten times larger — is a test (`packages/core/bench/scaling.test.ts`), run by `make check`.

## Releases

The packages are published to GitHub's npm registry. It asks for a token even to read: a GitHub token with `read:packages`, in the project's `.npmrc` (or, in GitHub Actions, the workflow's own token, given the package's access):

```ini
@overweave:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```bash
npm install @overweave/core@0.1.0
```

Each release on GitHub also carries every package as a tarball (`npm pack`).

A release is made by a tag: every package at that version (`npm run check:version 0.1.0` says whether they are), then

```bash
git tag v0.1.0
```

```bash
git push origin v0.1.0
```

The `release` workflow checks it as any push is checked, publishes each package to the registry (one with a `-` under the `next` tag), then packs each and attaches them to the release (a 0.x version, or one with a `-`, as a pre-release). Every push to `main` and every pull request is checked by the `check` workflow — what `make check` checks.

## License

MIT — [LICENSE](LICENSE).
