// The coverage of the last `npm run coverage` (coverage/coverage-summary.json), as a table: in CI the
// job's summary, a warning for each figure under 80% — told, never failing the run.
import { appendFileSync, readFileSync } from 'node:fs';

const WARN_UNDER = 80;
const METRICS = ['lines', 'statements', 'functions', 'branches'];

const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const rows = [['all', summary.total]];
for (const name of ['core', 'ui', 'testkit', 'storybook']) {
  const files = Object.entries(summary).filter(([file]) => file.includes(`/packages/${name}/`));
  const total = Object.fromEntries(
    METRICS.map((m) => [m, files.reduce((sum, [, f]) => ({ total: sum.total + f[m].total, covered: sum.covered + f[m].covered }), { total: 0, covered: 0 })]),
  );
  for (const m of METRICS) total[m].pct = total[m].total ? Math.round((total[m].covered / total[m].total) * 10000) / 100 : 100;
  rows.push([name, total]);
}

const low = [];
const cell = (who, m, figure) => {
  if (figure.pct >= WARN_UNDER) return `${figure.pct}%`;
  low.push(`${who}: ${m} ${figure.pct}%`);
  return `⚠️ ${figure.pct}%`;
};
const table = [
  '### Coverage',
  '',
  `| | ${METRICS.join(' | ')} |`,
  `|---|${METRICS.map(() => '---:').join('|')}|`,
  ...rows.map(([who, t]) => `| ${who} | ${METRICS.map((m) => cell(who, m, t[m])).join(' | ')} |`),
  '',
].join('\n');

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
else console.log(table);
for (const figure of low) console.log(`::warning title=Coverage under ${WARN_UNDER}%::${figure}`);
