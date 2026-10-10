import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/*
 * A small measurer for the packages' benches (`make bench`): an operation
 * run again and again, warmed up first, timed with performance.now — its
 * median, its 95th percentile, its fastest. An operation too fast for the
 * timer is run in batches, each batch's time divided. What an operation
 * needs made anew each time (a registry to take an addon from) is made by
 * `prepare`, outside the time. The results printed as a table, against
 * the run before (bench-results/, kept out of git) when there was one.
 */

export interface Result {
  readonly group: string;
  readonly name: string;
  readonly runs: number;
  /** Milliseconds. */
  readonly median: number;
  readonly p95: number;
  readonly min: number;
  /** What else was found, by name (renders, heap). */
  readonly notes?: Readonly<Record<string, number | string>>;
}

export interface MeasureOptions<T> {
  /** Made before each run, outside the time. */
  prepare?: () => T;
  /** Let go of after each run, outside the time. */
  after?: (prepared: T) => void;
  /** How long to keep running, in milliseconds (default 400). */
  time?: number;
  /** At least this many runs (default 10). */
  minRuns?: number;
  /** At most this many runs (default 5000). */
  maxRuns?: number;
}

const results: Result[] = [];

const percentile = (sorted: readonly number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];

/** One operation measured; its result kept for the report. */
export function measure<T = undefined>(group: string, name: string, run: (prepared: T) => unknown, options: MeasureOptions<T> = {}): Result {
  const { prepare, after, time = 400, minRuns = 10, maxRuns = 5000 } = options;
  const once = () => {
    const prepared = prepare ? prepare() : (undefined as T);
    const start = performance.now();
    run(prepared);
    const took = performance.now() - start;
    after?.(prepared);
    return took;
  };
  // Warmed up: the JIT given its chance.
  for (let i = 0; i < 5; i++) once();
  // Too fast for the timer (and nothing to prepare): run in batches.
  let batch = 1;
  if (!prepare) {
    while (batch < 1 << 16) {
      const start = performance.now();
      for (let i = 0; i < batch; i++) run(undefined as T);
      if (performance.now() - start >= 0.2) break;
      batch *= 2;
    }
  }
  const samples: number[] = [];
  const until = performance.now() + time;
  while ((samples.length < minRuns || performance.now() < until) && samples.length < maxRuns) {
    if (batch === 1) samples.push(once());
    else {
      const start = performance.now();
      for (let i = 0; i < batch; i++) run(undefined as T);
      samples.push((performance.now() - start) / batch);
    }
  }
  samples.sort((a, b) => a - b);
  const result: Result = { group, name, runs: samples.length * batch, median: percentile(samples, 0.5), p95: percentile(samples, 0.95), min: samples[0] };
  results.push(result);
  return result;
}

/** A finding that is not a time (renders, heap): kept with the results. */
export function note(group: string, name: string, notes: Record<string, number | string>): void {
  results.push({ group, name, runs: 0, median: Number.NaN, p95: Number.NaN, min: Number.NaN, notes });
}

const ms = (v: number) => (Number.isNaN(v) ? '' : v >= 100 ? `${v.toFixed(0)} ms` : v >= 1 ? `${v.toFixed(2)} ms` : `${(v * 1000).toFixed(1)} µs`);

/** The results printed (against the run before, if any), and written to bench-results/<name>.json in its place. */
export function report(name: string, root = process.cwd()): void {
  const out = join(root, 'bench-results', `${name}.json`);
  const before = existsSync(out) ? (JSON.parse(readFileSync(out, 'utf8')) as Result[]) : [];
  const was = new Map(before.map((r) => [`${r.group}\u0000${r.name}`, r]));
  const lines = [`\n${name}`, '| group | operation | median | p95 | runs | vs the run before | notes |', '|---|---|---|---|---|---|---|'];
  for (const r of results) {
    const b = was.get(`${r.group}\u0000${r.name}`);
    const vs = b && !Number.isNaN(r.median) && b.median > 0 ? `${r.median / b.median >= 1 ? '+' : ''}${((r.median / b.median - 1) * 100).toFixed(0)}%` : '';
    const notes = r.notes
      ? Object.entries(r.notes)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ')
      : '';
    lines.push(`| ${r.group} | ${r.name} | ${ms(r.median)} | ${ms(r.p95)} | ${r.runs || ''} | ${vs} | ${notes} |`);
  }
  console.log(lines.join('\n'));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
}

/** The heap now, in megabytes, after a collection (node --expose-gc; else as it is). */
export function heap(): number {
  (globalThis as { gc?: () => void }).gc?.();
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;
}

/** A generator of numbers from a seed (mulberry32): the same world every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
