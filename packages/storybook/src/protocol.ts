/*
 * What a story's world and the Overweave panel tell each other over
 * Storybook's channel: the story what its world is now (plain data); the
 * panel what to turn off or on, when to count again, and that it wants to
 * be told. Nothing here imports Storybook: the channel is what it gives.
 */

/** Storybook's channel, as much of it as is used. */
export interface Channel {
  on(event: string, listener: (...args: never[]) => void): void;
  off(event: string, listener: (...args: never[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
}

export const EVENTS = {
  /** story → panel: an InspectorState. */
  state: 'overweave/state',
  /** story → panel: { instance } — the story's world let go of. */
  gone: 'overweave/gone',
  /** panel → story: { instance? } — tell me again (one world, or every one); renders are counted between changes. */
  request: 'overweave/request',
  /** panel → story: { instance, id, on } — an addon turned off or on. */
  toggle: 'overweave/toggle',
  /** panel → story: { instance } — renders counted from zero. */
  resetCounts: 'overweave/reset-counts',
} as const;

export interface AddonState {
  readonly id: string;
  /** Turned on in the panel (all are, at first). */
  readonly on: boolean;
  readonly running: boolean;
  readonly priority: number;
  readonly rights: readonly string[];
  /** Why it did not start. */
  readonly failed?: string;
  /** What it says now. */
  readonly says: readonly { kind: string; name: string; operation: string; status: string }[];
}

export interface InspectorState {
  /** Which world (one page may draw several). */
  readonly instance: string;
  /** What is drawn: the slot's name, or "a tree". */
  readonly drawn: string;
  readonly addons: readonly AddonState[];
  /** Every definition: its spec (as plain data: functions by name), who defined it, who says each leaf. */
  readonly definitions: readonly { kind: string; name: string; definedBy: string; spec: unknown; says: Readonly<Record<string, string>> }[];
  /** What was refused: rejected (never taken), dropped (taken, then no longer fitting). */
  readonly refused: readonly { type: 'rejected' | 'dropped'; contributor: string; kind: string; name: string; codes: readonly string[] }[];
  readonly conflicts: readonly { kind: string; name: string; path: readonly string[]; contributors: readonly string[] }[];
  /** What failed: the world's making, what was given, an addon's start, a drawing. */
  readonly problems: readonly { what: string; message: string }[];
  /** Renders by component name, within this world's tree, since it was made (or counted again). */
  readonly renders: Readonly<Record<string, number>>;
}

/** Whether a message is for a world: an object naming it. */
export const isFor = (what: unknown, instance: string): what is { instance: string } =>
  typeof what === 'object' && what !== null && (what as { instance?: unknown }).instance === instance;

let given: Channel | undefined;
let warned = false;

/**
 * The preview's channel for the panel, given by the app — in its .storybook/preview:
 * `setPreviewChannel(addons.getChannel())` (addons from 'storybook/preview-api').
 * Without it, the channel Storybook leaves on the page is taken, if there is one.
 */
export function setPreviewChannel(channel: Channel | undefined): void {
  given = channel;
}

/** The preview's channel: the one given, else Storybook's on the page; none outside Storybook (and, in Storybook without one, a warning, once). */
export function previewChannel(): Channel | undefined {
  const channel = given ?? (globalThis as { __STORYBOOK_ADDONS_CHANNEL__?: Channel }).__STORYBOOK_ADDONS_CHANNEL__;
  if (!channel && !warned && '__STORYBOOK_PREVIEW__' in globalThis) {
    warned = true;
    console.warn('overweave: in Storybook, but no channel for the Overweave panel: call setPreviewChannel(addons.getChannel()) in .storybook/preview');
  }
  return channel;
}
