# @overweave/testkit

Testing what is built on overweave — kinds, addons, slots — without the app: a world of kinds and contributors; addons run and stopped by the testkit's own contract, and owned by the world; what each says (read from the registry itself) and who says what; every event kept and marked; addons run in every order; with Preact, any tree or a slot drawn on its own and its renders counted. Checks throw, for any test runner.

| Entry | What | Needs |
|---|---|---|
| `@overweave/testkit` | `world`, `everyOrder`, checks, `cleanup` | `@overweave/core` |
| `@overweave/testkit/preact` | `mount`, `renderSlot`, `renderCounts`, `cleanup` | `@overweave/ui`, `preact`, `@preact/signals`, a DOM (happy-dom, jsdom) |

The domain (a cluster, its objects) is the app's fixtures. What an addon is, is the app's too: the testkit runs any `setup(contributor) → cleanup?` by its own contract — the one the shell in `@overweave/ui`'s README follows. A test of the app's real shell is still the app's to write.

**Cleanup.** `afterEach(cleanup)` — nothing is registered unasked. There is one `cleanup`, the same from either entry: it unmounts every tree, stops every counter, then disposes every world (every addon in it stopped) — whatever was loaded. What fails in it is thrown after all of it ran, each failure named (`images: …`).

## A world

```ts
import { defineKind } from '@overweave/core';
import { assertContributions, assertEmpty, assertNothingRefused, assertSays, cleanup, world } from '@overweave/testkit';
import { afterEach, it } from 'vitest';
import images from './images';                       // an addon: setup(contributor) => cleanup?

afterEach(cleanup);

const Column = defineKind<ColumnSpec>()('Column', { required: ['header', 'value'], patchRights: { header: 'configure', value: 'behaviour' } });

it('renames the status column', () => {
  const w = world({ kinds: [Column] });             // what is contributed to, before anything is
  w.as('core').add('Column', 'status', { header: 'Status', value: (p) => p.status });

  const run = w.run('images', images.setup, { priority: 200, rights: ['configure'] });

  assertContributions(w, 'images', [
    { kind: 'Column', name: 'images.image', operation: 'add', status: 'included' },
    { kind: 'Column', name: 'status', operation: 'patch', status: 'included' },
  ]);
  assertSays(w, 'Column', 'status', ['header'], 'images');
  assertNothingRefused(w);

  run.stop();
  assertEmpty(w, 'images');                         // nothing running, nothing of it left
});
```

| `world({ kinds })` | |
|---|---|
| `w.as(id, grant?)` | A contributor by id: made the first time (priority 0, no rights), the same one after — asked again with another grant: a throw. A running addon's id gives its contributor, but typed without its rights: keep the reference `as` first gave (or the setup's) to keep them. A disposed one forgets only itself |
| `w.run(id, setup, grant?)` | An addon run: its id (unused), its grant and its `kinds` checked — against the world and one another — before anything changes, then defined; `setup(contributor)` at once (a promise: a throw, its rejection handled; anything but a function or nothing given back: a throw); a throw takes back what it said and is thrown (its kinds stay defined) |
| `run.stop()` | Its cleanup (at once: a promise is a throw), then all it said taken back — even if the cleanup throws; again: nothing |
| `w.running()`, `w.stopAll()`, `w.dispose()` | The world owns its runs: disposing it stops them all (each, even if one throws), then lets the registry go |
| `w.contributionsOf(id)` | What a contributor says now — the registry's own account, so a contributor made outside the world is seen too |
| `w.knows(id)`, `w.whoSays(kind, name, path)`, `w.get(kind, name)` | Reading (typed by the world's kinds) |
| `w.snapshot()` | The definitions as plain data: spec (functions by name), who says each leaf. `plain(value)` is how: a class instance under its name, a Date as ISO, a Map's and Set's entries, a cycle cut as `[cycle]` |
| `w.events` | Everything told: `all()`, `of(type, since?)`, `rejected(since?)`, `dropped(since?)`, `conflicts(since?)`, `mark()` — what one action told: `const m = w.events.mark(); …; w.events.rejected(m)` |

Several worlds are several `world()` calls. A world of the UI's kinds and one's own: `uiWorld(ui, Column)` (`ui` as `uiKinds` gives it).

**Every order** — what is read must not depend on the order addons start in:

```ts
import { everyOrder, world } from '@overweave/testkit';

everyOrder(() => world({ kinds: [Column] }), [
  { id: 'table', setup: table.setup },
  { id: 'images', setup: images.setup, grant: { priority: 200, rights: ['configure'] } },
]);   // each order in a world of its own; a snapshot that differs: a CheckError naming the two orders
```

Every order while there are no more than `max` (720: six addons); past that a fixed sample of `max` — the given order, its reverse, every rotation, then shuffles from `seed` (default 1) — so every addon starts first and last at least once. A start that fails is thrown with its order (`in the order a → b, b failed to start: …`); a difference is a `CheckError` listing the definitions only one order has, and those it has otherwise. `{ max, seed }` to change them; the first order's snapshot is returned.

**Checks** — each throws a `CheckError` carrying `expected` and `actual` (a runner's diff reads them):

| | |
|---|---|
| `assertContributions(w, id, list)` | It says exactly these now — whatever their order, or the order of their fields |
| `assertGone(w, id)` | Nothing of it left — a contributor the world never knew is a mistake, not a pass |
| `assertEmpty(w, ...ids)` | No addon running, nothing of those named left |
| `assertSays(w, kind, name, path, id)` | Who says a leaf |
| `assertNothingRefused(w, since?)`, `assertNoConflicts(w, since?)` | Since a mark: an action's; without one, the world's whole history (fixtures too) |
| `assertResult(result, status, codes?)` | Codes only for `'rejected'` |
| `assertSameSnapshot(a, b)` | Two snapshots alike |

## Drawing, with Preact

```tsx
import { assertNothingRefused, uiWorld } from '@overweave/testkit';
import { act, cleanup, mount, renderCounts, renderSlot } from '@overweave/testkit/preact';
import { within } from '@testing-library/preact';
import { afterEach, expect } from 'vitest';

afterEach(cleanup);

const w = uiWorld(ui);                                     // the UI's kinds; header, Title, fill, Settings, Router, save: the app's
const counts = renderCounts();                             // started before drawing: what is drawn before it is not counted
const view = renderSlot(w, header, { count: 2 });          // a slot on its own (a typed slot asks for its props)

expect(view.text()).toBe('Pods (2)!');
view.act(() => w.as('user', { priority: 1000, rights: ['configure'] }).patch('Slot', 'header', { hidden: { badge: true } }));
expect(view.html()).toBe('<h1>Pods (2)</h1>');
expect(counts.of(Title)).toBe(1);                          // by the component, or by its name
act(() => w.as('core').add('Fill', 'x', fill));            // act on its own: no view needed
expect(view.failures).toEqual([]);                         // { phase, definition, error }
view.retry();                                              // a new retry key: what failed tried again

const page = mount(w, <Settings />, { wrapper: ({ children }) => <Router>{children}</Router> });
await page.act(async () => { await save(); });             // an async change: awaited
within(page.container).getByRole('button');                // Testing Library's queries work on the container
```

- `mount(world, tree, { matcher, wrapper })` — any tree under the world's provider, inside the app's providers; `renderSlot(world, slot, props, options)` is one.
- `act(change)` — on its own or a view's: a change and its drawing before it returns; an async change returns a promise that waits for both.
- `unmount()` — the tree let go of, its container removed; again: nothing; anything else after (reading `text()`, `html()`, `container` too): a throw. A first drawing that fails leaves nothing behind. `mount` without a DOM throws (`// @vitest-environment happy-dom`).
- `renderCounts()` — start it before drawing. Counters start and stop in any order (one hook for all, kept in the chain if something else hooks in after); a count covers every tree drawn while it counts — or, given `{ within: Root }`, only what renders below an element of `Root` (give each tree a root component of its own). Count by the component (`counts.of(Title)`) or by its name (`displayName`, else its name — give anonymous renders one). `all()` holds the testkit's and the UI's own components too (`Overweave.Slot`, `Overweave.Fill`, …): count yours by name or component rather than the total.

## Checks

```bash
make check
```
