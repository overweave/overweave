import type { ApplyError, ApplyResult, ContributionOf } from '@overweave/core';
import type { Events, Mark, Snapshot } from './world.ts';

/*
 * Checks for any test runner: each throws a CheckError that says what was
 * expected and what there is — and carries both (a runner's diff reads
 * them); nothing when it holds.
 */

/** What the checks read of a world, whatever its kinds. */
interface Read {
  contributionsOf(id: string): readonly ContributionOf[];
  knows(id: string): boolean;
  whoSays(kind: string, name: string, path: readonly string[]): string | undefined;
  readonly events: Events;
  running(): readonly string[];
  readonly disposed: boolean;
}

/** A check that did not hold: what was expected, what there is. */
export class CheckError extends Error {
  constructor(
    message: string,
    readonly expected?: unknown,
    readonly actual?: unknown,
  ) {
    super(message);
    this.name = 'CheckError';
  }
}

const show = (value: unknown) =>
  JSON.stringify(value, (_k, v) => (typeof v === 'function' ? `[function ${v.name || 'anonymous'}]` : typeof v === 'symbol' ? `[${v.description}]` : v), 2);

const live = (world: Read) => {
  if (world.disposed) throw new CheckError('the world is disposed: nothing to check');
};

/** Nothing was rejected, nor dropped, in the world (since a mark: what an action told). */
export function assertNothingRefused(world: Read, since?: Mark): void {
  const refused = [...world.events.rejected(since), ...world.events.dropped(since)];
  if (refused.length) throw new CheckError(`expected nothing rejected or dropped; there is:\n${show(refused)}`, [], refused);
}

/** No conflict was told in the world (since a mark). */
export function assertNoConflicts(world: Read, since?: Mark): void {
  const conflicts = world.events.conflicts(since);
  if (conflicts.length) throw new CheckError(`expected no conflict; there is:\n${show(conflicts)}`, [], conflicts);
}

const byKey = (c: ContributionOf) => `${c.kind}\u0000${c.name}\u0000${c.operation}`;
const sorted = (list: readonly ContributionOf[]) =>
  [...list].map((c) => ({ kind: c.kind, name: c.name, operation: c.operation, status: c.status })).sort((a, b) => (byKey(a) < byKey(b) ? -1 : byKey(a) > byKey(b) ? 1 : 0));

/** A contributor says exactly these now — whatever their order, whatever the order of their fields. */
export function assertContributions(world: Read, id: string, expected: readonly ContributionOf[]): void {
  live(world);
  const actual = sorted(world.contributionsOf(id));
  const wanted = sorted(expected);
  if (show(actual) !== show(wanted)) throw new CheckError(`expected ${id} to say:\n${show(wanted)}\nit says:\n${show(actual)}`, wanted, actual);
}

/** Nothing a contributor said is there any more — a contributor this world never knew is a mistake, not a pass. */
export function assertGone(world: Read, id: string): void {
  live(world);
  if (!world.knows(id)) throw new CheckError(`${id} was never in this world: nothing to check gone`);
  const left = world.contributionsOf(id);
  if (left.length) throw new CheckError(`expected nothing of ${id} left; there is:\n${show(left)}`, [], left);
}

/** No addon runs, and none of those named says anything any more. */
export function assertEmpty(world: Read, ...ids: string[]): void {
  live(world);
  const running = world.running();
  if (running.length) throw new CheckError(`expected no addon running; there are: ${running.join(', ')}`, [], running);
  for (const id of ids) assertGone(world, id);
}

/** Who says what is at a path of a definition. */
export function assertSays(world: Read, kind: string, name: string, path: readonly string[], contributor: string): void {
  live(world);
  const who = world.whoSays(kind, name, path);
  if (who !== contributor)
    throw new CheckError(
      `expected ${contributor} to say ${kind}/${name} ${path.join('.')}; ${who === undefined ? 'nobody does (or there is no such definition)' : `${who} does`}`,
      contributor,
      who,
    );
}

/** An operation came to what was expected: included, waiting — or rejected, with which codes. */
export function assertResult(result: ApplyResult, status: 'included' | 'waiting'): void;
export function assertResult(result: ApplyResult, status: 'rejected', codes?: readonly ApplyError['code'][]): void;
export function assertResult(result: ApplyResult, status: ApplyResult['status'], codes?: readonly string[]): void {
  if (codes && status !== 'rejected') throw new CheckError(`codes are a rejection's: expected ${status} with codes makes no sense`);
  if (result.status !== status) throw new CheckError(`expected ${status}; it is:\n${show(result)}`, status, result);
  if (codes && result.status === 'rejected') {
    const got = result.errors.map((e) => e.code);
    if (show(got) !== show(codes)) throw new CheckError(`expected the codes ${JSON.stringify(codes)}; they are ${JSON.stringify(got)}:\n${show(result.errors)}`, codes, got);
  }
}

/** Two snapshots are the same (what came first, which of the two is which: said in the message). */
export function assertSameSnapshot(expected: Snapshot, actual: Snapshot, what = 'the snapshot'): void {
  if (show(expected) !== show(actual)) throw new CheckError(`expected ${what} to be the same; it differs:\nexpected ${show(expected)}\nactual ${show(actual)}`, expected, actual);
}
