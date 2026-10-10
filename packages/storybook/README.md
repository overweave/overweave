# @overweave/storybook

Storybook for what is built on overweave: its config, a world drawn in a story — the UI's kinds and one's own, what is there before anything runs, addons run by the testkit's contract, a slot or any tree under a provider of its own, what failed listed below it — and the Overweave panel, where that world is read and its addons turned off and on.

| Entry | What | Needs |
|---|---|---|
| `@overweave/storybook` | `storybook()` for `.storybook/main.ts`; the panel's event types | `vite`, `@preact/preset-vite`, `storybook`, `@storybook/preact-vite` (optional peers: needed for this entry only) |
| `@overweave/storybook/preact` | `<WorldStory>`, `setPreviewChannel` | `@overweave/testkit`, `@overweave/ui`, `preact`, `@preact/signals` |
| `@overweave/storybook/manager` | The Overweave panel (Storybook loads it: `storybook()` adds the addon) | Storybook's manager (React and its API are there; `react` an optional peer) |

How the stories look — styles, a shadow root, themes, fonts, Storybook addons such as a11y — is the app's: its `.storybook/preview.tsx` and the `addons` it gives. What an addon is, is the app's too: a story runs any `{ id, setup, grant }` the way `everyOrder` does.

## The config

```ts
// .storybook/main.ts
import { storybook } from '@overweave/storybook';

export default storybook({
  stories: ['../src/**/*.stories.tsx', '../addons/*/src/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y'],
  conditions: ['my-app-source'],   // the workspace's packages read from their sources, as the app's build reads them
  cacheDir: '../node_modules/.vite/storybook',
  poll: true,                      // in Docker over a host's folder: no file events cross the mount
});
```

It adds the Overweave panel (`panel: false` leaves it out), sets Preact's renderer, JSX as Preact's (`@preact/preset-vite` — not added again when the app's `vite.config`, which Storybook takes too, has it; `react` left as React, Storybook's docs being drawn with it), one Preact and one `@preact/signals` (and its core) for the stories, the UI and the renderer (two would not know each other's elements), no telemetry.

Storybook's manager loads the panel from the package as built (`dist/manager.js`): in a workspace, build `@overweave/storybook` before starting Storybook (the source conditions are the preview's, not the manager's).

```tsx
// .storybook/preview.tsx — the panel's channel, given (else the one Storybook leaves on the page is taken)
import { setPreviewChannel } from '@overweave/storybook/preact';
import { addons } from 'storybook/preview-api';

setPreviewChannel(addons.getChannel());
```

## A story

```tsx
import { WorldStory } from '@overweave/storybook/preact';
import type { Meta, StoryObj } from '@storybook/preact-vite';
import { Column, ui } from '../kinds';
import images from './images';
import table from './table';

export default { title: 'Addons/Images' } satisfies Meta;

const addons = {
  table: { id: 'table', setup: table.setup },
  images: { id: 'images', setup: images.setup, grant: { priority: 200, rights: ['configure'] } },
};

export const Table: StoryObj<{ rows: number }> = {
  args: { rows: 3 },
  render: (args) => <WorldStory ui={ui} kinds={[Column]} addons={[addons.table]} slot="main" props={args} />,
};

/** The same table, the images addon over it: a layer seen next to the story without it. */
export const WithImages: StoryObj<{ rows: number }> = {
  args: { rows: 3 },
  render: (args) => <WorldStory ui={ui} kinds={[Column]} addons={[addons.table, addons.images]} slot="main" props={args} />,
};
```

| Prop | |
|---|---|
| `ui`, `kinds` | The UI's kinds (as `uiKinds` gives them) and one's own: the world is typed by them |
| `given` | What is there before any addon runs, at once: `(w) => w.as('core').add('Column', 'name', …)` — typed by the world's kinds; run when the world is made (a new `given` changes nothing until it is made again); a promise is listed as a failure |
| `addons` | Run in this order; one that fails to start is listed, the others run |
| `slot`, `props`, `retryKey` | The slot drawn and its props (the story's args; a typed slot asks for them); without a slot, the children are drawn |
| `matcher`, `onError` | The app's matcher; where failures go too |

The world is made when the story is drawn (never by a drawing given up), and again only when its kinds or its addons change (by id, setup and grant) — new args draw the slot again in the same world. The old world is stopped before the new one starts, and its tree drawn anew: nothing below holds on to a world let go of. With the story, the world is let go of: every addon stopped. What failed — the world's making (kinds that do not go together), `given`, an addon's start, a fill's or a wrap's drawing, a condition — is listed below the story (`[data-overweave-problems]`, unstyled: how it looks is the app's), each failure once however often it fails again, before the app's `onError` is called.

A fill on its own is its addon run alone over its slot.

## The Overweave panel

A tab beside Controls and Actions, for the story's `<WorldStory>` — several on a page: each kept by its name, one shown, chosen in the panel:

| Section | |
|---|---|
| Failed | An addon's start, `given`, a drawing, a condition |
| Addons | Each with its priority, rights, status (running, stopped, off, failed) and what it says now (`add Fill/images.badge`, a patch waiting). The checkbox turns it off: the world is made again without it — a layer seen without it, then with it again |
| Definitions | Every definition, filtered by `kind/name`: who defined it, who says each leaf (`title ← images`), its spec (functions by name) |
| Refused and conflicts | Patches rejected or dropped (with their codes); leaves two contributors of the same priority and tie-break both say |
| Renders | How many times each component of this world's tree rendered since it was made (another world's, the app's decorators: not counted; overweave's own `Overweave.*` hidden unless asked for); "count again" starts from zero — then change an arg, and see what drew again |

The story tells the panel over Storybook's channel when its registry changes or something fails; the panel asks again every second while it is open, renders being counted between changes, and draws nothing again when nothing changed. A world that answers two askings no more (gone, or the page drawn again) is forgotten. What could not be read is told as what failed, never thrown into the channel. Outside Storybook (no channel) nothing is told and nothing counted. Which addons are off is kept by the story's `<WorldStory>` for as long as it is drawn: drawn anew (another story), all are on.

Storybook and React are not installed here: the manager entry is written against the little of their API it uses (`addons.register`, `addons.add` with `types.PANEL`, `addons.getChannel`, `createElement`), and the panel itself is Preact, tested with a channel of its own. Not yet tried in a running Storybook.

## Checks

```bash
make check
```
