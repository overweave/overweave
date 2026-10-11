// @vitest-environment happy-dom
import { createRegistry } from '@overweave/core';
import { act, cleanup, render } from '@testing-library/preact';
import { Fragment, h } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { uiKinds } from '../index.ts';
import { OverweaveProvider, type PreactComponent, Slot, type SlotTrace, slotTrace } from './index.ts';
import { trackSlot } from './trace.ts';

/* The slots drawn, followed for a provider given a trace: their names, how many fills each shows, their elements, where each is — the page left as it is. */

const ui = uiKinds<PreactComponent>()({ configure: 'configure', behaviour: 'behaviour' });
afterEach(cleanup);

function setup() {
  const registry = createRegistry({ kinds: [ui.Slot, ui.Fill, ui.Wrap] });
  const app = registry.contributor('app', { priority: 0 });
  app.add('Fill', 'title', { slot: 'header', render: () => h('h1', null, 'Title') });
  app.add('Fill', 'note', { slot: 'note', render: () => 'just text' });
  const page = (trace?: SlotTrace) =>
    h(
      OverweaveProvider,
      { registry, trace },
      h(
        'main',
        null,
        h(Slot, { name: 'header' }),
        h(Slot, { name: 'banner' }),
        h('nav', null, 'nav'),
        h(Slot, { name: 'footer' }, h('p', null, 'none')),
        h(Slot, { name: 'note' }),
      ),
    );
  return { registry, app, page };
}

describe('slotTrace', () => {
  it('follows the slots drawn: names, how many each shows, their elements, where each is — nothing put on the page', () => {
    const { app, page } = setup();
    const trace = slotTrace();
    const view = render(page(trace));
    const main = view.container.querySelector('main');
    const [header, banner, footer, note] = trace.slots();
    expect(trace.slots().map((s) => [s.name, s.shown])).toEqual([
      ['header', 1],
      ['banner', 0],
      ['footer', 0],
      ['note', 1],
    ]);
    expect(header.elements().map((e) => e.tagName)).toEqual(['H1']);
    expect([banner.elements(), banner.place()?.parent, banner.place()?.before]).toEqual([[], main, view.container.querySelector('nav')]);
    // Empty: its own children; text only: no element, but a place.
    expect(footer.elements().map((e) => e.tagName)).toEqual(['P']);
    expect([note.elements(), note.place()?.parent, note.place()?.before]).toEqual([[], main, null]);
    expect(view.container.innerHTML).toBe('<main><h1>Title</h1><nav>nav</nav><p>none</p>just text</main>');
    act(() => app.remove('Fill', 'title'));
    expect(header.shown).toBe(0);
    view.unmount();
    expect(trace.slots()).toEqual([]);
  });

  it('follows the provider’s trace now: given later, another, none', () => {
    const { page } = setup();
    const [a, b] = [slotTrace(), slotTrace()];
    const view = render(page());
    view.rerender(page(a));
    expect(a.slots()).toHaveLength(4);
    view.rerender(page(b));
    expect([a.slots().length, b.slots().length]).toEqual([0, 4]);
    view.rerender(page());
    expect(b.slots()).toEqual([]);
  });

  it('places an empty slot last at the root in what it is drawn into', () => {
    const { registry } = setup();
    const trace = slotTrace();
    const view = render(h(OverweaveProvider, { registry, trace }, h(Fragment, null, h('p', null, 'first'), h(Slot, { name: 'last' }))));
    expect([trace.slots()[0].place()?.parent, trace.slots()[0].place()?.before]).toEqual([view.container, null]);
  });

  it('takes no trace but slotTrace()’s', () => {
    expect(() => trackSlot({ slots: () => [] }, {}, () => 'x')).toThrow(/slotTrace/);
  });
});
