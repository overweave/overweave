/**
 * A Storybook of what is built on overweave — its .storybook/main.ts:
 * `export default storybook({ stories: [...] })`. A story draws a world of
 * its own: '@overweave/storybook/preact'. How the stories look (styles, a
 * shadow root, themes) is the app's: its .storybook/preview. Its types:
 * the events the panel and a story tell each other.
 */

import preact from '@preact/preset-vite';
import { defaultClientConditions, mergeConfig, type PluginOption, type UserConfig } from 'vite';

export type { AddonState, Channel, InspectorState } from './protocol.ts';

export interface StorybookOptions {
  /** Where the stories are, from .storybook. */
  stories: string[];
  /** Storybook addons beside the Overweave panel. */
  addons?: string[];
  /** The Overweave panel: a story's world, its addons turned off and on, who says what, renders (default: yes). */
  panel?: boolean;
  /** The export conditions the workspace's packages are read from as sources (as the app's own build reads them): ['my-app-source']. */
  conditions?: string[];
  /** Vite's cache. */
  cacheDir?: string;
  /** Poll for changes: in Docker over a host's folder, no file events cross the mount (default: no). */
  poll?: boolean;
}

/** Storybook's config, as much of it as is given here (a StorybookConfig of '@storybook/preact-vite'). */
export interface StorybookConfig {
  framework: { name: '@storybook/preact-vite'; options: Record<string, never> };
  stories: string[];
  addons: string[];
  core: { disableTelemetry: boolean; disableWhatsNewNotifications: boolean };
  viteFinal(config: UserConfig): UserConfig;
}

/** What one Preact needs: the stories, the UI, the renderer all on it (two would not know each other's elements). */
const ONE_PREACT = ['preact', '@preact/signals', '@preact/signals-core'];
const PREBUNDLED = ['preact', 'preact/hooks', 'preact/compat', 'preact/jsx-runtime', 'preact/jsx-dev-runtime', '@preact/signals'];

/** The names Preact's Vite plugin goes by: there already (the app's vite.config, which Storybook takes too), it is not added again. */
const PREACT_PLUGINS = new Set(['preact:config', 'vite:preact-jsx']);
const names = (plugins: PluginOption | PluginOption[] | undefined): string[] =>
  Array.isArray(plugins) ? plugins.flatMap(names) : plugins && typeof plugins === 'object' && 'name' in plugins ? [String(plugins.name)] : [];

/** Storybook's config: Preact's renderer, JSX as Preact's, one Preact, the workspace's packages from their sources (if their condition is given). */
export function storybook({ stories, addons = [], panel = true, conditions = [], cacheDir, poll = false }: StorybookOptions): StorybookConfig {
  return {
    framework: { name: '@storybook/preact-vite', options: {} },
    stories,
    // The panel is this package's manager entry: Storybook loads '@overweave/storybook/manager'.
    addons: panel ? [...addons, '@overweave/storybook'] : addons,
    core: { disableTelemetry: true, disableWhatsNewNotifications: true },
    viteFinal: (vite) =>
      mergeConfig(vite, {
        // JSX as Preact's (the framework does not set it: it would be React's) — unless the app's config has it already.
        // React stays React in the preview: Storybook's docs are drawn with it.
        plugins: names(vite.plugins).some((n) => PREACT_PLUGINS.has(n)) ? [] : [preact({ reactAliasesEnabled: false })],
        server: poll ? { watch: { usePolling: true, interval: 300 } } : {},
        // The given conditions before Vite's own (setting any replaces Vite's defaults).
        resolve: { ...(conditions.length ? { conditions: [...conditions, ...defaultClientConditions] } : {}), dedupe: ONE_PREACT },
        optimizeDeps: { include: PREBUNDLED },
        ...(cacheDir ? { cacheDir } : {}),
      } satisfies UserConfig),
  };
}
