import type { VNode } from 'preact';

/*
 * The slots drawn, for an overlay that shows them on the page: each one's
 * name, how many fills it shows, its elements, where it is. Kept only for
 * a provider given a trace (OverweaveProvider trace): without one, a slot
 * keeps nothing. The page is left as it is: a slot's elements are found in
 * Preact's tree when asked for (its fields as Preact's builds name them —
 * here only). What a fill puts elsewhere (a portal) is not its slot's.
 */

export interface TracedSlot {
  readonly name: string;
  /** How many fills it shows (0: empty). */
  readonly shown: number;
  /** What it drew: its fills' elements — empty, its children's (none: nothing, or text only). */
  elements(): Element[];
  /** Where it is: the element it is in, and the one it comes before (none: the last in it). */
  place(): { parent: Element; before: Element | null } | undefined;
}

export interface SlotTrace {
  slots(): TracedSlot[];
}

/** A vnode, as Preact keeps it: its parent, its children, its element. */
type Internal = VNode & { __?: Internal | null; __k?: (Internal | null)[] | null; __e?: Node | null };
/** A slot's component, as Preact keeps it: its vnode, the element it is drawn into; how many fills it shows (its own). */
type Mounted = { __v?: Internal; __P?: Element | null; shown?: number };

/** The outermost elements under a vnode. */
function elementsOf(v: Internal | null | undefined, out: Element[] = []): Element[] {
  if (!v) return out;
  if (typeof v.type === 'string') {
    if (v.__e instanceof Element) out.push(v.__e);
    return out;
  }
  for (const child of v.__k ?? []) elementsOf(child, out);
  return out;
}

/** The first of them. */
function firstOf(v: Internal | null | undefined): Element | undefined {
  if (!v) return undefined;
  if (typeof v.type === 'string') return v.__e instanceof Element ? v.__e : undefined;
  for (const child of v.__k ?? []) {
    const first = firstOf(child);
    if (first) return first;
  }
  return undefined;
}

/** Where a component is: the element it is in, and the first element after it there (none: the last in what it is drawn into). */
function placeOf(component: Mounted): { parent: Element; before: Element | null } | undefined {
  for (let at = component.__v; at?.__; at = at.__) {
    const up = at.__;
    const siblings = up.__k ?? [];
    for (const next of siblings.slice(siblings.indexOf(at) + 1)) {
      const first = firstOf(next);
      if (first) return { parent: first.parentElement ?? first, before: first };
    }
    if (typeof up.type === 'string') return up.__e instanceof Element ? { parent: up.__e, before: null } : undefined;
  }
  return component.__P ? { parent: component.__P, before: null } : undefined;
}

const tracked = new WeakMap<SlotTrace, Set<TracedSlot>>();

/** A trace to give a provider: its slots followed from then on. */
export function slotTrace(): SlotTrace {
  const slots = new Set<TracedSlot>();
  const trace: SlotTrace = { slots: () => [...slots] };
  tracked.set(trace, slots);
  return trace;
}

/** A mounted slot followed, till stopped. */
export function trackSlot(trace: SlotTrace, component: Mounted, name: () => string): { stop(): void } {
  const slots = tracked.get(trace);
  if (!slots) throw new Error('a trace is made by slotTrace()');
  const slot: TracedSlot = {
    get name() {
      return name();
    },
    get shown() {
      return component.shown ?? 0;
    },
    elements: () => elementsOf(component.__v),
    place: () => placeOf(component),
  };
  slots.add(slot);
  return { stop: () => void slots.delete(slot) };
}
