import { type Contributor, defineKind, type KindsByName } from '@overweave/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertContributions,
  assertEmpty,
  assertGone,
  assertNoConflicts,
  assertNothingRefused,
  assertResult,
  assertSays,
  CheckError,
  cleanup,
  everyOrder,
  plain,
  uiWorld,
  world,
} from './index.ts';
import { ordersOf } from './orders.ts';

/*
 * The testkit's world: contributors made as asked (an old one forgets only
 * itself), addons run by its contract and owned by it, what each says read
 * from the registry itself, events marked; addons in every order; checks
 * that throw, carrying what was expected and what there is.
 */

afterEach(cleanup);

interface ColumnSpec {
  header: string;
  order?: number;
  value: (row: string) => string;
}
const Column = defineKind<ColumnSpec>()('Column', {
  required: ['header', 'value'],
  patchRights: { header: 'configure', order: 'configure', value: 'behaviour' },
});
const value = (row: string) => row;

describe('contributors', () => {
  it('are made once per id; asked again with no grant, the same; with another, a mistake (rights as a set)', () => {
    const w = world({ kinds: [Column] });
    const a = w.as('a', { rights: ['configure', 'configure'] });
    expect(w.as('a')).toBe(a);
    expect(w.as('a', { rights: ['configure'] })).toBe(a);
    expect(() => w.as('a', { priority: 5 })).toThrow(/another grant/);
  });

  it('an old one, disposed again, forgets only itself', () => {
    const w = world({ kinds: [Column] });
    const old = w.as('a');
    old.dispose();
    const now = w.as('a');
    old.dispose();
    expect(w.as('a')).toBe(now);
  });
});

describe('an addon run', () => {
  it('says what it says, is stopped once (its cleanup, then everything it said taken back), and leaves nothing', () => {
    const w = world({ kinds: [Column] });
    w.as('core').add('Column', 'status', { header: 'Status', value });
    let released = 0;
    const run = w.run(
      'images',
      (c) => {
        c.add('Column', 'images.image', { header: 'Image', order: 15, value });
        c.patch('Column', 'status', { header: 'State' });
        c.patch('Column', 'later', { header: 'Waits' });
        return () => void released++;
      },
      { priority: 200, rights: ['configure'] },
    );
    // Whatever the order, whatever the order of the fields.
    assertContributions(w, 'images', [
      { name: 'later', kind: 'Column', status: 'waiting', operation: 'patch' },
      { kind: 'Column', name: 'images.image', operation: 'add', status: 'included' },
      { kind: 'Column', name: 'status', operation: 'patch', status: 'included' },
    ]);
    assertSays(w, 'Column', 'status', ['header'], 'images');
    assertNothingRefused(w);
    assertNoConflicts(w);
    expect(w.running()).toEqual(['images']);
    run.stop();
    run.stop();
    expect(released).toBe(1);
    assertGone(w, 'images');
    assertEmpty(w, 'images');
  });

  it('is stopped — its cleanup called — when the world is disposed, even if another’s cleanup throws', () => {
    const w = world({ kinds: [Column] });
    let released = 0;
    w.run('a', () => () => {
      throw new Error('a cleanup');
    });
    w.run('b', () => () => void released++);
    expect(() => w.dispose()).toThrow('a: a cleanup');
    expect(released).toBe(1);
    expect(w.disposed).toBe(true);
  });

  it('is checked whole before anything changes: kinds against the world and one another, its grant', () => {
    const w = world();
    const New = defineKind<{ a: string }>()('New', {});
    const OtherNew = defineKind<{ a: number }>()('New', { required: ['a'] });
    expect(() => w.run('two', () => {}, { kinds: [New, OtherNew] })).toThrow(/brought twice/);
    expect(w.registry.kinds()).toEqual([]);
    expect(() => w.run('bad', () => {}, { kinds: [New], priority: Number.NaN })).toThrow(/finite/);
    expect(w.registry.kinds()).toEqual([]);
    w.run('table', (c) => void c.add('Column', 'name', { header: 'Name', value }), { kinds: [Column] });
    const Other = defineKind<{ header: string }>()('Column', {});
    expect(() => w.run('other', () => {}, { kinds: [Other] })).toThrow(/is not the one/);
    expect(() => w.run('table', () => {})).toThrow(/already/);
  });

  it('refuses a promise — a setup’s or a cleanup’s — and leaves no rejection unhandled', async () => {
    const w = world({ kinds: [Column] });
    const unhandled: unknown[] = [];
    const take = (e: unknown) => void unhandled.push(e);
    process.on('unhandledRejection', take);
    try {
      expect(() => w.run('async', (async () => Promise.reject(new Error('later'))) as never)).toThrow(/at once/);
      const run = w.run('cleanup', () => (async () => Promise.reject(new Error('cleanup later'))) as never);
      expect(() => run.stop()).toThrow(/at once/);
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      process.off('unhandledRejection', take);
    }
    expect(unhandled).toEqual([]);
    expect(w.contributionsOf('async')).toEqual([]);
  });

  it('takes back what a setup said before it threw, and throws it (its kinds stay defined)', () => {
    const w = world();
    expect(() =>
      w.run(
        'broken',
        (c) => {
          c.add('Column', 'half', { header: 'Half', value });
          throw new Error('broken');
        },
        { kinds: [Column] },
      ),
    ).toThrow('broken');
    expect(w.registry.contract('Column')).toBeDefined();
    assertGone(w, 'broken');
  });
});

describe('what is said', () => {
  it('is read from the registry itself: a contributor made outside the world is seen too', () => {
    const w = world({ kinds: [Column] });
    w.registry.contributor('raw', { priority: 0 }).add('Column', 'x', { header: 'X', value });
    expect(() => assertGone(w, 'raw')).toThrow(/expected nothing of raw left/);
    expect(() => assertGone(w, 'nobody')).toThrow(/never in this world/);
    w.dispose();
    expect(() => assertGone(w, 'raw')).toThrow(/disposed/);
  });

  it('is told, and marked: what one action told read since its mark', () => {
    const w = world({ kinds: [Column] });
    w.as('core').add('Column', 'c', { header: 'C' } as never);
    const mark = w.events.mark();
    w.as('core').add('Column', 'c', { header: 'C', value });
    w.as('a', { priority: 200, rights: ['configure'] }).patch('Column', 'c', { header: 'A' });
    w.as('b', { priority: 200, rights: ['configure'] }).patch('Column', 'c', { header: 'B' });
    expect(w.events.rejected()).toHaveLength(1);
    assertNothingRefused(w, mark);
    expect(w.events.conflicts(mark)).toHaveLength(1);
    expect(w.events.all().length).toBeGreaterThan(3);
  });

  it('is typed by the world’s kinds; a world of no kinds takes none', () => {
    const w = world({ kinds: [Column] });
    w.as('core').add('Column', 'c', { header: 'C', value });
    const header: string | undefined = w.get('Column', 'c')?.spec.header;
    expect(header).toBe('C');
    // @ts-expect-error no such kind
    w.get('Nope', 'x');
    const empty = world();
    // @ts-expect-error a world of no kinds takes none
    empty.as('a').add('Column', 'x', {});
  });
});

describe('every order', () => {
  type C = Contributor<KindsByName<[typeof Column]>, 'configure'>;
  const make = () => world({ kinds: [Column] });
  const table = { id: 'table', setup: (c: C) => void c.add('Column', 'status', { header: 'Status', value }) };
  const images = { id: 'images', setup: (c: C) => void c.patch('Column', 'status', { header: 'State' }), grant: { priority: 200, rights: ['configure'] } };
  const another = { id: 'another', setup: (c: C) => void c.patch('Column', 'status', { header: 'Another' }), grant: { priority: 200, rights: ['configure'] } };

  it('runs addons in every order, each in a world of its own: the same read back', () => {
    const snapshot = everyOrder(make, [table, images, another]);
    expect(snapshot.definitions).toHaveLength(1);
    // Two addons at one priority: the id decides (images sorts later), in every order.
    expect(snapshot.definitions[0]).toMatchObject({ name: 'status', spec: { header: 'State', value: '[function value]' }, says: { header: 'images' } });
  });

  it('finds an addon whose world depends on the order it started in', () => {
    let started = 0;
    const counting = { id: 'counting', setup: (c: C) => void c.add('Column', `n${started++}`, { header: 'N', value }) };
    expect(() => everyOrder(make, [table, counting])).toThrow(CheckError);
  });
});

describe('checks', () => {
  it('throw saying what was expected and what there is, and carry both', () => {
    const w = world({ kinds: [Column] });
    const result = w.as('core').add('Column', 'c', { header: 'C' } as never);
    expect(() => assertResult(result, 'included')).toThrow(CheckError);
    try {
      assertResult(result, 'rejected', ['taken']);
    } catch (error) {
      expect(error).toMatchObject({ expected: ['taken'], actual: ['required'] });
    }
    assertResult(result, 'rejected', ['required']);
    // @ts-expect-error codes are a rejection's
    expect(() => assertResult(result, 'included', ['required'])).toThrow(/makes no sense/);
    expect(() => assertNothingRefused(w)).toThrow(/rejected or dropped/);
    expect(() => assertSays(w, 'Column', 'c', ['header'], 'core')).toThrow(/nobody does/);
    w.run('x', () => {});
    expect(() => assertEmpty(w)).toThrow(/running/);
  });
});

describe('the second round', () => {
  it('names each addon whose cleanup failed, on a line of its own — no errors buried in errors', () => {
    const w = world();
    w.run('a', () => () => {
      throw new Error('first');
    });
    w.run('b', () => () => {
      throw new Error('second');
    });
    expect(() => cleanup()).toThrow(/a: first\n.*b: second/s);
  });

  it('changes nothing when the id is taken outside the world', () => {
    const w = world();
    w.registry.contributor('raw', { priority: 0 });
    expect(() => w.run('raw', () => {}, { kinds: [Column] })).toThrow(/there already/);
    expect(w.registry.kinds()).toEqual([]);
  });

  it('refuses what a setup gives back that is no function', () => {
    const w = world();
    expect(() => w.run('odd', (() => ({ dispose() {} })) as never)).toThrow(/a function \(what to let go of\) or nothing/);
  });

  it('makes a world of the UI’s kinds and one’s own', () => {
    const ui = { Slot: defineKind<{ a?: string }>()('Slot', {}), Fill: defineKind<{ b?: string }>()('Fill', {}), Wrap: defineKind<{ c?: string }>()('Wrap', {}) };
    const w = uiWorld(ui, Column);
    expect(w.registry.kinds()).toEqual(['Slot', 'Fill', 'Wrap', 'Column']);
  });

  it('samples orders so every addon starts first and last, when there are too many to try', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const orders = ordersOf(ids, 50);
    expect(orders).toHaveLength(50);
    for (const id of ids) {
      expect(orders.some((o) => o[0] === id)).toBe(true);
      expect(orders.some((o) => o[o.length - 1] === id)).toBe(true);
    }
    expect(ordersOf(ids, 50)).toEqual(orders);
  });

  it('tells which order an addon failed to start in; a difference over a cleanup that fails', () => {
    type C = Contributor<KindsByName<[typeof Column]>, 'configure'>;
    const make = () => world({ kinds: [Column] });
    const fine = { id: 'fine', setup: (c: C) => void c.add('Column', 'f', { header: 'F', value }) };
    const flaky = {
      id: 'flaky',
      setup: (c: C) => {
        if (c.priority === 0 && w0.started++ > 0) throw new Error('second time');
      },
    };
    const w0 = { started: 0 };
    expect(() => everyOrder(make, [fine, flaky])).toThrow(/in the order .*flaky failed to start: second time/);
    let n = 0;
    const leaky = {
      id: 'leaky',
      setup: (c: C) => {
        const at = n++;
        c.add('Column', `l${at}`, { header: 'L', value });
        return () => {
          if (at > 0) throw new Error('cannot let go');
        };
      },
    };
    expect(() => everyOrder(make, [fine, leaky])).toThrow(CheckError);
  });
});

describe('plain data', () => {
  it('cuts cycles only, names what is not plain, and keeps a snapshot whole', () => {
    class Pod {
      self: Pod = this;
      constructor(readonly name: string) {}
    }
    const shared = { a: 1 };
    expect(plain({ pod: new Pod('web'), twice: [shared, shared], at: new Date(0), big: 2n, map: new Map([['k', 1]]), set: new Set([1]), inf: Number.POSITIVE_INFINITY })).toEqual({
      pod: { '[Pod]': { self: '[cycle]', name: 'web' } },
      twice: [{ a: 1 }, { a: 1 }],
      at: '1970-01-01T00:00:00.000Z',
      big: '2n',
      map: { '[Map]': [['k', 1]] },
      set: { '[Set]': [1] },
      inf: '[Infinity]',
    });
    const Thing = defineKind<{ value: unknown }>()('Thing', {});
    const w = world({ kinds: [Thing] });
    w.as('app').add('Thing', 't', { value: new Pod('db') });
    expect(w.snapshot().definitions[0].spec).toEqual({ value: { '[Pod]': { self: '[cycle]', name: 'db' } } });
  });
});
