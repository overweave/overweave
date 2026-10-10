import type { AddonRun } from '@overweave/testkit';
import { effect } from '@preact/signals';
import { type StateUpdater, useEffect, useRef, useState } from 'preact/hooks';
import { type Channel, EVENTS, type InspectorState, isFor } from '../protocol.ts';
import type { Made } from './world.ts';

/*
 * A story's world told to the Overweave panel: what it is now, as plain
 * data — told again when the registry changes, something fails, or the
 * panel asks (renders are counted between changes); what the panel turns
 * off or on, and when it counts again, done — for this world only.
 */

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A world's name for the panel: unlike any other's, a page reloaded or not. */
const newInstance = () => `world-${Math.random().toString(36).slice(2, 10)}`;

/** What a story's world is now. */
export function inspect(instance: string, drawn: string, made: Made, addons: readonly AddonRun[], off: ReadonlySet<string>): InspectorState {
  const w = made.world;
  const running = new Set(w?.running() ?? []);
  return {
    instance,
    drawn,
    addons: addons.map((a) => ({
      id: a.id,
      on: !off.has(a.id),
      running: running.has(a.id),
      priority: a.grant?.priority ?? 0,
      rights: [...(a.grant?.rights ?? [])],
      ...(made.failed.has(a.id) ? { failed: made.failed.get(a.id) } : {}),
      says: !w || off.has(a.id) ? [] : w.contributionsOf(a.id).map(({ kind, name, operation, status }) => ({ kind, name, operation, status })),
    })),
    // Plain already: functions by name, cycles cut (the testkit's snapshot).
    definitions: w?.snapshot().definitions ?? [],
    refused: w
      ? [...w.events.rejected(), ...w.events.dropped()].map((e) => ({ type: e.type, contributor: e.contributor, kind: e.kind, name: e.name, codes: e.errors.map((x) => x.code) }))
      : [],
    conflicts: w?.events.conflicts().map(({ kind, name, path, contributors }) => ({ kind, name, path: [...path], contributors: [...contributors] })) ?? [],
    problems: made.problems.value.map((p) => ({ what: p.what, message: message(p.error) })),
    renders: made.counts?.all() ?? {},
  };
}

/** The world told to the panel while the story is drawn (in Storybook: there is a channel). */
export function useInspector(
  channel: Channel | undefined,
  made: Made | null,
  addons: readonly AddonRun[],
  off: ReadonlySet<string>,
  setOff: (update: StateUpdater<ReadonlySet<string>>) => void,
  drawn: string,
): void {
  const [instance] = useState(newInstance);
  // Read when told: the latest addons, what is turned off, what is drawn — whatever render they came with.
  const now = useRef({ addons, off, drawn });
  now.current = { addons, off, drawn };
  useEffect(() => {
    if (!channel || !made) return;
    let queued = false;
    const tell = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (made.gone) return;
        let state: InspectorState;
        try {
          state = inspect(instance, now.current.drawn, made, now.current.addons, now.current.off);
        } catch (error) {
          // What could not be read is told as what failed, not thrown into Storybook's channel.
          state = {
            instance,
            drawn: now.current.drawn,
            addons: [],
            definitions: [],
            refused: [],
            conflicts: [],
            renders: {},
            problems: [{ what: 'the world could not be read', message: message(error) }],
          };
        }
        channel.emit(EVENTS.state, state);
      });
    };
    const unsubscribe = made.world?.registry.subscribe((event) => {
      if (event.type !== 'disposed') tell();
    });
    const unfollow = effect(() => {
      made.problems.value;
      tell();
    });
    const asked = (what?: unknown) => {
      // Asked of every world, or of this one.
      if (what && typeof what === 'object' && 'instance' in what && !isFor(what, instance)) return;
      tell();
    };
    const toggle = (what: unknown) => {
      if (!isFor(what, instance)) return;
      const { id, on } = what as { id?: unknown; on?: unknown };
      if (typeof id !== 'string' || typeof on !== 'boolean') return;
      // From the latest set: toggles told before a render are all kept.
      setOff((prev) => {
        if (on !== prev.has(id)) return prev;
        const next = new Set(prev);
        if (on) next.delete(id);
        else next.add(id);
        return next;
      });
    };
    const reset = (what: unknown) => {
      if (!isFor(what, instance)) return;
      made.counts?.reset();
      tell();
    };
    channel.on(EVENTS.request, asked);
    channel.on(EVENTS.toggle, toggle);
    channel.on(EVENTS.resetCounts, reset);
    return () => {
      unsubscribe?.();
      unfollow();
      channel.off(EVENTS.request, asked);
      channel.off(EVENTS.toggle, toggle);
      channel.off(EVENTS.resetCounts, reset);
    };
  }, [channel, made, instance, setOff]);
  // Gone with the story (not with each world it makes).
  useEffect(() => (channel ? () => channel.emit(EVENTS.gone, { instance }) : undefined), [channel, instance]);
}
