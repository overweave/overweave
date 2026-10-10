import type { Channel } from './protocol.ts';

/** A channel as Storybook's is, for tests: what is emitted kept, listeners told at once. */
export function testChannel() {
  const listeners = new Map<string, Set<(...args: never[]) => void>>();
  const emitted: { event: string; args: unknown[] }[] = [];
  const channel: Channel & { emitted: typeof emitted; last<T>(event: string): T | undefined; listening(event: string): number } = {
    on: (event, listener) => void (listeners.get(event) ?? listeners.set(event, new Set()).get(event))?.add(listener),
    off: (event, listener) => void listeners.get(event)?.delete(listener),
    emit(event, ...args) {
      emitted.push({ event, args });
      for (const listener of [...(listeners.get(event) ?? [])]) (listener as (...a: unknown[]) => void)(...args);
    },
    emitted,
    last: <T>(event: string) => emitted.filter((e) => e.event === event).at(-1)?.args[0] as T | undefined,
    listening: (event) => listeners.get(event)?.size ?? 0,
  };
  return channel;
}
