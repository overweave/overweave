/*
 * As much of Storybook's manager API, and of React, as the panel uses —
 * declared here rather than installed (Storybook gives both to the manager
 * it bundles the panel into). Not part of what is published.
 */

declare module 'storybook/manager-api' {
  interface Channel {
    on(event: string, listener: (...args: never[]) => void): void;
    off(event: string, listener: (...args: never[]) => void): void;
    emit(event: string, ...args: unknown[]): void;
  }

  export const types: { readonly PANEL: string };
  export const addons: {
    register(id: string, callback: () => void): void;
    add(id: string, addon: { type: string; title: string; render: (props: { active?: boolean }) => unknown }): void;
    getChannel(): Channel;
  };
}

declare module 'react' {
  export function createElement(type: string, props: Record<string, unknown> | null): unknown;
}
