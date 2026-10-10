/**
 * The Overweave panel in Storybook's manager — loaded by Storybook for the
 * addon '@overweave/storybook' (storybook() adds it). The manager draws
 * with React: the panel is an element Preact draws into.
 */

import { createElement } from 'react';
import { addons, types } from 'storybook/manager-api';
import { mountPanel } from './panel/panel.ts';

const ADDON = 'overweave';

let unmount: (() => void) | undefined;

/** Stable, so React does not hand the element over again at each render: Preact drawn in when it comes, taken away when it goes. */
function host(element: Element | null) {
  unmount?.();
  unmount = element ? mountPanel(element, addons.getChannel()) : undefined;
}

addons.register(ADDON, () => {
  addons.add(`${ADDON}/panel`, {
    type: types.PANEL,
    title: 'Overweave',
    render: ({ active }) => (active ? createElement('div', { ref: host, style: { height: '100%', overflow: 'auto' } }) : null),
  });
});
