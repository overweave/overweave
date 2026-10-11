// @vitest-environment happy-dom
import { createRegistry } from '@overweave/core';
import { act, cleanup, render } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uiKinds } from '../index.ts';
import { OverweaveProvider, type PreactComponent, Slot, slotTrace } from '../preact/index.ts';
import { mountSlotOverlay, type SlotOverlay } from './index.ts';

/* The slots over the page, as an app mounts it: apart from it and out of its way (a manual popover: the top layer, over a dialog), opened by its hotkey; each slot outlined and named, an empty one red at its place, one of text only a line; how many said. */

const ui = uiKinds<PreactComponent>()({ configure: 'configure', behaviour: 'behaviour' });
let overlay: SlotOverlay | undefined;
afterEach(() => {
  overlay?.stop();
  cleanup();
  vi.restoreAllMocks();
});

/** Boxes by tag: the page laid out as a column. */
const BOXES: Record<string, [number, number, number, number]> = { MAIN: [0, 0, 300, 200], H1: [10, 10, 100, 20], NAV: [10, 60, 100, 20] };

function setup() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const [x, y, w, hh] = BOXES[this.tagName] ?? [0, 0, 0, 0];
    return new DOMRect(x, y, w, hh);
  });
  const registry = createRegistry({ kinds: [ui.Slot, ui.Fill, ui.Wrap] });
  const app = registry.contributor('app', { priority: 0 });
  app.add('Fill', 'title', { slot: 'header', render: () => h('h1', null, 'Title') });
  app.add('Fill', 'note', { slot: 'note', render: () => 'text' });
  const trace = slotTrace();
  render(h(OverweaveProvider, { registry, trace }, h('main', null, h(Slot, { name: 'header' }), h(Slot, { name: 'banner' }), h('nav', null, 'nav'), h(Slot, { name: 'note' }))));
  overlay = mountSlotOverlay({ trace });
  const host = document.querySelector('[data-overweave-overlay]') as HTMLElement;
  return { host, root: host.shadowRoot as ShadowRoot };
}

describe('mountSlotOverlay', () => {
  it('is out of the page’s flow and the pointer’s way, drawing nothing till opened — by its hotkey too', () => {
    const { host, root } = setup();
    expect([host.style.position, host.style.pointerEvents, host.getAttribute('popover')]).toEqual(['fixed', 'none', 'manual']);
    expect(root.querySelector('.count')).toBeNull();
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', ctrlKey: true, shiftKey: true })));
    expect(root.querySelector('.count')?.textContent).toBe('3 slots · 1 empty');
  });

  it('outlines a slot and names it; an empty one red, midway between its neighbours; one of text only, a line at its place', () => {
    const { root } = setup();
    act(() => overlay?.toggle(true));
    const box = root.querySelector('.box') as HTMLElement;
    expect([box.textContent, box.style.left, box.style.top, box.style.width]).toEqual(['header · 1', '10px', '10px', '100px']);
    const [banner, note] = [...root.querySelectorAll<HTMLElement>('.line')];
    // Between the title (its bottom 30) and the nav (its top 60).
    expect([banner.textContent, banner.hasAttribute('data-empty'), banner.style.top]).toEqual(['∅ banner', true, '45px']);
    // Last in main: between the nav (its bottom 80) and main's bottom (200).
    expect([note.textContent, note.hasAttribute('data-empty'), note.style.top]).toEqual(['note · 1', false, '140px']);
  });

  it('does nothing more once stopped', () => {
    setup();
    overlay?.stop();
    act(() => overlay?.toggle(true));
    expect([overlay?.opened, document.querySelector('[data-overweave-overlay]')]).toEqual([false, null]);
    overlay = undefined;
  });
});
