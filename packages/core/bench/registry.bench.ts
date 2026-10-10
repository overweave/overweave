import { afterAll, describe, it } from 'vitest';
import { heap, measure, note, report } from '../../../scripts/bench/harness.ts';
import { makeWorld, REAL } from './world.ts';

/*
 * The core under the load of a real app (bench/world.ts: ≈ 3000 columns of
 * the app's, 50 addons adding 1000 more and changing 1000, the user's 1000
 * changes, 50 views of 100 filters and 50 labels): starting, one change,
 * an addon leaving, reading, a deep merge, a contested leaf, memory.
 */

afterAll(() => report('core'));

describe('start', () => {
  it('the whole world, one call at a time', () => {
    measure('start', 'everything, one by one', () => makeWorld(REAL).registry.dispose(), { time: 3000, minRuns: 5 });
  });
  it('the whole world, in one batch', () => {
    measure('start', 'everything, in one batch', () => makeWorld(REAL, { batch: true }).registry.dispose(), { time: 3000, minRuns: 5 });
  });
});

describe('one change on a full registry', () => {
  const w = makeWorld(REAL);
  let flip = false;
  const hide = () => {
    flip = !flip;
    return w.user.patch('Column', 't7.c3', { hidden: flip });
  };

  it('the user hides a column', () => {
    measure('one change', 'the user hides a column', hide);
  });
  it('… and the column read again', () => {
    measure('one change', '… and the column read again', () => {
      hide();
      w.registry.get('Column', 't7.c3');
    });
  });
  it('… and every column listed again', () => {
    measure('one change', '… and every column listed again', () => {
      hide();
      w.registry.list('Column');
    });
  });
  it('… told to 100 listeners', () => {
    const stops = Array.from({ length: 100 }, () => w.registry.subscribe(() => {}));
    measure('one change', '… told to 100 listeners', hide);
    for (const stop of stops) stop();
  });
  it('an addon adds a column', () => {
    let n = 0;
    measure('one change', 'an addon adds a column', () => w.addons[0].add('Column', `late-${n++}`, { table: 't1', header: 'Late', value: () => 0 }));
  });
});

describe('an addon leaves', () => {
  it('its 40 contributions taken back (patches of others under it retaken)', () => {
    let w = makeWorld(REAL);
    let i = 0;
    measure('leave', 'an addon of 40 contributions leaves', (addon) => addon.dispose(), {
      prepare: () => {
        // A fresh world now and then: each run takes another addon away.
        if (i >= w.addons.length) {
          w.registry.dispose();
          w = makeWorld(REAL);
          i = 0;
        }
        return w.addons[i++];
      },
      time: 2000,
      maxRuns: 200,
    });
    w.registry.dispose();
  });
});

describe('reading', () => {
  const w = makeWorld(REAL);
  it('a column, unchanged', () => {
    measure('read', 'get, unchanged', () => w.registry.get('Column', 't9.c9'));
  });
  it('every column, unchanged', () => {
    measure('read', 'list (4000), unchanged', () => w.registry.list('Column'));
  });
  it('who says a leaf', () => {
    measure('read', 'inspect a column', () => w.registry.inspect('Column', 't9.c9'));
  });
});

describe('deep merge', () => {
  const w = makeWorld(REAL);
  for (const [i, addon] of w.addons.slice(0, 20).entries())
    addon.patch('View', 'view-0', { filters: [{ id: `f${i}`, field: 'x', equals: `${i}` }], labels: { [`label${i}`]: `by ${i}` } });
  let n = 0;
  it('a filter of a view of 100, patched over 20 others', () => {
    measure('deep merge', 'one filter patched (100 filters, 20 patches)', () => w.user.patch('View', 'view-0', { filters: [{ id: 'f50', field: 'x', equals: `${n++}` }] }));
  });
  it('… and the view read', () => {
    measure('deep merge', '… and the view read', () => {
      w.user.patch('View', 'view-0', { labels: { label3: `${n++}` } });
      w.registry.get('View', 'view-0');
    });
  });
});

describe('a contested leaf', () => {
  it('20 contributors of one priority say one header', () => {
    const w = makeWorld(REAL);
    const same = Array.from({ length: 20 }, (_, i) => w.registry.contributor(`same-${i}`, { priority: 500, rights: ['configure'] }));
    for (const [i, c] of same.entries()) c.patch('Column', 't3.c3', { header: `by ${i}` });
    let n = 0;
    measure('contested', 'one of 20 equals changes its say', () => same[0].patch('Column', 't3.c3', { header: `again ${n++}` }));
  });
});

describe('memory', () => {
  it('a world made, and let go of', () => {
    const before = heap();
    const w = makeWorld(REAL);
    w.registry.list('Column');
    const made = heap();
    w.registry.dispose();
    const after = heap();
    note('memory', 'a whole world (MB)', { before, made, 'let go of': after, 'kept by the world': Math.round((made - before) * 10) / 10 });
  });
});
