/**
 * A world drawn in a story: the UI's kinds and one's own, fixtures, addons
 * run by the testkit's contract, a slot or any tree under a provider of its
 * own, what failed listed below it — and told to the Overweave panel over
 * Storybook's channel (setPreviewChannel gives it). Storybook's config:
 * '@overweave/storybook'.
 */

export { type AddonState, type Channel, EVENTS, type InspectorState, setPreviewChannel } from '../protocol.ts';
export { type Problem, type UiKindsOf, type WorldOf, WorldStory, type WorldStoryProps } from './world.ts';
