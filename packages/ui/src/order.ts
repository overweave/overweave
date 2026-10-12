import type { Placement } from './kinds.ts';

/*
 * Where things go among others of theirs: by order (500 if none), then
 * name; one with `after` right after the one it names (after those already
 * after it), one with `before` right before it (after those already before
 * it). Those only anchored to one another (a loop) go last, together;
 * what is anchored to one of them still goes by it.
 */

/** The order a placement without one gets. */
export const DEFAULT_ORDER = 500;

type Placed = { name: string; spec: Placement };

const byOrder = <T extends Placed>(a: T, b: T) => (a.spec.order ?? DEFAULT_ORDER) - (b.spec.order ?? DEFAULT_ORDER) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The one a placement goes by (after or before it): none, by order. */
const anchorOf = (t: Placed) => t.spec.after ?? t.spec.before;

/** Things in order: by `order`, then name; one with `after` right after the one it names, with `before` right before it. */
export function inOrder<T extends Placed>(list: readonly T[]): T[] {
  const sorted = [...list].sort(byOrder);
  const names = new Set(sorted.map((t) => t.name));
  const anchored = (t: T) => {
    const anchor = anchorOf(t);
    return anchor !== undefined && anchor !== t.name && names.has(anchor);
  };
  const placed = sorted.filter((t) => !anchored(t));
  let pending = sorted.filter(anchored);
  while (pending.length) {
    const at = new Set(placed.map((t) => t.name));
    const ready = pending.filter((t) => at.has(anchorOf(t) as string));
    if (ready.length) {
      for (const t of ready) {
        if (t.spec.after !== undefined) {
          let i = placed.findIndex((p) => p.name === t.spec.after) + 1;
          while (i < placed.length && placed[i].spec.after === t.spec.after) i++;
          placed.splice(i, 0, t);
        } else
          placed.splice(
            placed.findIndex((p) => p.name === t.spec.before),
            0,
            t,
          );
      }
      pending = pending.filter((t) => !ready.includes(t));
      continue;
    }
    // Nothing placeable: a loop. Its members go last, by order; what goes by one of them is placed next round.
    const loops = loopsOf(pending);
    const looped = new Set(loops.length ? loops : pending.map((t) => t.name));
    placed.push(...pending.filter((t) => looped.has(t.name)));
    pending = pending.filter((t) => !looped.has(t.name));
  }
  return placed;
}

/** The names of those in a loop of anchors (afters, befores): for diagnostics. */
export function loopsOf(list: readonly Placed[]): string[] {
  const anchor = new Map(list.map((t) => [t.name, anchorOf(t)]));
  const looped: string[] = [];
  for (const start of anchor.keys()) {
    const seen = new Set<string>();
    let at: string | undefined = start;
    while (at !== undefined && anchor.has(at) && !seen.has(at)) {
      seen.add(at);
      at = anchor.get(at);
    }
    if (at === start) looped.push(start);
  }
  return looped;
}
