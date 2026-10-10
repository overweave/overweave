import type { AnyKind, AnySpec, Definition, Registry, SpecOf } from '@overweave/core';
import { computed, type ReadonlySignal, type Signal, signal } from '@preact/signals';

/*
 * The registry, read as signals: one version per kind and one per
 * definition, moved by the registry's `changed` (all of them by its
 * `disposed`) — a definition read is followed by itself: a change of
 * another of its kind asks nothing of who reads it. What is read
 * through them keeps its identity while it is the same — the registry
 * keeps a definition's snapshot and a kind's list until they change, and a
 * selection keeps its last list while it holds the same definitions — so
 * whoever reads it is told only when what it read changed.
 */

// biome-ignore lint/suspicious/noExplicitAny: read by kind name, whatever the registry's kinds.
type AnyRegistry = Registry<any>;
const reader = (registry: AnyRegistry) => registry as { get(kind: string, name: string): Definition | undefined; list(kind: string): readonly Definition[] };

/** A registry's versions: by kind, and by definition (kind, then name) — made when first read. */
interface Versions {
  readonly kinds: Map<string, Signal<number>>;
  readonly definitions: Map<string, Map<string, Signal<number>>>;
}

const versions = new WeakMap<AnyRegistry, Versions>();

const bump = (v: Signal<number> | undefined) => {
  if (v) v.value = v.peek() + 1;
};

function versionsOf(registry: AnyRegistry): Versions {
  let made = versions.get(registry);
  if (!made) {
    const v: Versions = { kinds: new Map(), definitions: new Map() };
    made = v;
    versions.set(registry, v);
    registry.subscribe((event) => {
      if (event.type === 'disposed') {
        for (const k of v.kinds.values()) bump(k);
        for (const byName of v.definitions.values()) for (const d of byName.values()) bump(d);
        return;
      }
      if (event.type !== 'changed') return;
      bump(v.definitions.get(event.kind)?.get(event.name));
      bump(v.kinds.get(event.kind));
    });
  }
  return made;
}

/** A kind's version: read it to be told when any of the kind's definitions changes. */
export function versionOf(registry: AnyRegistry, kind: string): ReadonlySignal<number> {
  const { kinds } = versionsOf(registry);
  let v = kinds.get(kind);
  if (!v) {
    v = signal(0);
    kinds.set(kind, v);
  }
  return v;
}

/** A definition's version: read it to be told when that definition changes (or comes, or goes) — and only then. */
export function definitionVersionOf(registry: AnyRegistry, kind: string, name: string): ReadonlySignal<number> {
  const { definitions } = versionsOf(registry);
  let byName = definitions.get(kind);
  if (!byName) {
    byName = new Map();
    definitions.set(kind, byName);
  }
  let v = byName.get(name);
  if (!v) {
    v = signal(0);
    byName.set(name, v);
  }
  return v;
}

const kindName = (kind: AnyKind | string) => (typeof kind === 'string' ? kind : kind.name);

/** A definition, as a signal: told only when that definition changes. definitionSignal(registry, Column, 'age'): its spec typed by the kind. */
export function definitionSignal<K extends AnyKind>(registry: AnyRegistry, kind: K, name: string): ReadonlySignal<Definition<SpecOf<K>> | undefined>;
export function definitionSignal<S = AnySpec>(registry: AnyRegistry, kind: string, name: string): ReadonlySignal<Definition<S> | undefined>;
export function definitionSignal(registry: AnyRegistry, kind: AnyKind | string, name: string): ReadonlySignal<Definition | undefined> {
  const k = kindName(kind);
  const version = definitionVersionOf(registry, k, name);
  return computed(() => {
    version.value;
    return reader(registry).get(k, name);
  });
}

/** A kind's definitions, as a signal: told when any of them changes. */
export function listSignal<K extends AnyKind>(registry: AnyRegistry, kind: K): ReadonlySignal<readonly Definition<SpecOf<K>>[]>;
export function listSignal<S = AnySpec>(registry: AnyRegistry, kind: string): ReadonlySignal<readonly Definition<S>[]>;
export function listSignal(registry: AnyRegistry, kind: AnyKind | string): ReadonlySignal<readonly Definition[]> {
  const k = kindName(kind);
  return computed(() => {
    versionOf(registry, k).value;
    return reader(registry).list(k);
  });
}

/** A list as a signal that keeps its last value while the new one holds the same things in the same order: who reads it is told only of a real change. */
export function selection<T>(select: () => readonly T[]): ReadonlySignal<readonly T[]> {
  let last: readonly T[] | undefined;
  return computed(() => {
    const next = select();
    if (last && last.length === next.length && next.every((v, i) => v === last?.[i])) return last;
    last = next;
    return next;
  });
}
