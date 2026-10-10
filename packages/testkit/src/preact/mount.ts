import type { Failure, Matcher, SlotRef } from '@overweave/ui';
import { OverweaveProvider, Slot } from '@overweave/ui/preact';
import { type ComponentChildren, type ComponentType, h, render } from 'preact';
import { act as preactAct } from 'preact/test-utils';
import { addCleanup } from '../cleanup.ts';
import type { World } from '../world.ts';

/*
 * A tree drawn over a world's registry, in a provider of its own (and the
 * app's providers around it, if given): its failures kept, its text and
 * HTML read, changes made inside act (drawn before the next line — awaited
 * when the change is), drawn again with another tree, let go of. A slot
 * drawn on its own is one such tree. Made, it is let go of by cleanup()
 * too; let go of, it answers nothing more. A DOM is needed (happy-dom,
 * jsdom); Testing Library's queries work on its container.
 */

// biome-ignore lint/suspicious/noExplicitAny: a world of whatever kinds (the UI's among them).
type AnyWorld = Pick<World<any>, 'registry'>;

export interface MountOptions {
  // biome-ignore lint/suspicious/noExplicitAny: the app's matcher, whatever its targets and props.
  matcher?: Matcher<any, any>;
  /** The app's providers around the tree (a router, contexts): ({ children }) => <Router>{children}</Router>. */
  wrapper?: ComponentType<{ children?: ComponentChildren }>;
}

export interface Mounted {
  readonly container: HTMLElement;
  /** What failed in it (match, when, render), as told. */
  readonly failures: Failure[];
  text(): string;
  html(): string;
  /** A change made, and what it changes drawn before this returns — or, for an async change, before the promise does. */
  act(change: () => Promise<unknown>): Promise<void>;
  act(change: () => unknown): void;
  /** Drawn with another tree. */
  rerender(node: ComponentChildren): void;
  /** Let go of: the tree unmounted, its container removed. Again: nothing; anything else after (reading it too): a throw. */
  unmount(): void;
}

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  (typeof v === 'object' || typeof v === 'function') && v !== null && typeof (v as { then?: unknown }).then === 'function';

/** A change made, and what it changes drawn before this returns — or, for an async change, before the promise does: act(() => contributor.add(…)). */
export function act(change: () => Promise<unknown>): Promise<void>;
export function act(change: () => unknown): void;
export function act(change: () => unknown): Promise<void> | undefined {
  let result: unknown;
  const done = preactAct(() => {
    result = change();
    return isThenable(result) ? (result as Promise<void>) : undefined;
  }) as unknown;
  if (isThenable(result)) return Promise.resolve(done).then(() => undefined);
  return undefined;
}

/** Trees not yet let go of: what cleanup() unmounts. */
const mounted = new Set<Mounted>();

/** Any tree drawn over a world's registry: mount(w, <Settings />). */
export function mount(world: AnyWorld, node: ComponentChildren, options: MountOptions = {}): Mounted {
  if (typeof document === 'undefined') throw new Error('mount needs a DOM: run the test in happy-dom or jsdom (// @vitest-environment happy-dom)');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const failures: Failure[] = [];
  const onError = (failure: Failure) => void failures.push(failure);
  let gone = false;
  const live = () => {
    if (gone) throw new Error('this view was let go of (unmounted)');
  };
  const draw = (tree: ComponentChildren) => {
    const inner = h(OverweaveProvider, { registry: world.registry, matcher: options.matcher, onError }, tree);
    preactAct(() => {
      render(options.wrapper ? h(options.wrapper, null, inner) : inner, container);
    });
  };
  const view: Mounted = {
    get container() {
      live();
      return container;
    },
    failures,
    text() {
      live();
      return container.textContent ?? '';
    },
    html() {
      live();
      return container.innerHTML;
    },
    act(change: () => unknown) {
      live();
      return act(change) as never;
    },
    rerender(tree) {
      live();
      draw(tree);
    },
    unmount() {
      if (gone) return;
      gone = true;
      mounted.delete(view);
      try {
        preactAct(() => render(null, container));
      } finally {
        container.remove();
      }
    },
  };
  // The first drawing failed (a world without the UI's kinds): nothing left behind.
  try {
    draw(node);
  } catch (error) {
    gone = true;
    container.remove();
    throw error;
  }
  mounted.add(view);
  return view;
}

/** Every tree not yet let go of, unmounted. */
export function unmountAll(): void {
  for (const view of [...mounted]) view.unmount();
}
addCleanup(unmountAll, true);

export interface RenderedSlot<P> extends Omit<Mounted, 'rerender'> {
  /** Drawn with other props. */
  rerender(props: P): void;
  /** A new retry key: what failed in it tried again. */
  retry(): void;
}

/** What a typed slot must be given: its props, unless it declares none (or may be given none). */
type SlotArgs<P> = unknown extends P ? [props?: P, options?: MountOptions] : undefined extends P ? [props?: P, options?: MountOptions] : [props: P, options?: MountOptions];

/** A slot of a world drawn on its own: renderSlot(w, header, { pod }). */
export function renderSlot<P>(world: AnyWorld, slot: SlotRef<P> | string, ...[props, options]: SlotArgs<P>): RenderedSlot<P> {
  let now = props;
  let retryKey = 0;
  const tree = () => h(Slot as ComponentType<{ name: SlotRef<P> | string; props?: P; retryKey: number }>, { name: slot, props: now, retryKey });
  const view = mount(world, tree(), options);
  return {
    get container() {
      return view.container;
    },
    failures: view.failures,
    text: () => view.text(),
    html: () => view.html(),
    act: view.act,
    unmount: () => view.unmount(),
    rerender(next: P) {
      now = next;
      view.rerender(tree());
    },
    retry() {
      retryKey++;
      view.rerender(tree());
    },
  } as RenderedSlot<P>;
}
