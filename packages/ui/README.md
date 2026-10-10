# @overweave/ui

UI concepts over `@overweave/core`, with no framework — and `@overweave/ui/preact`, drawing them with Preact, each part drawn again only when what it shows changed.

| Entry | What | Needs |
|---|---|---|
| `@overweave/ui` | Kinds of the UI (`Slot`, `Fill`, `Wrap`) checking their own fields; typed slot references (`slot`); order (`order`, `after`, loops); what a slot shows for some props — targets by the app's matcher, `when`, the user's arrangement; every fill of a slot; what wraps a fill; `UiContributor` | `@overweave/core` |
| `@overweave/ui/preact` | `<OverweaveProvider>`, `<Slot>` (fills in order, each inside its wraps, each kept apart), `<Guarded>`, `fill` (typed by a slot, narrowed by a guard), hooks and signals following the registry | `preact` and `@preact/signals` (peers, optional for the main entry only) |

The packages are plain ESM: they import in Node as they do in a bundler (`make check` builds them and imports them in Node).

## Kinds

```ts
import { createRegistry } from '@overweave/core';
import { uiKinds } from '@overweave/ui';
import type { PreactComponent } from '@overweave/ui/preact';

// The rights are the app's words: configuring (titles, order, targets, the arrangement) and behaviour (renders, conditions).
export const ui = uiKinds<PreactComponent>()({ configure: 'configure', behaviour: 'behaviour' });
const registry = createRegistry({ kinds: [ui.Slot, ui.Fill, ui.Wrap /*, the app's own */] });
```

| Kind | Fields | Rights |
|---|---|---|
| `Slot` | `title`, `userArranged`, `arrangement`, `hidden` | configure |
| `Fill` | `title`, `order`, `after`, `target` · `when`, `render` · `slot` | configure · behaviour · its definer's |
| `Wrap` | `order`, `after` · `when`, `render` · `wraps` | configure · behaviour · its definer's |

- **Checked**: each kind checks its fields' values (an arrangement is a list of names, an order a finite number, a `when` a function…); what would break a slot is rejected, never read. Every `uiKinds()` gives the same contracts: kinds made twice are the same kinds — of one copy of `@overweave/ui` (two copies in one bundle are two sets of kinds, and the provider takes only its own).
- **Names are one space per kind**: prefix what an addon names with its id (`images.badge`, `table.page`) — the same name of another's is `taken`.
- **Where a fill goes** (`slot`) and **what a wrap wraps** (`wraps`) are their definer's: no right patches them.
- **`hidden`** is a map of names: what several say of it merges name by name — an addon hides `b`, the user hides `a`, both are hidden; `{ b: false }` shows it again.
- **A slot need not be declared**: one nobody declares shows its fills as they are. What the user arranges — `arrangement` (the fills they put first), `hidden` — is a patch of the slot's definition, and waits until someone declares it. `userArranged: false`: neither is followed.
- **Order** is decided among all the slot's fills, then those for the props are kept: a fill `after` one that is not shown stays where it was put. A loop of `after`s goes last, together; what follows one of it still follows it.
- **`when`** is taken as true or false (`Boolean`); a `target` with no matcher is not shown, and told. A `when` that reads a signal makes the slot follow it.

`typeof ui` keeps the rights' names; `UiContributor<typeof ui, [typeof Column], 'configure'>` is a contributor of the UI's kinds and some of one's own, typed by the rights it is given — what an addon's setup is handed.

## Typed slots

```ts
import { slot } from '@overweave/ui';
import { fill } from '@overweave/ui/preact';

export const header = slot<{ pod: Pod }>('pod.header');
app.add('Fill', 'app.name', fill(header, { order: 10, render: ({ pod }) => <h1>{pod.name}</h1> }));   // pod: Pod

// A `when` that is a type guard narrows what the render is given.
const isRoute = (p: { object: KubeObject }): p is { object: KubeObject<IngressRouteSpec> } => p.object.kind === 'IngressRoute';
app.add('Fill', 'traefik.routes', fill(details, { target: { kind: 'IngressRoute' }, when: isRoute, render: ({ object }) => <Routes spec={object.spec} /> }));
```

- `fill(slot, spec)` types the fill's `when` and `render` by the slot's props. (`slotFill`, in the main entry, is the same with no framework.)
- `<Slot name={header} props={{ pod }} />` checks the props in JSX, and asks for them when the slot declares any; with `h()`, which cannot infer it, use `slotElement(header, { pod })`.
- `fillsOf(registry, header, props)` takes the render's and the target's types from the registry's kinds; `useSlotView` and `useSlotContributions` give fills whose render is a Preact component.
- `useDefinition(Column, name)`, `useDefinitions(Column)`, `definitionSignal(registry, Column, name)`: the spec typed by the kind (a kind's name works too, untyped).

Types check what is written; data that comes from elsewhere (a cluster, a file) is checked by the guard, at run time.

## With Preact

```tsx
import { render } from 'preact';
import { OverweaveProvider, Slot } from '@overweave/ui/preact';

render(
  <OverweaveProvider registry={registry} matcher={matcher} onError={({ phase, definition, error }) => console.warn(phase, definition.name, error)}>
    <Slot name={header} props={props} retryKey={generation}>nothing here</Slot>
  </OverweaveProvider>,
  document.body,
);
```

**Drawn the least number of times** — each case is a test of `src/preact/components.test.ts`, counting real renders:

| What changes | What is drawn again |
|---|---|
| A fill added to a slot | the slot, and that fill — no other fill |
| A fill, a slot, a wrap of another slot (mounted or not) | nothing |
| One fill's definition | that fill (and its wraps) |
| A wrap of another fill | nothing |
| The user moves or hides fills | the slot (its fills are moved, not drawn again) |
| Several changes in one `registry.batch` | the slot once |
| Data a fill reads (a signal) | that fill |
| The provider's parent, with a new `onError` | nothing (a `<Slot>` given element children draws its own selection again — not its fills) |
| One definition read by `useDefinition` | its readers only when that definition changes |
| A new `retryKey` | what failed — nothing else |

The guarantee holds while what the slot is given keeps its identity (its props, its children): **give `<Slot>` stable props** — `useMemo(() => ({ count }), [count])`, not `props={{ count }}` in the render, which draws every fill of the slot again each time the parent draws. Likewise a new `matcher` makes every slot choose, and draw, again; `onError` may be a new function each render. A wrap added to a fill, or taken away from it, **remounts** that fill (and the wraps inside it): its state starts again.

**Kept apart**: each fill and each wrap is drawn inside its own error boundary, keyed by its kind and name (`Fill:…`, `Wrap:…`).

- A fill that throws in drawing is not drawn; a **wrap is a decoration**: one that throws leaves what it wraps drawn — keep what children need (a context provider) out of wraps.
- Told to `onError` as `{ phase, definition, error }`: `'match'` (the app's matcher), `'when'` — told once per definition and phase, until the definition changes — and `'render'`. An `onError` that throws is not the slot's to fail for.
- Tried again when the definition changes, or when the slot's `retryKey` does: its fills' conditions and matching asked again, what failed in drawing drawn again — nothing else; going back to an older key brings no failure back. A wrap's condition is asked again when the wrap changes, not on a retry key. A failure that comes again on a try is caught again.
- A fill that failed is tried again only then: new props, or data it reads changing, do not.
- Not caught: event handlers, promises, timers — the app's.
- The slot's `children` are drawn when it **selects** nothing: a fill that draws nothing, or failed, is still selected.

**`<Guarded definition={column} fallback={…}>`** (its fallback is to be safe: it is not kept apart) keeps any definition's drawing apart the same way — a column's cell, a section inside a fill: what throws is told as that definition's (not as the fill around it), and it is tried again when that definition changes. Put it where a contribution is drawn inside something else's render.

**For a slot's tools**: `useSlotView(slot, props)` — what it shows and what the user hid, followed; `useSlotContributions(slot)` — every fill of it, whatever its conditions (a settings page lists these, not what one set of props selects).

**Reading**: `useDefinition`, `useDefinitions`; `definitionSignal`, `listSignal`, `versionOf`, `selection` anywhere. A definition read is the same object until it changes — that is what all of this compares. When the registry is disposed, what was read through them is gone too; a provider over it — given before or after — draws nothing, and throws nothing.

## An app that is only a mount point

The app need draw nothing itself: it makes the registry, decides which addons it trusts and where they stand, and mounts one slot. An addon brings its kinds and its pages; others add to them. The rules this leans on:

- **An addon's kinds are checked (`registry.accepts`, and against one another), then defined, before it contributes.** A patch to a kind the registry does not know is rejected (`unknownKind`) — only a patch to a known kind's definition nobody added yet waits. The same kind again is nothing, so every addon names the kinds it uses; one bringing another contract under a taken name is left out — checked first, so it leaves no kind of its own behind.
- **An addon says what it adds at once**, and gives back what to let go of when it stops (subscriptions, timers). A setup that returns a promise is refused. Stopping it twice does nothing; what it said is taken back even if its cleanup throws.
- **The order addons start in does not matter**: `images` starts before `table` here; its patch of `status` waits for `table`'s add.
- **The contributor is typed by the addon's kinds and the rights it asks for** (`UiContributor<typeof ui, KS, R>`); a list of addons lets go of those types (`AnyAddon`), and the shell's one cast hands each addon the contributor made for it.

```ts
import { type AnyKind, createRegistry, defineKind } from '@overweave/core';
import { h, render } from 'preact';
import { slot, type UiContributor, uiKinds } from '@overweave/ui';
import { fill, OverweaveProvider, type PreactComponent, Slot, useDefinitions } from '@overweave/ui/preact';

// ── shared (a small module the shell and the addons import): the UI's kinds, the root slot, what an addon is ──
export const ui = uiKinds<PreactComponent>()({ configure: 'configure', behaviour: 'behaviour' });
export const main = slot('app.main');

/** An addon: the kinds it uses, the rights it asks for, a setup that says what it adds — at once, and gives back what to let go of. */
export interface Addon<KS extends readonly AnyKind[] = readonly AnyKind[], R extends string = string> {
  id: string;
  kinds: KS;
  rights: readonly R[];
  setup(contributor: UiContributor<typeof ui, [...KS], R>): undefined | (() => void);
}
export const defineAddon = <const KS extends readonly AnyKind[], const R extends 'configure' | 'behaviour' = never>(addon: Addon<KS, R>) => addon;
/** Any addon, its own types let go of: what a shell keeps a list of (its setup is handed a contributor made for its kinds). */
export interface AnyAddon {
  id: string;
  kinds: readonly AnyKind[];
  rights: readonly string[];
  setup(contributor: never): undefined | (() => void);
}

// ── @pods/table: a kind, a page, its own slot ──
interface Pod {
  name: string;
  status: string;
  image: string;
}
const pods: Pod[] = [{ name: 'web-1', status: 'Running', image: 'nginx:1.27' }];

export interface ColumnSpec {
  header: string;
  order?: number;
  value: (pod: Pod) => string;
}
export const Column = defineKind<ColumnSpec>()('Column', {
  required: ['header', 'value'],
  patchRights: { header: 'configure', order: 'configure', value: 'behaviour' },
});
export const podsHeader = slot('pods.header');

function PodsTable() {
  const columns = [...useDefinitions(Column)].sort((a, b) => (a.spec.order ?? 0) - (b.spec.order ?? 0));
  return h(
    'section',
    null,
    h(Slot, { name: podsHeader }),
    h(
      'table',
      null,
      h('tr', null, columns.map((c) => h('th', { key: c.name }, c.spec.header))),
      pods.map((p) => h('tr', { key: p.name }, columns.map((c) => h('td', { key: c.name }, c.spec.value(p))))),
    ),
  );
}

export const table = defineAddon({
  id: 'table',
  kinds: [Column],
  rights: [],
  setup(c) {
    c.add('Fill', 'table.page', fill(main, { render: PodsTable }));
    c.add('Fill', 'table.title', fill(podsHeader, { order: 10, render: () => h('h1', null, 'Pods') }));
    c.add('Column', 'name', { header: 'Name', order: 10, value: (p) => p.name });
    c.add('Column', 'status', { header: 'Status', order: 20, value: (p) => p.status });
    return undefined;
  },
});

// ── @pods/images: adds to table's ──
export const images = defineAddon({
  id: 'images',
  kinds: [Column],
  rights: ['configure'],
  setup(c) {
    c.add('Column', 'images.image', { header: 'Image', order: 15, value: (p) => p.image });
    c.patch('Column', 'status', { header: 'State' });
    return undefined;
  },
});

// ── the app: a registry, the addons it trusts and where they stand, one root slot ──
const registry = createRegistry({ kinds: [ui.Slot, ui.Fill, ui.Wrap] });
const priorities: Record<string, number> = { table: 0, images: 200 };

const isThenable = (v: unknown) => typeof (v as { then?: unknown } | null)?.then === 'function';

/** An addon started: every kind it uses checked — against the registry and one another — before any is defined; its setup run (at once: no promise); stopped once: what it gave back, then what it said taken back, even if that throws. */
function start(addon: AnyAddon): { stop(): void } | undefined {
  const scratch = createRegistry();
  const clashing = addon.kinds.find((kind) => !registry.accepts(kind) || !scratch.accepts(kind) || (scratch.define(kind), false));
  if (clashing || !(addon.id in priorities)) {
    console.warn(`${addon.id} left out`, clashing ? `its ${clashing.name} is not the one there` : 'not trusted');
    return undefined;
  }
  for (const kind of addon.kinds) registry.define(kind);
  const contributor = registry.contributor(addon.id, { priority: priorities[addon.id], rights: addon.rights });
  let release: unknown;
  try {
    // The one cast: the contributor is made for the addon's kinds (defined just above) and rights.
    release = addon.setup(contributor as never);
    if (isThenable(release)) {
      Promise.resolve(release).catch(() => {});
      throw new Error('a setup says what it adds at once');
    }
  } catch (error) {
    contributor.dispose();
    console.warn(`${addon.id} left out`, error);
    return undefined;
  }
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        if (typeof release === 'function') release();
      } finally {
        contributor.dispose();
      }
    },
  };
}

const addons: AnyAddon[] = [images, table];
export const running = addons.map(start);

render(h(OverweaveProvider, { registry }, h(Slot, { name: main }, 'nothing yet')), document.body);
```

Drawn: `Pods` over a table `Name | Image | State` — `web-1 | nginx:1.27 | Running`. `images` stopped, it is `Name | Status` again.

## Data that streams: tables, pages, virtual rows

The registry holds how the UI is — its columns, fills, views, the user's arrangement — never the data it shows. Pods, rows, a watch's events live in the app's data: one signal per row (by its uid), the order a signal of its own. A table reads its columns from the registry (`useDefinitions(Column)`) and its rows from the data, and draws only the rows in view:

- a row's cells are a component that reads its row's signal — drawn again when that row changes, and only then;
- that component is kept when the table draws again (it scrolled, a row came): a class with `shouldComponentUpdate` on the row and the columns (signals follow function components, so the cells are one);
- the columns shown are derived once per list of columns (the registry keeps the list's identity until a column changes).

Measured (`make bench`, `packages/ui/bench/table.bench.ts`: 10 000 pods, 60 columns of which 50 are addons', 40 rows in view):

| What happens | What draws again | The registry |
|---|---|---|
| A pod in view changes | its row | not asked |
| A pod out of view changes; a second's 100 at once | nothing | not asked |
| A pod comes | the table (the window), no row | not asked |
| Scrolled a row, a page | the rows that came into view | not asked |
| The user hides a column; an addon adds one | the header, the rows in view | one change |

So the stream and the scroll never touch the engine; it works when what the UI is changes — a user's action, an addon coming. Two things are the app's to do well: a column's `value(row)` runs for each row in view at each of its changes (keep it pure and cheap); and a sort by a field that changes sorts everything again at each change (≈ 2.6 ms for 10 000) — keep the order apart and move only the row that changed when that matters. A size dragged (a column's width) lives in the component while it is dragged, and goes to the registry once, when it is let go: a change a frame is the registry's work every frame.

## Without a framework

```ts
import { fillsOf } from '@overweave/ui';

type Render = (props: { pod: Pod }) => string;
const ui = uiKinds<Render>()({ configure: 'configure', behaviour: 'behaviour' });
// …
fillsOf(registry, header, props, options).map((fill) => fill.spec.render(props)).join('\n');   // render: Render — no cast
```

A failure of choosing (`match`, `when`) is told once per definition and phase for one `options` object: keep one, not a new literal each call.

## Checks

```bash
make check
```
