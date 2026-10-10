/**
 * Testing what is built on overweave, with no framework: a world of kinds
 * and contributors, addons run and stopped by the testkit's own contract
 * (owned by the world), what each says and who says what, every event kept
 * and marked; addons run in every order; checks that throw for any test
 * runner; one cleanup() for afterEach, whatever entry it is taken from. A slot or a tree drawn, renders counted:
 * '@overweave/testkit/preact'.
 */

export {
  assertContributions,
  assertEmpty,
  assertGone,
  assertNoConflicts,
  assertNothingRefused,
  assertResult,
  assertSameSnapshot,
  assertSays,
  CheckError,
} from './checks.ts';
export { cleanup } from './cleanup.ts';
export { type AddonRun, everyOrder } from './orders.ts';
export { type Events, type Grant, type Mark, plain, type Run, type Setup, type Snapshot, uiWorld, type World, world } from './world.ts';
