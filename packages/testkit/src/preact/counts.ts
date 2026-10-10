import { type ComponentType, options, type VNode } from 'preact';
import { addCleanup } from '../cleanup.ts';

/*
 * Renders counted, by component: counted right before a component renders
 * — not when Preact keeps it as it was (a component skipped, or given the
 * same element again, is no render). One hook for every counter: counters
 * start and stop in any order. The hook stays in Preact's chain while
 * another has wrapped it (it then only passes on), so a hook put over it,
 * and taken off again, breaks nothing. A count covers the whole Preact
 * runtime: every tree drawn while it counts — start it before drawing —
 * unless it is given a component to count within: then only what renders
 * below an element of it.
 */

/** Preact's hook before a component renders (its name in Preact's builds; @preact/signals hooks the same). */
type Hooks = { __r?: (vnode: VNode) => void };
type Counter = (vnode: VNode) => void;
/** A vnode's parent (its name in Preact's builds). */
type Linked = VNode & { __?: Linked | null };

const counters = new Set<Counter>();
/** Whether our hook is in Preact's chain, and what it passes on to. */
let installed = false;
let next: Hooks['__r'];
const hook = (vnode: VNode) => {
  if (counters.size && typeof vnode.type === 'function') for (const count of counters) count(vnode);
  next?.(vnode);
};

/** Our hook put in the chain once; taken out when the last counter stops — only if it is still on top (else it stays, passing on). */
function follow(counter: Counter): () => void {
  const hooks = options as Hooks;
  if (!installed) {
    next = hooks.__r;
    hooks.__r = hook;
    installed = true;
  }
  counters.add(counter);
  return () => {
    if (!counters.delete(counter) || counters.size) return;
    if (hooks.__r === hook) {
      hooks.__r = next;
      next = undefined;
      installed = false;
    }
  };
}

/** Counters not yet stopped: what cleanup() stops. */
const open = new Set<RenderCounts>();

export interface RenderCounts {
  /** How many times a component rendered since counting began (or the last reset): by the component itself, or by its name (displayName, else name — components of one name counted together). */
  of(component: string | object): number;
  /** Every count, by name (the UI's own components too: Overweave.Slot, Overweave.Fill…). */
  all(): Record<string, number>;
  reset(): void;
  /** Counting stops (in any order among counters; again: nothing). */
  stop(): void;
}

const nameOf = (type: unknown) => {
  const { displayName, name } = type as { displayName?: string; name?: string };
  return displayName ?? (name || '(anonymous)');
};

/** Whether a vnode is drawn below an element of a component. */
const below = (vnode: VNode, scope: unknown) => {
  for (let v = (vnode as Linked).__; v; v = v.__) if (v.type === scope) return true;
  return false;
};

export interface RenderCountsOptions {
  /** Count only what renders below an element of this component (one tree among others): give each tree a component of its own. */
  // biome-ignore lint/suspicious/noExplicitAny: a component of whatever props.
  within?: ComponentType<any>;
}

/** Start counting renders — before drawing what is to be counted: renderCounts().of(Title), .of('Overweave.SlotView'). cleanup() stops it. */
export function renderCounts({ within }: RenderCountsOptions = {}): RenderCounts {
  const byType = new Map<unknown, number>();
  const unfollow = follow((vnode) => {
    if (within && !below(vnode, within)) return;
    byType.set(vnode.type, (byType.get(vnode.type) ?? 0) + 1);
  });
  const counts: RenderCounts = {
    of(component) {
      if (typeof component !== 'string') return byType.get(component) ?? 0;
      let n = 0;
      for (const [type, c] of byType) if (nameOf(type) === component) n += c;
      return n;
    },
    all() {
      const out: Record<string, number> = {};
      for (const [type, c] of byType) out[nameOf(type)] = (out[nameOf(type)] ?? 0) + c;
      return out;
    },
    reset: () => byType.clear(),
    stop() {
      open.delete(counts);
      unfollow();
    },
  };
  open.add(counts);
  return counts;
}

/** Every counter not yet stopped, stopped. */
export function stopCounts(): void {
  for (const counts of [...open]) counts.stop();
}
addCleanup(stopCounts, true);
