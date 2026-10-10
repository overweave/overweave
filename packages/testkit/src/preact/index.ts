/**
 * Testing with Preact: any tree, or a slot, of a world drawn on its own
 * (the app's providers around it; its failures kept; changes drawn inside
 * act, awaited when async), renders counted — real ones, by component. The
 * one cleanup() (here or from '@overweave/testkit': the same) lets go of
 * all of it, and of every world, after each test: afterEach(cleanup).
 */

export { cleanup } from '../cleanup.ts';
export { type RenderCounts, type RenderCountsOptions, renderCounts } from './counts.ts';
export { act, type Mounted, type MountOptions, mount, type RenderedSlot, renderSlot } from './mount.ts';
