import { type ComponentChildren, h, render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { type AddonState, type Channel, EVENTS, type InspectorState } from '../protocol.ts';

/*
 * The Overweave panel: what a story's world is — its addons (turned off
 * and on here), what each says, who says each leaf of each definition,
 * what was refused or conflicts, what failed, how many times each
 * component of its tree rendered. Every world the page draws is kept by
 * its name, one shown (chosen when there are several); one that answers
 * no more (gone, or the page drawn again) is forgotten. Drawn with Preact
 * into the element Storybook's panel gives; told everything over the
 * channel.
 */

/** How often the panel asks again while it is open: renders are counted between changes. */
export const ASK_EVERY = 1000;
/** A world that answered none of this many askings is forgotten. */
const UNANSWERED = 2;

const css = {
  root: { padding: '8px 12px', fontSize: '12px', lineHeight: 1.5, fontFamily: 'inherit', color: 'inherit' },
  section: { margin: '0 0 8px' },
  summary: { cursor: 'pointer', fontWeight: 700, padding: '4px 0' },
  table: { borderCollapse: 'collapse', width: '100%' },
  cell: { textAlign: 'left', padding: '2px 8px 2px 0', verticalAlign: 'top', borderBottom: '1px solid rgba(128,128,128,.2)' },
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  bad: { color: '#d32f2f' },
  muted: { opacity: 0.6 },
} as const;

function Section({ title, count, open = true, children }: { title: string; count?: number; open?: boolean; children?: ComponentChildren }) {
  return h('details', { open, style: css.section, 'data-section': title }, h('summary', { style: css.summary }, count === undefined ? title : `${title} (${count})`), children);
}

interface Row {
  readonly key: string;
  readonly cells: readonly ComponentChildren[];
}

/** A table, its rows kept by their keys (what is open in a row stays with it). */
function Table({ head, rows }: { head: string[]; rows: readonly Row[] }) {
  return h(
    'table',
    { style: css.table },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        head.map((c) => h('th', { key: c, style: css.cell }, c)),
      ),
    ),
    h(
      'tbody',
      null,
      rows.map((r) =>
        h(
          'tr',
          { key: r.key, 'data-row': r.key },
          r.cells.map((c, j) => h('td', { key: j, style: css.cell }, c)),
        ),
      ),
    ),
  );
}

function addonStatus(a: AddonState) {
  if (!a.on) return h('span', { style: css.muted }, 'off');
  if (a.failed) return h('span', { style: css.bad }, `failed: ${a.failed}`);
  return a.running ? 'running' : 'stopped';
}

function Addons({ state, toggle }: { state: InspectorState; toggle: (id: string, on: boolean) => void }) {
  if (!state.addons.length) return h('p', { style: css.muted }, 'No addons in this story.');
  return h(Table, {
    head: ['', 'addon', 'priority', 'rights', 'status', 'says'],
    rows: state.addons.map((a) => ({
      key: a.id,
      cells: [
        h('input', { type: 'checkbox', checked: a.on, 'aria-label': `turn ${a.id} ${a.on ? 'off' : 'on'}`, onChange: () => toggle(a.id, !a.on) }),
        h('b', null, a.id),
        a.priority,
        a.rights.join(', ') || '—',
        addonStatus(a),
        a.says.length
          ? h(
              'ul',
              { style: { margin: 0, paddingLeft: '14px' } },
              a.says.map((s) =>
                h(
                  'li',
                  { key: `${s.kind}/${s.name}/${s.operation}`, style: css.mono },
                  `${s.operation} ${s.kind}/${s.name}`,
                  s.status === 'included' ? null : h('i', { style: css.muted }, ` ${s.status}`),
                ),
              ),
            )
          : '—',
      ],
    })),
  });
}

function Definitions({ state }: { state: InspectorState }) {
  const [filter, setFilter] = useState('');
  const shown = state.definitions.filter((d) => `${d.kind}/${d.name}`.toLowerCase().includes(filter.toLowerCase()));
  return h(
    'div',
    null,
    h('input', {
      type: 'search',
      placeholder: 'kind/name',
      value: filter,
      onInput: (e: Event) => setFilter((e.currentTarget as HTMLInputElement).value),
      style: { margin: '0 0 4px', font: 'inherit' },
    }),
    h(Table, {
      head: ['definition', 'defined by', 'who says each leaf'],
      rows: shown.map((d) => ({
        key: `${d.kind}/${d.name}`,
        cells: [
          h('span', { style: css.mono }, `${d.kind}/${d.name}`),
          d.definedBy,
          h(
            'details',
            null,
            h('summary', { style: { cursor: 'pointer' } }, summarize(d.says)),
            h(
              'ul',
              { style: { margin: 0, paddingLeft: '14px' } },
              Object.entries(d.says).map(([path, who]) => h('li', { key: path, style: css.mono }, `${path} ← ${who}`)),
            ),
            h('pre', { style: { ...css.mono, margin: '4px 0', whiteSpace: 'pre-wrap' } }, JSON.stringify(d.spec, null, 2)),
          ),
        ],
      })),
    }),
  );
}

/** Who says how many leaves: "app 3, images 1". */
function summarize(says: Readonly<Record<string, string>>): string {
  const by = new Map<string, number>();
  for (const who of Object.values(says)) by.set(who, (by.get(who) ?? 0) + 1);
  return [...by].map(([who, n]) => `${who} ${n}`).join(', ') || '—';
}

function Renders({ state, reset }: { state: InspectorState; reset: () => void }) {
  const [own, setOwn] = useState(false);
  const rows = Object.entries(state.renders)
    .filter(([name]) => own || !name.startsWith('Overweave.'))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return h(
    'div',
    null,
    h(
      'div',
      { style: { display: 'flex', gap: '12px', alignItems: 'center', margin: '0 0 4px' } },
      h('label', null, h('input', { type: 'checkbox', checked: own, onChange: () => setOwn(!own) }), ' overweave’s own'),
      h('button', { type: 'button', onClick: reset, style: { font: 'inherit' } }, 'count again'),
    ),
    rows.length
      ? h(Table, { head: ['component', 'renders'], rows: rows.map(([name, n]) => ({ key: name, cells: [h('span', { style: css.mono }, name), n] })) })
      : h('p', { style: css.muted }, 'Nothing rendered in this world since counting began.'),
  );
}

/** Whether what came over the channel is a world's state (anything else is left alone). */
const isState = (v: unknown): v is InspectorState =>
  typeof v === 'object' && v !== null && typeof (v as InspectorState).instance === 'string' && Array.isArray((v as InspectorState).addons);

/** The worlds told, by name, in the order first told — and how each was last told (the same again draws nothing again). */
function useWorlds(channel: Channel): ReadonlyMap<string, InspectorState> {
  const [worlds, setWorlds] = useState<ReadonlyMap<string, InspectorState>>(() => new Map());
  useEffect(() => {
    let asking = 0;
    const heard = new Map<string, number>();
    const last = new Map<string, string>();
    const forget = (instance: string) => {
      heard.delete(instance);
      last.delete(instance);
      setWorlds((prev) => {
        if (!prev.has(instance)) return prev;
        const next = new Map(prev);
        next.delete(instance);
        return next;
      });
    };
    const told = (state: unknown) => {
      if (!isState(state)) return;
      heard.set(state.instance, asking);
      const json = JSON.stringify(state);
      if (last.get(state.instance) === json) return;
      last.set(state.instance, json);
      setWorlds((prev) => new Map(prev).set(state.instance, state));
    };
    const gone = (what: unknown) => {
      const instance = (what as { instance?: unknown } | null)?.instance;
      if (typeof instance === 'string') forget(instance);
    };
    const ask = () => {
      asking++;
      for (const [instance, at] of heard) if (asking - at > UNANSWERED) forget(instance);
      channel.emit(EVENTS.request, {});
    };
    channel.on(EVENTS.state, told);
    channel.on(EVENTS.gone, gone);
    ask();
    const timer = setInterval(ask, ASK_EVERY);
    return () => {
      clearInterval(timer);
      channel.off(EVENTS.state, told);
      channel.off(EVENTS.gone, gone);
    };
  }, [channel]);
  return worlds;
}

/** The panel: the worlds of the story, one shown. */
export function Panel({ channel }: { channel: Channel }) {
  const worlds = useWorlds(channel);
  const [chosen, setChosen] = useState<string | null>(null);
  const list = [...worlds.values()];
  const state = (chosen ? worlds.get(chosen) : undefined) ?? list[0];
  const instance = state?.instance;
  const actions = useMemo(
    () => ({
      toggle: (id: string, on: boolean) => instance && channel.emit(EVENTS.toggle, { instance, id, on }),
      reset: () => instance && channel.emit(EVENTS.resetCounts, { instance }),
    }),
    [channel, instance],
  );
  if (!state) return h('div', { style: css.root }, h('p', { style: css.muted }, 'No overweave world in this story: draw one with <WorldStory>.'));
  return h(
    'div',
    { style: css.root },
    list.length > 1
      ? h(
          'label',
          { style: { display: 'block', margin: '0 0 6px' } },
          'World ',
          h(
            'select',
            {
              value: state.instance,
              'aria-label': 'world',
              onChange: (e: Event) => setChosen((e.currentTarget as HTMLSelectElement).value),
              style: { font: 'inherit' },
            },
            list.map((w, i) => h('option', { key: w.instance, value: w.instance }, `${i + 1}: ${w.drawn}`)),
          ),
        )
      : h('p', { style: { ...css.muted, margin: '0 0 6px' } }, `Drawn: ${state.drawn}`),
    state.problems.length
      ? h(
          Section,
          { title: 'Failed', count: state.problems.length },
          h(
            'ul',
            { style: { ...css.bad, margin: 0 } },
            state.problems.map((p, i) => h('li', { key: i }, `${p.what}: ${p.message}`)),
          ),
        )
      : null,
    h(Section, { title: 'Addons', count: state.addons.length }, h(Addons, { state, toggle: actions.toggle })),
    h(Section, { title: 'Definitions', count: state.definitions.length }, h(Definitions, { state })),
    state.refused.length || state.conflicts.length
      ? h(
          Section,
          { title: 'Refused and conflicts', count: state.refused.length + state.conflicts.length },
          h('ul', { style: { margin: 0 } }, [
            ...state.refused.map((r, i) => h('li', { key: `r${i}`, style: css.mono }, `${r.type}: ${r.contributor} → ${r.kind}/${r.name} (${r.codes.join(', ')})`)),
            ...state.conflicts.map((c, i) => h('li', { key: `c${i}`, style: css.mono }, `conflict: ${c.kind}/${c.name} ${c.path.join('.')} — ${c.contributors.join(' vs ')}`)),
          ]),
        )
      : null,
    h(Section, { title: 'Renders', open: false }, h(Renders, { state, reset: actions.reset })),
  );
}

/** The panel drawn into an element; what it gives back takes it away. */
export function mountPanel(element: Element, channel: Channel): () => void {
  render(h(Panel, { channel }), element);
  return () => render(null, element);
}
