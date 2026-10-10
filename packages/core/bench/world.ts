import { seeded } from '../../../scripts/bench/harness.ts';
import { createRegistry, defineKind } from '../src/index.ts';

/*
 * A world as an app over Kubernetes may have it: for each kind of object a
 * table of columns (the app's), addons adding columns of their own and
 * changing others' (a header, a width), the user hiding, ordering and
 * sizing columns; views with filters (a keyed list) and labels (a map).
 * Made from a seed: the same world every run.
 */

export interface ColumnSpec {
  table: string;
  header: string;
  value: (row: unknown) => unknown;
  width?: number;
  order?: number;
  hidden?: boolean;
}

export interface Filter {
  id: string;
  field: string;
  equals?: string;
}

export interface ViewSpec {
  title: string;
  filters: Filter[];
  labels: Record<string, string>;
  pageSize?: number;
}

export const Column = defineKind<ColumnSpec>()('Column', {
  required: ['table', 'header', 'value'],
  patchRights: { header: 'configure', width: 'configure', order: 'configure', hidden: 'configure', value: 'behaviour' },
  otherFieldsRight: 'behaviour',
});

export const View = defineKind<ViewSpec>()('View', {
  required: ['title', 'filters', 'labels'],
  patchRights: { title: 'configure', pageSize: 'configure', filters: 'configure', labels: 'configure' },
  merge: { lists: { filters: { key: 'id', required: ['field'] } }, maps: ['labels'] },
});

export interface Sizes {
  /** Kinds of objects, each a table. */
  readonly tables: number;
  readonly columnsPerTable: number;
  readonly addons: number;
  /** Columns each addon adds. */
  readonly addsPerAddon: number;
  /** Columns of others each addon changes. */
  readonly patchesPerAddon: number;
  /** Columns the user changed (hidden, width, order). */
  readonly userPatches: number;
  readonly views: number;
  readonly filtersPerView: number;
  readonly labelsPerView: number;
}

/** About what an app over a cluster has (≈ 3000 columns of its own, 1000 of addons). */
export const REAL: Sizes = {
  tables: 200,
  columnsPerTable: 15,
  addons: 50,
  addsPerAddon: 20,
  patchesPerAddon: 20,
  userPatches: 1000,
  views: 50,
  filtersPerView: 100,
  labelsPerView: 50,
};

/** The same world, n times smaller (or larger): to see how a cost grows. */
export const scaled = (sizes: Sizes, by: number): Sizes => ({
  ...sizes,
  tables: Math.max(1, Math.round(sizes.tables * by)),
  addons: Math.max(1, Math.round(sizes.addons * by)),
  userPatches: Math.round(sizes.userPatches * by),
  views: Math.max(1, Math.round(sizes.views * by)),
});

const value = (row: unknown) => row;

export function makeWorld(sizes: Sizes = REAL, options: { batch?: boolean; seed?: number } = {}) {
  const random = seeded(options.seed ?? 1);
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const registry = createRegistry({ kinds: [Column, View] });
  const app = registry.contributor('app', { priority: 0 });
  const user = registry.contributor('user', { priority: 1000, rights: ['configure'] });
  const columns: string[] = [];
  const views: string[] = [];
  const addons = Array.from({ length: sizes.addons }, (_, i) => registry.contributor(`addon-${i}`, { priority: 100 + i, rights: ['configure', 'behaviour'] }));
  const fill = () => {
    for (let t = 0; t < sizes.tables; t++) {
      for (let c = 0; c < sizes.columnsPerTable; c++) {
        const name = `t${t}.c${c}`;
        app.add('Column', name, { table: `t${t}`, header: `Column ${c}`, value, order: c });
        columns.push(name);
      }
    }
    for (let v = 0; v < sizes.views; v++) {
      const name = `view-${v}`;
      app.add('View', name, {
        title: `View ${v}`,
        filters: Array.from({ length: sizes.filtersPerView }, (_, f) => ({ id: `f${f}`, field: `field${f}` })),
        labels: Object.fromEntries(Array.from({ length: sizes.labelsPerView }, (_, l) => [`label${l}`, `value${l}`])),
      });
      views.push(name);
    }
    for (const [i, addon] of addons.entries()) {
      for (let a = 0; a < sizes.addsPerAddon; a++) addon.add('Column', `addon-${i}.c${a}`, { table: `t${Math.floor(random() * sizes.tables)}`, header: `Addon ${i} ${a}`, value });
      for (let p = 0; p < sizes.patchesPerAddon; p++) addon.patch('Column', pick(columns), { header: `Renamed by ${i}`, width: 80 + p });
    }
    for (let u = 0; u < sizes.userPatches; u++) {
      const r = random();
      user.patch('Column', pick(columns), r < 0.4 ? { hidden: true } : r < 0.7 ? { width: 100 + u } : { order: u });
    }
  };
  if (options.batch) registry.batch(fill);
  else fill();
  return { registry, app, user, addons, columns, views, random, pick };
}

export type World = ReturnType<typeof makeWorld>;
