// @vitest-environment happy-dom
import { defineKind } from '@overweave/core';
import { cleanup } from '@overweave/testkit';
import { slot, uiKinds } from '@overweave/ui';
import { type PreactComponent, useDefinitions, useOverweave } from '@overweave/ui/preact';
import { act, render, cleanup as unrender } from '@testing-library/preact';
import { render as draw, h, options } from 'preact';
import { useEffect } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS, type InspectorState } from '../protocol.ts';
import { testChannel } from '../testChannel.ts';
import { setPreviewChannel, WorldStory } from './index.ts';

const ui = uiKinds<PreactComponent>()({ configure: 'configure', behaviour: 'behaviour' });
const Column = defineKind<{ header: string }>()('Column', { required: ['header'], patchRights: { header: 'configure' } });

afterEach(() => {
  unrender();
  cleanup();
});

/** Lets what is told after a tree is drawn (failures, the panel's state) come. */
const settle = () => act(() => Promise.resolve());

type Adding = { add(kind: string, name: string, spec: object): unknown };

/** An addon whose starts and stops are logged: its fill shows the slot's props. */
function counted(id: string, text: string, order = 0, log: string[] = []) {
  const stops = vi.fn(() => void log.push(`stop ${id}`));
  const setup = vi.fn((c: Adding) => {
    log.push(`start ${id}`);
    c.add('Fill', `${id}.fill`, { slot: 'main', order, render: ({ n }: { n?: number }) => h('b', null, `${text}${n ?? ''}`) });
    return stops;
  });
  return { run: { id, setup: setup as (c: never) => unknown }, setup, stops };
}

const failing = (id: string, error: string) => ({
  id,
  setup: (c: Adding) => {
    c.add('Fill', id, {
      slot: 'main',
      render: () => {
        throw new Error(error);
      },
    });
  },
});

const problems = (container: Element) => [...container.querySelectorAll('[data-overweave-problems] li')].map((li) => li.textContent);

describe('WorldStory', () => {
  it('draws a slot of the addons run; new args draw it again in the same world', () => {
    const table = counted('table', 'T');
    const view = (n: number) => h(WorldStory, { ui, addons: [table.run], slot: 'main', props: { n } });
    const { container, rerender } = render(view(1));
    expect(container.textContent).toBe('T1');
    rerender(view(2));
    expect(container.textContent).toBe('T2');
    expect(table.setup).toHaveBeenCalledTimes(1);
  });

  it('stops the old world before the new one starts, when its addons change; lets it go with the story — once', () => {
    const log: string[] = [];
    const table = counted('table', 'T', 0, log);
    const images = counted('images', 'I', 1, log);
    const { container, rerender, unmount } = render(h(WorldStory, { ui, addons: [table.run], slot: 'main' }));
    rerender(h(WorldStory, { ui, addons: [table.run, images.run], slot: 'main' }));
    expect(container.textContent).toBe('TI');
    unmount();
    expect(log).toEqual(['start table', 'stop table', 'start table', 'start images', 'stop table', 'stop images']);
  });

  it('makes the world again when its kinds change; not for a grant written again alike', () => {
    const table = counted('table', 'T');
    const run = (priority: number) => ({ ...table.run, grant: { priority, rights: ['configure'] } });
    const { rerender } = render(h(WorldStory, { ui, addons: [run(1)], slot: 'main' }));
    rerender(h(WorldStory, { ui, addons: [run(1)], slot: 'main' }));
    expect(table.setup).toHaveBeenCalledTimes(1);
    rerender(h(WorldStory, { ui, kinds: [Column], addons: [run(1)], slot: 'main' }));
    expect(table.setup).toHaveBeenCalledTimes(2);
  });

  it('leaves nothing running when drawn and taken away at once, outside any act', () => {
    const table = counted('table', 'T');
    const element = document.createElement('div');
    draw(h(WorldStory, { ui, addons: [table.run], slot: 'main' }), element);
    draw(null, element);
    expect([table.setup.mock.calls.length, table.stops.mock.calls.length]).toEqual([1, 1]);
  });

  it('draws its tree anew with a new world: nothing below holds on to the old one', () => {
    const table = counted('table', 'T');
    const images = counted('images', 'I', 1);
    const seen: unknown[] = [];
    const Holder = () => {
      const { registry } = useOverweave();
      // biome-ignore lint/correctness/useExhaustiveDependencies: the registry it was mounted with, kept (as a child that holds on would).
      useEffect(() => void seen.push(registry), []);
      return null;
    };
    const { rerender } = render(h(WorldStory, { ui, addons: [table.run] }, h(Holder, null)));
    rerender(h(WorldStory, { ui, addons: [table.run, images.run] }, h(Holder, null)));
    expect(seen.length).toBe(2);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('lists an addon that fails to start, and runs the others', () => {
    const table = counted('table', 'T');
    const broken = {
      id: 'broken',
      setup: () => {
        throw new Error('no luck');
      },
    };
    const { container } = render(h(WorldStory, { ui, addons: [broken, table.run], slot: 'main' }));
    expect(container.querySelector('b')?.textContent).toBe('T');
    expect(problems(container)).toEqual(['broken failed to start: no luck']);
  });

  it('lists a world that cannot be made, what is given that throws or returns a promise — and draws on', async () => {
    const Clash = defineKind<{ title?: string }>()('Slot', {});
    const clash = render(h(WorldStory, { ui, kinds: [Clash], slot: 'main' }, 'x'));
    expect(problems(clash.container)[0]).toMatch(/^the world could not be made: /);
    clash.unmount();
    const throws = render(
      h(WorldStory, {
        ui,
        given: () => {
          throw new Error('bad fixture');
        },
      }),
    );
    expect(problems(throws.container)).toEqual(['what is given failed: bad fixture']);
    throws.unmount();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const late = render(h(WorldStory, { ui, given: async () => Promise.reject(new Error('later')) }));
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', unhandled);
    expect(problems(late.container)).toEqual(['what is given failed: it returned a promise: what is given is given at once']);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('lists a drawing that fails once, however often it fails again; before the app’s onError, even one that throws', async () => {
    const onError = vi.fn(() => {
      throw new Error('the app’s own');
    });
    const view = (n: number) => h(WorldStory, { ui, addons: [failing('bad', 'drawn wrong') as never], slot: 'main', props: { n }, onError });
    const { container, rerender } = render(view(1));
    rerender(view(2));
    rerender(view(3));
    await settle();
    expect(problems(container)).toEqual(['render of Fill/bad: drawn wrong']);
    expect(onError).toHaveBeenCalled();
  });

  it('draws any tree under the provider over what is given, with kinds of one’s own', () => {
    const Headers = () =>
      h(
        'i',
        null,
        useDefinitions(Column).map((c) => c.spec.header),
      );
    const { container } = render(h(WorldStory, { ui, kinds: [Column], given: (w) => w.as('core').add('Column', 'name', { header: 'Name' }) }, h(Headers, null)));
    expect(container.innerHTML).toBe('<i>Name</i>');
  });
});

describe('the Overweave panel told, in Storybook', () => {
  const channel = testChannel();
  beforeEach(() => {
    channel.emitted.length = 0;
    setPreviewChannel(channel);
  });
  afterEach(() => setPreviewChannel(undefined));

  const states = () => channel.emitted.filter((e) => e.event === EVENTS.state).map((e) => e.args[0] as InspectorState);
  const told = () => states().at(-1);

  it('tells what the world is: its addons, what each says, who says each leaf, renders', async () => {
    const table = counted('table', 'T');
    const images = counted('images', 'I', 1);
    const patcher = {
      id: 'patcher',
      setup: (c: { patch(kind: string, name: string, spec: object): unknown }) => void c.patch('Fill', 'table.fill', { title: 'Mine' }),
      grant: { priority: 200, rights: ['configure'] },
    };
    render(h(WorldStory, { ui, addons: [table.run, images.run, patcher as never], slot: 'main', props: { n: 1 } }));
    await settle();
    const state = told();
    expect(state?.drawn).toBe('main');
    expect(state?.addons.map((a) => [a.id, a.on, a.running, a.priority])).toEqual([
      ['table', true, true, 0],
      ['images', true, true, 0],
      ['patcher', true, true, 200],
    ]);
    expect(state?.addons[2].says).toEqual([{ kind: 'Fill', name: 'table.fill', operation: 'patch', status: 'included' }]);
    const fill = state?.definitions.find((d) => d.name === 'table.fill');
    expect([fill?.definedBy, fill?.says.title, fill?.says.slot]).toEqual(['table', 'patcher', 'table']);
    expect(state?.renders['Overweave.SlotView']).toBe(1);
  });

  it('turns addons off and on as the panel says — two toggles told at once both kept; what is not for it changes nothing', async () => {
    const table = counted('table', 'T');
    const images = counted('images', 'I', 1);
    const { container } = render(h(WorldStory, { ui, addons: [table.run, images.run], slot: 'main' }));
    await settle();
    const instance = told()?.instance;
    await act(() => {
      channel.emit(EVENTS.toggle, { instance, id: 'images', on: false });
      channel.emit(EVENTS.toggle, { instance, id: 'table', on: false });
    });
    await settle();
    expect(container.textContent).toBe('');
    expect(told()?.addons.map((a) => [a.id, a.on, a.running])).toEqual([
      ['table', false, false],
      ['images', false, false],
    ]);
    await act(() => {
      channel.emit(EVENTS.toggle, { instance: 'another', id: 'table', on: true });
      channel.emit(EVENTS.toggle);
      channel.emit(EVENTS.toggle, { instance, id: 42, on: true });
    });
    expect(container.textContent).toBe('');
    await act(() => channel.emit(EVENTS.toggle, { instance, id: 'images', on: true }));
    await settle();
    expect(container.textContent).toBe('I');
  });

  it('counts each world’s renders apart', async () => {
    const A = Object.assign(() => h('b', null, 'a'), { displayName: 'OnlyA' });
    const B = Object.assign(() => h('b', null, 'b'), { displayName: 'OnlyB' });
    render(h('div', null, h(WorldStory, { ui }, h(A, null)), h(WorldStory, { ui }, h(B, null))));
    await settle();
    const [a, b] = [...new Map(states().map((s) => [s.instance, s])).values()];
    expect([a.renders.OnlyA, a.renders.OnlyB, b.renders.OnlyA, b.renders.OnlyB]).toEqual([1, undefined, undefined, 1]);
  });

  it('tells again when asked — every world, or the one asked; counts again; tells it is gone and lets go of everything', async () => {
    const before = (options as { __r?: unknown }).__r;
    const { unmount } = render(h(WorldStory, { ui, addons: [counted('table', 'T').run], slot: 'main' }));
    await settle();
    const instance = told()?.instance as string;
    channel.emitted.length = 0;
    channel.emit(EVENTS.request, { instance: 'another' });
    await settle();
    expect(told()).toBeUndefined();
    channel.emit(EVENTS.request, {});
    await settle();
    expect(told()?.instance).toBe(instance);
    channel.emit(EVENTS.resetCounts, { instance });
    await settle();
    expect(told()?.renders).toEqual({});
    unmount();
    expect(channel.last(EVENTS.gone)).toEqual({ instance });
    expect([channel.listening(EVENTS.request), channel.listening(EVENTS.toggle), channel.listening(EVENTS.resetCounts)]).toEqual([0, 0, 0]);
    expect((options as { __r?: unknown }).__r).toBe(before);
  });

  it('tells a spec that holds itself, its cycle cut', async () => {
    class Loop {
      self: Loop = this;
    }
    const Thing = defineKind<{ value: unknown }>()('Thing', {});
    render(h(WorldStory, { ui, kinds: [Thing], given: (w) => w.as('core').add('Thing', 't', { value: new Loop() }) }));
    await settle();
    expect(told()?.definitions.find((d) => d.name === 't')?.spec).toEqual({ value: { '[Loop]': { self: '[cycle]' } } });
  });
});

describe('types', () => {
  it('ask a typed slot’s props, and type what is given by the world’s kinds', () => {
    const header = slot<{ count: number }>('header');
    const typed = () => {
      WorldStory({ ui, slot: header, props: { count: 1 } });
      // @ts-expect-error a typed slot's props are not to be left out
      WorldStory({ ui, slot: header });
      WorldStory({ ui, slot: 'any' });
      WorldStory({ ui, kinds: [Column], given: (w) => void w.as('core').add('Column', 'c', { header: 'C' }) });
      // @ts-expect-error no such kind in this world
      WorldStory({ ui, kinds: [Column], given: (w) => void w.as('core').add('Colum', 'c', { header: 'C' }) });
    };
    expect(typed).toBeTypeOf('function');
  });
});
