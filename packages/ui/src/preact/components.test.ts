// @vitest-environment happy-dom
import { createRegistry, type Definition, defineKind } from '@overweave/core';
import { uiWorld } from '@overweave/testkit';
import { act, cleanup, mount, renderCounts, renderSlot } from '@overweave/testkit/preact';
import { signal } from '@preact/signals';
import { render, cleanup as unrender } from '@testing-library/preact';
import { type ComponentChildren, h } from 'preact';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { slot, type UiContributor, uiKinds } from '../index.ts';
import {
  definitionSignal,
  fill,
  Guarded,
  listSignal,
  OverweaveProvider,
  type PreactComponent,
  Slot,
  type SlotProps,
  slotElement,
  useDefinition,
  useDefinitions,
  useSlotContributions,
  useSlotView,
} from './index.ts';

/*
 * Slots drawn with Preact — each drawn the least number of times: a slot
 * again only when what it selects changed, a fill only when its definition,
 * its props or its wraps changed, a definition read in a component only
 * when that definition changed. Each fill and wrap kept apart, keyed by
 * its definition; tried again on a retry key. Drawn and counted with the
 * testkit; what is the provider's own (its onError, its registry, no
 * provider at all) drawn by hand.
 */

const ui = uiKinds<PreactComponent>()({ configure: 'configure', behaviour: 'behaviour' });
const Provider = OverweaveProvider;

afterEach(() => {
  unrender();
  cleanup();
});

/** A fill component that counts its renders by its name. */
function Counted(name: string, text = name): PreactComponent {
  const C = () => h('span', null, text);
  C.displayName = name;
  return C;
}

/** A world of the UI's kinds, its contributors, and renders counted from the start. */
function setup() {
  const w = uiWorld(ui);
  const app = w.as('app');
  const addon = w.as('addon', { priority: 200, rights: ['configure'] });
  const user = w.as('user', { priority: 1000, rights: ['configure'] });
  const counts = renderCounts();
  const count = (...names: string[]) => names.map((n) => counts.of(n));
  return { w, app, addon, user, counts, count };
}

const wrapWith =
  (tag: string): PreactComponent =>
  ({ children }: { children?: ComponentChildren }) =>
    h(tag, null, children);

describe('the least renders', () => {
  it('draws each fill once; adding a fill draws only it', () => {
    const { w, app, count } = setup();
    app.add('Fill', 'a', { slot: 's', order: 1, render: Counted('A') });
    app.add('Fill', 'b', { slot: 's', order: 2, render: Counted('B') });
    const view = renderSlot(w, 's');
    expect(count('Overweave.SlotView', 'A', 'B')).toEqual([1, 1, 1]);
    view.act(() => app.add('Fill', 'c', { slot: 's', order: 3, render: Counted('C') }));
    expect(view.text()).toBe('ABC');
    expect(count('Overweave.SlotView', 'A', 'B', 'C')).toEqual([2, 1, 1, 1]);
  });

  it('draws nothing again for a change in another slot, nor in the slot’s kind elsewhere', () => {
    const { w, app, count } = setup();
    app.add('Fill', 'a', { slot: 's', render: Counted('A') });
    app.add('Fill', 'x', { slot: 'other', render: Counted('X') });
    const view = mount(w, h('div', null, h(Slot, { name: 's' }), h(Slot, { name: 'other' })));
    expect(count('Overweave.SlotView', 'A', 'X')).toEqual([2, 1, 1]);
    view.act(() => app.add('Fill', 'y', { slot: 'other', render: Counted('Y') }));
    view.act(() => app.add('Fill', 'z', { slot: 'unmounted', render: Counted('Z') }));
    view.act(() => app.add('Slot', 'unmounted', { title: 'U' }));
    // One more for the slot "other" (it shows y); none for "s", none for A.
    expect(count('Overweave.SlotView', 'A', 'X', 'Y')).toEqual([3, 1, 1, 1]);
  });

  it('draws again only the fill that changed', () => {
    const { w, app, addon, count } = setup();
    app.add('Fill', 'a', { slot: 's', order: 1, render: Counted('A') });
    app.add('Fill', 'b', { slot: 's', order: 2, render: Counted('B') });
    const view = renderSlot(w, 's');
    view.act(() => addon.patch('Fill', 'b', { title: 'Bee' }));
    expect(count('A', 'B')).toEqual([1, 2]);
  });

  it('draws nothing again for a wrap of another fill; for one of its own, that fill once', () => {
    const { w, app, addon, count } = setup();
    app.add('Fill', 'a', { slot: 's', order: 1, render: Counted('A') });
    app.add('Fill', 'b', { slot: 's', order: 2, render: Counted('B') });
    app.add('Fill', 'elsewhere', { slot: 'other', render: Counted('E') });
    const view = renderSlot(w, 's');
    view.act(() => addon.add('Wrap', 'w-elsewhere', { wraps: 'elsewhere', render: wrapWith('b') }));
    expect(count('Overweave.SlotView', 'A', 'B')).toEqual([1, 1, 1]);
    view.act(() => addon.add('Wrap', 'w-b', { wraps: 'b', render: wrapWith('b') }));
    expect(count('Overweave.SlotView', 'A', 'B')).toEqual([1, 1, 2]);
    expect(view.html()).toBe('<span>A</span><b><span>B</span></b>');
  });

  it('draws the fills of a slot the user arranges no more: they are moved, not drawn again', () => {
    const { w, app, user, count } = setup();
    app.add('Slot', 's', {});
    app.add('Fill', 'a', { slot: 's', order: 1, render: Counted('A') });
    app.add('Fill', 'b', { slot: 's', order: 2, render: Counted('B') });
    const view = renderSlot(w, 's');
    view.act(() => user.patch('Slot', 's', { arrangement: ['b'] }));
    expect(view.text()).toBe('BA');
    view.act(() => user.patch('Slot', 's', { arrangement: ['b'], hidden: { a: true } }));
    expect(view.text()).toBe('B');
    expect(count('Overweave.SlotView', 'A', 'B')).toEqual([3, 1, 1]);
  });

  it('draws a slot once for several changes made at once', () => {
    const { w, app, count } = setup();
    const view = renderSlot(w, 's');
    view.act(() =>
      w.registry.batch(() => {
        for (const n of ['a', 'b', 'c']) app.add('Fill', n, { slot: 's', render: Counted(n.toUpperCase()) });
      }),
    );
    expect(count('Overweave.SlotView', 'A', 'B', 'C')).toEqual([2, 1, 1, 1]);
  });

  it('draws a fill that reads data again by itself, and nothing else', () => {
    const { w, app, count } = setup();
    const n = signal(1);
    const Reads = () => h('span', null, `n=${n.value}`);
    Reads.displayName = 'Reads';
    app.add('Fill', 'a', { slot: 's', order: 1, render: Counted('A') });
    app.add('Fill', 'r', { slot: 's', order: 2, render: Reads });
    const view = renderSlot(w, 's');
    view.act(() => {
      n.value = 2;
    });
    expect(view.text()).toBe('An=2');
    expect(count('Overweave.SlotView', 'A', 'Reads')).toEqual([1, 1, 2]);
  });

  it('draws nothing again when the provider’s parent draws again with a new onError', () => {
    const { w, app, count } = setup();
    app.add('Fill', 'a', { slot: 's', render: Counted('A') });
    let again: () => void = () => {};
    const Parent = () => {
      const [, set] = useState(0);
      again = () => set((v) => v + 1);
      return h(Provider, { registry: w.registry, onError: () => {} }, h(Slot, { name: 's' }));
    };
    render(h(Parent, null));
    act(() => again());
    expect(count('Parent', 'Overweave.SlotView', 'A')).toEqual([2, 1, 1]);
  });

  it('follows one definition: another of its kind changing draws nothing again', () => {
    const { w, app, user, counts } = setup();
    app.add('Slot', 's', { title: 'Old' });
    app.add('Slot', 'other', { title: 'Other' });
    const Title = () => h('h2', null, useDefinition<{ title?: string }>('Slot', 's')?.spec.title ?? '');
    const view = mount(w, h(Title, null));
    view.act(() => user.patch('Slot', 'other', { title: 'Changed' }));
    expect(counts.of(Title)).toBe(1);
    view.act(() => user.patch('Slot', 's', { title: 'New' }));
    expect([counts.of(Title), view.text()]).toEqual([2, 'New']);
  });
});

describe('Slot', () => {
  it('draws its fills with its props; its children when it selects nothing', () => {
    const { w, app } = setup();
    app.add('Fill', 'b', { slot: 'header', order: 20, render: ({ pod }: { pod: string }) => h('i', null, `pod ${pod}`) });
    app.add('Fill', 'a', { slot: 'header', order: 10, render: Counted('A', 'first') });
    const view = mount(w, h('div', null, h(Slot, { name: 'header', props: { pod: 'web' } }), h(Slot, { name: 'empty' }, 'nothing here')));
    expect(view.text()).toBe('firstpod webnothing here');
  });

  it('draws a fill of a typed slot with the slot’s props', () => {
    const { w, app } = setup();
    const header = slot<{ pod: { name: string } }>('pod.header');
    app.add('Fill', 'name', fill(header, { when: ({ pod }) => pod.name !== '', render: ({ pod }) => h('b', null, pod.name) }));
    const view = renderSlot(w, header, { pod: { name: 'web-1' } });
    expect(view.html()).toBe('<b>web-1</b>');
  });

  it('follows contributions as they come and go', () => {
    const { w, app, addon } = setup();
    app.add('Fill', 'app.a', { slot: 's', order: 1, render: Counted('A') });
    const view = renderSlot(w, 's');
    view.act(() => addon.add('Fill', 'addon.b', { slot: 's', order: 2, render: Counted('B') }));
    expect(view.text()).toBe('AB');
    view.act(() => addon.dispose());
    expect(view.text()).toBe('A');
  });

  it('keeps each wrap’s state its own: one taken away gives its state to no other', () => {
    const { w, app, addon } = setup();
    let made = 0;
    const Labeled = (label: string): PreactComponent => {
      const Wrap = ({ children }: { children?: ComponentChildren }) => {
        const [id] = useState(() => ++made);
        return h('div', { 'data-wrap': `${label}:${id}` }, children);
      };
      return Wrap;
    };
    app.add('Fill', 'f', { slot: 's', render: Counted('F') });
    addon.add('Wrap', 'inner', { wraps: 'f', order: 1, render: Labeled('inner') });
    addon.add('Wrap', 'outer', { wraps: 'f', order: 2, render: Labeled('outer') });
    const view = renderSlot(w, 's');
    const outerId = view.container.querySelector('[data-wrap^="outer"]')?.getAttribute('data-wrap');
    view.act(() => addon.remove('Wrap', 'outer'));
    const now = view.container.querySelector('[data-wrap]')?.getAttribute('data-wrap') ?? '';
    expect(now.startsWith('inner:')).toBe(true);
    expect(now.split(':')[1]).not.toBe(outerId?.split(':')[1]);
  });

  it('keeps a failing fill apart (told, not drawn), and draws what a failing wrap wraps', () => {
    const { w, app, addon } = setup();
    app.add('Fill', 'broken', {
      slot: 's',
      order: 1,
      render: () => {
        throw new Error('fill');
      },
    });
    app.add('Fill', 'fine', { slot: 's', order: 2, render: Counted('Fine', 'fine') });
    addon.add('Wrap', 'bad', {
      wraps: 'fine',
      render: () => {
        throw new Error('wrap');
      },
    });
    const view = renderSlot(w, 's');
    expect(view.text()).toBe('fine');
    expect(view.failures.map((f) => [f.phase, f.definition.name]).sort()).toEqual([
      ['render', 'bad'],
      ['render', 'broken'],
    ]);
  });

  it('tries a failed fill again when its retry key changes, not when only its props do', () => {
    const { w, app } = setup();
    app.add('Fill', 'f', {
      slot: 's',
      render: ({ ok }: { ok: boolean }) => {
        if (!ok) throw new Error('not ok');
        return h('span', null, 'ok');
      },
    });
    const view = renderSlot(w, slot<{ ok: boolean }>('s'), { ok: false });
    expect(view.text()).toBe('');
    view.rerender({ ok: true });
    expect(view.text()).toBe('');
    view.retry();
    expect(view.text()).toBe('ok');
  });
});

describe('reading', () => {
  it('asks nothing of who reads a definition when another of its kind changes, nor of a slot when another slot does', () => {
    const { w, app, user } = setup();
    for (const n of ['a', 'b']) app.add('Slot', n, { title: n });
    app.add('Fill', 'f', { slot: 'a', render: Counted('F') });
    const one = definitionSignal(w.registry, 'Slot', 'a');
    const view = mount(w, h('div', null, h(Slot, { name: 'a' }), h(Slot, { name: 'b' })));
    expect(one.value?.spec.title).toBe('a');
    const get = vi.spyOn(w.registry, 'get');
    view.act(() => user.patch('Slot', 'b', { title: 'B' }));
    // Read once: slot b choosing again — not slot a, not the signal of a.
    expect(one.value?.spec.title).toBe('a');
    expect(get.mock.calls.map(([kind, name]) => `${kind}/${name}`)).toEqual(['Slot/b']);
    get.mockClear();
    view.act(() => user.patch('Slot', 'a', { title: 'A' }));
    expect(one.value?.spec.title).toBe('A');
    expect(get.mock.calls.map(([kind, name]) => `${kind}/${name}`).sort()).toEqual(['Slot/a', 'Slot/a']);
  });

  it('follows a kind in a component and as a signal', () => {
    const { w, app } = setup();
    const List = () =>
      h(
        'ul',
        null,
        useDefinitions('Fill').map((f) => h('li', { key: f.name }, f.name)),
      );
    const view = mount(w, h(List, null));
    const fills = listSignal(w.registry, 'Fill');
    expect(fills.value).toEqual([]);
    view.act(() => app.add('Fill', 'f', { slot: 's', render: Counted('F') }));
    expect(view.text()).toBe('f');
    expect(fills.value.map((f) => f.name)).toEqual(['f']);
  });

  it('lets go of what it read when the registry is disposed; tells a component with no provider', () => {
    const { w, app } = setup();
    app.add('Slot', 's', { title: 'T' });
    const one = definitionSignal(w.registry, 'Slot', 's');
    const all = listSignal(w.registry, 'Slot');
    expect([one.value?.name, all.value.length]).toEqual(['s', 1]);
    w.dispose();
    expect([one.value, all.value.length]).toEqual([undefined, 0]);
    expect(() => render(h(Slot, { name: 's' }))).toThrow(/no OverweaveProvider/);
    expect(() => render(h(OverweaveProvider, { registry: createRegistry() }, null))).toThrow(/no Slot/);
  });
});

describe('kept apart, and tried again', () => {
  it('keeps a fill apart even when the app’s onError throws', () => {
    const { w, app } = setup();
    app.add('Fill', 'broken', {
      slot: 's',
      render: () => {
        throw new Error('fill');
      },
    });
    app.add('Fill', 'fine', { slot: 's', render: Counted('Fine', 'fine') });
    const onError = vi.fn(() => {
      throw new Error('listener');
    });
    const { container } = render(h(Provider, { registry: w.registry, onError }, h(Slot, { name: 's' })));
    expect(container.textContent).toBe('fine');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('keeps a fill’s and a wrap’s state apart even when they share a name and a component', () => {
    const { w, app, addon } = setup();
    let made = 0;
    const Stateful = ({ children }: { children?: ComponentChildren }) => {
      const [id] = useState(() => ++made);
      return h('div', { 'data-id': String(id) }, children);
    };
    app.add('Fill', 'same', { slot: 's', render: Stateful });
    addon.add('Wrap', 'same', { wraps: 'same', render: Stateful });
    const view = renderSlot(w, 's');
    // The wrap (outside) mounted first.
    expect(view.html()).toBe('<div data-id="1"><div data-id="2"></div></div>');
    view.act(() => addon.remove('Wrap', 'same'));
    // The fill alone left, drawn anew (a wrap taken away moves it), never with the wrap's state.
    const ids = [...view.container.querySelectorAll('[data-id]')].map((e) => e.getAttribute('data-id'));
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe('1');
  });

  it('tries again on a new retry key — only what failed; going back to an old key brings no failure back', () => {
    const { w, app, count } = setup();
    const ok = { value: false };
    app.add('Fill', 'flaky', {
      slot: 's',
      order: 1,
      render: () => {
        if (!ok.value) throw new Error('not yet');
        return h('span', null, 'ok');
      },
    });
    app.add('Fill', 'healthy', { slot: 's', order: 2, render: Counted('Healthy', 'h') });
    const props = {};
    const tree = (retryKey: number) => h(Slot, { name: 's', props, retryKey });
    const view = mount(w, tree(1));
    expect(view.text()).toBe('h');
    ok.value = true;
    view.rerender(tree(2));
    expect(view.text()).toBe('okh');
    expect(count('Healthy')).toEqual([1]);
    view.rerender(tree(1));
    expect(view.text()).toBe('okh');
  });

  it('asks a failing condition again on a new retry key, and tells its failure once in between', () => {
    const { w, app } = setup();
    let broken = true;
    app.add('Fill', 'cond', {
      slot: 's',
      when: () => {
        if (broken) throw new Error('when');
        return true;
      },
      render: Counted('Cond', 'c'),
    });
    const view = renderSlot(w, 's', {});
    view.act(() => app.add('Fill', 'elsewhere', { slot: 'other', render: Counted('E') }));
    view.act(() => app.add('Slot', 'other', {}));
    expect(view.failures.map((f) => f.phase)).toEqual(['when']);
    broken = false;
    view.retry();
    expect(view.text()).toBe('c');
  });

  it('keeps any definition’s drawing apart with Guarded: a column’s cell, told as the column’s, back when it is fixed', () => {
    const Column = defineKind<{ header: string; value: (row: string) => string }>()('Column', {
      required: ['header', 'value'],
      patchRights: { header: 'configure', value: 'behaviour' },
    });
    const w = uiWorld(ui, Column);
    const app = w.as('app');
    const editor = w.as('editor', { priority: 100, rights: ['behaviour'] });
    app.add('Column', 'name', { header: 'Name', value: (row) => row });
    app.add('Column', 'bad', {
      header: 'Bad',
      value: () => {
        throw new Error('column');
      },
    });
    const Table = () =>
      h(
        'tr',
        null,
        useDefinitions(Column).map((c) => h(Guarded, { key: c.name, definition: c, fallback: h('td', null, '—') }, h(Cell, { column: c }))),
      );
    const Cell = ({ column }: { column: Definition<{ value: (row: string) => string }> }) => h('td', null, column.spec.value('web'));
    app.add('Fill', 'table', { slot: 'main', render: Table });
    const view = renderSlot(w, 'main');
    expect(view.text()).toBe('—web');
    expect(view.failures.map((f) => f.definition.name)).toEqual(['bad']);
    view.act(() => editor.patch('Column', 'bad', { value: (row: string) => row.toUpperCase() }));
    expect(view.text()).toBe('WEBweb');
  });
});

describe('a slot’s tools', () => {
  it('follow what a slot shows and every fill of it, whatever their conditions', () => {
    const { w, app, user } = setup();
    app.add('Slot', 's', {});
    app.add('Fill', 'a', { slot: 's', order: 1, render: Counted('A') });
    app.add('Fill', 'b', { slot: 's', order: 2, when: (p: { b: boolean }) => p.b, render: Counted('B') });
    const props = { b: false };
    let shown = '';
    let all = '';
    const Tools = () => {
      const view = useSlotView('s', props);
      const every = useSlotContributions('s');
      shown = `${view.selected.map((f) => f.name)}|${view.userHidden.map((f) => f.name)}`;
      all = every.fills.map((f) => f.name).join(',');
      return null;
    };
    const view = mount(w, h(Tools, null));
    expect([shown, all]).toEqual(['a|', 'a,b']);
    view.act(() => user.patch('Slot', 's', { hidden: { a: true } }));
    expect(shown).toBe('|a');
    view.act(() => app.add('Fill', 'c', { slot: 's', order: 3, render: Counted('C') }));
    expect([shown, all]).toEqual(['c|a', 'a,b,c']);
  });
});

describe('the provider', () => {
  it('takes only the UI’s kinds; after the registry is disposed, draws nothing and throws nothing', () => {
    const Imposter = defineKind<{ title?: string }>()('Slot', {});
    expect(() => render(h(Provider, { registry: createRegistry({ kinds: [Imposter, ui.Fill, ui.Wrap] }) }, null))).toThrow(/no Slot of the UI's/);
    // Two uiKinds() are the same kinds.
    const again = uiKinds<PreactComponent>()({ configure: 'configure', behaviour: 'behaviour' });
    const { w, app } = setup();
    expect(() => w.registry.define(again.Slot)).not.toThrow();
    app.add('Fill', 'a', { slot: 's', render: Counted('A') });
    let redraw: () => void = () => {};
    const Parent = () => {
      const [, set] = useState(0);
      redraw = () => set((v) => v + 1);
      return h(Provider, { registry: w.registry }, h(Slot, { name: 's' }, 'gone'));
    };
    const { container } = render(h(Parent, null));
    act(() => w.dispose());
    expect(() => act(() => redraw())).not.toThrow();
    expect(container.textContent).toBe('gone');
  });
});

describe('types', () => {
  it('type a slot’s props where it is drawn, a guard’s narrowing in a fill, a kind’s spec in a hook, an addon’s rights', () => {
    const header = slot<{ count: number }>('header');
    // @ts-expect-error a typed slot's props are not to be left out
    const missing: SlotProps<{ count: number }> = { name: header };
    expect(missing).toBeDefined();
    slotElement(header, { count: 1 });
    // @ts-expect-error props of the slot's shape
    slotElement(header, { nope: 1 });
    interface Obj {
      kind: string;
      spec: unknown;
    }
    const details = slot<{ object: Obj }>('details');
    const isRoute = (p: { object: Obj }): p is { object: Obj & { spec: { routes: string[] } } } => p.object.kind === 'IngressRoute';
    const routes = fill(details, { when: isRoute, render: ({ object }) => h('i', null, object.spec.routes.join()) });
    expect(routes.slot).toBe('details');
    // @ts-expect-error without the guard, spec is unknown
    fill(details, { render: ({ object }) => h('i', null, object.spec.routes.join()) });
    const Column = defineKind<{ header: string }>()('Column', { required: ['header'], patchRights: { header: 'configure' } });
    const setup = (c: UiContributor<typeof ui, [typeof Column], 'configure'>) => {
      c.patch('Slot', 'header', { hidden: { a: true } });
      c.patch('Column', 'x', { header: 'X' });
      // @ts-expect-error configure only: no render
      c.patch('Fill', 'f', { render: Counted('X') });
    };
    expect(setup).toBeTypeOf('function');
    const Header = () => h('b', null, useDefinition(Column, 'x')?.spec.header);
    expect(Header).toBeTypeOf('function');
    // @ts-expect-error a typed slot drawn on its own asks for its props
    expect(() => renderSlot(uiWorld(ui), header)).not.toThrow();
  });
});

describe('a failure that outlives a try', () => {
  const failing = (label: string) => () => {
    throw new Error(label);
  };

  it('stays caught when a fill fails again: on a new retry key, on a patch of its definition', () => {
    const { w, app, addon } = setup();
    app.add('Fill', 'broken', { slot: 's', order: 1, render: failing('fill') });
    app.add('Fill', 'fine', { slot: 's', order: 2, render: Counted('Fine', 'fine') });
    const view = renderSlot(w, 's', {});
    view.retry();
    view.act(() => addon.patch('Fill', 'broken', { title: 'Still broken' }));
    view.act(() => addon.patch('Fill', 'broken', { title: 'And again' }));
    expect(view.text()).toBe('fine');
    expect(view.failures.map((f) => f.definition.name)).toEqual(['broken', 'broken', 'broken', 'broken']);
  });

  it('stays caught when a wrap or a Guarded drawing fails again', () => {
    const Column = defineKind<{ header: string; value: () => string }>()('Column', { required: ['header', 'value'], patchRights: { header: 'configure' } });
    const w = uiWorld(ui, Column);
    const app = w.as('app');
    const user = w.as('user', { priority: 1000, rights: ['configure'] });
    app.add('Column', 'bad', { header: 'Bad', value: failing('column') });
    const Cell = ({ column }: { column: Definition<{ value: () => string }> }) => h('i', null, column.spec.value());
    const Row = () =>
      h(
        'span',
        null,
        useDefinitions(Column).map((c) => h(Guarded, { key: c.name, definition: c, fallback: '—' }, h(Cell, { column: c }))),
      );
    app.add('Fill', 'row', { slot: 's', render: Row });
    app.add('Wrap', 'frame', { wraps: 'row', render: failing('wrap') });
    const view = renderSlot(w, 's');
    expect(view.text()).toBe('—');
    view.act(() => user.patch('Column', 'bad', { header: 'Still bad' }));
    view.act(() => user.patch('Wrap', 'frame', { order: 2 }));
    expect(view.text()).toBe('—');
  });

  it('draws nothing, and throws nothing, over a registry disposed before it was given', () => {
    const { w } = setup();
    const registry = w.registry;
    w.dispose();
    const { container } = render(h(Provider, { registry }, h(Slot, { name: 's' }, 'gone')));
    expect(container.textContent).toBe('gone');
  });
});
