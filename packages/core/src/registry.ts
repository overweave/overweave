import { type AnyContract, type AnyKind, type CreatableBy, type DeepReadonly, type ListRule, type PatchableBy, type PatchOf, type Problem, type SpecOf, unset } from './kinds.ts';

/*
 * The registry: definitions of kinds, and what contributors say of them.
 * A contributor is the app's: an id, a priority, rights — the core knows
 * nothing else of it (an extension, the user, a file, a server).
 * - add: a definition of one's own, whole. One definer per kind and name.
 *   A fallback add ({ fallback: true }) stands only while nobody adds the
 *   definition: a default that yields — another's add takes its place (the
 *   fallback kept under it, back when that add goes), the patches over
 *   whichever is there. One fallback per kind and name, too.
 * - patch: fields of a definition, each as the right its kind names for it.
 *   A contributor's patch replaces its patch before; `unset` takes away
 *   what is under it.
 * Layering, leaf by leaf (a field; a map's key; a keyed list's item and its
 * fields): the highest priority wins; at an equal priority, a patch over
 * the add; then the higher tie-break; then the id sorting later. Two
 * patches saying different values at one priority are a conflict, told.
 * Taken back, what is under a contribution shows again.
 *
 * The kind's contract always holds for what is read: an add is checked as
 * it will be read; a patch that would break the definition is rejected
 * (what was there before stays). Patches of a definition nobody added wait
 * for it; when its add comes (or changes), and when a patch is taken back,
 * the patches are taken again from the most important down, and one that
 * no longer fits is dropped (told).
 *
 * What is given is copied (plain data) and frozen; what is read is a frozen
 * snapshot. Functions and class instances are kept as they are. What
 * happens is told to subscribers once the registry is consistent.
 */

export type Operation = 'add' | 'patch';

/** Who says a leaf's value: the contributor, how, at what priority. */
export interface Provenance {
  readonly contributor: string;
  readonly operation: Operation;
  readonly priority: number;
}

/** A leaf of a definition: its path (field; field, key; field, item, field), its value (`unset`: taken away), who says it. */
export interface Leaf {
  readonly path: readonly string[];
  readonly value: unknown;
  readonly by: Provenance;
}

/** A spec of a kind the reader does not name. */
// biome-ignore lint/suspicious/noExplicitAny: whatever the kind's spec is.
export type AnySpec = Record<string, any>;

/** A definition as its contributions put together: a frozen snapshot. */
export interface Definition<S = AnySpec> {
  readonly kind: string;
  readonly name: string;
  readonly spec: DeepReadonly<S>;
  /** The contributor that added it. */
  readonly definedBy: string;
  /** Every leaf counted, with who says it (those taken away too: their value is `unset`). */
  readonly leaves: readonly Leaf[];
  /** Who says what is at a path: its leaf; a field of parts, the one of them that wins over the others. */
  provenanceOf(path: readonly string[]): Provenance | undefined;
}

/** Why an operation was rejected, or a patch dropped. */
export type ApplyError =
  | { code: 'unknownKind' }
  | { code: 'notAnObject' }
  | { code: 'required'; field: string; item?: string }
  | { code: 'notPatchable'; field: string }
  | { code: 'noRight'; right: string; field?: string }
  | { code: 'notAList'; field: string }
  | { code: 'notAMap'; field: string }
  | { code: 'missingKey'; field: string }
  | { code: 'duplicateKey'; field: string; key: string }
  | { code: 'badData'; field: string; reason: 'cycle' | 'tooDeep' | 'sparseArray' }
  | { code: 'unsafeName'; field: string }
  | { code: 'unsetInAdd'; field: string }
  | { code: 'invalid'; problem: Problem }
  | { code: 'taken'; definer: string }
  | { code: 'disposed' };

/** Another contributor of the same operation at the same priority saying another value of a leaf. */
export interface Conflict {
  readonly path: readonly string[];
  readonly with: string;
}

/** What an operation came to: counted; kept, waiting for the definition's add; or rejected (nothing changed). */
export type ApplyResult =
  | { readonly status: 'included'; readonly conflicts: readonly Conflict[] }
  | { readonly status: 'waiting' }
  | { readonly status: 'rejected'; readonly errors: readonly ApplyError[] };

export type RegistryEvent =
  /** A definition read differently now (added, changed, gone). */
  | { type: 'changed'; kind: string; name: string }
  | { type: 'rejected'; contributor: string; kind: string; name: string; errors: readonly ApplyError[] }
  /** A patch that no longer fits after its definition's add changed or another patch went: taken away. */
  | { type: 'dropped'; contributor: string; kind: string; name: string; errors: readonly ApplyError[] }
  | { type: 'conflict'; kind: string; name: string; path: readonly string[]; contributors: readonly [string, string] }
  /** The registry is disposed: everything read from it is gone (the last thing told). */
  | { type: 'disposed' };

export interface ContributorOptions<R extends string = string> {
  /** Where its contributions meet others', the higher wins. */
  priority: number;
  /** What it may do: the rights kinds name for adding and patching. */
  rights?: readonly R[];
  /** At an equal priority, the higher wins (default 0); then the id sorting later. */
  tieBreak?: number;
}

type KindName<KM> = keyof KM & string;

export interface AddOptions {
  /** A default that yields: it stands only while nobody adds the definition. */
  fallback?: boolean;
}

/** One who contributes: what it says is its own, taken back when it goes. */
export interface Contributor<KM = Record<string, AnyKind>, R extends string = string> {
  readonly id: string;
  readonly priority: number;
  readonly tieBreak: number;
  readonly rights: readonly string[];
  /**
   * A definition of its own, whole; the same name of another's is rejected. Adding it again replaces it.
   * fallback: only while nobody adds it — another's add takes its place (waiting: kept under it).
   */
  add<K extends CreatableBy<KM, R>>(kind: K, name: string, spec: SpecOf<KM[K]>, options?: AddOptions): ApplyResult;
  /** Fields of a definition it has the rights for. Replaces its patch of it before; {} takes it back. */
  patch<K extends KindName<KM>>(kind: K, name: string, fields: PatchOf<KM[K], PatchableBy<KM[K], R>>): ApplyResult;
  /** All it said of a definition (its add and its patch), taken back. */
  remove(kind: KindName<KM>, name: string): void;
  /** Everything it said, taken back; it says nothing more (its id may be used again). */
  dispose(): void;
}

/** One thing a contributor says now. */
export interface ContributionOf {
  readonly kind: string;
  readonly name: string;
  readonly operation: Operation;
  /** Counted, or (a patch) waiting for the definition's add. */
  readonly status: 'included' | 'waiting';
}

/** Everything said of a definition: for diagnostics. */
export interface Inspection {
  readonly definition: Definition | undefined;
  readonly contributions: readonly {
    readonly contributor: string;
    readonly operation: Operation;
    readonly priority: number;
    readonly tieBreak: number;
    /** Counted, or (a patch) waiting for the definition's add. */
    readonly status: 'included' | 'waiting';
    readonly leaves: readonly Leaf[];
  }[];
}

export interface Registry<KM = Record<string, AnyKind>> {
  /** One more kind; the registry, typed with it (use that one for it). The same kind again: nothing; another contract under a taken name: a throw. */
  define<K extends AnyKind>(kind: K): Registry<KM & { [N in K['name']]: K }>;
  /** Whether a kind may be defined: its name free, or taken by the same contract (and the contract well formed). Changes nothing — check several before defining any. */
  accepts(kind: AnyKind): boolean;
  /** A kind's contract (frozen); none for a kind not defined. */
  contract(kind: string): AnyContract | undefined;
  kinds(): string[];
  /** One who contributes: one per id at a time. */
  contributor<const R extends string = never>(id: string, options: ContributorOptions<R>): Contributor<KM, R>;
  /** A definition, as its contributions put together; none if nobody adds it. */
  get<K extends KindName<KM>>(kind: K, name: string): Definition<SpecOf<KM[K]>> | undefined;
  /** A kind's definitions, by name. */
  list<K extends KindName<KM>>(kind: K): readonly Definition<SpecOf<KM[K]>>[];
  inspect(kind: KindName<KM>, name: string): Inspection;
  /** Everything a contributor says now — its adds, its patches (waiting too) — in the order it first touched each definition; none for one not there (or gone). */
  contributions(id: string): readonly ContributionOf[];
  /** Told what happens, once the registry is consistent; what the listener does is told after. */
  subscribe(listener: (event: RegistryEvent) => void): () => void;
  /** Several changes at once: subscribers told after them all. */
  batch<T>(fn: () => T): T;
  /** Everything let go; nothing may be contributed after. */
  dispose(): void;
}

/** The kinds of a list, by name. */
export type KindsByName<KS extends readonly AnyKind[]> = { [K in KS[number] as K['name']]: K };

/** A registry of some kinds, typed by them: createRegistry({ kinds: [Column, Board] }). */
export function createRegistry<const KS extends readonly AnyKind[] = readonly []>(options: { kinds?: KS } = {}): Registry<KindsByName<KS>> {
  const registry = new Store();
  for (const kind of options.kinds ?? []) registry.define(kind);
  return registry as unknown as Registry<KindsByName<KS>>;
}

// ── Inside ───────────────────────────────────────────────────────────────────

const MAX_DEPTH = 64;

/** Names that would reach an object's prototype: never taken as a key. */
const unsafeName = (name: string) => name === '__proto__' || name === 'constructor' || name === 'prototype';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Plain data: an array or an object made of `{}`. */
function isPlain(value: unknown): value is Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return true;
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const isUnsetItem = (v: unknown): v is { [unset]: string } => isRecord(v) && Object.hasOwn(v, unset);

class BadData extends Error {
  constructor(readonly reason: 'cycle' | 'tooDeep' | 'sparseArray') {
    super(reason);
  }
}

/** A frozen copy of plain data (anything else as it is: functions, class instances, `unset`). */
function frozenCopy(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (isUnsetItem(value)) return Object.freeze({ [unset]: String(value[unset]) });
  if (!isPlain(value)) return value;
  if (seen.has(value)) throw new BadData('cycle');
  if (depth > MAX_DEPTH) throw new BadData('tooDeep');
  seen.add(value);
  let out: unknown;
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new BadData('sparseArray');
    out = value.map((v) => frozenCopy(v, seen, depth + 1));
  } else {
    out = Object.fromEntries(Object.keys(value).map((k) => [k, frozenCopy(value[k], seen, depth + 1)]));
  }
  seen.delete(value);
  return Object.freeze(out);
}

/** Whether two values are the same: one value, or equal plain data (arrays in order, objects whatever the order of their keys). */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!isPlain(a) || !isPlain(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((v, i) => same(v, (b as unknown[])[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && same(a[k], (b as Record<string, unknown>)[k]));
}

/** A contract made the registry's own: copied, checked, frozen (its validation kept as it is). */
function ownContract(name: string, contract: AnyContract): AnyContract {
  const lists = Object.entries(contract.merge?.lists ?? {}) as [string, ListRule<Record<string, unknown>>][];
  const maps = [...(contract.merge?.maps ?? [])] as string[];
  for (const [field, rule] of lists) {
    if (typeof rule?.key !== 'string' || rule.key === '') throw new Error(`${name}: the list ${field} needs a key`);
    if (maps.includes(field)) throw new Error(`${name}: ${field} is a list and a map`);
  }
  for (const field of [...lists.map(([f]) => f), ...maps, ...Object.keys(contract.patchRights ?? {}), ...(contract.required ?? [])]) {
    if (unsafeName(field)) throw new Error(`${name}: a field may not be called ${field}`);
  }
  return frozenCopy({
    required: [...(contract.required ?? [])],
    patchRights: { ...(contract.patchRights ?? {}) },
    otherFieldsRight: contract.otherFieldsRight,
    createRight: contract.createRight,
    merge: { lists: Object.fromEntries(lists.map(([f, r]) => [f, { key: r.key, required: [...(r.required ?? [])] }])), maps },
    validate: contract.validate,
  }) as AnyContract;
}

/** Whether two contracts are one: the same structure, the same validation (by identity). */
function sameContract(a: AnyContract, b: AnyContract): boolean {
  const { validate: va, ...ra } = a;
  const { validate: vb, ...rb } = b;
  return va === vb && same(ra, rb);
}

/** The right a patch of a field needs (none: not patchable). */
function rightOf(contract: AnyContract, field: string): string | undefined {
  if (contract.patchRights && Object.hasOwn(contract.patchRights, field)) return contract.patchRights[field];
  return contract.otherFieldsRight;
}

interface Who {
  id: string;
  priority: number;
  tieBreak: number;
  rights: ReadonlySet<string>;
  disposed: boolean;
  /** The definitions it said something of. */
  entries: Set<Entry>;
}

interface StoredLeaf {
  key: string;
  path: readonly string[];
  value: unknown;
}

interface Contribution {
  who: Who;
  operation: Operation;
  /** Its leaves, in the order it gave them. */
  leaves: readonly StoredLeaf[];
}

interface Entry {
  kind: string;
  name: string;
  /** The add read: the definite one, else the fallback. */
  add: Contribution | undefined;
  definite: Contribution | undefined;
  fallback: Contribution | undefined;
  /** By contributor. */
  patches: Map<string, Contribution>;
  /** Conflicts there are now (leaf, the two): each told when it comes. */
  conflicts: Set<string>;
  cached: Definition | undefined | null;
}

const keyOf = (path: readonly string[]) => JSON.stringify(path);
const OPERATION_ORDER: Record<Operation, number> = { add: 0, patch: 1 };

/** Which of two contributions wins (positive: a): the higher priority, a patch over the add, the higher tie-break, the id sorting later. */
function better(a: Contribution, b: Contribution): number {
  return (
    a.who.priority - b.who.priority ||
    OPERATION_ORDER[a.operation] - OPERATION_ORDER[b.operation] ||
    a.who.tieBreak - b.who.tieBreak ||
    (a.who.id > b.who.id ? 1 : a.who.id < b.who.id ? -1 : 0)
  );
}

const provenance = (c: Contribution): Provenance => Object.freeze({ contributor: c.who.id, operation: c.operation, priority: c.who.priority });

const rejected = (errors: ApplyError[]): ApplyResult => Object.freeze({ status: 'rejected', errors: Object.freeze(errors) });
const WAITING: ApplyResult = Object.freeze({ status: 'waiting' });
const INCLUDED: ApplyResult = Object.freeze({ status: 'included', conflicts: Object.freeze([]) });

/** A contribution's spec put together for checking and reading: what wins at every leaf, what is taken away left out. */
function assemble(entry: Entry, contract: AnyContract, add: Contribution, patches: readonly Contribution[]): Definition {
  const lists = contract.merge?.lists ?? {};
  const maps = new Set<string>(contract.merge?.maps ?? []);
  // The contributions in the order they are read: the add, then the patches, the least important first.
  const ordered = [add, ...[...patches].sort(better)];
  const best = new Map<string, StoredLeaf & { c: Contribution }>();
  for (const c of ordered) {
    for (const leaf of c.leaves) {
      const now = best.get(leaf.key);
      if (!now || better(c, now.c) > 0) best.set(leaf.key, { ...leaf, c });
    }
  }
  // The strongest taking away of each container (a field, an item), whoever wins the container itself.
  const unsets = new Map<string, Contribution>();
  for (const c of ordered) {
    for (const leaf of c.leaves) {
      const now = unsets.get(leaf.key);
      if (leaf.value === unset && leaf.path.length < 3 && (!now || better(c, now) > 0)) unsets.set(leaf.key, c);
    }
  }
  // A leaf under a container taken away by one at least as strong as its own: hidden.
  const hidden = (leaf: StoredLeaf & { c: Contribution }) => {
    for (let n = 1; n < leaf.path.length; n++) {
      const by = unsets.get(keyOf(leaf.path.slice(0, n)));
      if (by && better(leaf.c, by) <= 0) return true;
    }
    return false;
  };
  // Every leaf, in the order it was first given (by the contributions in the order read).
  const order = new Map<string, number>();
  for (const c of ordered) for (const leaf of c.leaves) if (!order.has(leaf.key)) order.set(leaf.key, order.size);
  const counted = [...best.values()].filter((l) => !hidden(l)).sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));

  const spec: Record<string, unknown> = {};
  const items = new Map<string, Map<string, Record<string, unknown>>>();
  for (const { path, value } of counted) {
    const [field, key, part] = path;
    const rule = Object.hasOwn(lists, field) ? (lists as Record<string, ListRule<Record<string, unknown>>>)[field] : undefined;
    if (rule) {
      const byKey = items.get(field) ?? new Map<string, Record<string, unknown>>();
      items.set(field, byKey);
      if (path.length === 1 && value !== unset) spec[field] = [];
      if (path.length === 3 && value !== unset) byKey.set(key, { ...(byKey.get(key) ?? { [rule.key]: key }), [part]: value });
    } else if (maps.has(field)) {
      if (value === unset) continue;
      spec[field] ??= {};
      if (path.length === 2) (spec[field] as Record<string, unknown>)[key] = value;
    } else if (value !== unset) {
      spec[field] = value;
    }
  }
  for (const [field, byKey] of items) {
    if (byKey.size || Object.hasOwn(spec, field)) spec[field] = Object.freeze([...byKey.values()].map((i) => Object.freeze(i)));
  }
  for (const field of maps) if (isRecord(spec[field])) spec[field] = Object.freeze(spec[field]);

  const leaves = Object.freeze(counted.map((l) => Object.freeze({ path: l.path, value: l.value, by: provenance(l.c) })));
  // For provenance: the leaves, the winning first.
  const ranked = [...counted].sort((a, b) => better(b.c, a.c) || b.path.length - a.path.length);
  return Object.freeze({
    kind: entry.kind,
    name: entry.name,
    spec: Object.freeze(spec) as DeepReadonly<AnySpec>,
    definedBy: add.who.id,
    leaves,
    provenanceOf(path: readonly string[]) {
      const at = ranked.find((l) => path.length <= l.path.length && path.every((p, i) => l.path[i] === p));
      return at ? provenance(at.c) : undefined;
    },
  });
}

class Store {
  private readonly contracts = new Map<string, AnyContract>();
  private readonly given = new Map<string, AnyContract>();
  private readonly entries = new Map<string, Map<string, Entry>>();
  private readonly lists = new Map<string, readonly Definition[]>();
  private readonly contributors = new Map<string, Who>();
  private readonly listeners = new Set<(event: RegistryEvent) => void>();
  private readonly events: RegistryEvent[] = [];
  private batching = 0;
  private flushing = false;
  private disposed = false;

  define(kind: AnyKind): this {
    this.live();
    if (this.given.get(kind.name) === kind.contract) return this;
    const contract = ownContract(kind.name, kind.contract);
    const known = this.contracts.get(kind.name);
    if (known) {
      if (!sameContract(known, contract)) throw new Error(`the kind ${kind.name} is defined already, with another contract`);
      return this;
    }
    this.contracts.set(kind.name, contract);
    this.given.set(kind.name, kind.contract);
    return this;
  }

  accepts(kind: AnyKind): boolean {
    if (this.disposed) return false;
    if (this.given.get(kind.name) === kind.contract) return true;
    let contract: AnyContract;
    try {
      contract = ownContract(kind.name, kind.contract);
    } catch {
      return false;
    }
    const known = this.contracts.get(kind.name);
    return !known || sameContract(known, contract);
  }

  contract(kind: string): AnyContract | undefined {
    return this.contracts.get(kind);
  }

  kinds(): string[] {
    return [...this.contracts.keys()];
  }

  contributor(id: string, options: ContributorOptions): Contributor {
    this.live();
    if (this.contributors.has(id)) throw new Error(`a contributor ${id} is there already`);
    const tieBreak = options.tieBreak ?? 0;
    if (!Number.isFinite(options.priority) || !Number.isFinite(tieBreak)) throw new Error(`${id}: a priority and a tie-break are finite numbers`);
    const rights = Object.freeze([...new Set(options.rights ?? [])]);
    const who: Who = { id, priority: options.priority, tieBreak, rights: new Set(rights), disposed: false, entries: new Set() };
    this.contributors.set(id, who);
    return Object.freeze({
      id,
      priority: who.priority,
      tieBreak,
      rights,
      add: (kind: string, name: string, spec: object, options?: AddOptions) => this.batch(() => this.add(who, kind, name, spec, options?.fallback === true)),
      patch: (kind: string, name: string, fields: object) => this.batch(() => this.patch(who, kind, name, fields)),
      remove: (kind: string, name: string) => this.batch(() => this.remove(who, kind, name)),
      dispose: () => this.batch(() => this.drop(who)),
    }) as unknown as Contributor;
  }

  get(kind: string, name: string): Definition | undefined {
    const entry = this.entries.get(kind)?.get(name);
    return entry ? this.read(entry) : undefined;
  }

  list(kind: string): readonly Definition[] {
    let list = this.lists.get(kind);
    if (!list) {
      const all = [...(this.entries.get(kind)?.values() ?? [])].map((e) => this.read(e)).filter((d): d is Definition => !!d);
      list = Object.freeze(all.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
      if (this.contracts.has(kind)) this.lists.set(kind, list);
    }
    return list;
  }

  inspect(kind: string, name: string): Inspection {
    const entry = this.entries.get(kind)?.get(name);
    // The add read, a fallback under another's add (waiting), the patches.
    const shadowed = entry?.fallback && entry.fallback !== entry.add ? [entry.fallback] : [];
    const all = entry ? [...(entry.add ? [entry.add] : []), ...shadowed, ...entry.patches.values()] : [];
    return {
      definition: this.get(kind, name),
      contributions: all.map((c) => ({
        contributor: c.who.id,
        operation: c.operation,
        priority: c.who.priority,
        tieBreak: c.who.tieBreak,
        status: entry?.add && !shadowed.includes(c) ? ('included' as const) : ('waiting' as const),
        leaves: c.leaves.map((l) => Object.freeze({ path: l.path, value: l.value, by: provenance(c) })),
      })),
    };
  }

  contributions(id: string): readonly ContributionOf[] {
    const who = this.contributors.get(id);
    if (!who) return Object.freeze([]);
    const out: ContributionOf[] = [];
    for (const entry of who.entries) {
      if (entry.definite?.who === who) out.push(Object.freeze({ kind: entry.kind, name: entry.name, operation: 'add', status: 'included' }));
      if (entry.fallback?.who === who)
        out.push(Object.freeze({ kind: entry.kind, name: entry.name, operation: 'add', status: entry.add === entry.fallback ? 'included' : 'waiting' }));
      if (entry.patches.get(id)?.who === who) out.push(Object.freeze({ kind: entry.kind, name: entry.name, operation: 'patch', status: entry.add ? 'included' : 'waiting' }));
    }
    return Object.freeze(out);
  }

  subscribe(listener: (event: RegistryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  batch<T>(fn: () => T): T {
    this.batching++;
    try {
      return fn();
    } finally {
      this.batching--;
      if (this.batching === 0) this.flush();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // A contributor's handle may outlive the registry (an addon keeps it): it holds nothing of it.
    for (const who of this.contributors.values()) {
      who.disposed = true;
      who.entries.clear();
    }
    // Told last, once nothing is there any more: what follows the registry lets go of what it read.
    this.entries.clear();
    this.lists.clear();
    this.events.push({ type: 'disposed' });
    this.flush();
    this.contributors.clear();
    this.contracts.clear();
    this.given.clear();
    // Disposed from a listener: the flush under way tells what is left, `disposed` last, then lets the listeners go.
    if (this.flushing) return;
    this.events.length = 0;
    this.listeners.clear();
  }

  // ── Operations ─────────────────────────────────────────────────────────────

  private live(): void {
    if (this.disposed) throw new Error('the registry is disposed');
  }

  private add(who: Who, kind: string, name: string, spec: object, fallback = false): ApplyResult {
    if (this.disposed || who.disposed) return rejected([{ code: 'disposed' }]);
    const contract = this.contracts.get(kind);
    if (!contract) return this.reject(who, kind, name, [{ code: 'unknownKind' }]);
    if (!isRecord(spec)) return this.reject(who, kind, name, [{ code: 'notAnObject' }]);
    if (contract.createRight !== undefined && !who.rights.has(contract.createRight)) return this.reject(who, kind, name, [{ code: 'noRight', right: contract.createRight }]);
    const known = this.entries.get(kind)?.get(name);
    const holder = fallback ? known?.fallback : known?.definite;
    if (holder && holder.who !== who) return this.reject(who, kind, name, [{ code: 'taken', definer: holder.who.id }]);
    const leaves = this.leavesOf(contract, spec, 'add');
    if (!Array.isArray(leaves)) return this.reject(who, kind, name, leaves.errors);
    const entry = this.entryOf(kind, name);
    const c: Contribution = { who, operation: 'add', leaves };
    // Checked as it will be read, on its own.
    const alone = this.check(contract, assemble(entry, contract, c, []).spec);
    if (alone.length) {
      this.forgetIfEmpty(entry);
      return this.reject(who, kind, name, alone);
    }
    const before = fallback ? entry.fallback : entry.definite;
    if (before && sameLeaves(before, c)) return fallback && entry.add !== entry.fallback ? WAITING : this.resultOf(entry, who);
    if (fallback) entry.fallback = c;
    else entry.definite = c;
    who.entries.add(entry);
    const read = entry.add;
    entry.add = entry.definite ?? entry.fallback;
    // A fallback under another's add: kept, nothing read differently.
    if (entry.add === read) return WAITING;
    this.retake(entry);
    this.changed(entry);
    return this.resultOf(entry, who);
  }

  /** Whether a contributor says anything of a definition still (its add, its fallback, its patch). */
  private says(entry: Entry, who: Who): boolean {
    return entry.definite?.who === who || entry.fallback?.who === who || entry.patches.has(who.id);
  }

  private patch(who: Who, kind: string, name: string, fields: object): ApplyResult {
    if (this.disposed || who.disposed) return rejected([{ code: 'disposed' }]);
    const contract = this.contracts.get(kind);
    if (!contract) return this.reject(who, kind, name, [{ code: 'unknownKind' }]);
    if (!isRecord(fields)) return this.reject(who, kind, name, [{ code: 'notAnObject' }]);
    const errors: ApplyError[] = [];
    for (const field of Object.keys(fields)) {
      if (fields[field] === undefined) continue;
      const right = rightOf(contract, field);
      if (unsafeName(field)) errors.push({ code: 'unsafeName', field });
      else if (right === undefined) errors.push({ code: 'notPatchable', field });
      else if (!who.rights.has(right)) errors.push({ code: 'noRight', right, field });
    }
    if (errors.length) return this.reject(who, kind, name, errors);
    const leaves = this.leavesOf(contract, fields, 'patch');
    if (!Array.isArray(leaves)) return this.reject(who, kind, name, leaves.errors);
    const known = this.entries.get(kind)?.get(name);
    const before = known?.patches.get(who.id);
    // Nothing said: its patch taken back.
    if (!leaves.length) {
      if (before && known) this.takeBack(known, who, 'patch');
      return known?.add ? INCLUDED : WAITING;
    }
    const c: Contribution = { who, operation: 'patch', leaves };
    if (before && known && sameLeaves(before, c)) return this.resultOf(known, who);
    const entry = this.entryOf(kind, name);
    if (entry.add) {
      const others = [...entry.patches.values()].filter((p) => p.who !== who);
      const broken = this.check(contract, assemble(entry, contract, entry.add, [...others, c]).spec);
      if (broken.length) return this.reject(who, kind, name, broken);
    }
    entry.patches.set(who.id, c);
    who.entries.add(entry);
    if (entry.add) this.changed(entry);
    return this.resultOf(entry, who);
  }

  private remove(who: Who, kind: string, name: string): void {
    const entry = this.entries.get(kind)?.get(name);
    if (!entry) return;
    if (entry.patches.has(who.id)) this.takeBack(entry, who, 'patch');
    if (entry.definite?.who === who || entry.fallback?.who === who) this.takeBack(entry, who, 'add');
  }

  /** A contributor gone: closed first (nothing it is asked after counts), then everything it said taken back. */
  private drop(who: Who): void {
    if (who.disposed) return;
    who.disposed = true;
    if (this.contributors.get(who.id) === who) this.contributors.delete(who.id);
    for (const entry of [...who.entries]) this.remove(who, entry.kind, entry.name);
  }

  private takeBack(entry: Entry, who: Who, operation: Operation): void {
    const read = entry.add;
    if (operation === 'add') {
      if (entry.definite?.who === who) entry.definite = undefined;
      if (entry.fallback?.who === who) entry.fallback = undefined;
      // The add gone: a fallback under it read instead (the patches taken again over it); none, they wait.
      entry.add = entry.definite ?? entry.fallback;
    } else entry.patches.delete(who.id);
    if (!this.says(entry, who)) who.entries.delete(entry);
    // A patch gone, or the add replaced: the others taken again (one may no longer fit).
    if (operation === 'patch' || (entry.add && entry.add !== read)) this.retake(entry);
    if (read !== undefined && (operation === 'patch' || entry.add !== read)) this.changed(entry);
    this.forgetIfEmpty(entry);
  }

  /**
   * The patches taken again over the add, the most important first, each
   * kept if the definition stays valid with it; one that does not is
   * dropped (told).
   */
  private retake(entry: Entry): void {
    const contract = this.contracts.get(entry.kind);
    if (!entry.add || !contract) return;
    const kept: Contribution[] = [];
    for (const p of [...entry.patches.values()].sort((a, b) => better(b, a))) {
      const broken = this.check(contract, assemble(entry, contract, entry.add, [...kept, p]).spec);
      if (!broken.length) {
        kept.push(p);
        continue;
      }
      entry.patches.delete(p.who.id);
      if (!this.says(entry, p.who)) p.who.entries.delete(entry);
      this.tell({ type: 'dropped', contributor: p.who.id, kind: entry.kind, name: entry.name, errors: broken });
    }
  }

  // ── Checking ───────────────────────────────────────────────────────────────

  /** What is said, as leaves, its shape checked: fields; a collection's container and its parts (a map's keys; a list's items and their fields). */
  private leavesOf(contract: AnyContract, spec: Record<string, unknown>, operation: Operation): StoredLeaf[] | { errors: ApplyError[] } {
    const lists = (contract.merge?.lists ?? {}) as Record<string, ListRule<Record<string, unknown>>>;
    const maps = new Set<string>(contract.merge?.maps ?? []);
    const leaves: StoredLeaf[] = [];
    const errors: ApplyError[] = [];
    const put = (path: string[], value: unknown) => {
      if (value === unset && operation === 'add') {
        errors.push({ code: 'unsetInAdd', field: path[0] });
        return;
      }
      try {
        leaves.push({ key: keyOf(path), path: Object.freeze(path), value: frozenCopy(value) });
      } catch (error) {
        errors.push({ code: 'badData', field: path[0], reason: error instanceof BadData ? error.reason : 'cycle' });
      }
    };
    for (const field of Object.keys(spec)) {
      const value = spec[field];
      if (value === undefined) continue;
      if (unsafeName(field)) {
        errors.push({ code: 'unsafeName', field });
        continue;
      }
      const rule = Object.hasOwn(lists, field) ? lists[field] : undefined;
      if (value === unset) put([field], unset);
      else if (rule) {
        if (!Array.isArray(value)) {
          errors.push({ code: 'notAList', field });
          continue;
        }
        put([field], []);
        const seen = new Set<string>();
        for (const item of value) {
          const removed = isUnsetItem(item);
          const key = removed ? item[unset] : isRecord(item) ? item[rule.key] : undefined;
          if (typeof key !== 'string' || key === '' || (removed && operation === 'add')) {
            errors.push(removed ? { code: 'unsetInAdd', field } : { code: 'missingKey', field });
            continue;
          }
          if (unsafeName(key)) {
            errors.push({ code: 'unsafeName', field });
            continue;
          }
          if (seen.has(key)) {
            errors.push({ code: 'duplicateKey', field, key });
            continue;
          }
          seen.add(key);
          if (removed) {
            put([field, key], unset);
            continue;
          }
          for (const part of Object.keys(item as Record<string, unknown>)) {
            const v = (item as Record<string, unknown>)[part];
            if (unsafeName(part)) errors.push({ code: 'unsafeName', field });
            else if (v !== undefined) put([field, key, part], v);
          }
        }
      } else if (maps.has(field)) {
        if (!isRecord(value)) {
          errors.push({ code: 'notAMap', field });
          continue;
        }
        put([field], {});
        for (const key of Object.keys(value)) {
          if (unsafeName(key)) errors.push({ code: 'unsafeName', field });
          else if (value[key] !== undefined) put([field, key], value[key]);
        }
      } else {
        put([field], value);
      }
    }
    return errors.length ? { errors } : leaves;
  }

  /** What is wrong with a definition as it would be read: required fields, keyed items' required fields, the kind's validation. */
  private check(contract: AnyContract, spec: Record<string, unknown>): ApplyError[] {
    const errors: ApplyError[] = [];
    for (const field of contract.required ?? []) if (spec[field] === undefined || spec[field] === null) errors.push({ code: 'required', field });
    for (const [field, rule] of Object.entries((contract.merge?.lists ?? {}) as Record<string, ListRule<Record<string, unknown>>>)) {
      const items = spec[field];
      if (!Array.isArray(items)) continue;
      for (const item of items as Record<string, unknown>[]) {
        for (const part of rule.required ?? []) {
          if (item[part] === undefined || item[part] === null) errors.push({ code: 'required', field: part, item: String(item[rule.key]) });
        }
      }
    }
    if (!errors.length && contract.validate) {
      try {
        for (const problem of contract.validate(spec as never) ?? []) errors.push({ code: 'invalid', problem });
      } catch {
        errors.push({ code: 'invalid', problem: { code: 'validationThrew' } });
      }
    }
    return errors;
  }

  // ── Reading, telling ───────────────────────────────────────────────────────

  private entryOf(kind: string, name: string): Entry {
    const byName = this.entries.get(kind) ?? new Map<string, Entry>();
    this.entries.set(kind, byName);
    let entry = byName.get(name);
    if (!entry) {
      entry = { kind, name, add: undefined, definite: undefined, fallback: undefined, patches: new Map(), conflicts: new Set(), cached: null };
      byName.set(name, entry);
    }
    return entry;
  }

  private forgetIfEmpty(entry: Entry): void {
    if (entry.add || entry.fallback || entry.patches.size) return;
    const byName = this.entries.get(entry.kind);
    byName?.delete(entry.name);
    if (byName && !byName.size) this.entries.delete(entry.kind);
  }

  private read(entry: Entry): Definition | undefined {
    if (entry.cached !== null) return entry.cached;
    const contract = this.contracts.get(entry.kind);
    entry.cached = entry.add && contract ? assemble(entry, contract, entry.add, [...entry.patches.values()]) : undefined;
    return entry.cached;
  }

  /** The definition reads differently: told; its conflicts told as they come. */
  private changed(entry: Entry): void {
    entry.cached = null;
    this.lists.delete(entry.kind);
    this.tell({ type: 'changed', kind: entry.kind, name: entry.name });
    const now = new Set<string>();
    const patches = entry.add ? [...entry.patches.values()] : [];
    for (let i = 0; i < patches.length; i++) {
      for (let j = i + 1; j < patches.length; j++) {
        const [a, b] = [patches[i], patches[j]];
        // A tie the app broke (another tie-break) is no conflict: only one the id decides is.
        if (a.who.priority !== b.who.priority || a.who.tieBreak !== b.who.tieBreak) continue;
        const theirs = new Map(b.leaves.map((l) => [l.key, l]));
        for (const leaf of a.leaves) {
          const other = theirs.get(leaf.key);
          if (!other || same(other.value, leaf.value)) continue;
          const pair = [a.who.id, b.who.id].sort() as [string, string];
          const said = JSON.stringify([leaf.key, ...pair]);
          now.add(said);
          if (!entry.conflicts.has(said)) this.tell({ type: 'conflict', kind: entry.kind, name: entry.name, path: leaf.path, contributors: pair });
        }
      }
    }
    entry.conflicts = now;
  }

  private resultOf(entry: Entry, who: Who): ApplyResult {
    if (!entry.add) return WAITING;
    const mine = entry.patches.get(who.id);
    if (!mine) return INCLUDED;
    const conflicts: Conflict[] = [];
    for (const other of entry.patches.values()) {
      if (other === mine || other.who.priority !== who.priority || other.who.tieBreak !== who.tieBreak) continue;
      const theirs = new Map(other.leaves.map((l) => [l.key, l]));
      for (const leaf of mine.leaves) {
        const said = theirs.get(leaf.key);
        if (said && !same(said.value, leaf.value)) conflicts.push(Object.freeze({ path: leaf.path, with: other.who.id }));
      }
    }
    return conflicts.length ? Object.freeze({ status: 'included', conflicts: Object.freeze(conflicts) }) : INCLUDED;
  }

  private reject(who: Who, kind: string, name: string, errors: ApplyError[]): ApplyResult {
    this.tell({ type: 'rejected', contributor: who.id, kind, name, errors });
    return rejected(errors);
  }

  private tell(event: RegistryEvent): void {
    if (!this.disposed) this.events.push(Object.freeze(event));
  }

  /** Events told once the registry is consistent, in order; what a listener does is told after; a listener's throw is its own. */
  private flush(): void {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.events.length) {
        const event = this.events.shift() as RegistryEvent;
        for (const listener of [...this.listeners]) {
          try {
            listener(event);
          } catch {
            // a listener is not the registry's to fail for
          }
        }
      }
    } finally {
      this.flushing = false;
      if (this.disposed) this.listeners.clear();
    }
  }
}

/** Whether a contribution says exactly what another says, in the same order. */
function sameLeaves(a: Contribution, b: Contribution): boolean {
  return a.leaves.length === b.leaves.length && a.leaves.every((l, i) => l.key === b.leaves[i].key && same(l.value, b.leaves[i].value));
}
