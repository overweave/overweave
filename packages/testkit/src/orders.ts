import { CheckError } from './checks.ts';
import { failed } from './cleanup.ts';
import type { Grant, Snapshot, World } from './world.ts';

/*
 * Addons in every order: run in each order in a world of its own, their
 * snapshots compared — what is read must not depend on the order they
 * started in. Orders grow fast (n!): every one while there are no more
 * than `max` (default 720, six addons); else a fixed sample of `max` — the
 * given order, its reverse, every rotation, then shuffles from a seed — so
 * every addon starts first, and last, at least once.
 */

/** An addon to run: its id, its setup, its grant (its kinds among it). */
export interface AddonRun {
  readonly id: string;
  /** Its setup, whatever its contributor's types (it is handed the one made for it). */
  readonly setup: (contributor: never) => unknown;
  // biome-ignore lint/suspicious/noExplicitAny: an addon of whatever kinds.
  readonly grant?: Grant & { readonly kinds?: readonly any[] };
}

function* permutations<T>(list: readonly T[]): Generator<T[]> {
  if (list.length <= 1) {
    yield [...list];
    return;
  }
  for (let i = 0; i < list.length; i++) {
    const rest = [...list.slice(0, i), ...list.slice(i + 1)];
    for (const tail of permutations(rest)) yield [list[i], ...tail];
  }
}

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));

/** A seeded generator (mulberry32): the same shuffles every run. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The orders to try: all of them, or a sample of `max` that starts every addon first and last. */
export function ordersOf<T>(list: readonly T[], max: number, seed = 1): T[][] {
  if (factorial(list.length) <= max) return [...permutations(list)];
  const out = new Map<string, T[]>();
  const add = (order: T[]) => {
    const key = order.map((t) => list.indexOf(t)).join(',');
    if (!out.has(key) && out.size < max) out.set(key, order);
  };
  add([...list]);
  add([...list].reverse());
  for (let r = 1; r < list.length; r++) add([...list.slice(r), ...list.slice(0, r)]);
  const random = seeded(seed);
  for (let tries = 0; out.size < max && tries < max * 20; tries++) {
    const order = [...list];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    add(order);
  }
  return [...out.values()];
}

/** What differs between two snapshots: the definitions only one has, or has otherwise. */
function differences(a: Snapshot, b: Snapshot) {
  const key = (d: Snapshot['definitions'][number]) => `${d.kind}/${d.name}`;
  const left = new Map(a.definitions.map((d) => [key(d), d]));
  const right = new Map(b.definitions.map((d) => [key(d), d]));
  const changed: { definition: string; was: unknown; now: unknown }[] = [];
  for (const [k, d] of left) {
    const o = right.get(k);
    if (o && JSON.stringify(d) !== JSON.stringify(o)) changed.push({ definition: k, was: d, now: o });
  }
  return { only: [...left.keys()].filter((k) => !right.has(k)), other: [...right.keys()].filter((k) => !left.has(k)), changed };
}

/** Run some addons in every order (each in a fresh world), and check that each reads the same: the snapshot of the first order back. */
// biome-ignore lint/suspicious/noExplicitAny: worlds of whatever kinds.
export function everyOrder(makeWorld: () => World<any>, addons: readonly AddonRun[], options: { max?: number; seed?: number } = {}): Snapshot {
  let first: { snapshot: Snapshot; order: string } | undefined;
  for (const order of ordersOf(addons, options.max ?? 720, options.seed ?? 1)) {
    const named = order.map((a) => a.id).join(' → ');
    const w = makeWorld();
    let wrong: unknown;
    try {
      for (const a of order) {
        try {
          w.run(a.id, a.setup as never, a.grant);
        } catch (error) {
          throw new Error(`in the order ${named}, ${a.id} failed to start: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
      }
      const snapshot = w.snapshot();
      if (!first) first = { snapshot, order: named };
      else {
        const diff = differences(first.snapshot, snapshot);
        if (diff.only.length || diff.other.length || diff.changed.length) {
          const told = { [`only in ${first.order}`]: diff.only, [`only in ${named}`]: diff.other, changed: diff.changed };
          throw new CheckError(`${named} reads otherwise than ${first.order}:\n${JSON.stringify(told, null, 2)}`, first.snapshot, snapshot);
        }
      }
    } catch (error) {
      wrong = error;
    }
    // What the world fails to let go of comes second: a difference, or a start that failed, is what is told.
    try {
      w.dispose();
    } catch (error) {
      wrong ??= failed(`in the order ${named}`, [error]);
    }
    if (wrong) throw wrong;
  }
  return first?.snapshot ?? { definitions: [] };
}
