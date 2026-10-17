import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// One run for every package; the workspace's packages from their sources (client and server resolution alike), every cache in the root's node_modules/.vite.
const pkg = (name: string) => ({
  cacheDir: `../../node_modules/.vite/${name}`,
  resolve: { conditions: ['overweave-source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['overweave-source', ...defaultServerConditions] } },
  // One Preact: the testing library through Vite too, not loaded beside it by Node.
  test: { name: `@overweave/${name}`, root: `packages/${name}`, server: { deps: { inline: ['@testing-library/preact'] } } },
});

// The benches (make bench): apart from the tests, one file at a time (timings not shared with another), the collector exposed.
const bench = (name: string) => {
  const base = pkg(name);
  return {
    ...base,
    test: { ...base.test, name: `bench:${name}`, include: ['bench/**/*.bench.ts'], fileParallelism: false, testTimeout: 600_000, execArgv: ['--expose-gc'] },
  };
};

export default defineConfig({
  test: {
    projects: [pkg('core'), pkg('ui'), pkg('testkit'), pkg('storybook'), ...(process.env.BENCH ? [bench('core'), bench('ui')] : [])],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      // Nothing to test in them: re-exports, types, Storybook's manager (drawn in a running Storybook only).
      exclude: ['**/*.test.{ts,tsx}', '**/index.ts', '**/*.d.ts', 'packages/storybook/src/manager.ts'],
      // json-summary: what CI shows of it (scripts/coverage-summary.mjs).
      reporter: ['text-summary', 'text', 'json-summary'],
    },
  },
});
