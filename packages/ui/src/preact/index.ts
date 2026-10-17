/**
 * overweave's UI, drawn with Preact: a provider (the registry, the app's
 * matcher, where failures go), <Slot> (its fills in order, as the user
 * arranged it, each inside what wraps it, each kept apart — each drawn
 * again only when what it shows changed), hooks and signals that follow
 * the registry, fill() typed by a slot; <Wrapped> (something the app draws
 * itself, wrapped by name like a fill).
 */

export {
  fill,
  Guarded,
  type GuardedProps,
  type OverweaveContext,
  OverweaveProvider,
  type OverweaveProviderProps,
  type PreactComponent,
  Slot,
  type SlotProps,
  slotElement,
  useDefinition,
  useDefinitions,
  useOverweave,
  useSlotContributions,
  useSlotView,
  Wrapped,
  type WrappedProps,
} from './components.ts';
export { definitionSignal, definitionVersionOf, listSignal, versionOf } from './signals.ts';
export { type SlotTrace, slotTrace, type TracedSlot } from './trace.ts';
