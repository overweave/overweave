# @overweave/core

Definitions of kinds, and what contributors say of them, layered. Nothing else, and no dependencies.

A **contributor** is the app's: an id, a priority, rights. The core knows nothing more of it — an extension, the user, a config file, a server are all contributors. It **adds** definitions of its own, and **patches** the fields of others' it has the rights for. What several say of one leaf (a field, a map's key, a keyed list's item and its fields) is **layered**: the highest priority wins; take a contributor away and what is under it shows again; every leaf knows who says it. What is read always holds the kind's contract.

```
core   (add, priority 0):      Column age { header: "Age", width: "70px", value }
addon  (patch, priority 200):             { header: "Created" }
user   (patch, priority 1000):            { width: "120px" }
───────────────────────────────────────────────────────────────────────────────
result:                        { header: "Created" (addon), width: "120px" (user), value (core) }
```

Who contributes, when, what definitions mean, how they are drawn, kept or watched reactively — the app's.

## Use

```ts
import { createRegistry, defineKind, unset } from '@overweave/core';

interface Pod { name: string; age: string }
interface ColumnSpec { header: string; width?: string; value: (row: Pod) => string }

// A kind: its contract, in one place. Rights are the app's words: the core only compares them.
const Column = defineKind<ColumnSpec>()('Column', {
  required: ['header', 'value'],
  patchRights: { header: 'configure', width: 'configure', value: 'behaviour' },   // the right a patch of each field needs
  validate: (spec) => (spec.width?.endsWith('px') === false ? [{ code: 'notPx', field: 'width' }] : undefined),
});

const registry = createRegistry({ kinds: [Column] });

const core  = registry.contributor('core', { priority: 0 });
const addon = registry.contributor('images', { priority: 200, rights: ['configure'] });
const user  = registry.contributor('user', { priority: 1000, rights: ['configure'] });

core.add('Column', 'age', { header: 'Age', width: '70px', value: (pod) => pod.age });
addon.patch('Column', 'age', { header: 'Created' });            // { status: 'included', conflicts: [] }
user.patch('Column', 'age', { width: '120px' });
user.patch('Column', 'age', { width: unset });                  // replaces the user's patch: width back to 70px
addon.patch('Column', 'age', { width: 'wide' });                // { status: 'rejected', errors: [{ code: 'invalid', … }] }
addon.patch('Column', 'age', { value: () => '' });              // does not compile; at run time: noRight 'behaviour'

registry.get('Column', 'age')?.spec;                            // { header: 'Created', width: '70px', value }
registry.get('Column', 'age')?.provenanceOf(['header']);        // { contributor: 'images', operation: 'patch', priority: 200 }
registry.subscribe((event) => { /* { type: 'changed', kind, name } … */ });

addon.dispose();                                                // everything it said, taken back
```

A contributor's `patch` replaces its patch before: say all it wants, each time (`{}` takes it back).

| API | What |
|---|---|
| `defineKind<S>()(name, contract)` | A kind: `required`, `patchRights` (field → right), `otherFieldsRight`, `createRight`, `merge` (`lists: { field: { key, required } }`, `maps`), `validate` |
| `createRegistry({ kinds })` | A registry, typed by its kinds; `registry.define(kind)` gives it typed with one more; `registry.accepts(kind)` says whether it may be defined (changing nothing) |
| `registry.contributor(id, { priority, rights, tieBreak })` | One who contributes (one per id at a time) |
| `contributor.add / patch / remove / dispose` | What it says, and taking it back; an answer: `included`, `waiting` (no add yet) or `rejected` |
| `unset`, `unsetItem(key)` | In a patch: take away what is under it (a field, a map's key, an item, an item's field) |
| `registry.get / list / inspect / contributions` | Frozen snapshots; diagnostics: everything said of a definition, everything a contributor says (waiting patches too) |
| `registry.subscribe / batch / dispose` | Told what happens (`changed`, `rejected`, `dropped`, `conflict`; last, `disposed`), once consistent; several changes at once |

Errors are codes (`ApplyError`), never words.

## Rules

- **One definer** per kind and name; another's `add` is rejected (`taken`). An add is checked as it will be read.
- **A patch** says only the fields its contributor has the rights for: a field named in `patchRights`, by its right; any other, by `otherFieldsRight`. Keyed lists merge item by item (by the key the kind names), maps key by key; anything else is said whole.
- **Layering**, leaf by leaf: the higher priority; at an equal one, a patch over the add; then the higher `tieBreak`; then the id sorting later — never the order things came in. Two patches at one priority and one tie-break saying different values are a conflict (only the id decides), told; a tie the app broke with `tieBreak` is none.
- **The contract always holds.** A patch that would break the definition is rejected (what was there stays). Patches of a definition nobody added wait for it; when its add comes or changes, or a patch is taken back, the patches are taken again from the most important down, and one that no longer fits is dropped (told).
- **`unset`** takes away what is under it, at the patch's priority; a required field cannot be unset.

Rule by rule: [MODEL.md](MODEL.md).

## Limits

- Rights are checked against what a contributor was given; `rights: string[]` read from a config types as "any right" — the types cannot know it. Rights are no security boundary: contributors run in the page's own JavaScript.
- `validate` is to be pure: the same spec, the same answer. Values kept by reference (functions, class instances) are not the core's to watch.
- Merging goes one level down (a field; a map's key; a list item's field). Deeper, a value is said whole.

## Checks

```bash
make check
```
