// @vitest-environment happy-dom
import { cleanup, renderCounts } from '@overweave/testkit/preact';
import { act, fireEvent, render, cleanup as unrender } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVENTS, type InspectorState } from '../protocol.ts';
import { testChannel } from '../testChannel.ts';
import { ASK_EVERY, mountPanel, Panel } from './panel.ts';

afterEach(() => {
  unrender();
  cleanup();
  vi.useRealTimers();
});

const state: InspectorState = {
  instance: 'story-1',
  drawn: 'main',
  addons: [
    { id: 'table', on: true, running: true, priority: 0, rights: [], says: [{ kind: 'Fill', name: 'table.fill', operation: 'add', status: 'included' }] },
    { id: 'images', on: true, running: false, priority: 200, rights: ['configure'], failed: 'no luck', says: [] },
  ],
  definitions: [
    { kind: 'Fill', name: 'table.fill', definedBy: 'table', spec: { slot: 'main', render: '[function T]' }, says: { slot: 'table', render: 'table', title: 'images' } },
  ],
  refused: [{ type: 'rejected', contributor: 'images', kind: 'Fill', name: 'x', codes: ['noRight'] }],
  conflicts: [],
  problems: [{ what: 'images failed to start', message: 'no luck' }],
  renders: { 'Overweave.SlotView': 2, Title: 3 },
};

describe('the Overweave panel', () => {
  it('asks to be told, and says when there is no world', () => {
    const channel = testChannel();
    const { container } = render(h(Panel, { channel }));
    expect(channel.emitted.map((e) => e.event)).toEqual([EVENTS.request]);
    expect(container.textContent).toContain('No overweave world in this story');
  });

  it('shows what it is told: addons, who says what, what was refused and failed, renders', () => {
    const channel = testChannel();
    const { container } = render(h(Panel, { channel }));
    act(() => channel.emit(EVENTS.state, state));
    const text = container.textContent ?? '';
    expect(text).toContain('Drawn: main');
    expect(text).toContain('add Fill/table.fill');
    expect(text).toContain('failed: no luck');
    expect(text).toContain('table 2, images 1');
    expect(text).toContain('title ← images');
    expect(text).toContain('rejected: images → Fill/x (noRight)');
    expect(text).toContain('images failed to start: no luck');
    // Renders: overweave's own hidden until asked for.
    const renders = (name: string) => [...container.querySelectorAll(`[data-row="${name}"] td`)].map((td) => td.textContent);
    expect(renders('Title')).toEqual(['Title', '3']);
    expect(renders('Overweave.SlotView')).toEqual([]);
  });

  it('turns an addon off, counts again, forgets a story that is gone', () => {
    const channel = testChannel();
    const { container, getByLabelText, getByText } = render(h(Panel, { channel }));
    act(() => channel.emit(EVENTS.state, state));
    fireEvent.click(getByLabelText('turn table off'));
    expect(channel.last(EVENTS.toggle)).toEqual({ instance: 'story-1', id: 'table', on: false });
    fireEvent.click(getByText('count again'));
    expect(channel.last(EVENTS.resetCounts)).toEqual({ instance: 'story-1' });
    act(() => channel.emit(EVENTS.gone, { instance: 'another' }));
    expect(container.textContent).toContain('Drawn: main');
    act(() => channel.emit(EVENTS.gone, { instance: 'story-1' }));
    expect(container.textContent).toContain('No overweave world in this story');
  });

  it('asks again while open (renders are counted between changes); taken away, asks nothing more', () => {
    vi.useFakeTimers();
    const channel = testChannel();
    const element = document.createElement('div');
    let stop = () => {};
    act(() => {
      stop = mountPanel(element, channel);
    });
    vi.advanceTimersByTime(2000);
    expect(channel.emitted.filter((e) => e.event === EVENTS.request).length).toBe(3);
    stop();
    vi.advanceTimersByTime(2000);
    expect(channel.emitted.filter((e) => e.event === EVENTS.request).length).toBe(3);
    expect(channel.listening(EVENTS.state)).toBe(0);
  });

  it('keeps every world by its name, one shown and chosen; draws nothing again for the same state', () => {
    const channel = testChannel();
    const counts = renderCounts();
    const { container, getByLabelText } = render(h(Panel, { channel }));
    act(() => {
      channel.emit(EVENTS.state, state);
      channel.emit(EVENTS.state, { ...state, instance: 'story-2', drawn: 'side', addons: [] });
    });
    expect(container.querySelector('[data-row="table"]')).not.toBeNull();
    expect([...container.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['1: main', '2: side']);
    fireEvent.change(getByLabelText('world'), { target: { value: 'story-2' } });
    expect(container.textContent).toContain('No addons in this story.');
    const drawn = counts.of(Panel);
    act(() => channel.emit(EVENTS.state, { ...state, instance: 'story-2', drawn: 'side', addons: [] }));
    expect(counts.of(Panel)).toBe(drawn);
  });

  it('forgets a world that answers no more (the page drawn again), and leaves alone what is no state', () => {
    vi.useFakeTimers();
    const channel = testChannel();
    const { container } = render(h(Panel, { channel }));
    act(() => {
      channel.emit(EVENTS.state, state);
      channel.emit(EVENTS.state, null);
      channel.emit(EVENTS.gone);
    });
    act(() => void vi.advanceTimersByTime(ASK_EVERY * 2));
    expect(container.textContent).toContain('Drawn: main');
    act(() => void vi.advanceTimersByTime(ASK_EVERY));
    expect(container.textContent).toContain('No overweave world in this story');
  });
});
