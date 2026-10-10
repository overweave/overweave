// @vitest-environment happy-dom
import { createRegistry, type Definition, defineKind } from '@overweave/core';
import { renderCounts } from '@overweave/testkit/preact';
import { batch, computed, type ReadonlySignal, type Signal, signal } from '@preact/signals';
import { Component, h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterAll, describe, it } from 'vitest';
import { measure, note, report, seeded } from '../../../scripts/bench/harness.ts';
import { uiKinds } from '../src/index.ts';
import { OverweaveProvider, type PreactComponent, useDefinitions } from '../src/preact/index.ts';

/*
 * A virtual table over streaming data, as an app over a cluster would draw
 * one: 10 000 pods, 60 columns (10 of the app's, 50 of addons'), 40 rows in
 * view. The pods live in the app's data — one signal per row, the order a
 * signal of its own — never in the registry: the registry holds only how
 * the table looks (its columns). What is measured: a pod changing (in view,
 * out of view, a burst of a second's 100), rows coming, scrolling, the user
 * hiding a column, an addon adding one, sorting by a field that changes —
 * how long each takes, how many rows drew again, and whether the registry
 * was asked anything at all.
 */

afterAll(() => report('table'));

const ui = uiKinds<PreactComponent>()({ configure: 'configure', behaviour: 'behaviour' });

interface Pod {
  uid: string;
  name: string;
  namespace: string;
  phase: 'Running' | 'Pending' | 'Failed';
  restarts: number;
  cpu: number;
  memory: number;
  labels: Record<string, string>;
}

interface ColumnSpec {
  header: string;
  value: (pod: Pod) => string | number;
  order?: number;
  hidden?: boolean;
  width?: number;
}

const Column = defineKind<ColumnSpec>()('Column', {
  required: ['header', 'value'],
  patchRights: { header: 'configure', order: 'configure', hidden: 'configure', width: 'configure', value: 'behaviour' },
});

const PODS = 10_000;
const ADDONS = 50;
const IN_VIEW = 40;

// ── The app's data: a signal per pod, the order a signal of its own ───────────

function podsOf(random: () => number): Pod[] {
  return Array.from({ length: PODS }, (_, i) => ({
    uid: `uid-${i}`,
    name: `pod-${i}`,
    namespace: `ns-${i % 40}`,
    phase: random() < 0.9 ? 'Running' : 'Pending',
    restarts: Math.floor(random() * 5),
    cpu: Math.floor(random() * 1000),
    memory: Math.floor(random() * 4096),
    labels: { app: `app-${i % 200}`, tier: i % 2 ? 'web' : 'db' },
  }));
}

class Pods {
  readonly byUid = new Map<string, Signal<Pod>>();
  readonly uids: Signal<readonly string[]>;
  constructor(pods: readonly Pod[]) {
    for (const p of pods) this.byUid.set(p.uid, signal(p));
    this.uids = signal(pods.map((p) => p.uid));
  }
  /** A watch event: a pod changed (a new object), or came. */
  upsert(pod: Pod): void {
    const row = this.byUid.get(pod.uid);
    if (row) {
      row.value = pod;
      return;
    }
    this.byUid.set(pod.uid, signal(pod));
    this.uids.value = [...this.uids.value, pod.uid];
  }
  /** The rows in order: as they came, or sorted by a field (then every row's change is read). */
  rows(sortBy?: keyof Pod): ReadonlySignal<readonly Signal<Pod>[]> {
    return computed(() => {
      const rows = this.uids.value.map((uid) => this.byUid.get(uid) as Signal<Pod>);
      if (!sortBy) return rows;
      return [...rows].sort((a, b) => (a.value[sortBy] < b.value[sortBy] ? -1 : a.value[sortBy] > b.value[sortBy] ? 1 : 0));
    });
  }
}

// ── The table: the columns from the registry, the rows from the data ─────────

type Columns = readonly Definition<ColumnSpec>[];

/** A row's cells: drawn again when its pod changes (it reads the pod's signal), or the columns do. */
function Row({ pod, columns }: { pod: Signal<Pod>; columns: Columns }) {
  const p = pod.value;
  return h(
    'tr',
    null,
    columns.map((c) => h('td', { key: c.name }, c.spec.value(p))),
  );
}
Row.displayName = 'Row';

/** A row kept as it is when the table draws again (it scrolled, a row came): only its pod or the columns draw it again. */
class KeptRow extends Component<{ pod: Signal<Pod>; columns: Columns }> {
  static displayName = 'KeptRow';
  shouldComponentUpdate(next: { pod: Signal<Pod>; columns: Columns }) {
    return next.pod !== this.props.pod || next.columns !== this.props.columns;
  }
  render() {
    return h(Row, this.props);
  }
}

/** The columns shown, in order: kept while the registry's columns are the same. */
function useColumns(): Columns {
  const all = useDefinitions(Column);
  const shown = useMemoColumns(all);
  return shown;
}
let lastAll: Columns | undefined;
let lastShown: Columns = [];
function useMemoColumns(all: Columns): Columns {
  if (all !== lastAll) {
    lastAll = all;
    lastShown = all.filter((c) => !c.spec.hidden).sort((a, b) => (a.spec.order ?? 0) - (b.spec.order ?? 0));
  }
  return lastShown;
}

function Header({ columns }: { columns: Columns }) {
  return h(
    'tr',
    null,
    columns.map((c) => h('th', { key: c.name }, c.spec.header)),
  );
}

/** The header kept as it is while the columns are the same (the table scrolled, a row came). */
class KeptHeader extends Component<{ columns: Columns }> {
  shouldComponentUpdate(next: { columns: Columns }) {
    return next.columns !== this.props.columns;
  }
  render() {
    return h(Header, this.props);
  }
}

/** The rows in view only: the window moves with `top`. */
function VirtualTable({ rows, top }: { rows: ReadonlySignal<readonly Signal<Pod>[]>; top: Signal<number> }) {
  const columns = useColumns();
  const from = top.value;
  const window = rows.value.slice(from, from + IN_VIEW);
  return h(
    'table',
    null,
    h('thead', null, h(KeptHeader, { columns })),
    h(
      'tbody',
      null,
      window.map((pod) => h(KeptRow, { key: pod.peek().uid, pod, columns })),
    ),
  );
}
VirtualTable.displayName = 'VirtualTable';

// ── The world: the app's columns, 50 addons' columns, the user ───────────────

function table(sortBy?: keyof Pod) {
  const random = seeded(7);
  const registry = createRegistry({ kinds: [ui.Slot, ui.Fill, ui.Wrap, Column] });
  const app = registry.contributor('app', { priority: 0 });
  const user = registry.contributor('user', { priority: 1000, rights: ['configure'] });
  const addons = Array.from({ length: ADDONS }, (_, i) => registry.contributor(`addon-${i}`, { priority: 100 + i, rights: ['configure', 'behaviour'] }));
  registry.batch(() => {
    const own: [string, (p: Pod) => string | number][] = [
      ['Name', (p) => p.name],
      ['Namespace', (p) => p.namespace],
      ['Phase', (p) => p.phase],
      ['Restarts', (p) => p.restarts],
      ['CPU', (p) => `${p.cpu}m`],
      ['Memory', (p) => `${p.memory}Mi`],
      ['App', (p) => p.labels.app],
      ['Tier', (p) => p.labels.tier],
      ['Ready', (p) => (p.phase === 'Running' ? '1/1' : '0/1')],
      ['Node', (p) => `node-${p.uid.length % 7}`],
    ];
    for (const [i, [header, value]] of own.entries()) app.add('Column', `app.${i}`, { header, value, order: i });
    for (const [i, addon] of addons.entries()) addon.add('Column', `addon-${i}.col`, { header: `Addon ${i}`, value: (p) => (p.cpu * (i + 1)) % 97, order: 100 + i });
  });
  const pods = new Pods(podsOf(random));
  const rows = pods.rows(sortBy);
  const top = signal(0);
  const container = document.createElement('div');
  act(() => render(h(OverweaveProvider, { registry }, h(VirtualTable, { rows, top })), container));
  let asked = 0;
  registry.subscribe(() => asked++);
  return { registry, user, addons, pods, rows, top, container, random, asked: () => asked };
}

/** A pod changed as a watch tells it: a new object, a field moved. */
const changed = (pod: Pod, n: number): Pod => ({ ...pod, restarts: pod.restarts + 1, cpu: (pod.cpu + 37 * n) % 1000 });

/** What one change drew again, by component. */
function rendersOf(change: () => void) {
  const counts = renderCounts();
  act(change);
  const all = counts.all();
  counts.stop();
  return { Row: all.Row ?? 0, Header: all.Header ?? 0, VirtualTable: all.VirtualTable ?? 0 };
}

describe('drawing', () => {
  it('10 000 pods, 60 columns, 40 rows in view: drawn the first time', () => {
    measure('table', 'first drawing (40 rows × 60 columns of 10 000)', () => table().registry.dispose(), { time: 2000, minRuns: 5 });
  });
});

describe('the stream', () => {
  const t = table();
  let n = 0;
  const pod = (i: number) => t.pods.byUid.get(`uid-${i}`)?.peek() as Pod;
  it('a pod in view changes', () => {
    const before = t.asked();
    measure('stream', 'a pod in view changes', () => act(() => t.pods.upsert(changed(pod(5), n++))));
    note('stream', '… drawn again', { ...rendersOf(() => t.pods.upsert(changed(pod(5), n++))), 'registry events': t.asked() - before });
  });
  it('a pod out of view changes', () => {
    measure('stream', 'a pod out of view changes', () => act(() => t.pods.upsert(changed(pod(5000), n++))));
    note(
      'stream',
      '… drawn again (out of view)',
      rendersOf(() => t.pods.upsert(changed(pod(5000), n++))),
    );
  });
  it('a second of the stream: 100 pods at once', () => {
    const burst = () =>
      batch(() => {
        for (let i = 0; i < 100; i++) t.pods.upsert(changed(pod(Math.floor(t.random() * PODS)), n++));
      });
    measure('stream', '100 pods change at once (a second’s worth)', () => act(burst));
    note('stream', '… drawn again (100 at once)', rendersOf(burst));
  });
  it('a pod comes', () => {
    const before = t.asked();
    measure('stream', 'a pod comes (at the end, out of view)', () => act(() => t.pods.upsert({ ...pod(1), uid: `new-${n}`, name: `new-${n++}` })));
    note('stream', '… drawn again (a pod came)', { ...rendersOf(() => t.pods.upsert({ ...pod(1), uid: `new-${n}`, name: `new-${n++}` })), 'registry events': t.asked() - before });
  });
});

describe('scrolling', () => {
  const t = table();
  let at = 0;
  it('one row down', () => {
    measure('scroll', 'one row down', () =>
      act(() => {
        t.top.value = ++at % 5000;
      }),
    );
    note(
      'scroll',
      '… drawn again (one row)',
      rendersOf(() => {
        t.top.value = ++at % 5000;
      }),
    );
  });
  it('a page down', () => {
    measure('scroll', 'a page down (40 rows)', () =>
      act(() => {
        at += IN_VIEW;
        t.top.value = at % 5000;
      }),
    );
    note(
      'scroll',
      '… drawn again (a page)',
      rendersOf(() => {
        at += IN_VIEW;
        t.top.value = at % 5000;
      }),
    );
  });
});

describe('the table changing', () => {
  const t = table();
  let flip = false;
  it('the user hides a column', () => {
    const hide = () => {
      flip = !flip;
      t.user.patch('Column', 'app.3', { hidden: flip });
    };
    measure('columns', 'the user hides a column', () => act(hide));
    note('columns', '… drawn again (a column hidden)', rendersOf(hide));
  });
  it('an addon adds a column', () => {
    let n = 0;
    const add = () => {
      t.addons[0].add('Column', `late-${n++}`, { header: 'Late', value: (p) => p.name, order: 1000 + n });
    };
    measure('columns', 'an addon adds a column', () => act(add));
    note('columns', '… drawn again (a column added)', rendersOf(add));
  });
});

describe('sorted by a field that changes', () => {
  const t = table('cpu');
  let n = 0;
  it('a pod changes, the 10 000 sorted again', () => {
    measure('sorted', 'a pod changes (sorted by cpu: 10 000 sorted again)', () => act(() => t.pods.upsert(changed(t.pods.byUid.get('uid-5')?.peek() as Pod, n++))), { time: 2000 });
    note(
      'sorted',
      '… drawn again (sorted)',
      rendersOf(() => t.pods.upsert(changed(t.pods.byUid.get('uid-5')?.peek() as Pod, n++))),
    );
  });
});
