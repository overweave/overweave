import type { Definition, Registry } from '@overweave/core';
import type { FillSpec, RenderOf, SlotRef, SlotSpec, TargetOf, UiKindsMap, WrapSpec } from './kinds.ts';
import { inOrder } from './order.ts';

/*
 * What a slot shows: its fills, in order (order, after or before, among
 * all the slot's fills), those whose target takes the props (the app's matcher
 * decides; no target: every props) and whose condition holds, as the user
 * arranged the slot; and what is drawn around each fill. Nothing drawn:
 * what to draw is the binding's. The fills of each slot, and the wraps of
 * each fill, are indexed once per state of the registry.
 */

/** Whether a target takes what a slot is drawn with: the app's. */
export interface Matcher<Target = unknown, Props = unknown> {
  matches(target: Target, props: Props): boolean;
}

/** Where it went wrong: the app's matcher, a definition's `when`, a render (the binding's). */
export type FailurePhase = 'match' | 'when' | 'render';

/** What went wrong, and in which definition. */
export interface Failure {
  readonly phase: FailurePhase;
  readonly definition: Definition;
  readonly error: unknown;
}

/** How a slot's fills are chosen: the app's matcher, and where failures go (a definition that fails is not shown). */
// biome-ignore lint/suspicious/noExplicitAny: given to a provider, a matcher takes whatever props each slot gives.
export interface SlotOptions<Target = unknown, Props = any> {
  matcher?: Matcher<Target, Props>;
  onError?: (failure: Failure) => void;
}

export interface SlotView<Fill> {
  /** The slot's definition (none: no one declared it — its fills shown as they are, nothing arranged). */
  slot: Definition<SlotSpec> | undefined;
  /** What it shows, in order. */
  selected: Fill[];
  /** For the props, but hidden by the user (for a slot's tools). */
  userHidden: Fill[];
}

type FillOf<KM, P> = Definition<FillSpec<P, RenderOf<KM>, TargetOf<KM>>>;
type WrapOf<KM, P> = Definition<WrapSpec<P, RenderOf<KM>, TargetOf<KM>>>;

const nameOf = (where: string | SlotRef) => (typeof where === 'string' ? where : where.name);

// biome-ignore lint/suspicious/noExplicitAny: read by kind name, whatever the registry's kinds.
const read = (registry: Registry<any>) => registry as { get(kind: string, name: string): Definition | undefined; list(kind: string): readonly Definition[] };

/** By a key, each group in order: indexed once per list (the registry keeps a kind's list until it changes). */
const indexes = new WeakMap<readonly Definition[], Map<string, Definition[]>>();
function indexed(list: readonly Definition[], key: (d: Definition) => string, at: string): Definition[] {
  let index = indexes.get(list);
  if (!index) {
    const groups = new Map<string, Definition[]>();
    for (const d of list) {
      const k = key(d);
      const group = groups.get(k);
      if (group) group.push(d);
      else groups.set(k, [d]);
    }
    for (const [k, group] of groups) groups.set(k, inOrder(group as Definition<{ order?: number; after?: string }>[]) as Definition[]);
    index = groups;
    indexes.set(list, index);
  }
  return index.get(at) ?? [];
}

/** A failure told to the app; what the app's listener throws is not the slot's to fail for. */
export function report(options: SlotOptions, failure: Failure): void {
  try {
    options.onError?.(failure);
  } catch {
    // a listener is not the slot's to fail for
  }
}

/** Failures of choosing (a matcher, a condition) told: once per definition and phase, until the definition changes — a slot chooses again at every change. */
const told = new WeakMap<SlotOptions, WeakMap<Definition, Set<FailurePhase>>>();
function tell(options: SlotOptions, failure: Failure): void {
  let byDefinition = told.get(options);
  if (!byDefinition) {
    byDefinition = new WeakMap();
    told.set(options, byDefinition);
  }
  const phases = byDefinition.get(failure.definition) ?? new Set<FailurePhase>();
  if (phases.has(failure.phase)) return;
  phases.add(failure.phase);
  byDefinition.set(failure.definition, phases);
  report(options, failure);
}

/** Whether a fill (or a wrap) is for these props: its target taken (no target: yes; a target and no matcher: no, told), its condition holding. */
function isFor(d: Definition, props: unknown, options: SlotOptions): boolean {
  const { target, when } = d.spec as { target?: unknown; when?: (props: unknown) => unknown };
  if (target !== undefined) {
    const matcher = options.matcher as Matcher<unknown, unknown> | undefined;
    if (!matcher) {
      tell(options, { phase: 'match', definition: d, error: new Error('a target, and no matcher to take it') });
      return false;
    }
    try {
      if (!matcher.matches(target, props)) return false;
    } catch (error) {
      tell(options, { phase: 'match', definition: d, error });
      return false;
    }
  }
  if (!when) return true;
  try {
    return Boolean(when(props));
  } catch (error) {
    tell(options, { phase: 'when', definition: d, error });
    return false;
  }
}

/** Every fill of a slot, in order — whatever their targets and conditions: what a slot's settings list (with the slot's definition). */
export function slotContributions<KM extends UiKindsMap, P>(
  registry: Registry<KM>,
  where: SlotRef<P> | string,
): { slot: Definition<SlotSpec> | undefined; fills: FillOf<KM, P>[] } {
  const name = nameOf(where);
  return {
    slot: read(registry).get('Slot', name) as Definition<SlotSpec> | undefined,
    fills: [...indexed(read(registry).list('Fill'), (d) => String(d.spec.slot), name)] as FillOf<KM, P>[],
  };
}

/** What a slot shows for some props, as the user arranged it. */
export function slotView<KM extends UiKindsMap, P>(
  registry: Registry<KM>,
  where: SlotRef<P> | string,
  props: P,
  options: SlotOptions<TargetOf<KM>, P> = {},
): SlotView<FillOf<KM, P>> {
  const name = nameOf(where);
  const slot = read(registry).get('Slot', name) as Definition<SlotSpec> | undefined;
  // In order among all the slot's fills, then those for the props: one after a fill not shown stays where it was put.
  const fills = indexed(read(registry).list('Fill'), (d) => String(d.spec.slot), name).filter((f) => isFor(f, props, options as SlotOptions)) as FillOf<KM, P>[];
  if (!slot || slot.spec.userArranged === false) return { slot, selected: fills, userHidden: [] };
  const byName = new Map(fills.map((f) => [f.name, f]));
  const first = [...new Set(slot.spec.arrangement ?? [])].filter((n) => byName.has(n)).map((n) => byName.get(n) as FillOf<KM, P>);
  const arranged = [...first, ...fills.filter((f) => !first.includes(f))];
  const hidden = slot.spec.hidden ?? {};
  const isHidden = (f: FillOf<KM, P>) => Object.hasOwn(hidden, f.name) && hidden[f.name] === true;
  return { slot, selected: arranged.filter((f) => !isHidden(f)), userHidden: arranged.filter(isHidden) };
}

/** What a slot shows for some props, in order. */
export function fillsOf<KM extends UiKindsMap, P>(registry: Registry<KM>, where: SlotRef<P> | string, props: P, options: SlotOptions<TargetOf<KM>, P> = {}): FillOf<KM, P>[] {
  return slotView(registry, where, props, options).selected;
}

/** What is drawn around a fill (or anything the app wraps by name) for some props: the innermost first. */
export function wrapsOf<KM extends UiKindsMap, P>(registry: Registry<KM>, name: string, props: P, options: SlotOptions<TargetOf<KM>, P> = {}): WrapOf<KM, P>[] {
  return indexed(read(registry).list('Wrap'), (d) => String(d.spec.wraps), name).filter((w) => isFor(w, props, options as SlotOptions)) as WrapOf<KM, P>[];
}
