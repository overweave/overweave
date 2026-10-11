import { describe, expect, it } from 'vitest';
import { createRegistry, defineKind, type RegistryEvent, unset, unsetItem } from './index.ts';

/*
 * The registry: definitions added whole by one definer; patches of the
 * fields a contributor has the rights for, layered leaf by leaf (priority,
 * a patch over the add, tie-break, id); what is read always holds the
 * kind's contract (a breaking patch rejected, one that no longer fits
 * dropped); `unset` takes away what is under it; told to subscribers once
 * consistent. The regressions of the reviews are here too.
 */

interface ColumnSpec {
  header: string;
  width?: string;
  value: (row: unknown) => unknown;
}
const Column = defineKind<ColumnSpec>()('Column', {
  required: ['header', 'value'],
  patchRights: { header: 'configure', width: 'configure', value: 'behaviour' },
  validate: (spec) => (spec.width !== undefined && !/^\d+px$/.test(spec.width) ? [{ code: 'notPx', field: 'width' }] : undefined),
});

interface Region {
  id: string;
  layout?: string;
  url?: string;
}
interface BoardSpec {
  title: string;
  subtitle?: string;
  regions?: Region[];
  values?: Record<string, unknown>;
}
const Board = defineKind<BoardSpec>()('Board', {
  required: ['title'],
  patchRights: { title: 'configure', subtitle: 'configure', regions: 'configure', values: 'configure' },
  merge: { lists: { regions: { key: 'id' } }, maps: ['values'] },
});

const Range = defineKind<{ x: number; y: number }>()('Range', {
  required: ['x', 'y'],
  patchRights: { x: 'configure', y: 'configure' },
  validate: (s) => (s.x > s.y ? [{ code: 'xOverY' }] : undefined),
});

const Locked = defineKind<{ a?: number }>()('Locked', { createRight: 'author', patchRights: { a: 'configure' } });

const value = () => 'v';

function setup() {
  const events: RegistryEvent[] = [];
  const registry = createRegistry({ kinds: [Column, Board, Range, Locked] });
  registry.subscribe((e) => events.push(e));
  const core = registry.contributor('core', { priority: 0, rights: ['author'] });
  const addon = registry.contributor('addon', { priority: 200, rights: ['configure'] });
  const user = registry.contributor('user', { priority: 1000, rights: ['configure'] });
  return { registry, events, core, addon, user };
}

const of = (events: RegistryEvent[], type: RegistryEvent['type']) => events.filter((e) => e.type === type);

describe('add', () => {
  it('takes a whole definition of its definer; another’s of the same name is rejected, before anything else is checked', () => {
    const { registry, events, core, addon } = setup();
    expect(core.add('Column', 'age', { header: 'Age', value })).toEqual({ status: 'included', conflicts: [] });
    expect(addon.add('Column', 'age', { header: 'Mine', value })).toEqual({ status: 'rejected', errors: [{ code: 'taken', definer: 'core' }] });
    expect(addon.add('Column', 'age', {} as never)).toEqual({ status: 'rejected', errors: [{ code: 'taken', definer: 'core' }] });
    expect(of(events, 'rejected')).toHaveLength(2);
    core.add('Column', 'age', { header: 'Created', value });
    expect(registry.get('Column', 'age')).toMatchObject({ spec: { header: 'Created' }, definedBy: 'core' });
  });

  it('checks a definition as it will be read: required fields, shapes, keys, its kind’s validation, plain data — as codes', () => {
    const { core } = setup();
    expect(core.add('Column', 'c', { header: 'C' } as never)).toEqual({ status: 'rejected', errors: [{ code: 'required', field: 'value' }] });
    expect(core.add('Board', 'b', { title: 'B', regions: [{ layout: 'x' }] } as never).status).toBe('rejected');
    expect(core.add('Board', 'm', { title: 'M', values: 'nope' } as never)).toEqual({ status: 'rejected', errors: [{ code: 'notAMap', field: 'values' }] });
    expect(core.add('Column', 'w', { header: 'W', value, width: 'wide' })).toEqual({
      status: 'rejected',
      errors: [{ code: 'invalid', problem: { code: 'notPx', field: 'width' } }],
    });
    // Two items of one key: rejected — never merged into one that the contract did not see.
    expect(core.add('Board', 'd', { title: 'D', regions: [{ id: 'same' }, { id: 'same' }] })).toEqual({
      status: 'rejected',
      errors: [{ code: 'duplicateKey', field: 'regions', key: 'same' }],
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(core.add('Board', 'c', { title: 'C', values: { x: cyclic } })).toEqual({ status: 'rejected', errors: [{ code: 'badData', field: 'values', reason: 'cycle' }] });
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 70; i++) deep = { deep };
    expect(core.add('Board', 'e', { title: 'E', values: { deep } })).toEqual({ status: 'rejected', errors: [{ code: 'badData', field: 'values', reason: 'tooDeep' }] });
    expect(core.add('Board', 's', { title: 'S', values: { holes: new Array(3) } })).toEqual({
      status: 'rejected',
      errors: [{ code: 'badData', field: 'values', reason: 'sparseArray' }],
    });
    expect(core.add('Board', 'u', { title: unset } as never)).toEqual({ status: 'rejected', errors: [{ code: 'unsetInAdd', field: 'title' }] });
    expect(core.add('Board', 'p', JSON.parse('{"title": "P", "__proto__": {"polluted": true}}'))).toEqual({
      status: 'rejected',
      errors: [{ code: 'unsafeName', field: '__proto__' }],
    });
    expect(core.add('Board', 'l', { title: 'L', regions: 'nope' } as never)).toEqual({ status: 'rejected', errors: [{ code: 'notAList', field: 'regions' }] });
    expect(core.add('Board', 'k', { title: 'K', regions: [{ id: '__proto__' }] })).toEqual({ status: 'rejected', errors: [{ code: 'unsafeName', field: 'regions' }] });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('gives its validation a frozen copy: one that changes it is rejected, and what was given is not changed', () => {
    const Mutating = defineKind<{ a: number }>()('Mutating', {
      validate: (spec) => {
        (spec as { a: number }).a = 99;
        return undefined;
      },
    });
    const registry = createRegistry({ kinds: [Mutating] });
    const given = { a: 1 };
    expect(registry.contributor('m', { priority: 0 }).add('Mutating', 'm', given)).toEqual({
      status: 'rejected',
      errors: [{ code: 'invalid', problem: { code: 'validationThrew' } }],
    });
    expect(given.a).toBe(1);
  });

  it('asks the right a kind names for adding it', () => {
    const { core, addon } = setup();
    expect(core.add('Locked', 'l', { a: 1 }).status).toBe('included');
    // @ts-expect-error addon has no right "author"
    expect(addon.add('Locked', 'm', { a: 1 })).toEqual({ status: 'rejected', errors: [{ code: 'noRight', right: 'author' }] });
  });

  it('keeps the order of a list given again', () => {
    const { registry, core } = setup();
    core.add('Board', 'b', { title: 'B', regions: [{ id: 'a' }, { id: 'b' }] });
    core.add('Board', 'b', { title: 'B', regions: [{ id: 'b' }, { id: 'a' }] });
    expect(registry.get('Board', 'b')?.spec.regions?.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('a fallback add', () => {
  it('stands while nobody adds the definition; another’s add takes its place, the patches over it; gone, the fallback is back', () => {
    const { registry, core, addon, user } = setup();
    const other = registry.contributor('other', { priority: 200 });
    expect(core.add('Board', 'b', { title: 'default' }, { fallback: true })).toEqual({ status: 'included', conflicts: [] });
    user.patch('Board', 'b', { subtitle: 'mine' });
    expect(registry.get('Board', 'b')?.spec).toEqual({ title: 'default', subtitle: 'mine' });
    expect(other.add('Board', 'b', { title: 'its own' }).status).toBe('included');
    expect([registry.get('Board', 'b')?.spec, registry.get('Board', 'b')?.definedBy]).toEqual([{ title: 'its own', subtitle: 'mine' }, 'other']);
    expect(registry.contributions('core')).toEqual([{ kind: 'Board', name: 'b', operation: 'add', status: 'waiting' }]);
    expect(registry.inspect('Board', 'b').contributions.map((c) => [c.contributor, c.status])).toEqual([
      ['other', 'included'],
      ['core', 'waiting'],
      ['user', 'included'],
    ]);
    other.remove('Board', 'b');
    expect([registry.get('Board', 'b')?.spec, registry.get('Board', 'b')?.definedBy]).toEqual([{ title: 'default', subtitle: 'mine' }, 'core']);
    expect(addon.add('Board', 'b', { title: 'x' }, { fallback: true })).toEqual({ status: 'rejected', errors: [{ code: 'taken', definer: 'core' }] });
  });

  it('added under another’s add: kept, waiting, nothing read differently; taken back, nothing changes', () => {
    const { registry, events, core } = setup();
    const other = registry.contributor('other', { priority: 200 });
    other.add('Board', 'b', { title: 'its own' });
    events.length = 0;
    expect(core.add('Board', 'b', { title: 'default' }, { fallback: true })).toEqual({ status: 'waiting' });
    core.remove('Board', 'b');
    expect([events, registry.get('Board', 'b')?.spec.title]).toEqual([[], 'its own']);
    core.add('Board', 'c', { title: 'only' }, { fallback: true });
    core.dispose();
    expect(registry.get('Board', 'c')).toBeUndefined();
  });
});

describe('patch', () => {
  it('says the fields its contributor has the rights for, over the definer; the rest rejected', () => {
    const { registry, core, addon } = setup();
    core.add('Column', 'c', { header: 'Age', width: '70px', value });
    expect(addon.patch('Column', 'c', { header: 'Created' }).status).toBe('included');
    // @ts-expect-error value needs "behaviour"
    expect(addon.patch('Column', 'c', { value: () => 'mine' })).toEqual({ status: 'rejected', errors: [{ code: 'noRight', right: 'behaviour', field: 'value' }] });
    const c = registry.get('Column', 'c');
    expect(c?.spec).toMatchObject({ header: 'Created', width: '70px' });
    expect(c?.provenanceOf(['header'])).toEqual({ contributor: 'addon', operation: 'patch', priority: 200 });
  });

  it('opens the fields not named by otherFieldsRight only — a named field keeps its own right', () => {
    const Open = defineKind<{ secret?: string; [key: string]: unknown }>()('Open', { patchRights: { secret: 'admin' }, otherFieldsRight: 'edit' });
    const Closed = defineKind<{ a?: number; b?: number }>()('Closed', { patchRights: { a: 'edit' } });
    const registry = createRegistry({ kinds: [Open, Closed] });
    const core = registry.contributor('core', { priority: 0 });
    const editor = registry.contributor('editor', { priority: 100, rights: ['edit'] });
    core.add('Open', 'o', {});
    core.add('Closed', 'c', {});
    expect(editor.patch('Open', 'o', { anything: 1 }).status).toBe('included');
    expect(editor.patch('Open', 'o', { secret: 'x' } as never)).toEqual({ status: 'rejected', errors: [{ code: 'noRight', right: 'admin', field: 'secret' }] });
    // @ts-expect-error b is no one's to patch
    expect(editor.patch('Closed', 'c', { b: 1 })).toEqual({ status: 'rejected', errors: [{ code: 'notPatchable', field: 'b' }] });
  });

  it('replaces its patch before; nothing said takes it back', () => {
    const { registry, core, addon } = setup();
    core.add('Board', 'b', { title: 'B' });
    addon.patch('Board', 'b', { title: 'T' });
    addon.patch('Board', 'b', { subtitle: 'S' });
    expect(registry.get('Board', 'b')?.spec).toEqual({ title: 'B', subtitle: 'S' });
    expect(addon.patch('Board', 'b', {}).status).toBe('included');
    expect(registry.get('Board', 'b')?.spec).toEqual({ title: 'B' });
    expect(registry.inspect('Board', 'b').contributions.map((c) => c.contributor)).toEqual(['core']);
  });

  it('is rejected if it would break the definition — what was there before stays', () => {
    const { registry, events, core, addon } = setup();
    core.add('Column', 'c', { header: 'Age', width: '70px', value });
    addon.patch('Column', 'c', { width: '90px' });
    expect(addon.patch('Column', 'c', { width: 'wide' })).toEqual({ status: 'rejected', errors: [{ code: 'invalid', problem: { code: 'notPx', field: 'width' } }] });
    expect(registry.get('Column', 'c')?.spec.width).toBe('90px');
    expect(of(events, 'rejected')).toHaveLength(1);
  });

  it('waits for a definition nobody added; taken in once it is, the most important first — one that does not fit is dropped (told)', () => {
    const { registry, events, core, addon, user } = setup();
    expect(user.patch('Range', 'r', { x: 5 })).toEqual({ status: 'waiting' });
    expect(addon.patch('Range', 'r', { y: 3 })).toEqual({ status: 'waiting' });
    expect(registry.get('Range', 'r')).toBeUndefined();
    expect(of(events, 'changed')).toHaveLength(0);
    core.add('Range', 'r', { x: 0, y: 10 });
    expect(registry.get('Range', 'r')?.spec).toEqual({ x: 5, y: 10 });
    // user's x: 5 taken first; addon's y: 3 under it would make x over y — dropped.
    expect(of(events, 'dropped')).toEqual([{ type: 'dropped', contributor: 'addon', kind: 'Range', name: 'r', errors: [{ code: 'invalid', problem: { code: 'xOverY' } }] }]);
    expect(registry.inspect('Range', 'r').contributions.map((c) => [c.contributor, c.status])).toEqual([
      ['core', 'included'],
      ['user', 'included'],
    ]);
  });

  it('drops a patch that no longer fits when another goes', () => {
    const { registry, events, core, addon, user } = setup();
    core.add('Range', 'r', { x: 0, y: 0 });
    user.patch('Range', 'r', { y: 10 });
    addon.patch('Range', 'r', { x: 5 });
    user.dispose();
    expect(registry.get('Range', 'r')?.spec).toEqual({ x: 0, y: 0 });
    expect(of(events, 'dropped').map((e) => e.type === 'dropped' && e.contributor)).toEqual(['addon']);
  });

  it('makes its patches wait again when the definition’s add goes', () => {
    const { registry, core, user } = setup();
    core.add('Column', 'c', { header: 'Age', value });
    user.patch('Column', 'c', { header: 'Mine' });
    core.remove('Column', 'c');
    expect(registry.get('Column', 'c')).toBeUndefined();
    expect(registry.inspect('Column', 'c').contributions.map((c) => c.status)).toEqual(['waiting']);
    core.add('Column', 'c', { header: 'Age', value });
    expect(registry.get('Column', 'c')?.spec.header).toBe('Mine');
  });
});

describe('unset', () => {
  it('takes away a field, a map’s key, a list’s item or an item’s field at its priority; what is above it stays; gone, what is under shows again', () => {
    const { registry, core, addon, user } = setup();
    core.add('Board', 'b', {
      title: 'B',
      subtitle: 'S',
      regions: [
        { id: 'tiles', layout: 'grid' },
        { id: 'main', layout: 'row' },
      ],
      values: { a: 1, b: 2 },
    });
    addon.patch('Board', 'b', { values: { c: 3 } });
    user.patch('Board', 'b', { subtitle: unset, values: { a: unset }, regions: [unsetItem('tiles'), { id: 'main', layout: unset }] });
    expect(registry.get('Board', 'b')?.spec).toEqual({ title: 'B', regions: [{ id: 'main' }], values: { b: 2, c: 3 } });
    expect(registry.get('Board', 'b')?.provenanceOf(['subtitle'])).toEqual({ contributor: 'user', operation: 'patch', priority: 1000 });
    user.dispose();
    expect(registry.get('Board', 'b')?.spec).toEqual({
      title: 'B',
      subtitle: 'S',
      regions: [
        { id: 'tiles', layout: 'grid' },
        { id: 'main', layout: 'row' },
      ],
      values: { a: 1, b: 2, c: 3 },
    });
  });

  it('takes away a whole collection, but not what is said above it', () => {
    const { registry, core, addon, user } = setup();
    core.add('Board', 'b', { title: 'B', values: { a: 1 } });
    user.patch('Board', 'b', { values: { z: 9 } });
    addon.patch('Board', 'b', { values: unset });
    expect(registry.get('Board', 'b')?.spec.values).toEqual({ z: 9 });
  });

  it('cannot take away what is required', () => {
    const { core, user } = setup();
    core.add('Board', 'b', { title: 'B' });
    // @ts-expect-error title is required: it cannot be unset
    expect(user.patch('Board', 'b', { title: unset })).toEqual({ status: 'rejected', errors: [{ code: 'required', field: 'title' }] });
  });
});

describe('keyed lists', () => {
  const Links = defineKind<{ links: { slug: string; url: string; title?: string }[] }>()('Links', {
    required: ['links'],
    patchRights: { links: 'configure' },
    merge: { lists: { links: { key: 'slug', required: ['url'] } } },
  });

  it('merge by the key the kind names, in the order given (the definer’s first), each item whole as the kind requires', () => {
    const registry = createRegistry({ kinds: [Links] });
    const core = registry.contributor('core', { priority: 0 });
    const addon = registry.contributor('addon', { priority: 200, rights: ['configure'] });
    core.add('Links', 'l', {
      links: [
        { slug: 'b', url: '/b' },
        { slug: 'a', url: '/a' },
      ],
    });
    expect(
      addon.patch('Links', 'l', {
        links: [
          { slug: 'c', url: '/c' },
          { slug: 'a', title: 'A' },
        ],
      }).status,
    ).toBe('included');
    expect(registry.get('Links', 'l')?.spec.links).toEqual([
      { slug: 'b', url: '/b' },
      { slug: 'a', url: '/a', title: 'A' },
      { slug: 'c', url: '/c' },
    ]);
    // A new item without what every item must have: rejected (never read half made).
    expect(addon.patch('Links', 'l', { links: [{ slug: 'new' }] })).toEqual({ status: 'rejected', errors: [{ code: 'required', field: 'url', item: 'new' }] });
  });
});

describe('layering', () => {
  it('lets a patch win over an add at the same priority', () => {
    const { registry } = setup();
    const early = registry.contributor('early', { priority: 200, rights: ['configure'] });
    const late = registry.contributor('late', { priority: 200 });
    early.patch('Column', 'c', { header: 'Patched' });
    late.add('Column', 'c', { header: 'Default', value });
    expect(registry.get('Column', 'c')?.spec.header).toBe('Patched');
  });

  it('breaks a tie by tie-break, then by id — never by when one came: registered again, it changes nothing', () => {
    const { registry, core, events } = setup();
    core.add('Column', 'c', { header: 'Age', value });
    const b = registry.contributor('b', { priority: 200, rights: ['configure'] });
    let a = registry.contributor('a', { priority: 200, rights: ['configure'] });
    a.patch('Column', 'c', { header: 'A' });
    b.patch('Column', 'c', { header: 'B' });
    expect(registry.get('Column', 'c')?.spec.header).toBe('B');
    a.dispose();
    a = registry.contributor('a', { priority: 200, rights: ['configure'] });
    a.patch('Column', 'c', { header: 'A' });
    expect(registry.get('Column', 'c')?.spec.header).toBe('B');
    const first = registry.contributor('first', { priority: 200, rights: ['configure'], tieBreak: 1 });
    first.patch('Column', 'c', { header: 'First' });
    expect(registry.get('Column', 'c')?.spec.header).toBe('First');
    expect(of(events, 'conflict').length).toBeGreaterThan(0);
  });

  it('reads the same whatever the order contributions came in: values, key order, leaves, provenance', () => {
    const read = (order: string[]) => {
      const { registry, core } = setup();
      const a = registry.contributor('a', { priority: 200, rights: ['configure'] });
      const b = registry.contributor('b', { priority: 200, rights: ['configure'] });
      const steps: Record<string, () => void> = {
        base: () => core.add('Board', 'b', { title: 'B', values: { k: 0 } }),
        a: () => a.patch('Board', 'b', { values: { x: 1 }, subtitle: 'A' }),
        b: () => b.patch('Board', 'b', { values: { y: 2 }, regions: [{ id: 'r' }] }),
      };
      for (const step of order) steps[step]();
      const d = registry.get('Board', 'b');
      return JSON.stringify({ spec: d?.spec, leaves: d?.leaves, values: d?.provenanceOf(['values']) });
    };
    const all = [
      ['base', 'a', 'b'],
      ['base', 'b', 'a'],
      ['a', 'b', 'base'],
      ['b', 'base', 'a'],
    ].map(read);
    for (const r of all) expect(r).toBe(all[0]);
    expect(JSON.parse(all[0]).values.contributor).toBe('b');
  });

  it('tells conflicts when they come — those of patches that waited too', () => {
    const s = setup();
    s.registry.contributor('a', { priority: 200, rights: ['configure'] }).patch('Column', 'c', { header: 'A' });
    s.registry.contributor('b', { priority: 200, rights: ['configure'] }).patch('Column', 'c', { header: 'B' });
    expect(of(s.events, 'conflict')).toHaveLength(0);
    s.core.add('Column', 'c', { header: 'Age', value });
    expect(of(s.events, 'conflict')).toEqual([{ type: 'conflict', kind: 'Column', name: 'c', path: ['header'], contributors: ['a', 'b'] }]);
  });
});

describe('cost', () => {
  it('checks a definition once per patch when its add comes under many', () => {
    let calls = 0;
    const Counted = defineKind<{ n: number; [key: string]: unknown }>()('Counted', {
      otherFieldsRight: 'set',
      validate: () => {
        calls++;
        return undefined;
      },
    });
    const registry = createRegistry({ kinds: [Counted] });
    for (let i = 0; i < 200; i++) registry.contributor(`p${i}`, { priority: i, rights: ['set'] }).patch('Counted', 'c', { [`f${i}`]: i });
    registry.contributor('core', { priority: 0 }).add('Counted', 'c', { n: 0 });
    expect(calls).toBe(201);
  });
});

describe('the end, from a listener', () => {
  it('tells `disposed` last even when a listener disposes the registry', () => {
    const { registry, core } = setup();
    const told: string[] = [];
    registry.subscribe((e) => {
      told.push(e.type);
      if (e.type === 'changed') registry.dispose();
    });
    core.add('Column', 'c', { header: 'C', value });
    expect(told).toEqual(['changed', 'disposed']);
  });

  it('tells no conflict when the app broke the tie (another tie-break): only when the id decides', () => {
    const { registry, core, events } = setup();
    core.add('Column', 'c', { header: 'Age', value });
    registry.contributor('a', { priority: 200, rights: ['configure'], tieBreak: 1 }).patch('Column', 'c', { header: 'A' });
    expect(registry.contributor('b', { priority: 200, rights: ['configure'] }).patch('Column', 'c', { header: 'B' })).toEqual({ status: 'included', conflicts: [] });
    expect(registry.get('Column', 'c')?.spec.header).toBe('A');
    expect(of(events, 'conflict')).toHaveLength(0);
  });
});

describe('what a contributor says', () => {
  it('is listed — waiting patches too — in the order it first touched each definition; none once it is gone', () => {
    const { registry, core, addon } = setup();
    core.add('Column', 'c', { header: 'C', value });
    addon.patch('Column', 'later', { header: 'L' });
    addon.patch('Column', 'c', { header: 'X' });
    expect(registry.contributions('addon')).toEqual([
      { kind: 'Column', name: 'later', operation: 'patch', status: 'waiting' },
      { kind: 'Column', name: 'c', operation: 'patch', status: 'included' },
    ]);
    expect(registry.contributions('core')).toEqual([{ kind: 'Column', name: 'c', operation: 'add', status: 'included' }]);
    addon.dispose();
    expect(registry.contributions('addon')).toEqual([]);
    expect(registry.contributions('nobody')).toEqual([]);
  });
});

describe('contributors', () => {
  it('are one at a time per id; their rights cannot be changed after', () => {
    const { registry, addon } = setup();
    expect(() => registry.contributor('addon', { priority: 0 })).toThrow(/there already/);
    expect(() => registry.contributor('x', { priority: Number.NaN })).toThrow(/finite/);
    expect(Object.isFrozen(addon.rights)).toBe(true);
    addon.dispose();
    expect(registry.contributor('addon', { priority: 200 }).id).toBe('addon');
  });

  it('say nothing more once disposed — not even from a listener told of their going', () => {
    const { registry, core } = setup();
    core.add('Column', 'c', { header: 'Age', value });
    const ghost = registry.contributor('ghost', { priority: 0 });
    ghost.add('Column', 'g', { header: 'G', value });
    registry.subscribe((e) => {
      if (e.type === 'changed' && e.name === 'g' && !registry.get('Column', 'g')) ghost.add('Column', 'g', { header: 'Back', value });
    });
    ghost.dispose();
    expect(registry.get('Column', 'g')).toBeUndefined();
    expect(ghost.add('Column', 'g', { header: 'G', value })).toEqual({ status: 'rejected', errors: [{ code: 'disposed' }] });
  });
});

describe('what is read', () => {
  it('is a frozen snapshot; what was given is copied; functions kept; provenance of every leaf', () => {
    const { registry, core, user } = setup();
    const regions = [{ id: 'a', layout: 'grid' }];
    core.add('Board', 'b', { title: 'B', regions });
    user.patch('Board', 'b', { regions: [{ id: 'a', url: '/a' }] });
    regions[0].layout = 'row';
    const b = registry.get('Board', 'b');
    expect(b?.spec.regions).toEqual([{ id: 'a', layout: 'grid', url: '/a' }]);
    expect(Object.isFrozen(b?.spec.regions?.[0])).toBe(true);
    expect(b?.provenanceOf(['regions', 'a', 'url'])?.contributor).toBe('user');
    expect(b?.provenanceOf(['regions', 'a', 'layout'])?.contributor).toBe('core');
    core.add('Column', 'c', { header: 'C', value });
    expect(registry.get('Column', 'c')?.spec.value).toBe(value);
  });

  it('lists a kind’s definitions by name', () => {
    const { registry, core } = setup();
    core.add('Column', 'b', { header: 'B', value });
    core.add('Column', 'a', { header: 'A', value });
    expect(registry.list('Column').map((d) => d.name)).toEqual(['a', 'b']);
    expect(registry.list('Column')).toBe(registry.list('Column'));
  });

  it('tells subscribers what changed, once consistent; the same again tells nothing; a batch tells after it all', () => {
    const { registry, events, core, addon } = setup();
    core.add('Column', 'c', { header: 'Age', value });
    addon.patch('Column', 'c', { header: 'A' });
    const before = events.length;
    addon.patch('Column', 'c', { header: 'A' });
    expect(events.length).toBe(before);
    const seen: string[] = [];
    const stop = registry.subscribe((e) => {
      if (e.type === 'changed') seen.push(`${e.name}:${registry.get('Column', e.name)?.spec.header}`);
    });
    registry.batch(() => {
      core.add('Column', 'd', { header: 'D', value });
      core.add('Column', 'e', { header: 'E', value });
      expect(seen).toEqual([]);
    });
    expect(seen).toEqual(['d:D', 'e:E']);
    stop();
  });

  it('stays consistent when a listener throws', () => {
    const { registry, core, addon } = setup();
    registry.subscribe(() => {
      throw new Error('listener');
    });
    core.add('Column', 'c', { header: 'A', value });
    expect(() => addon.patch('Column', 'c', { header: 'B' })).not.toThrow();
    expect(registry.get('Column', 'c')?.spec.header).toBe('B');
  });
});

describe('kinds and the end', () => {
  it('keeps its own copy of a contract: changing what was given changes nothing', () => {
    const contract = { required: ['a'] as 'a'[], patchRights: { a: 'x' } };
    const K = defineKind<{ a: number; b?: number }>()('K', contract);
    const registry = createRegistry({ kinds: [K] });
    contract.required.push('b' as never);
    contract.patchRights.a = 'y';
    expect(registry.contract('K')).toMatchObject({ required: ['a'], patchRights: { a: 'x' } });
    expect(Object.isFrozen(registry.contract('K'))).toBe(true);
  });

  it('defines a kind once; the same contract again (a copy too) is nothing, another is refused', () => {
    const { registry } = setup();
    const Late = defineKind<{ a: string }>()('Late', { required: ['a'] });
    registry.define(Late);
    registry.define(defineKind<{ a: string }>()('Late', { required: ['a'] }));
    expect(() => registry.define(defineKind<{ a: string }>()('Late', {}))).toThrow(/another contract/);
    expect(() => registry.define(defineKind<{ a: string[] }>()('Bad', { merge: { lists: { a: { key: '' as never } } } } as never))).toThrow(/needs a key/);
  });

  it('says whether a kind may be defined, changing nothing', () => {
    const { registry } = setup();
    const Late = defineKind<{ a: string }>()('Late', { required: ['a'] });
    expect(registry.accepts(Late)).toBe(true);
    expect(registry.kinds()).not.toContain('Late');
    expect(registry.accepts(Column)).toBe(true);
    expect(registry.accepts(defineKind<{ header: string }>()('Column', {}))).toBe(false);
    expect(registry.accepts(defineKind<{ a: string[] }>()('Bad', { merge: { lists: { a: { key: '' as never } } } } as never))).toBe(false);
    registry.dispose();
    expect(registry.accepts(Late)).toBe(false);
  });

  it('takes a kind later, typed: the registry it gives knows it', () => {
    const registry = createRegistry().define(Column);
    const core = registry.contributor('core', { priority: 0 });
    core.add('Column', 'c', { header: 'C', value });
    expect(registry.list('Column').map((d) => d.name)).toEqual(['c']);
  });

  it('lets go of everything, and takes nothing after', () => {
    const { registry, core } = setup();
    core.add('Column', 'c', { header: 'C', value });
    const told: string[] = [];
    registry.subscribe((e) => {
      told.push(`${e.type}:${registry.get('Column', 'c') === undefined}`);
    });
    registry.dispose();
    expect(told).toEqual(['disposed:true']);
    expect(core.add('Column', 'd', { header: 'D', value })).toEqual({ status: 'rejected', errors: [{ code: 'disposed' }] });
    expect(registry.kinds()).toEqual([]);
    expect(() => registry.contributor('x', { priority: 0 })).toThrow(/disposed/);
  });
});

describe('types', () => {
  it('types what a contributor says by the kinds and its rights', () => {
    const Conf = defineKind<{ config: { url: string; timeout: number }; tags?: Record<string, string>; note?: string }>()('Conf', {
      required: ['config'],
      patchRights: { config: 'set', tags: 'set', note: 'set' },
      merge: { maps: ['tags'] },
    });
    const registry = createRegistry({ kinds: [Column, Conf] });
    const reader = registry.contributor('reader', { priority: 0 });
    const setter = registry.contributor('setter', { priority: 100, rights: ['set'] });
    reader.add('Conf', 'c', { config: { url: 'u', timeout: 1 } });
    // @ts-expect-error a Column must have its value
    reader.add('Column', 'x', { header: 'X' });
    // @ts-expect-error no such kind
    reader.add('Nope', 'n', {});
    // @ts-expect-error no such kind
    registry.get('Colunm', 'c');
    // @ts-expect-error no rights: nothing to patch
    reader.patch('Conf', 'c', { tags: { a: 'b' } });
    // @ts-expect-error an object not merged is said whole
    setter.patch('Conf', 'c', { config: { url: 'x' } });
    setter.patch('Conf', 'c', { tags: { a: 'b', z: unset }, config: { url: 'x', timeout: 2 }, note: unset });
    // @ts-expect-error a right for a field the spec has not (a typo)
    defineKind<{ a: string }>()('Typo', { patchRights: { a: 'r', zzz: 'r' } });
    // @ts-expect-error a list's fields only for keyed lists of objects
    defineKind<{ tags: string[] }>()('Tags', { merge: { lists: { tags: { key: 'x' } } } });
    const read = registry.get('Conf', 'c');
    expect(() => {
      // @ts-expect-error what is read is read-only (and frozen)
      if (read) read.spec.config.url = 'y';
    }).toThrow();
    expect(read?.spec).toEqual({ config: { url: 'x', timeout: 2 }, tags: { a: 'b' } });
  });
});
