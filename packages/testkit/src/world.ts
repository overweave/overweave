import {
  type AnyKind,
  type ContributionOf,
  type Contributor,
  createRegistry,
  type Definition,
  type KindsByName,
  type Registry,
  type RegistryEvent,
  type SpecOf,
} from '@overweave/core';
import { addCleanup, failed } from './cleanup.ts';

/*
 * A world to test in: a registry of some kinds, contributors made as they
 * are asked for, addons run by the testkit's own contract — the kinds all
 * checked before any is defined, the setup at once, what it gives back
 * called once when it stops — and owned: disposing the world stops them
 * all. Everything told is kept, marked to read what one action told. What
 * each contributor says is read from the registry itself, whoever made it.
 */

/** What an addon is to a world: a setup over its contributor, giving back what to let go of when it stops (or nothing) — at once, never a promise. */
// biome-ignore lint/suspicious/noConfusingVoidType: a setup may return nothing (no `return undefined` asked of it).
export type Setup<C> = (contributor: C) => undefined | (() => void) | void;

/** How a contributor stands: its priority (default 0), its rights, its tie-break. */
export interface Grant<R extends string = string> {
  readonly priority?: number;
  readonly rights?: readonly R[];
  readonly tieBreak?: number;
}

/** An addon running in a world. */
export interface Run<C> {
  readonly id: string;
  readonly contributor: C;
  /** What it gave back called (once), then everything it said taken back — even if that throws. Again: nothing. */
  stop(): void;
}

/** A place in the events: what is told after it. */
export interface Mark {
  readonly at: number;
}

/** Everything told, kept — read by type, or since a mark. */
export interface Events {
  all(): readonly RegistryEvent[];
  of<T extends RegistryEvent['type']>(type: T, since?: Mark): Extract<RegistryEvent, { type: T }>[];
  rejected(since?: Mark): Extract<RegistryEvent, { type: 'rejected' }>[];
  dropped(since?: Mark): Extract<RegistryEvent, { type: 'dropped' }>[];
  conflicts(since?: Mark): Extract<RegistryEvent, { type: 'conflict' }>[];
  /** Where the events are now: read what an action told with `since`. */
  mark(): Mark;
}

/** A world's definitions as plain data: spec (functions by name), who says each leaf — to compare two worlds. */
export interface Snapshot {
  readonly definitions: readonly { kind: string; name: string; definedBy: string; spec: unknown; says: Readonly<Record<string, string>> }[];
}

type SpecIn<KM, K extends string> = K extends keyof KM ? SpecOf<KM[K]> : never;

export interface World<KM> {
  readonly registry: Registry<KM>;
  /** A contributor by its id: made the first time (default priority 0, no rights), the same one after — asked again with another grant: a throw. */
  as<const R extends string = never>(id: string, grant?: Grant<R>): Contributor<KM, R>;
  /** An addon run: its kinds all checked (against the world and one another) and its grant before anything changes, then defined; its setup at once (a promise: a throw); what it throws thrown, and what it said taken back. */
  run<const R extends string = never, const KS extends readonly AnyKind[] = []>(
    id: string,
    setup: Setup<Contributor<KM & KindsByName<KS>, R>>,
    grant?: Grant<R> & { readonly kinds?: KS },
  ): Run<Contributor<KM & KindsByName<KS>, R>>;
  /** The addons running. */
  running(): readonly string[];
  /** Every addon stopped (all of them, even if one's cleanup throws: then a throw after). */
  stopAll(): void;
  /** A definition, as read: typed by the world's kinds. */
  get<K extends keyof KM & string>(kind: K, name: string): Definition<SpecIn<KM, K>> | undefined;
  /** Everything a contributor says now (the registry's own account: whoever made it), in the order it first touched each definition. */
  contributionsOf(id: string): readonly ContributionOf[];
  /** Whether a contributor was ever in this world (asked for, run, or saying something now). */
  knows(id: string): boolean;
  /** Who says what is at a path of a definition (none: nobody, or no definition). */
  whoSays<K extends keyof KM & string>(kind: K, name: string, path: readonly string[]): string | undefined;
  /** The definitions as plain data. */
  snapshot(): Snapshot;
  readonly events: Events;
  /** Every addon stopped, then the registry let go of; the world takes nothing after. */
  dispose(): void;
  readonly disposed: boolean;
}

/** Worlds not yet disposed: what cleanup() lets go of. */
const alive = new Set<{ dispose(): void }>();

/** Every world made and not disposed, disposed — every addon in it stopped (what testkit's cleanup does: `afterEach(cleanup)`). */
export function disposeWorlds(): void {
  const errors: unknown[] = [];
  for (const w of [...alive]) {
    try {
      w.dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw failed('some worlds failed to dispose', errors);
}
addCleanup(disposeWorlds);

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  (typeof v === 'object' || typeof v === 'function') && v !== null && typeof (v as { then?: unknown }).then === 'function';

/** A promise not taken: its rejection kept from becoming another test's failure. */
const swallow = (v: PromiseLike<unknown>) => void Promise.resolve(v).catch(() => {});

/**
 * Plain data (JSON's), whatever a value holds: functions and symbols by name,
 * a bigint as `12n`, a Date as its ISO string, a Map's and a Set's entries,
 * an instance of a class under its name (`{ "[Pod]": { … } }`), a value met
 * again inside itself as `[cycle]` (a value met twice elsewhere is written
 * twice: only cycles are cut).
 */
export function plain(value: unknown, inside: Set<object> = new Set()): unknown {
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return `[${value.description ?? 'symbol'}]`;
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'number' && !Number.isFinite(value)) return `[${value}]`;
  if (typeof value !== 'object' || value === null) return value;
  if (inside.has(value)) return '[cycle]';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString();
  inside.add(value);
  try {
    if (Array.isArray(value)) return value.map((v) => plain(v, inside));
    if (value instanceof Map) return { '[Map]': [...value].map(([k, v]) => [plain(k, inside), plain(v, inside)]) };
    if (value instanceof Set) return { '[Set]': [...value].map((v) => plain(v, inside)) };
    const fields = Object.fromEntries(Object.keys(value).map((k) => [k, plain((value as Record<string, unknown>)[k], inside)]));
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) return fields;
    return { [`[${proto?.constructor?.name || 'object'}]`]: fields };
  } finally {
    inside.delete(value);
  }
}

/** A world of some kinds: world({ kinds: [ui.Slot, ui.Fill, ui.Wrap, Column] }). */
export function world<const KS extends readonly AnyKind[] = readonly []>(options: { kinds?: KS } = {}): World<KindsByName<KS>> {
  const registry = createRegistry({ kinds: options.kinds }) as unknown as Registry<KindsByName<KS>>;
  // biome-ignore lint/suspicious/noExplicitAny: read by kind name, whatever the kinds.
  const read = registry as unknown as Registry<any>;
  const told: RegistryEvent[] = [];
  registry.subscribe((event) => told.push(event));
  /** The contributor made for each id now, and its grant (normalized). */
  const made = new Map<string, { contributor: Contributor; grant: string }>();
  const ever = new Set<string>();
  const runs = new Map<string, Run<Contributor>>();
  let disposed = false;

  const live = () => {
    if (disposed) throw new Error('the world is disposed');
  };
  const keyOf = (grant: Grant) => JSON.stringify([grant.priority ?? 0, [...new Set(grant.rights ?? [])].sort(), grant.tieBreak ?? 0]);
  const checkGrant = (id: string, grant: Grant) => {
    if (!Number.isFinite(grant.priority ?? 0) || !Number.isFinite(grant.tieBreak ?? 0)) throw new Error(`${id}: a priority and a tie-break are finite numbers`);
  };

  /** A contributor that, disposed, forgets itself — only itself (an older one of the same id forgets nothing). */
  const open = (id: string, grant: Grant = {}): Contributor => {
    checkGrant(id, grant);
    const contributor = read.contributor(id, { priority: grant.priority ?? 0, rights: [...new Set(grant.rights ?? [])], tieBreak: grant.tieBreak ?? 0 });
    const own: Contributor = Object.freeze({
      id: contributor.id,
      priority: contributor.priority,
      tieBreak: contributor.tieBreak,
      rights: contributor.rights,
      add: contributor.add,
      patch: contributor.patch,
      remove: contributor.remove,
      dispose: () => {
        if (made.get(id)?.contributor === own) made.delete(id);
        contributor.dispose();
      },
    });
    made.set(id, { contributor: own, grant: keyOf(grant) });
    ever.add(id);
    return own;
  };

  const ofType = <T extends RegistryEvent['type']>(type: T, since?: Mark) => told.slice(since?.at ?? 0).filter((e): e is Extract<RegistryEvent, { type: T }> => e.type === type);

  const stopAll = () => {
    const errors: unknown[] = [];
    for (const run of [...runs.values()]) {
      try {
        run.stop();
      } catch (error) {
        errors.push(new Error(`${run.id}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }));
      }
    }
    if (errors.length) throw failed('some addons failed to stop', errors);
  };

  const w: World<KindsByName<KS>> = {
    registry,
    as(id, grant) {
      live();
      const known = made.get(id);
      if (known) {
        if (grant !== undefined && known.grant !== keyOf(grant as Grant)) throw new Error(`${id} is in this world already${runs.has(id) ? ' (running)' : ''}, with another grant`);
        return known.contributor as never;
      }
      return open(id, grant as Grant) as never;
    },
    run(id, setup, grant = {}) {
      live();
      if (made.has(id) || runs.has(id)) throw new Error(`${id} is in this world already`);
      checkGrant(id, grant as Grant);
      // Every kind checked before any is defined: against the world, and against one another.
      const kinds = grant.kinds ?? [];
      const scratch = createRegistry();
      for (const kind of kinds) {
        if (!scratch.accepts(kind))
          throw new Error(`${id}: its kind ${kind.name} ${read.contract(kind.name) ? 'is' : 'could be'} brought twice, or its contract cannot be defined`);
        if (!read.accepts(kind)) throw new Error(`${id}: its kind ${kind.name} is not the one in this world`);
        scratch.define(kind);
      }
      // Its contributor made before its kinds are defined: an id taken (outside the world too) changes nothing.
      const contributor = open(id, grant as Grant);
      for (const kind of kinds) read.define(kind);
      let release: unknown;
      try {
        release = (setup as unknown as Setup<Contributor>)(contributor);
        if (isThenable(release)) {
          swallow(release);
          throw new Error(`${id}: a setup says what it adds at once (it gave a promise)`);
        }
        if (release !== undefined && typeof release !== 'function') throw new Error(`${id}: what a setup gives back is a function (what to let go of) or nothing`);
      } catch (error) {
        contributor.dispose();
        throw error;
      }
      let stopped = false;
      const run: Run<Contributor> = {
        id,
        contributor,
        stop() {
          if (stopped) return;
          stopped = true;
          runs.delete(id);
          try {
            if (typeof release === 'function') {
              const done = (release as () => unknown)();
              if (isThenable(done)) {
                swallow(done);
                throw new Error(`${id}: what a setup gives back lets go at once (it gave a promise)`);
              }
            }
          } finally {
            contributor.dispose();
          }
        },
      };
      runs.set(id, run);
      return run as never;
    },
    running: () => [...runs.keys()],
    stopAll,
    get: (kind, name) => read.get(kind, name) as never,
    contributionsOf: (id) => read.contributions(id),
    knows: (id) => ever.has(id) || read.contributions(id).length > 0,
    whoSays: (kind, name, path) => read.get(kind, name)?.provenanceOf(path)?.contributor,
    snapshot() {
      const definitions = read
        .kinds()
        .sort()
        .flatMap((kind) =>
          read.list(kind).map((d) => ({
            kind,
            name: d.name,
            definedBy: d.definedBy,
            spec: plain(d.spec),
            says: Object.fromEntries(d.leaves.map((l) => [l.path.join('.'), l.by.contributor])),
          })),
        );
      return { definitions };
    },
    events: {
      all: () => [...told],
      of: ofType,
      rejected: (since) => ofType('rejected', since),
      dropped: (since) => ofType('dropped', since),
      conflicts: (since) => ofType('conflict', since),
      mark: () => ({ at: told.length }),
    },
    dispose() {
      if (disposed) return;
      alive.delete(w);
      try {
        stopAll();
      } finally {
        disposed = true;
        made.clear();
        registry.dispose();
      }
    },
    get disposed() {
      return disposed;
    },
  };
  alive.add(w);
  return w;
}

/** A world of the UI's kinds (as uiKinds gives them) and some of one's own: uiWorld(ui, Column). */
export function uiWorld<U extends { readonly Slot: AnyKind; readonly Fill: AnyKind; readonly Wrap: AnyKind }, const KS extends readonly AnyKind[] = []>(
  ui: U,
  ...kinds: KS
): World<KindsByName<[U['Slot'], U['Fill'], U['Wrap'], ...KS]>> {
  return world({ kinds: [ui.Slot, ui.Fill, ui.Wrap, ...kinds] as [U['Slot'], U['Fill'], U['Wrap'], ...KS] });
}
