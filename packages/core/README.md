# @overweave/core

Definitions of kinds, and what contributors say of them, layered. Nothing else, and no dependencies.

A **kind** is a type of definition with a contract: which fields are required, the right a patch of each field needs, how lists and maps merge, how a whole definition is validated. A **contributor** is the app's: an id, a priority, rights. The core knows nothing more of it — an extension, the user, a config file, a server are all contributors. It **adds** definitions of its own, and **patches** the fields of others' it has the rights for. What several say of one leaf (a field, a map's key, a keyed list's item and its fields) is **layered**: the highest priority wins; take a contributor away and what is under it shows again; every leaf knows who says it. What is read always holds the kind's contract.

```
app    (add, priority 0):      Column age { header: "Age", width: "70px", value }
addon  (patch, priority 200):             { header: "Created" }
user   (patch, priority 1000):            { width: "120px" }
───────────────────────────────────────────────────────────────────────────────
result:                        { header: "Created" (addon), width: "120px" (user), value (app) }
```

Who contributes, when, what definitions mean, how they are drawn, kept or watched reactively — the app's. ([`@overweave/ui`](../ui/README.md) is one answer for the UI; [`@overweave/testkit`](../testkit/README.md) tests what is built on either.)

## Install

```bash
npm install @overweave/core
```

Plain ESM with type declarations, ES2022, no dependencies. Part of the [overweave](../../README.md) workspace.

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

### A kind

`defineKind<Spec>()(name, contract)` — two calls: the spec's type is given, the name and the contract's literal rights are inferred (so the types know which fields a contributor with which rights may patch).

| Contract field | Meaning |
|---|---|
| `required` | Fields an `add` must give, and no patch may take away |
| `patchRights` | Per field, the right a patch of it needs; a right for a field the spec has not is a type error |
| `otherFieldsRight` | The right a patch of a field not named in `patchRights` needs (none: only the definer's add says such fields) |
| `createRight` | The right an `add` needs (none: anyone may add) |
| `merge.lists` | Lists of objects merged item by item: `{ field: { key, required } }` — the field telling items apart, and the fields every item must have |
| `merge.maps` | Object fields merged key by key. Anything else is said whole |
| `validate` | Problems (`{ code, field? }`) with a whole definition, given a frozen copy; pure |

### A registry

| API | What |
|---|---|
| `createRegistry({ kinds })` | A registry, typed by its kinds |
| `registry.define(kind)` | One more kind; gives the registry typed with it. The same kind again is nothing; another contract under a taken name throws |
| `registry.accepts(kind)` | Whether a kind may be defined (its name free, or taken by the same contract) — changing nothing, so several can be checked before any is defined |
| `registry.contract(kind)`, `registry.kinds()` | A kind's contract (frozen); the kinds' names |
| `registry.contributor(id, { priority, rights, tieBreak })` | One who contributes: one per id at a time (another throws) |
| `contributor.add(kind, name, spec, { fallback }?)` | A definition of its own, whole; adding it again replaces it |
| `contributor.patch(kind, name, fields)` | Some fields, as the kind merges them; replaces its patch before; `{}` takes it back |
| `contributor.remove(kind, name)`, `contributor.dispose()` | What it said of one definition, or everything, taken back |
| `unset`, `unsetItem(key)` | In a patch: take away what is under it (a field, a map's key, a list's item, an item's field) |
| `registry.get(kind, name)`, `registry.list(kind)` | Frozen snapshots: the definition, or a kind's definitions by name |
| `definition.spec`, `.definedBy`, `.leaves`, `.provenanceOf(path)` | The merged spec; who added it; every leaf with who says it; who says what is at a path |
| `registry.inspect(kind, name)` | Diagnostics: every contribution to a definition — waiting too — with its priority, tie-break and leaves |
| `registry.contributions(id)` | Everything a contributor says now (adds, patches, waiting ones), in the order it first touched each definition |
| `registry.subscribe(listener)` | Told what happens, once the registry is consistent; gives back the unsubscribe |
| `registry.batch(fn)` | Several changes at once: subscribers told after them all |
| `registry.dispose()` | Everything let go; nothing may be contributed after |

Every `add` and `patch` answers at once (`ApplyResult`): `{ status: 'included', conflicts }`, `{ status: 'waiting' }` (a patch of a definition nobody added yet), or `{ status: 'rejected', errors }`. Errors are codes (`ApplyError`), never words: `unknownKind`, `notAnObject`, `required`, `notPatchable`, `noRight`, `notAList`, `notAMap`, `missingKey`, `duplicateKey`, `badData`, `unsafeName`, `unsetInAdd`, `invalid` (the kind's `validate`), `taken`, `disposed`.

Events (`RegistryEvent`): `changed` (a definition reads differently: added, changed, gone), `rejected`, `dropped` (a patch that no longer fits, taken away), `conflict` (two patches at one priority and tie-break say different values; only the id decides), and last `disposed`.

### Fallback adds

`add(kind, name, spec, { fallback: true })` is a default that yields: it stands only while nobody adds the definition. Another contributor's add takes its place and the patches move over to it; when that add goes, the fallback is read again, the patches over it. While shadowed, the fallback is listed as `waiting` (`contributions`, `inspect`). One fallback per kind and name, as one definer: a second is `taken`.

```ts
core.add('Board', 'main', { title: 'Default board' }, { fallback: true });
user.patch('Board', 'main', { subtitle: 'mine' });
registry.get('Board', 'main')?.spec;        // { title: 'Default board', subtitle: 'mine' } — definedBy 'core'
theme.add('Board', 'main', { title: 'Themed' });
registry.get('Board', 'main')?.spec;        // { title: 'Themed', subtitle: 'mine' } — definedBy 'theme'
theme.remove('Board', 'main');              // the fallback is back, the user's subtitle still on it
```

### Types

The registry and its contributors are typed by their kinds: `add` asks for the spec; `patch` offers only the fields the contributor's rights open, and only as the kind merges them (`unset` only on optional fields, items by their key); `get` and `list` give the spec typed. What a contributor was given as `rights: string[]` (read from a config) types as "any right": the types cannot know it.

| Type | What |
|---|---|
| `Kind`, `KindContract`, `ListRule`, `Problem` | A kind and its contract |
| `SpecOf<K>`, `ContractOf<K>`, `KindsByName<KS>` | Taken from a kind, or a list of kinds |
| `Registry<KM>`, `Contributor<KM, R>`, `ContributorOptions`, `AddOptions` | The registry and a contributor, typed by the kinds (by name) and the rights `R` |
| `PatchOf<K, F>`, `PatchableBy<K, R>`, `CreatableBy<KM, R>`, `FieldPatch`, `ItemPatch`, `Unset`, `UnsetItem` | What a patch may say, and what rights open |
| `Definition<S>`, `Leaf`, `Provenance`, `Operation`, `DeepReadonly<T>` | What is read |
| `ApplyResult`, `ApplyError`, `Conflict`, `RegistryEvent`, `Inspection`, `ContributionOf` | Answers, events, diagnostics |
| `AnyKind`, `AnySpec` | A kind, a spec, whatever its type |

## Rules

- **One definer** per kind and name; another's `add` is rejected (`taken`). An add is checked as it will be read.
- **A patch** says only the fields its contributor has the rights for: a field named in `patchRights`, by its right; any other, by `otherFieldsRight`. Keyed lists merge item by item (by the key the kind names), maps key by key; anything else is said whole.
- **Layering**, leaf by leaf: the higher priority; at an equal one, a patch over the add; then the higher `tieBreak`; then the id sorting later — never the order things came in. Two patches at one priority and one tie-break saying different values are a conflict (only the id decides), told; a tie the app broke with `tieBreak` is none.
- **The contract always holds.** A patch that would break the definition is rejected (what was there stays). Patches of a definition nobody added wait for it; when its add comes or changes, or a patch is taken back, the patches are taken again from the most important down, and one that no longer fits is dropped (told).
- **`unset`** takes away what is under it, at the patch's priority; a required field cannot be unset.
- **What is read is frozen**, and the same object until it changes (a kind's list too): compare by identity. What was given is copied first; functions and class instances are kept by reference.

Rule by rule, with the words: [MODEL.md](MODEL.md). The rules are tested in `src/registry.test.ts`.

## Limits

- Rights are checked against what a contributor was given; `rights: string[]` read from a config types as "any right" — the types cannot know it. Rights are no security boundary: contributors run in the page's own JavaScript.
- `validate` is to be pure: the same spec, the same answer. Values kept by reference (functions, class instances) are not the core's to watch.
- Merging goes one level down (a field; a map's key; a list item's field). Deeper, a value is said whole.
- Plain data only, up to 64 levels deep: a cycle, a sparse array, a deeper value is `badData` — and so is an `unsetItem` anywhere but as a keyed list's item. `__proto__`, `constructor` and `prototype` are never taken as names (`unsafeName`).

## Development

See the [workspace README](../../README.md#development): `make check` runs lint, types, tests and the built package imported by Node.

## License

MIT — [LICENSE](LICENSE).
