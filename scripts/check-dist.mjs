// The built packages, imported as plain Node imports them: every public entry, its whole graph.
import assert from 'node:assert/strict';

const core = await import('@overweave/core');
const ui = await import('@overweave/ui');
const preact = await import('@overweave/ui/preact');
const overlay = await import('@overweave/ui/overlay');
const testkit = await import('@overweave/testkit');
const testkitPreact = await import('@overweave/testkit/preact');
const storybook = await import('@overweave/storybook');
const storybookPreact = await import('@overweave/storybook/preact');
// '@overweave/storybook/manager' is Storybook's manager's: React and its API are there only.

assert.equal(typeof core.createRegistry, 'function');
assert.equal(typeof ui.uiKinds, 'function');
assert.equal(typeof preact.Slot, 'function');
assert.equal(typeof overlay.mountSlotOverlay, 'function');
assert.equal(typeof testkit.world, 'function');
assert.equal(typeof testkitPreact.mount, 'function');
assert.equal(storybook.storybook({ stories: [] }).framework.name, '@storybook/preact-vite');
assert.equal(typeof storybookPreact.WorldStory, 'function');

const kinds = ui.uiKinds()({ configure: 'configure', behaviour: 'behaviour' });
const registry = core.createRegistry({ kinds: [kinds.Slot, kinds.Fill, kinds.Wrap] });
registry.contributor('app', { priority: 0 }).add('Fill', 'f', { slot: 's', render: () => 'drawn' });
assert.deepEqual(
  ui.fillsOf(registry, 's', {}).map((f) => f.spec.render()),
  ['drawn'],
);
console.log('the built packages import and work in Node');
