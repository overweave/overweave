import { defaultClientConditions } from 'vite';
import { describe, expect, it } from 'vitest';
import { storybook } from './index.ts';

describe('storybook()', () => {
  it('is Preact’s, with no telemetry, the Overweave panel and the addons given', () => {
    const config = storybook({ stories: ['../src/**/*.stories.tsx'] });
    expect(config.framework.name).toBe('@storybook/preact-vite');
    expect(config.stories).toEqual(['../src/**/*.stories.tsx']);
    expect(config.addons).toEqual(['@overweave/storybook']);
    expect(storybook({ stories: [], addons: ['a11y'], panel: false }).addons).toEqual(['a11y']);
    expect(config.core.disableTelemetry).toBe(true);
  });

  it('keeps one Preact, reads sources by the conditions given, polls only when asked', () => {
    const vite = storybook({ stories: [], conditions: ['app-source'], cacheDir: '.cache', poll: true }).viteFinal({ resolve: { dedupe: ['x'] } });
    expect(vite.resolve?.dedupe).toEqual(['x', 'preact', '@preact/signals', '@preact/signals-core']);
    expect(vite.resolve?.conditions).toEqual(['app-source', ...defaultClientConditions]);
    expect(vite.server?.watch?.usePolling).toBe(true);
    expect(vite.cacheDir).toBe('.cache');
    expect(vite.plugins?.length).toBeGreaterThan(0);
    const plain = storybook({ stories: [] }).viteFinal({});
    expect([plain.resolve?.conditions, plain.server?.watch, plain.cacheDir]).toEqual([undefined, undefined, undefined]);
  });

  it('adds Preact’s plugin only when the app’s config has none', () => {
    const names = (plugins: unknown): string[] =>
      Array.isArray(plugins) ? plugins.flatMap(names) : plugins && typeof plugins === 'object' && 'name' in plugins ? [String(plugins.name)] : [];
    const config = storybook({ stories: [] });
    expect(names(config.viteFinal({}).plugins)).toContain('vite:preact-jsx');
    const theirs = [{ name: 'preact:config' }, { name: 'vite:preact-jsx' }];
    expect(names(config.viteFinal({ plugins: [theirs] }).plugins)).toEqual(['preact:config', 'vite:preact-jsx']);
  });
});
