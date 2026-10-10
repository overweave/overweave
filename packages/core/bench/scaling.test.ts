import { describe, expect, it } from 'vitest';
import { makeWorld, REAL, scaled } from './world.ts';

/*
 * How a cost grows, not how long it takes (a time is the machine's): one
 * change, and reading what changed, cost about the same in a world ten
 * times larger. A cost that grew with the world (the whole registry gone
 * through for one change) is a mistake of the design, caught here.
 */

/** The median time of many runs (ms). */
function median(run: () => void, times = 300): number {
  for (let i = 0; i < 20; i++) run();
  const samples: number[] = [];
  for (let i = 0; i < times; i++) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

/** One change, and what changed read again, in a world of these sizes. */
function oneChange(by: number) {
  const w = makeWorld(scaled(REAL, by));
  let flip = false;
  const cost = median(() => {
    flip = !flip;
    w.user.patch('Column', 't0.c3', { hidden: flip });
    w.registry.get('Column', 't0.c3');
  });
  w.registry.dispose();
  return cost;
}

describe('how costs grow', () => {
  it('one change, and reading it, costs about the same in a world ten times larger', () => {
    // The smaller world measured again after the larger: what is slower first (the JIT) is not taken for growth.
    oneChange(0.1);
    const small = Math.max(oneChange(0.1), 0.001);
    const large = oneChange(1);
    expect(large / small).toBeLessThan(4);
  });
});
