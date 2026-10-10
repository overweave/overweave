/*
 * A kind of definition and its contract — everything about the kind in one
 * place: which fields a definition must have; the right a patch of each
 * field needs, and the right an add needs (rights are the app's words: the
 * core only compares them); how collections merge (keyed lists item by
 * item, maps key by key); and how a whole definition is checked.
 */

/** A problem with a definition, as its kind's validation says it: a code, and the field it is about. */
export interface Problem {
  code: string;
  field?: string;
}

/** Deeply read-only (functions and classes as they are). */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends abstract new (
        ...args: never[]
      ) => unknown
    ? T
    : T extends readonly (infer I)[]
      ? readonly DeepReadonly<I>[]
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;

/** In a patch: what is under it, taken away at the patch's priority (a field, a map's key, an item's field). */
export const unset: unique symbol = Symbol.for('overweave.unset');
export type Unset = typeof unset;

/** In a patch of a keyed list: the item of that key, taken away at the patch's priority. */
export interface UnsetItem {
  readonly [unset]: string;
}

export function unsetItem(key: string): UnsetItem {
  return Object.freeze({ [unset]: key });
}

type ItemOf<V> = NonNullable<V> extends readonly (infer I)[] ? I : never;

/** Fields whose value is a list of objects (they may merge item by item). */
export type ListFields<S> = { [K in keyof S]-?: ItemOf<S[K]> extends never ? never : ItemOf<S[K]> extends object ? K : never }[keyof S] & string;

/** Fields whose value is an object, not a list nor a function (they may merge key by key). */
export type MapFields<S> = {
  [K in keyof S]-?: NonNullable<S[K]> extends readonly unknown[]
    ? never
    : NonNullable<S[K]> extends (...args: never[]) => unknown
      ? never
      : NonNullable<S[K]> extends object
        ? K
        : never;
}[keyof S] &
  string;

/** How a list merges: by which field its items are told apart, and which of their fields every item must have. */
export interface ListRule<I> {
  readonly key: keyof I & string;
  readonly required?: readonly (keyof I & string)[];
}

// biome-ignore lint/suspicious/noExplicitAny: a list rule of any item.
type AnyListRule = ListRule<any>;

/** The keyed lists of a spec: only fields that are lists of objects (any spec: any field). */
type ListRules<S> = 0 extends 1 & S
  ? { readonly [field: string]: AnyListRule }
  : { readonly [K in ListFields<S>]?: ListRule<ItemOf<S[K]>> } & { readonly [K in Exclude<keyof S & string, ListFields<S>>]?: never };

/** A kind's contract. S: a definition's spec. */
export interface KindContract<S> {
  /** Fields an add must give, and no counted patch may take away. */
  readonly required?: readonly (keyof S & string)[];
  /** Per field, the right a patch of it needs. A field not named: as otherFieldsRight says. */
  readonly patchRights?: { readonly [K in keyof S & string]?: string };
  /** The right a patch of a field not named in patchRights needs (none: such fields only their definer's add says). */
  readonly otherFieldsRight?: string;
  /** The right an add needs (none: any contributor may add). */
  readonly createRight?: string;
  /** Fields merged part by part: keyed lists item by item, maps key by key. Any other field is said whole. */
  readonly merge?: {
    readonly lists?: ListRules<S>;
    readonly maps?: readonly MapFields<S>[];
  };
  /** What is wrong with a whole definition (beyond its required fields): nothing, or the problems. Pure: the same spec, the same answer. */
  readonly validate?: (spec: DeepReadonly<S>) => readonly Problem[] | undefined;
}

/** A kind of definition: its name, its contract; its spec's type carried along (types only). */
export interface Kind<N extends string = string, S = unknown, C extends KindContract<S> = KindContract<S>> {
  readonly name: N;
  readonly contract: C;
  /** Types only: never set. */
  readonly __spec?: S;
}

/** Any kind (whatever its spec). */
// biome-ignore lint/suspicious/noExplicitAny: a kind of any spec, any contract.
export type AnyKind = Kind<string, any, KindContract<any>>;

/** A contract of a kind of any spec (inside the core, which reads any kind). */
// biome-ignore lint/suspicious/noExplicitAny: a contract of any spec.
export type AnyContract = KindContract<any>;

/**
 * Declare a kind: defineKind<ColumnSpec>()('Column', { required: ['header', 'value'], patchRights: { header: 'configure' }, … }).
 * Two calls: the spec's type is given, the rest (the name, the contract's literal rights) inferred.
 */
export function defineKind<S>() {
  return <const N extends string, const C extends KindContract<S>>(name: N, contract: C & NoOtherRights<S, C>): Kind<N, S, C> => ({ name, contract });
}

/** Rights of fields the spec has not: a typo, refused by the types. */
type NoOtherRights<S, C> = C extends { readonly patchRights: infer R } ? { readonly patchRights: { readonly [K in Exclude<keyof R, keyof S>]: never } } : unknown;

// ── Types: what a contributor may say ──────────────────────────────────────

/** A kind's spec. */
// biome-ignore lint/suspicious/noExplicitAny: whatever its contract.
export type SpecOf<K> = K extends Kind<string, infer S, any> ? S : never;

/** A kind's contract. */
// biome-ignore lint/suspicious/noExplicitAny: whatever its spec.
export type ContractOf<K> = K extends Kind<string, any, infer C> ? C : never;

/** A spec no type is known of (any): every field. */
type Untyped<K> = 0 extends 1 & SpecOf<K> ? true : false;

type RightsOf<K> = ContractOf<K> extends { readonly patchRights: infer F } ? F : Record<never, never>;
type OtherRight<K> = ContractOf<K> extends { readonly otherFieldsRight: infer O extends string } ? O : never;

/** The fields of a kind a contributor with rights R may patch: those named, by their own right; the others, by otherFieldsRight. */
export type PatchableBy<K, R extends string> =
  Untyped<K> extends true
    ? string
    :
        | { [F in keyof RightsOf<K>]: RightsOf<K>[F] extends R ? F : never }[keyof RightsOf<K>]
        | ([OtherRight<K>] extends [never] ? never : OtherRight<K> extends R ? Exclude<keyof SpecOf<K>, keyof RightsOf<K>> : never);

/** The kinds (of a map of them) a contributor with rights R may add. */
export type CreatableBy<KM, R extends string> = {
  [K in keyof KM]: ContractOf<KM[K]> extends { readonly createRight: infer C } ? (C extends R ? K : never) : K;
}[keyof KM] &
  string;

type MergeOf<K> = ContractOf<K> extends { readonly merge: infer M } ? M : Record<never, never>;
type KindListRules<K> = MergeOf<K> extends { readonly lists: infer L } ? L : Record<never, never>;
type MapsOf<K> = MergeOf<K> extends { readonly maps: readonly (infer M)[] } ? M : never;
type KeyOf<K, P> = P extends keyof KindListRules<K> ? (KindListRules<K>[P] extends { readonly key: infer Key extends string } ? Key : never) : never;
/** A field that may be taken away: an optional one. */
type Unsettable<V> = undefined extends V ? Unset : never;

/** An item in a patch of a keyed list: its key, and some of its fields (an optional one may be unset); or the item taken away. */
export type ItemPatch<I, Key extends string> = ({ readonly [F in Key & keyof I]: I[F] } & { readonly [F in Exclude<keyof I, Key>]?: I[F] | Unsettable<I[F]> }) | UnsetItem;

/** What a patch says of a field, as the kind merges it: a keyed list, some items; a map, some keys; anything else, whole. An optional field may be unset. */
export type FieldPatch<K, P extends keyof SpecOf<K>> =
  | (P extends keyof KindListRules<K>
      ? readonly ItemPatch<ItemOf<SpecOf<K>[P]>, KeyOf<K, P>>[]
      : P extends MapsOf<K>
        ? { readonly [Q in keyof NonNullable<SpecOf<K>[P]>]?: NonNullable<SpecOf<K>[P]>[Q] | Unset }
        : SpecOf<K>[P])
  | Unsettable<SpecOf<K>[P]>;

/** What a contributor without the right to patch any field of a kind is given to patch: nothing it can say. */
export interface NoFieldToPatch {
  readonly 'no right to patch any field of this kind': never;
}

/** A patch of some fields of a kind, as it merges them. */
export type PatchOf<K, F> = [F] extends [never] ? NoFieldToPatch : { readonly [P in F & keyof SpecOf<K>]?: FieldPatch<K, P> };
