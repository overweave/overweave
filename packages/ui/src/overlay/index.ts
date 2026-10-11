import { useSignal } from '@preact/signals';
import { Fragment, h, render } from 'preact';
import { useEffect } from 'preact/hooks';
import type { SlotTrace, TracedSlot } from '../preact/trace.ts';

/**
 * The slots over the page, apart from it (its own shadow root, out of the
 * page's flow, never in the pointer's way): each one outlined, its name and
 * how many fills it shows — one whose fills drew no element (text) a line
 * where it is; an empty one red: what it draws of its own hatched, or a
 * line where it is. Opened and closed by a hotkey (ctrl+shift+s) or the
 * handle given back; closed, nothing is drawn. Its trace is the one its
 * provider was given.
 */

export interface SlotOverlayOptions {
  trace: SlotTrace;
  /** The keys that open and close it (default ctrl+shift+s); null: only by the handle. */
  hotkey?: string | null;
  open?: boolean;
  /** Where it is put (default: the document's body). */
  parent?: Element;
}

export interface SlotOverlay {
  toggle(open?: boolean): void;
  readonly opened: boolean;
  /** Taken off the page, the hotkey let go; nothing more after. */
  stop(): void;
}

const CSS = `
:host { all: initial; }
.box, .line, .count { position: fixed; pointer-events: none; box-sizing: border-box; }
.box { border: 1px dashed #2dd4bf; border-radius: 3px; }
.box[data-empty] { border-color: #ff5c5c; background: repeating-linear-gradient(45deg, transparent 0 6px, rgba(255, 92, 92, .1) 6px 12px); }
.line { height: 0; border-top: 1px dashed #2dd4bf; display: flex; justify-content: center; align-items: center; }
.line[data-empty] { border-color: #ff5c5c; }
.name { position: absolute; left: -1px; top: -15px; padding: 0 5px; border-radius: 3px; background: #2dd4bf; color: #04201c; font: 600 10px/15px ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
.line > .name { position: static; }
[data-empty] > .name { background: #ff5c5c; color: #2a0607; }
.count { right: 12px; bottom: 12px; padding: 4px 10px; border-radius: 999px; background: #18181b; color: #e4e4e7; font: 12px system-ui, sans-serif; box-shadow: 0 4px 14px rgba(0, 0, 0, .4); }
.count b { color: #ff7373; font-weight: 600; }
`;

/** Elements as one box (none: nothing to see). */
function boxOf(els: Element[]): DOMRect | undefined {
  const rects = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width || r.height);
  if (!rects.length) return undefined;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  return new DOMRect(left, top, Math.max(...rects.map((r) => r.right)) - left, Math.max(...rects.map((r) => r.bottom)) - top);
}

/** A slot with nothing to see: a line across what it is in, midway between what comes before it (or its top) and after it (or its bottom) — as in a column; in a row, at the start of what follows. */
function lineOf(slot: TracedSlot) {
  const place = slot.place();
  if (!place) return undefined;
  const within = place.parent.getBoundingClientRect();
  const after = place.before ? place.before.getBoundingClientRect().top : within.bottom;
  const prev = place.before ? place.before.previousElementSibling : place.parent.lastElementChild;
  const before = prev ? prev.getBoundingClientRect().bottom : within.top;
  return { left: `${within.left}px`, top: `${before <= after ? (before + after) / 2 : after}px`, width: `${within.width}px` };
}

const px = (r: DOMRect) => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });

function Overlay({ trace }: { trace: SlotTrace }) {
  // Drawn again each frame: the page moves under it.
  const frame = useSignal(0);
  useEffect(() => {
    let id = requestAnimationFrame(function next() {
      frame.value++;
      id = requestAnimationFrame(next);
    });
    return () => cancelAnimationFrame(id);
  }, []);
  frame.value;
  const slots = trace.slots();
  return h(
    Fragment,
    null,
    slots.map((slot, i) => {
      const empty = slot.shown ? undefined : '';
      const name = h('span', { class: 'name' }, empty === undefined ? `${slot.name} · ${slot.shown}` : `∅ ${slot.name}`);
      const box = boxOf(slot.elements());
      if (box) return h('div', { key: i, class: 'box', 'data-empty': empty, style: px(box) }, name);
      const line = lineOf(slot);
      return line ? h('div', { key: i, class: 'line', 'data-empty': empty, style: line }, name) : null;
    }),
    h('div', { class: 'count' }, `${slots.length} slots · `, h('b', null, `${slots.filter((s) => !s.shown).length} empty`)),
  );
}

/** Whether an event is these keys ("ctrl+shift+s"). */
function pressed(e: KeyboardEvent, keys: string): boolean {
  const parts = keys.toLowerCase().split('+');
  const key = parts.pop();
  const mods = { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey };
  return e.key.toLowerCase() === key && Object.entries(mods).every(([m, on]) => parts.includes(m) === on);
}

export function mountSlotOverlay({ trace, hotkey = 'ctrl+shift+s', open = false, parent = document.body }: SlotOverlayOptions): SlotOverlay {
  const host = document.createElement('div');
  host.setAttribute('data-overweave-overlay', '');
  // Out of the page's flow, under nothing of it and in the pointer's way nowhere.
  host.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483646; pointer-events: none;';
  parent.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const mount = document.createElement('div');
  root.append(style, mount);
  let opened = false;
  let stopped = false;
  const keys = (e: KeyboardEvent) => {
    if (!hotkey || !pressed(e, hotkey)) return;
    e.preventDefault();
    overlay.toggle();
  };
  window.addEventListener('keydown', keys);
  const overlay: SlotOverlay = {
    toggle(on = !opened) {
      if (stopped) return;
      opened = on;
      render(opened ? h(Overlay, { trace }) : null, mount);
    },
    get opened() {
      return opened;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      opened = false;
      window.removeEventListener('keydown', keys);
      render(null, mount);
      host.remove();
    },
  };
  if (open) overlay.toggle(true);
  return overlay;
}
