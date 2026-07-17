const W = 1080;
const H = 160;
const PAD = { t: 10, r: 6, b: 22, l: 34 };
const GAP = 2;
const DAYS = 30;

const pad2 = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parse = (s) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); };

// Zero-filled last-30-days series so gaps read as empty bars, not a squeezed timeline.
function buildSeries(trend) {
  if (!trend.length) return [];
  const newest = parse(trend[trend.length - 1].date);
  const byKey = new Map(trend.map((d) => [d.date, d]));
  const out = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const cur = new Date(newest);
    cur.setDate(newest.getDate() - i);
    const key = dateKey(cur);
    const d = byKey.get(key) || { erroredToolCalls: 0, redundantReads: 0 };
    out.push({ key, label: key.slice(5), erroredToolCalls: d.erroredToolCalls, redundantReads: d.redundantReads });
  }
  return out;
}

// Stacked daily bars: errored tool calls (retried) below, redundant reads above.
// A quick way to see whether waste is trending up or down, not just the total.
export default function WasteTrend({ trend }) {
  const rows = buildSeries(trend || []);
  if (!rows.length) return null;

  const max = Math.max(...rows.map((d) => d.erroredToolCalls + d.redundantReads), 1);
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const band = plotW / rows.length;
  const barW = Math.max(band - GAP, 1);
  const labelStep = Math.max(1, Math.ceil(rows.length / 10));

  return (
    <div className="chart relative rounded-panel border border-line bg-surface px-[18px] pb-2 pt-4 shadow-panel">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs text-muted">Waste trend — last {DAYS} days</span>
        <span className="inline-flex items-center gap-[5px] text-xs text-muted">
          <span className="inline-block h-2 w-2 rounded-full bg-danger" /> errored calls{' '}
          <span className="ml-2.5 inline-block h-2 w-2 rounded-full bg-chart" /> redundant reads
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Waste trend, last ${DAYS} days`}>
        <line className="grid-line" x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} />
        {rows.map((d, i) => {
          const x = PAD.l + i * band + (band - barW) / 2;
          const errH = (plotH * d.erroredToolCalls) / max;
          const redH = (plotH * d.redundantReads) / max;
          const errY = H - PAD.b - errH;
          const redY = errY - redH;
          return (
            <g key={d.key}>
              {d.erroredToolCalls > 0 && <rect className="bar-error" x={x} y={errY} width={barW} height={errH} />}
              {d.redundantReads > 0 && <rect className="bar-redundant" x={x} y={redY} width={barW} height={redH} />}
              {(d.erroredToolCalls > 0 || d.redundantReads > 0) && (
                <title>{`${d.key}: ${d.erroredToolCalls} errored, ${d.redundantReads} redundant`}</title>
              )}
              {i % labelStep === 0 && (
                <text x={PAD.l + i * band} y={H - 8}>
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
