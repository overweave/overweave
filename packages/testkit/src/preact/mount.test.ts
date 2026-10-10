// @vitest-environment happy-dom
import { slot, uiKinds } from '@overweave/ui';
import { fill, type PreactComponent, Slot, useDefinition } from '@overweave/ui/preact';
import { type ComponentChildren, createContext, h, options, type VNode } from 'preact';
import { useContext, useState } from 'preact/hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup as rootCleanup, uiWorld, world } from '../index.ts';
import { act, cleanup, mount, renderCounts, renderSlot } from './index.ts';

/* A tree or a slot of a world drawn on its own; renders counted, real ones; all of it let go of by cleanup. */

afterEach(cleanup);

const ui = uiKinds<PreactComponent>()({ configure: 'configure', behaviour: 'behaviour' });
const header = slot<{ count: number }>('header');

const named = (name: string, draw: PreactComponent): PreactComponent => {
  (draw as { displayName?: string }).displayName = name;
  return draw;
};

describe('renderSlot', () => {
  it('draws a slot with its props; changes made inside act are drawn; renders counted', () => {
    const counts = renderCounts();
    const w = world({ kinds: [ui.Slot, ui.Fill, ui.Wrap] });
    const app = w.as('app');
    const Title = named('Title', ({ count }: { count: number }) => h('h1', null, `Pods (${count})`));
    app.add('Slot', 'header', {});
    app.add('Fill', 'title', fill(header, { order: 1, render: Title }));
    app.add('Fill', 'badge', fill(header, { order: 2, render: named('Badge', () => h('i', null, '!')) }));
    const view = renderSlot(w, header, { count: 2 });
    expect(view.text()).toBe('Pods (2)!');
    view.act(() => w.as('user', { priority: 1000, rights: ['configure'] }).patch('Slot', 'header', { hidden: { badge: true } }));
    expect(view.html()).toBe('<h1>Pods (2)</h1>');
    expect([counts.of(Title), counts.of('Badge'), counts.of('Overweave.SlotView')]).toEqual([1, 1, 2]);
    view.rerender({ count: 3 });
    expect(view.text()).toBe('Pods (3)');
    // @ts-expect-error a typed slot's props are not to be left out
    renderSlot(w, header);
  });

  it('keeps what failed, and tries it again when asked', () => {
    const w = world({ kinds: [ui.Slot, ui.Fill, ui.Wrap] });
    let ok = false;
    w.as('app').add('Fill', 'flaky', {
      slot: 's',
      render: () => {
        if (!ok) throw new Error('not yet');
        return h('b', null, 'ok');
      },
    });
    const view = renderSlot(w, 's');
    expect(view.failures.map((f) => [f.phase, f.definition.name])).toEqual([['render', 'flaky']]);
    ok = true;
    view.retry();
    expect(view.text()).toBe('ok');
  });
});

describe('mount', () => {
  it('draws any tree under the world’s provider, inside the app’s providers', () => {
    const w = world({ kinds: [ui.Slot, ui.Fill, ui.Wrap] });
    w.as('app').add('Slot', 's', { title: 'Settings' });
    const Theme = createContext('light');
    const wrapper = ({ children }: { children?: ComponentChildren }) => h(Theme.Provider, { value: 'dark' }, children);
    const Page = () => h('p', null, `${useDefinition('Slot', 's')?.spec.title} in ${useContext(Theme)}`);
    const view = mount(w, h(Page, null), { wrapper });
    expect(view.text()).toBe('Settings in dark');
    view.rerender(h('div', null, h(Page, null), h(Slot, { name: 's' }, ' (empty)')));
    expect(view.text()).toBe('Settings in dark (empty)');
  });

  it('awaits an async change; once unmounted, does nothing more', async () => {
    const w = world({ kinds: [ui.Slot, ui.Fill, ui.Wrap] });
    const view = mount(w, h(Slot, { name: 's' }, 'empty'));
    await view.act(async () => {
      await Promise.resolve();
      w.as('app').add('Fill', 'f', { slot: 's', render: () => h('b', null, 'filled') });
    });
    expect(view.text()).toBe('filled');
    view.unmount();
    view.unmount();
    expect(() => view.rerender(null)).toThrow(/let go of/);
    expect(document.body.children).toHaveLength(0);
  });

  it('leaves nothing behind when the first drawing fails; cleanup unmounts what was left', () => {
    expect(() => mount(world(), null)).toThrow(/no Slot/);
    expect(document.body.children).toHaveLength(0);
    mount(world({ kinds: [ui.Slot, ui.Fill, ui.Wrap] }), h('i', null, 'left'));
    expect(document.body.children).toHaveLength(1);
    cleanup();
    expect(document.body.children).toHaveLength(0);
  });
});

describe('renderCounts', () => {
  it('counters start and stop in any order; a stopped one counts no more', () => {
    const w = world({ kinds: [ui.Slot, ui.Fill, ui.Wrap] });
    const A = named('A', () => h('span', null, 'a'));
    w.as('app').add('Fill', 'a', { slot: 's', render: A });
    const outer = renderCounts();
    const inner = renderCounts();
    outer.stop();
    mount(w, h(Slot, { name: 's' }));
    expect([outer.of(A), inner.of(A)]).toEqual([0, 1]);
    inner.stop();
    mount(w, h(Slot, { name: 's' }));
    expect([outer.of(A), inner.of(A)]).toEqual([0, 1]);
    expect(inner.all()).toMatchObject({ A: 1 });
    inner.reset();
    expect(inner.of('A')).toBe(0);
  });

  it('counts within one tree among others, when given a component of its own', () => {
    const w = world({ kinds: [ui.Slot, ui.Fill, ui.Wrap] });
    const A = named('A', () => h('span', null, 'a'));
    w.as('app').add('Fill', 'a', { slot: 's', render: A });
    const Here = ({ children }: { children?: ComponentChildren }) => children;
    const There = ({ children }: { children?: ComponentChildren }) => children;
    const here = renderCounts({ within: Here });
    const all = renderCounts();
    mount(w, h(Here, null, h(Slot, { name: 's' })));
    mount(w, h(There, null, h(Slot, { name: 's' })));
    expect([here.of(A), all.of(A), here.of(Here)]).toEqual([1, 2, 0]);
  });
});

describe('the second round', () => {
  it('counts on when another hook is put over the counter’s, and taken off; no loop when counting starts again', () => {
    const w = uiWorld(ui);
    const A = named('A', () => {
      const [v] = useState('a');
      return h('span', null, v);
    });
    w.as('app').add('Fill', 'a', { slot: 's', render: A });
    const hooks = options as { __r?: (v: VNode) => void };
    const first = renderCounts();
    const under = hooks.__r;
    let foreign = 0;
    hooks.__r = (v) => {
      foreign++;
      under?.(v);
    };
    first.stop();
    const again = renderCounts();
    mount(w, h(Slot, { name: 's' }));
    expect(again.of(A)).toBe(1);
    expect(foreign).toBeGreaterThan(0);
    // The other hook taken off again: hooks still work, counting too.
    hooks.__r = under;
    const view = mount(w, h(Slot, { name: 's' }));
    expect(view.text()).toBe('a');
    expect(again.of(A)).toBe(2);
  });

  it('is let go of by the one cleanup, whichever entry it was taken from', () => {
    mount(uiWorld(ui), h('i', null, 'left'));
    const counts = renderCounts();
    rootCleanup();
    expect(document.body.children).toHaveLength(0);
    mount(uiWorld(ui), h('i', null, 'again'));
    expect(counts.of('Overweave.SlotView')).toBe(0);
  });

  it('answers nothing once unmounted; acts on its own, outside a view', () => {
    const w = uiWorld(ui);
    const view = mount(w, h(Slot, { name: 's' }, 'empty'));
    act(() => w.as('app').add('Fill', 'f', { slot: 's', render: () => h('b', null, 'f') }));
    expect(view.text()).toBe('f');
    view.unmount();
    expect(() => view.text()).toThrow(/let go of/);
    expect(() => view.container).toThrow(/let go of/);
  });
});
