import { createRegistry, type Definition, unset } from '@overweave/core';
import { describe, expect, it } from 'vitest';
import { type Failure, slotFill as fill, fillsOf, inOrder, loopsOf, slot, slotView, uiKinds, wrapsOf } from './index.ts';

/*
 * The UI's logic, no framework: kinds whose rights the app names and whose
 * fields are checked; order (loops included); what a slot shows for some
 * props — ordered among all its fills, then targets, conditions, the
 * user's arrangement; what is drawn around a fill; types from the kinds.
 */

interface Pod {
  name: string;
  image?: string;
  kind?: string;
}
type Render = (props: { pod: Pod }) => string;
const ui = uiKinds<Render, { kind: string }>()({ configure: 'arrange', behaviour: 'draw' });

function setup() {
  const registry = createRegistry({ kinds: [ui.Slot, ui.Fill, ui.Wrap] });
  const app = registry.contributor('app', { priority: 0 });
  const addon = registry.contributor('addon', { priority: 200, rights: ['arrange'] });
  const user = registry.contributor('user', { priority: 1000, rights: ['arrange'] });
  return { registry, app, addon, user };
}

const names = (list: readonly Definition[]) => list.map((d) => d.name);
const r =
  (text: string): Render =>
  () =>
    text;

describe('order', () => {
  it('puts things by order, then name; one with `after` right after the one it names', () => {
    const list = [
      { name: 'c', spec: {} },
      { name: 'a', spec: { order: 10 } },
      { name: 'b', spec: { after: 'a' } },
      { name: 'd', spec: { after: 'a' } },
    ];
    expect(inOrder(list).map((t) => t.name)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('puts a loop together, last, and still puts what follows one of it after it (after those already after it)', () => {
    const list = [
      { name: 'x', spec: { after: 'y' } },
      { name: 'y', spec: { after: 'x' } },
      { name: 'a', spec: { after: 'x' } },
      { name: 'b', spec: {} },
    ];
    expect(inOrder(list).map((t) => t.name)).toEqual(['b', 'x', 'y', 'a']);
    expect(loopsOf(list)).toEqual(['x', 'y']);
  });

  it('puts one with `before` right before the one it names (after those already before it); one naming none there, by order', () => {
    const list = [
      { name: 'title', spec: { order: 200 } },
      { name: 'icon', spec: { order: 100 } },
      { name: 'badge', spec: { before: 'title' } },
      { name: 'dot', spec: { before: 'title' } },
      { name: 'flag', spec: { before: 'icon' } },
      { name: 'lost', spec: { before: 'nobody', order: 300 } },
    ];
    expect(inOrder(list).map((t) => t.name)).toEqual(['flag', 'icon', 'badge', 'dot', 'title', 'lost']);
  });

  it('puts a loop of befores and afters together, last', () => {
    const list = [
      { name: 'x', spec: { before: 'y' } },
      { name: 'y', spec: { after: 'x' } },
      { name: 'b', spec: {} },
    ];
    expect(inOrder(list).map((t) => t.name)).toEqual(['b', 'x', 'y']);
    expect(loopsOf(list)).toEqual(['x', 'y']);
  });

  it('refuses a fill or a wrap anchored both after and before', () => {
    const { app } = setup();
    expect(app.add('Fill', 'f', { slot: 's', after: 'a', before: 'b', render: r('f') })).toMatchObject({
      status: 'rejected',
      errors: [{ code: 'invalid', problem: { code: 'bothAnchors', field: 'before' } }],
    });
    expect(app.add('Wrap', 'w', { wraps: 'f', after: 'a', before: 'b', render: r('w') })).toMatchObject({
      status: 'rejected',
      errors: [{ code: 'invalid', problem: { code: 'bothAnchors' } }],
    });
  });

  it('refuses a patch that would anchor one both ways (as its contributors make it), and takes one that moves the anchor', () => {
    const { registry, app, addon } = setup();
    app.add('Fill', 'a', { slot: 's', render: r('a') });
    app.add('Fill', 'b', { slot: 's', render: r('b') });
    app.add('Fill', 'f', { slot: 's', after: 'b', render: r('f') });
    expect(addon.patch('Fill', 'f', { before: 'a' })).toMatchObject({ status: 'rejected', errors: [{ code: 'invalid', problem: { code: 'bothAnchors' } }] });
    expect(addon.patch('Fill', 'f', { before: 'a', after: unset }).status).toBe('included');
    expect(names(fillsOf(registry, 's', {}))).toEqual(['f', 'a', 'b']);
  });

  it('puts a chain of befores, and one before a loop’s, each right before what it names; one before what is not shown stays where it was put', () => {
    const chain = [
      { name: 'c', spec: {} },
      { name: 'b', spec: { before: 'c' } },
      { name: 'a', spec: { before: 'b' } },
      { name: 'z', spec: { order: 1 } },
    ];
    expect(inOrder(chain).map((t) => t.name)).toEqual(['z', 'a', 'b', 'c']);
    const looped = [
      { name: 'x', spec: { after: 'y' } },
      { name: 'y', spec: { after: 'x' } },
      { name: 'b', spec: { before: 'x' } },
      { name: 'a', spec: {} },
    ];
    expect(inOrder(looped).map((t) => t.name)).toEqual(['a', 'b', 'x', 'y']);
    const { registry, app } = setup();
    app.add('Fill', 'title', { slot: 's', order: 1, render: r('t') });
    app.add('Fill', 'pods', { slot: 's', order: 2, target: { kind: 'Pod' }, render: r('p') });
    app.add('Fill', 'icon', { slot: 's', before: 'pods', render: r('i') });
    const matcher = { matches: (t: { kind: string }, p: Pod) => t.kind === p.kind };
    expect(names(fillsOf(registry, 's', { name: 'n', kind: 'Node' }, { matcher }))).toEqual(['title', 'icon']);
  });
});

describe('a slot', () => {
  it('shows its fills in order, those for the props (targets by the app’s matcher, conditions), declared or not', () => {
    const { registry, app, addon } = setup();
    app.add('Fill', 'app.name', { slot: 'header', order: 10, render: r('name') });
    app.add('Fill', 'app.status', { slot: 'header', order: 20, render: r('status') });
    app.add('Fill', 'app.pods', { slot: 'header', target: { kind: 'Pod' }, render: r('pods only') });
    addon.add('Fill', 'addon.image', { slot: 'header', after: 'app.name', when: (p: Pod) => p.image !== undefined, render: r('image') });
    app.add('Fill', 'elsewhere', { slot: 'footer', render: r('x') });
    const matcher = { matches: (t: { kind: string }, p: Pod) => t.kind === p.kind };
    expect(names(fillsOf(registry, 'header', { name: 'web', image: 'nginx', kind: 'Pod' }, { matcher }))).toEqual(['app.name', 'addon.image', 'app.status', 'app.pods']);
    expect(names(fillsOf(registry, 'header', { name: 'web', kind: 'Node' }, { matcher }))).toEqual(['app.name', 'app.status']);
  });

  it('orders among all its fills before choosing: one after a fill not shown stays where it was put', () => {
    const { registry, app } = setup();
    app.add('Fill', 'a', { slot: 's', order: 10, when: (p: { a: boolean }) => p.a, render: r('a') });
    app.add('Fill', 'b', { slot: 's', after: 'a', render: r('b') });
    app.add('Fill', 'c', { slot: 's', order: 20, render: r('c') });
    expect(names(fillsOf(registry, 's', { a: true }))).toEqual(['a', 'b', 'c']);
    expect(names(fillsOf(registry, 's', { a: false }))).toEqual(['b', 'c']);
  });

  it('follows the user’s arrangement; hides by name, what several say merged; unless it is not the user’s to arrange', () => {
    const { registry, app, addon, user } = setup();
    app.add('Slot', 'header', { title: 'Header' });
    for (const n of ['a', 'b', 'c']) app.add('Fill', n, { slot: 'header', render: r(n) });
    addon.patch('Slot', 'header', { hidden: { b: true } });
    user.patch('Slot', 'header', { arrangement: ['c'], hidden: { a: true } });
    const view = slotView(registry, 'header', {});
    expect([names(view.selected), names(view.userHidden)]).toEqual([['c'], ['a', 'b']]);
    user.patch('Slot', 'header', { arrangement: ['c'], hidden: { a: true, b: false } });
    expect(names(fillsOf(registry, 'header', {}))).toEqual(['c', 'b']);
    user.patch('Slot', 'header', { hidden: { a: unset } });
    expect(names(fillsOf(registry, 'header', {}))).toEqual(['a', 'c']);
    app.add('Slot', 'header', { userArranged: false });
    expect(names(fillsOf(registry, 'header', {}))).toEqual(['a', 'b', 'c']);
  });

  it('wraps a fill for some targets (by the app’s matcher) and when it holds', () => {
    const { registry, app, addon } = setup();
    app.add('Fill', 'app.name', { slot: 'header', render: r('name') });
    addon.add('Wrap', 'addon.pods', { wraps: 'app.name', target: { kind: 'Pod' }, render: r('pods') });
    addon.add('Wrap', 'addon.web', { wraps: 'app.name', when: (p: Pod) => p.name === 'web', render: r('web') });
    const matcher = { matches: (t: { kind: string }, p: Pod) => t.kind === p.kind };
    expect(names(wrapsOf(registry, 'app.name', { name: 'web', kind: 'Pod' }, { matcher }))).toEqual(['addon.pods', 'addon.web']);
    expect(names(wrapsOf(registry, 'app.name', { name: 'db', kind: 'Node' }, { matcher }))).toEqual([]);
  });

  it('orders the wraps of a fill as fills are: by order, one after or before another', () => {
    const { registry, app, addon } = setup();
    app.add('Fill', 'app.name', { slot: 'header', render: r('name') });
    addon.add('Wrap', 'addon.a', { wraps: 'app.name', order: 1, render: r('a') });
    addon.add('Wrap', 'addon.c', { wraps: 'app.name', order: 2, render: r('c') });
    addon.add('Wrap', 'addon.b', { wraps: 'app.name', before: 'addon.c', render: r('b') });
    expect(names(wrapsOf(registry, 'app.name', {}))).toEqual(['addon.a', 'addon.b', 'addon.c']);
  });

  it('wraps for no target with no matcher, and tells it', () => {
    const { registry, app, addon } = setup();
    app.add('Fill', 'f', { slot: 's', render: r('f') });
    addon.add('Wrap', 'pods', { wraps: 'f', target: { kind: 'Pod' }, render: r('w') });
    const failures: Failure[] = [];
    expect(names(wrapsOf(registry, 'f', { name: 'web', kind: 'Pod' }, { onError: (f) => failures.push(f) }))).toEqual([]);
    expect(failures.map((f) => [f.phase, f.definition.name])).toEqual([['match', 'pods']]);
  });

  it('tells what fails — the matcher, a condition, a target with no matcher — with its phase, and does not show it', () => {
    const { registry, app } = setup();
    app.add('Fill', 'bad', {
      slot: 's',
      when: () => {
        throw new Error('when');
      },
      render: r('x'),
    });
    app.add('Fill', 'targeted', { slot: 's', target: { kind: 'Pod' }, render: r('t') });
    app.add('Fill', 'truthy', { slot: 's', when: (() => 1) as never, render: r('1') });
    const failures: Failure[] = [];
    const onError = (f: Failure) => failures.push(f);
    expect(names(fillsOf(registry, 's', {}, { onError }))).toEqual(['truthy']);
    expect(failures.map((f) => [f.phase, f.definition.name])).toEqual([
      ['when', 'bad'],
      ['match', 'targeted'],
    ]);
    failures.length = 0;
    const matcher = {
      matches: () => {
        throw new Error('matcher');
      },
    };
    fillsOf(registry, 's', {}, { matcher, onError });
    expect(failures.map((f) => [f.phase, f.definition.name])).toContainEqual(['match', 'targeted']);
  });
});

describe('the kinds', () => {
  it('check their own fields’ values: what would break a slot is rejected', () => {
    const { app } = setup();
    expect(app.add('Slot', 's', { arrangement: 42 } as never)).toEqual({ status: 'rejected', errors: [{ code: 'invalid', problem: { code: 'notNames', field: 'arrangement' } }] });
    expect(app.add('Slot', 's', { hidden: { a: 'yes' } } as never).status).toBe('rejected');
    expect(app.add('Fill', 'f', { slot: 's', order: Number.NaN, render: r('x') }).status).toBe('rejected');
    expect(app.add('Fill', 'g', { slot: '', render: r('x') }).status).toBe('rejected');
    expect(app.add('Wrap', 'w', { wraps: 'f', when: 'always', render: r('x') } as never).status).toBe('rejected');
  });

  it('let the rights the app named change what they open; where a fill goes and what a wrap wraps are their definer’s', () => {
    const { app, addon } = setup();
    app.add('Fill', 'f', { slot: 's', render: r('x') });
    app.add('Wrap', 'w', { wraps: 'f', render: r('w') });
    expect(addon.patch('Fill', 'f', { title: 'T', order: 1 }).status).toBe('included');
    // @ts-expect-error addon may arrange, not draw
    expect(addon.patch('Fill', 'f', { render: r('mine') })).toEqual({ status: 'rejected', errors: [{ code: 'noRight', right: 'draw', field: 'render' }] });
    // @ts-expect-error a fill's slot is its definer's
    expect(addon.patch('Fill', 'f', { slot: 'elsewhere' }).status).toBe('rejected');
    // @ts-expect-error a wrap's fill is its definer's
    expect(addon.patch('Wrap', 'w', { wraps: 'g' }).status).toBe('rejected');
  });

  it('strict: a render is behaviour all through — adding a fill or a wrap, a fill’s target', () => {
    const strict = uiKinds<Render, { kind: string }>()({ configure: 'arrange', behaviour: 'draw' }, { strict: true });
    const registry = createRegistry({ kinds: [strict.Slot, strict.Fill, strict.Wrap] });
    const app = registry.contributor('app', { priority: 0, rights: ['arrange', 'draw'] });
    const user = registry.contributor('user', { priority: 1000, rights: ['arrange'] });
    expect(app.add('Fill', 'f', { slot: 's', target: { kind: 'Pod' }, render: r('x') }).status).toBe('included');
    expect(user.patch('Fill', 'f', { title: 'T', order: 1 }).status).toBe('included');
    // @ts-expect-error a fill's target is behaviour: a Pod's render is not moved to others
    expect(user.patch('Fill', 'f', { target: { kind: 'Node' } })).toEqual({ status: 'rejected', errors: [{ code: 'noRight', right: 'draw', field: 'target' }] });
    // @ts-expect-error adding a fill is behaviour
    expect(user.add('Fill', 'mine', { slot: 's', render: r('m') })).toEqual({ status: 'rejected', errors: [{ code: 'noRight', right: 'draw' }] });
    // @ts-expect-error adding a wrap is behaviour
    expect(user.add('Wrap', 'mine', { wraps: 'f', render: r('m') }).status).toBe('rejected');
    // A wrap's target too; where it goes among others is the user's.
    app.add('Wrap', 'w', { wraps: 'f', target: { kind: 'Pod' }, render: r('w') });
    // @ts-expect-error a wrap's target is behaviour
    expect(user.patch('Wrap', 'w', { target: { kind: 'Node' } })).toEqual({ status: 'rejected', errors: [{ code: 'noRight', right: 'draw', field: 'target' }] });
    expect(user.patch('Wrap', 'w', { before: 'other' }).status).toBe('included');
    // Not strict (setup's kinds): anyone adds them.
    expect(setup().user.add('Fill', 'mine', { slot: 's', render: r('m') }).status).toBe('included');
  });
});

describe('wraps', () => {
  it('are a fill’s, those for the props, innermost first', () => {
    const { registry, app, addon } = setup();
    app.add('Fill', 'f', { slot: 's', render: r('x') });
    addon.add('Wrap', 'outer', { wraps: 'f', order: 20, render: r('outer') });
    addon.add('Wrap', 'inner', { wraps: 'f', order: 10, render: r('inner') });
    addon.add('Wrap', 'never', { wraps: 'f', when: () => false, render: r('never') });
    addon.add('Wrap', 'other', { wraps: 'g', render: r('other') });
    expect(names(wrapsOf(registry, 'f', {}))).toEqual(['inner', 'outer']);
  });
});

describe('types', () => {
  it('keep the render and the target of the kinds, and the props of a typed slot', () => {
    const { registry, app } = setup();
    const header = slot<{ pod: Pod }>('pod.header');
    app.add('Fill', 'f', fill(header, { when: ({ pod }) => pod.name !== '', render: ({ pod }: { pod: Pod }) => pod.name }));
    const props = { pod: { name: 'web' } };
    // The render is the kinds' own: no cast to call it.
    expect(fillsOf(registry, header, props).map((f) => f.spec.render(props))).toEqual(['web']);
    // @ts-expect-error a target of the kinds' shape
    fillsOf(registry, header, props, { matcher: { matches: (t: number) => t > 0 } });
    // @ts-expect-error the props of the slot
    fill(header, { when: ({ nope }: { nope: number }) => nope > 0, render: r('x') });
  });
});
