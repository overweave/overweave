// @vitest-environment happy-dom
import { createRegistry, defineKind } from '@overweave/core';
import { renderCounts } from '@overweave/testkit/preact';
import { type ComponentChildren, h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterAll, describe, it } from 'vitest';
import { measure, note, report } from '../../../scripts/bench/harness.ts';
import { uiKinds } from '../src/index.ts';
import { OverweaveProvider, type PreactComponent, Slot, useDefinition } from '../src/preact/index.ts';

/*
 * The UI under the load of a real page: 100 slots of 5 fills each drawn at
 * once, 100 wraps, 3000 columns each read by a component of its own — and
 * one thing changing in it. How long the change takes to be drawn, and how
 * many components drew again (the least: what changed, and nothing else).
 */

afterAll(() => report('ui'));

const ui = uiKinds<PreactComponent>()({ configure: 'configure', behaviour: 'behaviour' });
const Column = defineKind<{ header: string; width?: number }>()('Column', { required: ['header'], patchRights: { header: 'configure', width: 'configure' } });

const SLOTS = 100;
const FILLS = 5;
const COLUMNS = 3000;

const Item = ({ label }: { label?: string }) => h('span', null, label ?? 'item');
Item.displayName = 'Item';

function page() {
  const registry = createRegistry({ kinds: [ui.Slot, ui.Fill, ui.Wrap, Column] });
  const app = registry.contributor('app', { priority: 0 });
  const addon = registry.contributor('addon', { priority: 200, rights: ['configure'] });
  const user = registry.contributor('user', { priority: 1000, rights: ['configure'] });
  registry.batch(() => {
    for (let s = 0; s < SLOTS; s++) {
      app.add('Slot', `s${s}`, { title: `Slot ${s}` });
      for (let f = 0; f < FILLS; f++) app.add('Fill', `s${s}.f${f}`, { slot: `s${s}`, order: f, render: Item });
      app.add('Wrap', `s${s}.w`, { wraps: `s${s}.f0`, render: ({ children }: { children?: unknown }) => h('div', null, children as never) });
    }
    for (let c = 0; c < COLUMNS; c++) app.add('Column', `c${c}`, { header: `Column ${c}` });
  });
  return { registry, app, addon, user };
}

const Slots = () =>
  h(
    'div',
    null,
    Array.from({ length: SLOTS }, (_, s) => h(Slot, { key: s, name: `s${s}` })),
  );

const Header = ({ name }: { name: string }) => h('th', null, useDefinition(Column, name)?.spec.header);
Header.displayName = 'Header';

const Headers = () =>
  h(
    'tr',
    null,
    Array.from({ length: COLUMNS }, (_, c) => h(Header, { key: c, name: `c${c}` })),
  );

function drawn(registry: ReturnType<typeof page>['registry'], tree: ComponentChildren) {
  const container = document.createElement('div');
  act(() => render(h(OverweaveProvider, { registry }, tree), container));
  return () => act(() => render(null, container));
}

/** Renders one change makes, by component (overweave's own included). */
function rendersOf(change: () => void) {
  const counts = renderCounts();
  act(change);
  const all = counts.all();
  counts.stop();
  return all;
}

describe('drawing', () => {
  it('100 slots of 5 fills, drawn the first time', () => {
    const p = page();
    measure('draw', '100 slots × 5 fills, first drawing', (container) => act(() => render(h(OverweaveProvider, { registry: p.registry }, h(Slots, null)), container)), {
      prepare: () => document.createElement('div'),
      after: (container) => act(() => render(null, container)),
      time: 2000,
    });
  });
});

describe('one change on a full page', () => {
  const p = page();
  drawn(p.registry, h(Slots, null));
  let n = 0;
  it('a fill’s title changes', () => {
    measure('one change', 'a fill changes (100 slots drawn)', () => act(() => void p.addon.patch('Fill', 's7.f3', { title: `t${n++}` })));
    note(
      'one change',
      '… renders',
      rendersOf(() => void p.addon.patch('Fill', 's7.f3', { title: `t${n++}` })),
    );
  });
  it('a fill is added to one slot', () => {
    measure('one change', 'a fill added (100 slots drawn)', () => act(() => void p.addon.add('Fill', `late-${n++}`, { slot: 's9', order: 9, render: Item })));
    note(
      'one change',
      '… renders (a fill added)',
      rendersOf(() => void p.addon.add('Fill', `late-${n++}`, { slot: 's9', order: 9, render: Item })),
    );
  });
  it('the user rearranges a slot', () => {
    let flip = false;
    const rearrange = () => {
      flip = !flip;
      p.user.patch('Slot', 's11', { arrangement: flip ? ['s11.f4', 's11.f3'] : ['s11.f0'] });
    };
    measure('one change', 'the user rearranges a slot', () => act(rearrange));
    note('one change', '… renders (rearranged)', rendersOf(rearrange));
  });
  it('a column changes, under the slots — nothing of theirs', () => {
    measure('one change', 'a column changes (no slot reads it)', () => act(() => void p.addon.patch('Column', 'c5', { width: n++ })));
  });
});

describe('3000 columns, each read by its own component', () => {
  const p = page();
  drawn(p.registry, h(Headers, null));
  let n = 0;
  it('one column changes', () => {
    measure('3000 readers', 'one column’s header changes', () => act(() => void p.addon.patch('Column', 'c42', { header: `h${n++}` })));
    note(
      '3000 readers',
      '… renders',
      rendersOf(() => void p.addon.patch('Column', 'c42', { header: `h${n++}` })),
    );
  });
  it('a column is added', () => {
    measure('3000 readers', 'a column added (none reads it)', () => act(() => void p.addon.add('Column', `late-${n++}`, { header: 'late' })));
  });
});
