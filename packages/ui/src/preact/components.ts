import type { AnyKind, AnySpec, Definition, Registry, SpecOf } from '@overweave/core';
import { computed } from '@preact/signals';
import { Component, type ComponentChildren, type ComponentType, createContext, Fragment, h, type VNode } from 'preact';
import { useContext, useMemo, useRef } from 'preact/hooks';
import { type FillSpec, type SlotRef, type SlotSpec, validateFill, validateSlot, validateWrap, type WrapSpec } from '../kinds.ts';
import { type Failure, type Matcher, report, type SlotOptions, slotContributions, slotView, wrapsOf } from '../slots.ts';
import { definitionSignal, definitionVersionOf, listSignal, selection, versionOf } from './signals.ts';
import { type SlotTrace, trackSlot } from './trace.ts';

/*
 * Drawing slots with Preact, each drawn again only when what it shows
 * changed: a slot follows its own selection (not every change of every
 * fill); a fill is drawn again only when its definition, its props or its
 * wraps changed; a definition read in a component is followed by itself.
 * Each fill, each wrap — and any definition the app keeps apart with
 * <Guarded> — drawn inside its own boundary: what it throws is told, and
 * its fallback drawn, until its definition or the slot's retryKey changes.
 */

// biome-ignore lint/suspicious/noExplicitAny: a fill is drawn with whatever props its slot gives.
export type PreactComponent = ComponentType<any>;

// biome-ignore lint/suspicious/noExplicitAny: read by kind name, whatever the registry's kinds.
type AnyRegistry = Registry<any>;

/** What the provider gives the slots below: stable while its registry and matcher are. */
export interface OverweaveContext {
  readonly registry: AnyRegistry;
  readonly options: SlotOptions;
  /** Where the slots below are followed (for an overlay that shows them); none: they are not. */
  readonly trace?: SlotTrace;
}

const Context = createContext<OverweaveContext | null>(null);
/** The retry key of the slot a boundary is in: a boundary that failed tries again when it changes. */
const Retry = createContext<unknown>(undefined);

export interface OverweaveProviderProps {
  /** A registry with the UI's kinds (checked when the provider gets it). */
  registry: AnyRegistry;
  /** Give a stable one: a new one makes every slot below choose — and draw — again. */
  // biome-ignore lint/suspicious/noExplicitAny: a matcher takes whatever targets and props the slots below have.
  matcher?: Matcher<any, any>;
  /** Where failures go (a new function each render changes nothing). */
  onError?: (failure: Failure) => void;
  /** The slots below followed, for an overlay that shows them (slotTrace()); none: nothing kept. */
  trace?: SlotTrace;
  children?: ComponentChildren;
}

const UI_KINDS = { Slot: validateSlot, Fill: validateFill, Wrap: validateWrap } as const;

/** The registry the slots below draw from, the app's matcher, where failures go. */
export function OverweaveProvider({ registry, matcher, onError, trace, children }: OverweaveProviderProps) {
  // The UI's kinds, as uiKinds gives them (not other kinds of the same names): checked once per registry. A disposed one (it accepts no kind) draws nothing, and throws nothing.
  useMemo(() => {
    if (!registry.accepts({ name: '\u0000overweave.probe', contract: {} })) return;
    for (const [kind, validate] of Object.entries(UI_KINDS)) {
      if (registry.contract(kind)?.validate !== validate) throw new Error(`the registry has no ${kind} of the UI's: give it the UI's kinds (uiKinds)`);
    }
  }, [registry]);
  const told = useRef(onError);
  told.current = onError;
  const value = useMemo<OverweaveContext>(
    () => ({ registry, options: { matcher: matcher as Matcher, onError: (failure) => told.current?.(failure) }, trace }),
    [registry, matcher, trace],
  );
  return h(Context.Provider, { value }, children);
}

/** What the provider above gives. */
export function useOverweave(): OverweaveContext {
  const value = useContext(Context);
  if (!value) throw new Error('no OverweaveProvider above');
  return value;
}

const kindName = (kind: AnyKind | string) => (typeof kind === 'string' ? kind : kind.name);

/** A definition, drawn again only when it changes: useDefinition(Column, 'age') — its spec typed by the kind. */
export function useDefinition<K extends AnyKind>(kind: K, name: string): Definition<SpecOf<K>> | undefined;
export function useDefinition<S = AnySpec>(kind: string, name: string): Definition<S> | undefined;
export function useDefinition(kind: AnyKind | string, name: string): Definition | undefined {
  const { registry } = useOverweave();
  const k = kindName(kind);
  return useMemo(() => definitionSignal(registry, k, name), [registry, k, name]).value;
}

/** A kind's definitions, drawn again when any of them changes. */
export function useDefinitions<K extends AnyKind>(kind: K): readonly Definition<SpecOf<K>>[];
export function useDefinitions<S = AnySpec>(kind: string): readonly Definition<S>[];
export function useDefinitions(kind: AnyKind | string): readonly Definition[] {
  const { registry } = useOverweave();
  const k = kindName(kind);
  return useMemo(() => listSignal(registry, k), [registry, k]).value;
}

const slotName = (where: SlotRef | string) => (typeof where === 'string' ? where : where.name);

/** A fill as the Preact entry reads it: its render a component. */
type PreactFill<P> = Definition<FillSpec<P, PreactComponent>>;

/** What a slot shows for some props, and what the user hid of it — followed (for a slot's tools). Give stable props. */
export function useSlotView<P>(
  where: SlotRef<P> | string,
  props: P,
): { slot: Definition<SlotSpec> | undefined; selected: readonly PreactFill<P>[]; userHidden: readonly PreactFill<P>[] } {
  const { registry, options } = useOverweave();
  const name = slotName(where);
  const [slot, selected, userHidden] = useMemo(() => {
    // Chosen once per change; each half kept while it holds the same fills.
    const view = computed(() => {
      definitionVersionOf(registry, 'Slot', name).value;
      versionOf(registry, 'Fill').value;
      return slotView(registry, name, props, options);
    });
    return [definitionSignal(registry, 'Slot', name), selection(() => view.value.selected), selection(() => view.value.userHidden)] as const;
  }, [registry, options, name, props]);
  return { slot: slot.value as Definition<SlotSpec> | undefined, selected: selected.value as PreactFill<P>[], userHidden: userHidden.value as PreactFill<P>[] };
}

/** Every fill of a slot, in order, whatever their targets and conditions, and the slot's definition — followed (for a settings page). */
export function useSlotContributions<P = unknown>(where: SlotRef<P> | string): { slot: Definition<SlotSpec> | undefined; fills: readonly PreactFill<P>[] } {
  const { registry } = useOverweave();
  const name = slotName(where);
  const [slot, fills] = useMemo(
    () =>
      [
        definitionSignal(registry, 'Slot', name),
        selection(() => {
          versionOf(registry, 'Fill').value;
          return slotContributions(registry, name).fills;
        }),
      ] as const,
    [registry, name],
  );
  return { slot: slot.value as Definition<SlotSpec> | undefined, fills: fills.value as PreactFill<P>[] };
}

interface BoundaryProps {
  definition: Definition;
  options: SlotOptions;
  /** What is drawn when what it holds throws. */
  fallback: ComponentChildren;
  children?: ComponentChildren;
}

type Failed = { definition: Definition; retryKey: unknown } | null;

/** One definition's drawing kept apart: what it throws is told, and the fallback drawn — until the definition or the slot's retry key changes. */
class Boundary extends Component<BoundaryProps, { failed: Failed }> {
  static displayName = 'Overweave.Boundary';
  static contextType = Retry;
  state = { failed: null as Failed };

  private stale(failed: Failed): boolean {
    return !!failed && (failed.definition !== this.props.definition || !Object.is(failed.retryKey, this.context));
  }

  componentDidCatch(error: unknown) {
    this.setState({ failed: { definition: this.props.definition, retryKey: this.context } });
    report(this.props.options, { phase: 'render', definition: this.props.definition, error });
  }

  // A failure of another definition or key: forgotten — going back to that key later does not bring it back.
  // Read from the state about to be (a failure caught just now is never taken for an old one).
  componentDidUpdate() {
    this.setState((state) => (this.stale(state.failed) ? { failed: null } : null) as { failed: Failed });
  }

  render() {
    return this.state.failed && !this.stale(this.state.failed) ? this.props.fallback : this.props.children;
  }
}

export interface GuardedProps {
  /** Whose drawing it is: what it throws is told as this definition's. */
  definition: Definition;
  /** Another value tries what failed again (a page's path); none: the slot's around it. */
  retryKey?: unknown;
  /** Drawn when it throws (default: nothing). */
  fallback?: ComponentChildren;
  children?: ComponentChildren;
}

/** Any definition's drawing kept apart (a column's cell, a section): told as its own, tried again when it changes or the slot's retry key does. */
export function Guarded({ definition, retryKey, fallback = null, children }: GuardedProps) {
  const { options } = useOverweave();
  const boundary = h(Boundary, { definition, options, fallback }, children);
  return retryKey === undefined ? boundary : h(Retry.Provider, { value: retryKey }, boundary);
}
Guarded.displayName = 'Overweave.Guarded';

interface FillProps {
  fill: Definition<FillSpec>;
  props: unknown;
  context: OverweaveContext;
}

/** A fill: drawn again only when one of its props is another (its definition, the slot's props, the context). */
class Fill extends Component<FillProps> {
  static displayName = 'Overweave.Fill';

  shouldComponentUpdate(next: FillProps) {
    const now = this.props;
    return next.fill !== now.fill || next.props !== now.props || next.context !== now.context;
  }

  render() {
    return h(Drawn, this.props);
  }
}

/** The wraps of a drawing (by its name), for its props: followed as wraps come, change and go. */
function useWraps({ registry, options }: OverweaveContext, name: string, props: unknown): readonly Definition<WrapSpec>[] {
  return useMemo(
    () =>
      selection(() => {
        versionOf(registry, 'Wrap').value;
        return wrapsOf(registry, name, props, options) as Definition<WrapSpec>[];
      }),
    [registry, options, name, props],
  ).value;
}

/** A drawing inside these wraps (the innermost first), each kept apart: one that throws, what it wraps drawn instead. */
function wrapIn(wraps: readonly Definition<WrapSpec>[], props: unknown, inner: ComponentChildren, options: OverweaveContext['options']): ComponentChildren {
  let drawn = inner;
  for (const wrap of wraps) {
    const within: ComponentChildren = drawn;
    drawn = h(
      Boundary,
      { key: `Wrap:${wrap.name}`, definition: wrap, options, fallback: within },
      h(wrap.spec.render as PreactComponent, { ...(props as object), children: within }),
    );
  }
  return drawn;
}

/** A fill drawn inside what wraps it (the innermost first), each kept apart, each keyed by its kind and name. */
function Drawn({ fill, props, context }: FillProps) {
  const wraps = useWraps(context, fill.name, props);
  const inner = h(Boundary, { key: `Fill:${fill.name}`, definition: fill, options: context.options, fallback: null }, h(fill.spec.render as PreactComponent, props as object));
  return wrapIn(wraps, props, inner, context.options) as VNode;
}
Drawn.displayName = 'Overweave.Drawn';

/** No props: the same each time. */
const NO_PROPS = {};

export interface WrappedProps<P = unknown> {
  /** The name it is wrapped by: what Wraps name in `wraps`. */
  name: string;
  /** What its wraps are given (and chosen by: target, when) — stable, as a slot's; none: no props. */
  props?: P;
  children?: ComponentChildren;
}

/**
 * Something the app draws itself, wrapped by name like a fill (a table's
 * cell, by its column's name): its children inside the Wraps of that name
 * for the props, the innermost first, each wrap kept apart — the children
 * not (the app's to keep: Guarded); remounted as a wrap comes or goes.
 */
export function Wrapped<P>({ name, props = NO_PROPS as P, children }: WrappedProps<P>) {
  const context = useOverweave();
  return wrapIn(useWraps(context, name, props), props, children, context.options) as VNode;
}
Wrapped.displayName = 'Overweave.Wrapped';

/** What a typed slot must be given: its props, unless they may be left out. */
type PropsOf<P> = unknown extends P ? { props?: P } : undefined extends P ? { props?: P } : { props: P };

export type SlotProps<P = unknown> = {
  name: SlotRef<P> | string;
  /** Another value tries what failed in it again — its fills' conditions and matching, and the drawing of fills and wraps that failed — and draws nothing else again. A wrap's condition is asked again when the wrap changes. */
  retryKey?: unknown;
  /** Drawn when it selects nothing (a fill that draws nothing, or fails, is still selected). */
  children?: ComponentChildren;
  /** At most this many of its fills drawn, the first in its order (1: one in place of the others — a default the last). */
  limit?: number;
} & PropsOf<P>;

type AnySlotProps = SlotProps & { props?: unknown };

/** A place others put things in: its fills, in order, as the user arranged it; its children when it selects nothing. No element of its own. Drawn again only when one of its props is another, or what it selects changed. */
export class Slot<P = unknown> extends Component<SlotProps<P>> {
  static displayName = 'Overweave.Slot';
  static contextType = Context;
  declare context: OverweaveContext | null;
  /** How many fills it shows now (for a trace). */
  shown = 0;
  /** The trace it is followed in: its provider's now (given later, another, none: followed in that one, or let go of). */
  private traced?: { trace: SlotTrace; stop(): void };
  private follow() {
    const trace = this.context?.trace;
    if (this.traced?.trace === trace) return;
    this.traced?.stop();
    this.traced = trace && { trace, ...trackSlot(trace, this as Parameters<typeof trackSlot>[1], () => slotName(this.props.name)) };
  }
  private drawn = (n: number) => {
    this.shown = n;
  };

  componentDidMount() {
    this.follow();
  }

  componentDidUpdate() {
    this.follow();
  }

  componentWillUnmount() {
    this.traced?.stop();
    this.traced = undefined;
  }

  shouldComponentUpdate(next: SlotProps<P>) {
    const now = this.props as AnySlotProps;
    const then = next as AnySlotProps;
    return then.name !== now.name || then.props !== now.props || !Object.is(then.retryKey, now.retryKey) || then.children !== now.children || then.limit !== now.limit;
  }

  render() {
    return h(SlotView, { ...(this.props as AnySlotProps), drawn: this.drawn });
  }
}

function SlotView({ name, props, retryKey, children, limit, drawn: told }: AnySlotProps & { drawn?: (n: number) => void }) {
  const context = useOverweave();
  const { registry } = context;
  const where = slotName(name);
  // Choosing again with each retry key: the fills' conditions and matching asked again, their failures told again.
  const options = useMemo(() => ({ ...context.options }), [context.options, retryKey]);
  const selected = useMemo(
    () =>
      selection(() => {
        // Its own slot's definition (the user's arrangement), not every slot's.
        definitionVersionOf(registry, 'Slot', where).value;
        versionOf(registry, 'Fill').value;
        return slotView(registry, where, props, options).selected;
      }),
    [registry, options, where, props],
  ).value;
  const drawn = limit === undefined ? selected : selected.slice(0, Math.max(0, limit));
  told?.(drawn.length);
  if (!selected.length) return h(Fragment, null, children);
  return h(
    Retry.Provider,
    { value: retryKey },
    drawn.map((fill) => h(Fill, { key: fill.name, fill: fill as Definition<FillSpec>, props, context })),
  );
}
SlotView.displayName = 'Overweave.SlotView';

/** A typed slot as an element, its props checked (h() does not infer a component's generic props): slotElement(header, { pod }). */
export function slotElement<P>(name: SlotRef<P>, props: P, rest: { retryKey?: unknown; limit?: number; children?: ComponentChildren } = {}): VNode {
  return h(Slot as ComponentType<AnySlotProps>, { name, props, ...rest }) as VNode;
}

/**
 * A fill of a slot, drawn with Preact, its props typed by the slot:
 * fill(header, { render: ({ pod }) => … }). A `when` that is a type guard
 * narrows what the render is given: fill(details, { when: isIngressRoute, render: ({ object }) => … }).
 */
export function fill<P, Q extends P, Target = never>(
  where: SlotRef<P>,
  spec: Omit<FillSpec<P, ComponentType<Q>, Target>, 'slot' | 'when' | 'render'> & { when: (props: P) => props is Q; render: ComponentType<Q> },
): FillSpec<P, PreactComponent, Target>;
export function fill<P, Target = never>(where: SlotRef<P>, spec: Omit<FillSpec<P, ComponentType<P>, Target>, 'slot'>): FillSpec<P, PreactComponent, Target>;
export function fill(where: SlotRef, spec: object): FillSpec<unknown, PreactComponent, unknown> {
  return { ...(spec as FillSpec<unknown, PreactComponent>), slot: where.name };
}
