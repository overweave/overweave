<p align="center"><img src=".github/logo.svg" alt="" width="120"></p>

# overweave

[![check](https://github.com/overweave/overweave/actions/workflows/check.yml/badge.svg)](https://github.com/overweave/overweave/actions/workflows/check.yml)
[![npm](https://img.shields.io/npm/v/@overweave/core)](https://www.npmjs.com/package/@overweave/core)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/overweave/overweave/badge)](https://scorecard.dev/viewer/?uri=github.com/overweave/overweave)

> **Experimental — 0.x.** The API will change before 1.0.

Overweave is a small TypeScript library for building apps that are assembled from layers. The app declares *kinds* of definitions (a column, a slot, a view); its *contributors* — its own code, plugins, the user, a config file, a server — add definitions and patch each other's fields, each at a priority and with the rights it was given. What several contributors say of one field is layered: the highest priority wins, what is under it shows again when it goes, and every field knows who set it. The core is only that. What the definitions mean, how they are drawn, kept or synced is the app's — and the other packages here are one answer for the UI.

## Why

- **Layered definitions.** A plugin renames a column, the user widens it, the app still owns its value. Nobody overwrites anybody: each says its part, the result is computed, and taking a contributor away (a plugin disabled, the user's settings reset) shows what was under it again.
- **Contributors with priorities and rights.** A kind names the right a patch of each field needs (`configure`, `behaviour` — the app's words). A contributor has some rights and a priority; the core only compares them. The user at priority 1000 wins over a plugin at 200, but a plugin without `behaviour` cannot touch a render function.
- **Every field knows who set it.** `provenanceOf(['header'])` says which contributor says the header now, by which operation, at what priority. A settings page, a debug panel, a "reset to default" button are reads, not bookkeeping.
- **The contract always holds.** A kind's required fields, list keys and validation are checked on every change; a patch that would break a definition is rejected, and one that no longer fits after the definition changed is dropped and told.

## Packages

| Package | What | README |
|---|---|---|
| `@overweave/core` | Kinds, contributors, `add` and `patch`, layering with provenance, events. No UI, no dependencies | [packages/core](packages/core/README.md), [the model](packages/core/MODEL.md) |
| `@overweave/ui` | The UI's concepts over the core — slots, fills, wraps, order, the user's arrangement — with no framework; `/preact` draws them with Preact; `/overlay` shows the slots over the page | [packages/ui](packages/ui/README.md) |
| `@overweave/testkit` | Testing what is built on them: a world of kinds and contributors, addons run and stopped, checks that throw; `/preact` draws a slot on its own and counts renders | [packages/testkit](packages/testkit/README.md) |
| `@overweave/storybook` | Storybook for what is built on them: the config, a world drawn in a story, the Overweave panel | [packages/storybook](packages/storybook/README.md) |

The packages share one version and ask for one another at `^` that version. They are plain ESM with type declarations, and ship their sources beside `dist/`.

## Install

The packages are on npmjs.org, public — no token, no `.npmrc`:

```bash
npm install @overweave/core
npm install @overweave/ui preact @preact/signals     # the UI, drawn with Preact
npm install -D @overweave/testkit                    # tests
```

Node 24 or later is used for development; the packages themselves target ES2022.

## Quick start

A kind, three contributors, one definition they share:

```ts
import { createRegistry, defineKind } from '@overweave/core';

interface Row {
  name: string;
}
interface ColumnSpec {
  header: string;
  width?: string;
  value: (row: Row) => string;
}

// A kind: its contract in one place. Rights are the app's words; the core only compares them.
const Column = defineKind<ColumnSpec>()('Column', {
  required: ['header', 'value'],
  patchRights: { header: 'configure', width: 'configure', value: 'behaviour' },
});

const registry = createRegistry({ kinds: [Column] });

const app = registry.contributor('app', { priority: 0 });
const plugin = registry.contributor('plugin', { priority: 200, rights: ['configure'] });
const user = registry.contributor('user', { priority: 1000, rights: ['configure'] });

app.add('Column', 'name', { header: 'Name', value: (row) => row.name });
plugin.patch('Column', 'name', { header: 'Full name' }); // { status: 'included', conflicts: [] }
user.patch('Column', 'name', { width: '120px' });

const column = registry.get('Column', 'name');
column?.spec; //                        { header: 'Full name', value, width: '120px' }
column?.provenanceOf(['header']); //    { contributor: 'plugin', operation: 'patch', priority: 200 }

registry.subscribe((event) => {
  // { type: 'changed', kind: 'Column', name: 'name' } …
});

plugin.dispose(); // everything it said, taken back
registry.get('Column', 'name')?.spec.header; // 'Name'
```

The same registry drawn with Preact — a slot, a fill put in it by the app:

```tsx
import { createRegistry } from '@overweave/core';
import { slot, uiKinds } from '@overweave/ui';
import { fill, OverweaveProvider, type PreactComponent, Slot } from '@overweave/ui/preact';
import { render } from 'preact';

const ui = uiKinds<PreactComponent>()({ configure: 'configure', behaviour: 'behaviour' });
const registry = createRegistry({ kinds: [ui.Slot, ui.Fill, ui.Wrap] });
const header = slot<{ title: string }>('header');

const app = registry.contributor('app', { priority: 0 });
app.add('Fill', 'app.title', fill(header, { order: 10, render: ({ title }) => <h1>{title}</h1> }));

render(
  <OverweaveProvider registry={registry}>
    <Slot name={header} props={{ title: 'Inbox' }} />
  </OverweaveProvider>,
  document.body,
);
```

A plugin adds a second fill to `header`, or patches `app.title`'s `order`, and the slot redraws — only what changed. The UI README has the rest: wraps, the user's arrangement, error boundaries, an app that is only a mount point.

## Documentation

- [`@overweave/core`](packages/core/README.md) — the registry's API; [MODEL.md](packages/core/MODEL.md) states the rules one by one (layering, waiting and dropped patches, `unset`, fallbacks, events).
- [`@overweave/ui`](packages/ui/README.md) — slots, fills, wraps, the Preact binding, the overlay.
- [`@overweave/testkit`](packages/testkit/README.md) — worlds, addons run in every order, checks, render counts.
- [`@overweave/storybook`](packages/storybook/README.md) — the Storybook config, `<WorldStory>`, the panel.

## Development

The repository is an npm workspace. Node runs in Docker through `make`, so only Docker is needed on the machine:

```bash
make check       # what CI checks: lint and format, types, tests, the built packages imported by Node
make lint        # or: format, typecheck, test, coverage — one of them (format rewrites files)
make dist        # build every package and import it as plain Node does
make bench       # the core and the UI under a real app's load, each run against the one before
```

With Node 24 installed, the same as plain npm scripts:

```bash
npm ci
npm run lint && npm run typecheck && npm test
npm run build && npm run check:dist
npm run bench
```

Tests are Vitest, one project per package, each reading the others from their sources (the `overweave-source` export condition). Lint and format are Biome (`biome.json` also keeps the layers apart: the core imports no framework, `@overweave/ui` imports no Preact outside `/preact`).

**Benches.** `make bench` runs the core and the UI under a real app's load — thousands of columns, fifty addons, a user's thousand changes, a hundred slots drawn, a virtual table of ten thousand rows streaming — and reports how long one change takes, how many components drew again, and what a world holds in memory. Results land in `bench-results/` (not in git), each run read against the one before. What does not depend on the machine — that one change costs about the same in a world ten times larger — is a test (`packages/core/bench/scaling.test.ts`), run by `make check`.

**Releases.** Every package carries the same version; `npm run check:version 0.5.0` says whether they do. A tag `v<version>` is checked as any push is, then published to npmjs.org and to GitHub Packages, and a GitHub release is made with each package's tarball attached (`.github/workflows/release.yml`). What changed in each version: [the releases](https://github.com/overweave/overweave/releases).

## Contributing

Issues and pull requests are welcome — [CONTRIBUTING.md](CONTRIBUTING.md) says how a change is made and checked. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). A vulnerability is reported privately: [SECURITY.md](SECURITY.md).

## License

MIT — [LICENSE](LICENSE).
