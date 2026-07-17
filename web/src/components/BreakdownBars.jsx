import { fmtUSD, fmtTok, pct, shortProject } from '../format.js';

// Horizontal magnitude bars for the top spenders, biggest first, with the long
// tail rolled into one "Other" row so the chart never grows unbounded. Single
// hue — this is one measure (cost), so identity color would be noise.
export default function BreakdownBars({ rows, totalCost, topN = 8 }) {
  const sorted = [...rows].sort((a, b) => b.costUSD - a.costUSD);
  const head = sorted.slice(0, topN);
  const tail = sorted.slice(topN);

  const bars = head.map((p) => ({
    key: p.project,
    label: shortProject(p.project),
    full: p.project,
    costUSD: p.costUSD,
    tokens: p.tokens,
    sessions: p.sessionCount,
  }));

  if (tail.length) {
    bars.push({
      key: '__other__',
      label: `Other (${tail.length} project${tail.length > 1 ? 's' : ''})`,
      full: `${tail.length} smaller projects`,
      costUSD: tail.reduce((s, p) => s + p.costUSD, 0),
      tokens: tail.reduce((s, p) => s + p.tokens, 0),
      sessions: tail.reduce((s, p) => s + p.sessionCount, 0),
      muted: true,
    });
  }

  const max = Math.max(...bars.map((b) => b.costUSD), 0.01);

  return (
    <div className="mb-3.5 rounded-panel border border-line bg-surface px-5 py-[18px] shadow-panel">
      <div className="grid gap-[11px]">
        {bars.map((b) => (
          <div
            className="grid grid-cols-[minmax(96px,190px)_1fr_minmax(112px,auto)] items-center gap-3.5"
            key={b.key}
            title={`${b.full}\n${fmtUSD(b.costUSD)} · ${fmtTok(b.tokens)} tokens · ${b.sessions} session${b.sessions === 1 ? '' : 's'}`}
          >
            <span
              className={
                'overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] ' +
                (b.muted ? 'text-muted' : 'text-ink')
              }
            >
              {b.label}
            </span>
            <div className="h-[11px] overflow-hidden rounded-[4px] bg-surface-2">
              <div
                className={
                  'h-full min-w-[3px] rounded-r-[4px] transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ' +
                  (b.muted ? 'bg-cat-other' : 'bg-chart')
                }
                style={{ width: (b.costUSD / max) * 100 + '%' }}
              />
            </div>
            <span className="whitespace-nowrap text-right font-mono text-[12.5px] font-medium text-ink tabular-nums">
              {fmtUSD(b.costUSD)}
              <span className="ml-2 font-normal text-faint">{pct(b.costUSD, totalCost)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
