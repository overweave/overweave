import { type AnyKind, type Contributor, defineKind, type KindsByName, type Problem, type SpecOf } from '@overweave/core';

/*
 * The UI's kinds, as kinds of the core: a Slot (a place), a Fill (something
 * put in a place), a Wrap (drawn around a fill). Their rights are the app's
 * words: uiKinds()({ configure, behaviour }) — configuration (titles, order,
 * targets, what the user arranged) and behaviour (what is drawn, when).
 * Where a fill goes and what a wrap wraps are their definer's alone. No
 * framework: what a render is, is the binding's (Render); what a target is,
 * the app's (Target). The kinds check their own fields' values.
 */

/** Where a definition goes among others: by order (500 if none), then name; one with `after` right after the one it names. */
export interface Placement {
  order?: number;
  after?: string;
}

/** A place: what the user arranged in it — the fills they put first, those they hid (or showed) — unless it is not theirs to arrange. */
export interface SlotSpec {
  title?: string;
  /** The user may move and hide what is in it (default); false: neither order nor hiding is followed. */
  userArranged?: boolean;
  /** Fills in the order the user put them; those not named follow, in their order. */
  arrangement?: string[];
  /** Fills hidden (true) or shown again (false), by name: what several say of it merges name by name. */
  hidden?: Record<string, boolean>;
}

/** Something put in a slot: for some targets (none: every one), when it holds (none: always), drawn by its render. P: the props it is drawn with. */
export interface FillSpec<P = unknown, Render = unknown, Target = unknown> extends Placement {
  slot: string;
  /** What it is, to the user. */
  title?: string;
  target?: Target;
  when?: (props: P) => boolean;
  render: Render;
}

/** Drawn around a fill (the fill's name): its render given what it wraps. A decoration: one that fails leaves what it wraps drawn. */
export interface WrapSpec<P = unknown, Render = unknown> extends Placement {
  wraps: string;
  when?: (props: P) => boolean;
  render: Render;
}

/** A slot by name, with the props it is drawn with: slot<{ pod: Pod }>('pod.header'). */
export interface SlotRef<P = unknown> {
  readonly name: string;
  /** Types only: never set. */
  readonly __props?: P;
}

export function slot<P = unknown>(name: string): SlotRef<P> {
  return Object.freeze({ name });
}

/** A fill of a slot, its props typed by the slot (no framework: the render as given; with Preact, use '@overweave/ui/preact' fill). */
export function slotFill<P, Render, Target = never>(where: SlotRef<P>, spec: Omit<FillSpec<P, Render, Target>, 'slot'>): FillSpec<P, Render, Target> {
  return { ...spec, slot: where.name };
}

// ── Checks of the fields' values ───────────────────────────────────────────

type Check = (value: unknown) => boolean;
const text: Check = (v) => typeof v === 'string';
const name: Check = (v) => typeof v === 'string' && v !== '';
const finite: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const flag: Check = (v) => typeof v === 'boolean';
const fn: Check = (v) => typeof v === 'function';
const texts: Check = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');
const flags: Check = (v) => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((b) => typeof b === 'boolean');

/** A validation of some fields: each, if given, as it should be (its code: what it should be). */
function fields(checks: Record<string, [Check, string]>) {
  return (spec: Record<string, unknown>): Problem[] | undefined => {
    const problems = Object.entries(checks)
      .filter(([field, [check]]) => spec[field] !== undefined && !check(spec[field]))
      .map(([field, [, code]]) => ({ code, field }));
    return problems.length ? problems : undefined;
  };
}

const placement = { order: [finite, 'notANumber'], after: [name, 'notAName'] } as Record<string, [Check, string]>;

// The kinds' validations: one each, whatever the rights' names — so every uiKinds() gives the same contracts.
export const validateSlot = fields({ title: [text, 'notText'], userArranged: [flag, 'notAFlag'], arrangement: [texts, 'notNames'], hidden: [flags, 'notFlags'] });
export const validateFill = fields({ slot: [name, 'notAName'], title: [text, 'notText'], ...placement, when: [fn, 'notAFunction'] });
export const validateWrap = fields({ wraps: [name, 'notAName'], ...placement, when: [fn, 'notAFunction'] });

/**
 * The UI's kinds, their rights named by the app: configure (titles, order,
 * targets, the arrangement) and behaviour (renders, conditions).
 * uiKinds<Render, Target>()({ configure: 'configure', behaviour: 'behaviour' }) —
 * two calls: the types given, the rights' names inferred.
 */
export function uiKinds<Render = unknown, Target = unknown>() {
  return <const C extends string, const B extends string>(rights: { configure: C; behaviour: B }) => kinds<Render, Target, C, B>(rights);
}

function kinds<Render, Target, C extends string, B extends string>(rights: { configure: C; behaviour: B }) {
  const { configure, behaviour } = rights;
  // biome-ignore lint/suspicious/noExplicitAny: a fill is drawn with whatever props its slot gives (fill() types them by the slot).
  type Props = any;
  const Slot = defineKind<SlotSpec>()('Slot', {
    patchRights: { title: configure, userArranged: configure, arrangement: configure, hidden: configure },
    merge: { maps: ['hidden'] },
    validate: validateSlot as never,
  });
  const Fill = defineKind<FillSpec<Props, Render, Target>>()('Fill', {
    required: ['slot', 'render'],
    patchRights: { title: configure, order: configure, after: configure, target: configure, when: behaviour, render: behaviour },
    validate: validateFill as never,
  });
  const Wrap = defineKind<WrapSpec<Props, Render>>()('Wrap', {
    required: ['wraps', 'render'],
    patchRights: { order: configure, after: configure, when: behaviour, render: behaviour },
    validate: validateWrap as never,
  });
  return { Slot, Fill, Wrap } as const;
}

/** The UI's kinds, as uiKinds gives them — with the rights' names it was given (typeof ui keeps them too). */
export type UiKinds<Render = unknown, Target = unknown, C extends string = 'configure', B extends string = 'behaviour'> = ReturnType<typeof kinds<Render, Target, C, B>>;

/**
 * A contributor of a registry with the UI's kinds (as `ui` gives them) and
 * some kinds of its own, typed by the rights R it is given: what an addon's
 * setup is handed. UiContributor<typeof ui, [typeof Column], 'configure'>.
 */
export type UiContributor<U extends { Slot: AnyKind; Fill: AnyKind; Wrap: AnyKind }, KS extends readonly AnyKind[] = [], R extends string = never> = Contributor<
  KindsByName<[U['Slot'], U['Fill'], U['Wrap'], ...KS]>,
  R
>;

/** What a registry has of the UI's kinds (and anything else). */
export interface UiKindsMap {
  Slot: AnyKind;
  Fill: AnyKind;
  Wrap: AnyKind;
}

/** What a fill's render is, in a registry of these kinds. */
export type RenderOf<KM> = KM extends { Fill: infer F } ? (SpecOf<F> extends { render: infer R } ? R : unknown) : unknown;
/** What a fill's target is, in a registry of these kinds. */
export type TargetOf<KM> = KM extends { Fill: infer F } ? (SpecOf<F> extends { target?: infer T } ? T : unknown) : unknown;
