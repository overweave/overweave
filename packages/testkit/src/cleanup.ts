/*
 * One cleanup for everything the testkit made: each entry adds its steps
 * (the Preact entry its trees and counters, first; the worlds last). Every
 * step runs, whatever one throws; what failed is told by name and cause,
 * not buried in errors within errors.
 */

const steps: (() => void)[] = [];

/** A step of cleanup: `first` ones run before the others (trees before the worlds they draw). */
export function addCleanup(step: () => void, first = false): void {
  if (steps.includes(step)) return;
  if (first) steps.unshift(step);
  else steps.push(step);
}

/** Errors within errors, flat. */
export function flatten(errors: readonly unknown[]): unknown[] {
  return errors.flatMap((e) => (e instanceof AggregateError ? flatten(e.errors) : [e]));
}

const said = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One error for several: each told on a line of its own. */
export function failed(what: string, errors: readonly unknown[]): Error {
  const all = flatten(errors);
  if (all.length === 1 && all[0] instanceof Error) return all[0];
  return new AggregateError(all, `${what}:\n${all.map((e) => `  ${said(e)}`).join('\n')}`);
}

/** Everything the testkit made let go of: trees unmounted, counters stopped (with the Preact entry), worlds disposed — their addons stopped. afterEach(cleanup). */
export function cleanup(): void {
  const errors: unknown[] = [];
  for (const step of [...steps]) {
    try {
      step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw failed('cleanup failed', errors);
}
