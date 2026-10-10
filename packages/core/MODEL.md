# The model

How definitions are contributed, layered and read. The rules below are tested in `src/registry.test.ts`, with the regressions of the reviews.

## Words

| Word | Meaning |
|---|---|
| definition | `(kind, name) → spec` |
| kind | A definition's type and its **contract** (`defineKind`) |
| contributor | Who says something: an id, a priority, rights, a tie-break — the app's (an extension, the user, a file) |
| right | A word of the app's: a kind names the right a patch of each field (and an add) needs; a contributor has some |
| contribution | What one contributor says of one definition by one operation (`add` or `patch`) |
| definer | The contributor whose `add` a definition is |
| leaf | What is layered: a field; a map's key; a keyed list's item, and each of its fields; a collection's container |
| included / waiting | A patch counted, or kept until the definition's add comes |

## Kinds

| Contract field | Meaning |
|---|---|
| `required` | Fields an `add` must give, and no patch may take away. |
| `patchRights` | Per field, the right a patch of it needs. |
| `otherFieldsRight` | The right a patch of a field not named in `patchRights` needs (none: only the definer's add says it). |
| `createRight` | The right an `add` needs (none: any contributor may add). |
| `merge.lists` | Lists of objects merged item by item: `{ field: { key, required } }` — the field telling items apart, and the fields every item must have. |
| `merge.maps` | Objects merged key by key. Anything else is said whole. |
| `validate` | Problems (`{ code, field? }`) with a whole definition; given a frozen copy; to be pure. |

The registry keeps its own frozen copy of a contract. The same kind again (a copy of its contract too) is nothing; another contract under its name is refused. `define(kind)` adds one later; `accepts(kind)` says beforehand, changing nothing — so several kinds can be checked before any is defined.

## Operations

A contributor has at most one add and one patch per definition; saying it again replaces it.

| Operation | Rule |
|---|---|
| `add` | The whole definition. **One definer per (kind, name):** another's add is rejected (`taken`), before anything else is checked. Checked as it will be read: required fields, items' keys (no two alike) and required fields, `validate`. |
| `patch` | Only fields its contributor has the rights for (`noRight`; no right opens it: `notPatchable`). It replaces the contributor's patch before; `{}` takes it back. |

**Rejected** (nothing changes): a field without the right; a collection of the wrong shape (`notAList`, `notAMap`, `missingKey`, `duplicateKey`); a name that would reach a prototype (`unsafeName`); data that cannot be copied (`badData`: a cycle, deeper than 64, a sparse array); `unset` in an add; an unknown kind; a disposed contributor or registry; and a patch that would break the definition (`required`, `invalid`). Errors are codes.

## The contract always holds

What is read is valid by its kind's contract:

- an add is checked as it will be read;
- a patch of a definition that exists is checked with every other counted patch: breaking it, it is **rejected**, and what was there stays;
- a patch of a definition nobody added **waits** for it;
- when the add comes or changes, and when a patch is taken back, the patches are **taken again**: over the add, the most important first (priority, tie-break, id), each kept if the definition stays valid with it; one that does not is **dropped** — taken away, and told (`dropped`).

Which patches are kept then depends only on the patches there are, not on the order they came in. A rejection does depend on what was there when the patch came: it is the answer to that patch.

## Layering

For every leaf the value is the one of:

1. the highest **priority**;
2. at an equal priority, a `patch` over the `add`;
3. then the higher **tie-break** (default 0);
4. then the id sorting later.

Two patches at one priority and one tie-break saying different values are a **conflict** — only their ids decide: the one that wins wins, the result says so, and it is told (`conflict`) when it comes. A tie the app broke (another `tieBreak`) is none. Saying exactly the same again changes nothing and tells nothing (a list's order counts; functions are the same only if they are the same function).

What is read is the same whatever the order contributions came in: values, the order of keys and items (the definer's first, then the patches', the least important first), leaves, provenance.

**`unset`** in a patch takes away what is under it at its priority: a field (`{ subtitle: unset }`), a map's key (`{ values: { a: unset } }`), an item (`unsetItem('tiles')`), an item's field. What is said above it stays. Taken back, what is under it shows again. A required field cannot be unset.

**Taking back** (`remove`, `dispose`) shows what is under it again. A disposed contributor says nothing more — from the moment it is disposed, a listener told of its going included.

## Reading

- `get(kind, name)` and `list(kind)` (by name) give **frozen snapshots**. What was given is copied first; functions and class instances are kept by reference.
- Every leaf has its **provenance**: `{ contributor, operation, priority }`; `provenanceOf(path)`: a field of parts, the part that wins over the others. A leaf taken away is read with the value `unset`.
- A definition read is **the same object** until it changes (a kind's list too): who compares can compare by identity.
- `subscribe(listener)` is told what happens — `changed`, `rejected`, `dropped`, `conflict`, and last `disposed` (everything read from it is gone; disposed from a listener too) — once the registry is consistent, in order; what a listener does is told after it; a listener that throws changes nothing. `batch(fn)` tells after several changes.
- `inspect(kind, name)` shows every contribution to a definition — waiting too — with its priority and tie-break; `contributions(id)`, everything a contributor says now, in the order it first touched each definition (none once it is gone).
