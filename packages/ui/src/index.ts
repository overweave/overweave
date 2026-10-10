/**
 * overweave's UI concepts, over @overweave/core, with no framework: kinds
 * of the UI (Slot, Fill, Wrap) whose rights the app names, and typed slot
 * references; order; what a slot shows for some props — its fills'
 * targets and conditions, the user's arrangement; what is drawn around a
 * fill. Drawing them is a binding's: '@overweave/ui/preact'.
 */

export {
  type FillSpec,
  type Placement,
  type RenderOf,
  type SlotRef,
  type SlotSpec,
  slot,
  slotFill,
  type TargetOf,
  type UiContributor,
  type UiKinds,
  type UiKindsMap,
  uiKinds,
  type WrapSpec,
} from './kinds.ts';
export { DEFAULT_ORDER, inOrder, loopsOf } from './order.ts';
export { type Failure, type FailurePhase, fillsOf, type Matcher, report, type SlotOptions, type SlotView, slotContributions, slotView, wrapsOf } from './slots.ts';
