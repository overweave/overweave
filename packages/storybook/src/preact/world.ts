import type { AnyKind, KindsByName } from '@overweave/core';
import { type AddonRun, type World, world } from '@overweave/testkit';
import { type RenderCounts, renderCounts } from '@overweave/testkit/preact';
import type { Failure, Matcher, SlotRef } from '@overweave/ui';
import { OverweaveProvider, Slot } from '@overweave/ui/preact';
import { type Signal, signal } from '@preact/signals';
import { type ComponentChildren, type ComponentType, Fragment, h } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { previewChannel } from '../protocol.ts';
import { message, useInspector } from './inspect.ts';

/*
 * A world drawn in a story: the UI's kinds and some of one's own, what is
 * given before anything runs (fixtures), addons run by the testkit's
 * contract — then a slot, or any tree, under a provider of its own. Made
 * when the story is drawn, and again when its kinds or addons change
 * (Storybook draws the story again with new args: the same world, unless
 * they did) — the old one stopped before the new one starts, and its tree
 * drawn anew: nothing below holds on to a world let go of. Let go of with
 * the story. What failed — the world's making, what is given, an addon's
 * start, a drawing — listed below it, once each, not only in the console.
 * In Storybook, the Overweave panel is told what the world is, and turns
 * its addons off and on.
 */

// biome-ignore lint/suspicious/noExplicitAny: a world of whatever kinds.
type AnyWorld = World<any>;

/** The UI's kinds, as uiKinds gives them. */
export interface UiKindsOf {
  readonly Slot: AnyKind;
  readonly Fill: AnyKind;
  readonly Wrap: AnyKind;
}

/** The world of a story: the UI's kinds and one's own, typed. */
export type WorldOf<U extends UiKindsOf, KS extends readonly AnyKind[]> = World<KindsByName<[U['Slot'], U['Fill'], U['Wrap'], ...KS]>>;

/** What a typed slot must be given: its props, unless they may be left out. */
type PropsOf<P> = unknown extends P ? { props?: P } : undefined extends P ? { props?: P } : { props: P };

/** A slot drawn (its props as it asks), or the children. */
type Drawing<P> = ({ slot: SlotRef<P> | string; retryKey?: unknown } & PropsOf<P>) | { slot?: undefined; props?: undefined; retryKey?: undefined };

export type WorldStoryProps<U extends UiKindsOf = UiKindsOf, KS extends readonly AnyKind[] = readonly AnyKind[], P = unknown> = {
  /** The UI's kinds (uiKinds' result). */
  ui: U;
  /** Kinds of one's own beside the UI's. */
  kinds?: KS;
  /** What is there before any addon runs, at once (never a promise): (w) => w.as('core').add('Column', 'name', …). Run when the world is made — a new one changes nothing until it is made again. */
  given?: (world: WorldOf<U, KS>) => void;
  /** The addons run, in this order. */
  addons?: readonly AddonRun[];
  // biome-ignore lint/suspicious/noExplicitAny: the app's matcher, whatever its targets and props.
  matcher?: Matcher<any, any>;
  /** Where failures go too (they are listed below the story whatever this does). */
  onError?: (failure: Failure) => void;
  /** Any tree under the world's provider, drawn when no slot is given (or the slot's when it selects nothing). */
  children?: ComponentChildren;
} & Drawing<P>;

/** What went wrong, told below the story. */
export interface Problem {
  readonly what: string;
  readonly error: unknown;
}

/** A world made for a story: what it is, what failed, its renders. */
export interface Made {
  /** Which making of the story's world (a new one each time its kinds or addons change). */
  readonly generation: number;
  /** None when it could not be made (its kinds do not go together). */
  world: AnyWorld | undefined;
  /** The addons run (those turned on). */
  readonly addons: readonly AddonRun[];
  /** Why an addon did not start, by its id. */
  readonly failed: ReadonlyMap<string, string>;
  readonly problems: Signal<readonly Problem[]>;
  /** Its tree's root: a component of its own, so its renders are counted apart from any other's. */
  readonly Scope: ComponentType<{ children?: ComponentChildren }>;
  /** Renders within its tree, counted from before it was first drawn (for the panel: in Storybook only). */
  readonly counts: RenderCounts | undefined;
  /** Let go of: told nothing more. */
  gone: boolean;
}

interface Wanted {
  readonly kinds: readonly AnyKind[];
  readonly addons: readonly AddonRun[];
  readonly generation: number;
}

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  (typeof v === 'object' || typeof v === 'function') && v !== null && typeof (v as { then?: unknown }).then === 'function';

const sameGrant = (a: AddonRun['grant'], b: AddonRun['grant']) =>
  a === b ||
  (!!a &&
    !!b &&
    a.priority === b.priority &&
    a.tieBreak === b.tieBreak &&
    (a.rights ?? []).join('\u0000') === (b.rights ?? []).join('\u0000') &&
    (a.kinds ?? []).length === (b.kinds ?? []).length &&
    (a.kinds ?? []).every((k, i) => k === b.kinds?.[i]));

/** The same world: the same kinds, the same addons (id, setup, grant), in the same order. */
const same = (wanted: Wanted, kinds: readonly AnyKind[], addons: readonly AddonRun[]) =>
  wanted.kinds.length === kinds.length &&
  wanted.kinds.every((k, i) => k === kinds[i]) &&
  wanted.addons.length === addons.length &&
  wanted.addons.every((a, i) => a.id === addons[i].id && a.setup === addons[i].setup && sameGrant(a.grant, addons[i].grant));

const listed = (list: readonly Problem[], what: string, error: unknown) => list.some((q) => q.what === what && message(q.error) === message(error));

/** A problem listed, once: the same failure again (at each change of args) is not listed again. Told while a tree is drawn: listed after it. */
function record(made: Made, what: string, error: unknown) {
  queueMicrotask(() => {
    const now = made.problems.value;
    if (made.gone || listed(now, what, error)) return;
    made.problems.value = [...now, { what, error }];
  });
}

function make(wanted: Wanted, given: ((world: AnyWorld) => void) | undefined, counted: boolean): Made {
  const Scope = ({ children }: { children?: ComponentChildren }) => children;
  Scope.displayName = 'Overweave.WorldScope';
  const problems: Problem[] = [];
  const failed = new Map<string, string>();
  const problem = (what: string, error: unknown) => {
    if (!listed(problems, what, error)) problems.push({ what, error });
  };
  const made: Made = {
    generation: wanted.generation,
    world: undefined,
    addons: wanted.addons,
    failed,
    problems: signal(problems),
    Scope,
    counts: counted ? renderCounts({ within: Scope }) : undefined,
    gone: false,
  };
  let w: AnyWorld;
  try {
    w = world({ kinds: wanted.kinds });
  } catch (error) {
    problem('the world could not be made', error);
    return made;
  }
  made.world = w;
  try {
    const result: unknown = given?.(w);
    if (isThenable(result)) {
      Promise.resolve(result).catch(() => {});
      problem('what is given failed', new Error('it returned a promise: what is given is given at once'));
    }
  } catch (error) {
    problem('what is given failed', error);
  }
  // An addon that fails to start is told; the others run.
  for (const addon of wanted.addons) {
    try {
      // An addon list is of whatever kinds (each addon's contributor typed by the app): the world takes each as it comes.
      w.run(addon.id, addon.setup as never, addon.grant);
    } catch (error) {
      problem(`${addon.id} failed to start`, error);
      failed.set(addon.id, message(error));
    }
  }
  made.problems.value = [...problems];
  return made;
}

function letGo(made: Made) {
  made.gone = true;
  made.counts?.stop();
  try {
    made.world?.dispose();
  } catch (error) {
    console.error('overweave: the story’s world failed to let go', error);
  }
}

/** What went wrong, listed: nothing drawn while there is nothing. How it looks is the app's ([data-overweave-problems]). */
function Problems({ problems }: { problems: Signal<readonly Problem[]> }) {
  const list = problems.value;
  if (!list.length) return null;
  return h(
    'ul',
    { 'data-overweave-problems': '', role: 'alert' },
    list.map((p, i) => h('li', { key: i }, `${p.what}: ${message(p.error)}`)),
  );
}
Problems.displayName = 'Overweave.Problems';

type AnySlotProps = { name: SlotRef<unknown> | string; props?: unknown; retryKey?: unknown; children?: ComponentChildren };

/** A world drawn in a story: <WorldStory ui={ui} kinds={[Column]} addons={[table, images]} slot="main" props={args} />. */
export function WorldStory<U extends UiKindsOf, const KS extends readonly AnyKind[] = [], P = unknown>(story: WorldStoryProps<U, KS, P>) {
  const { ui, kinds, given, addons = [], slot, props, retryKey, matcher, onError, children } = story as WorldStoryProps<U, KS, P> & { props?: P };
  const all = [ui.Slot, ui.Fill, ui.Wrap, ...(kinds ?? [])];
  const channel = previewChannel();
  // Addons the panel turned off: not run (the world made again without them).
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  const on = off.size ? addons.filter((a) => !off.has(a.id)) : addons;
  // Which world is wanted: a new making only when kinds or addons are others (new args are not).
  const wanted = useRef<Wanted | null>(null);
  if (!wanted.current || !same(wanted.current, all, on)) wanted.current = { kinds: all, addons: on, generation: (wanted.current?.generation ?? 0) + 1 };
  const { generation } = wanted.current;
  const latestGiven = useRef(given);
  latestGiven.current = given;
  // Made once committed (a drawing given up makes nothing), let go of before the next is made, and with the story.
  const [made, setMade] = useState<Made | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: made again for each wanted world (its generation), from what is wanted then.
  useLayoutEffect(() => {
    const next = make(wanted.current as Wanted, latestGiven.current as ((world: AnyWorld) => void) | undefined, !!channel);
    setMade(next);
    return () => letGo(next);
  }, [generation, channel]);
  const current = made && made.generation === generation && !made.gone ? made : null;
  const live = useRef(current);
  live.current = current;
  const told = useRef(onError);
  told.current = onError;
  const report = useRef((failure: Failure) => {
    const m = live.current;
    if (m) record(m, `${failure.phase} of ${failure.definition.kind}/${failure.definition.name}`, failure.error);
    // Listed first: what the app's onError does (or throws) takes nothing from the list.
    told.current?.(failure);
  }).current;
  useInspector(channel, current, addons, off, setOff, slot === undefined ? 'a tree' : typeof slot === 'string' ? slot : slot.name);
  if (!current) return null;
  const drawn = slot === undefined ? children : h(Slot as ComponentType<AnySlotProps>, { name: slot as SlotRef<unknown> | string, props, retryKey }, children);
  return h(
    Fragment,
    null,
    // Its tree under a root of its own: a new world, a new tree.
    current.world ? h(current.Scope, { key: current.generation }, h(OverweaveProvider, { registry: current.world.registry, matcher, onError: report }, drawn)) : null,
    h(Problems, { problems: current.problems }),
  );
}
WorldStory.displayName = 'Overweave.WorldStory';
