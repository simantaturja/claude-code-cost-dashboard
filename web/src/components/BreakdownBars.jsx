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
    <div className="viz-panel">
      <div className="hbars">
        {bars.map((b) => (
          <div
            className={'hbar' + (b.muted ? ' is-muted' : '')}
            key={b.key}
            title={`${b.full}\n${fmtUSD(b.costUSD)} · ${fmtTok(b.tokens)} tokens · ${b.sessions} session${b.sessions === 1 ? '' : 's'}`}
          >
            <span className="hbar-label">{b.label}</span>
            <div className="hbar-track">
              <div className="hbar-fill" style={{ width: (b.costUSD / max) * 100 + '%' }} />
            </div>
            <span className="hbar-val">
              {fmtUSD(b.costUSD)}
              <span className="hbar-share">{pct(b.costUSD, totalCost)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
