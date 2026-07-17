import { fmtUSD, pct } from '../format.js';

// Where spend splits across models, as one 100%-stacked share bar + legend.
// Monochrome ordinal ramp (validated light+dark via the dataviz script) — biggest
// share = most ink; 2px surface gaps keep segments distinct. Top 3 + "Other".
const shortModel = (m) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '');

export default function ModelSplit({ rows, totalCost }) {
  const priced = rows.filter((m) => m.costUSD > 0).sort((a, b) => b.costUSD - a.costUSD);
  if (!priced.length) return null;

  const head = priced.slice(0, 3);
  const tail = priced.slice(3);
  const segs = head.map((m, i) => ({
    key: m.model,
    label: shortModel(m.model),
    costUSD: m.costUSD,
    slot: i + 1,
  }));
  if (tail.length) {
    segs.push({
      key: '__other__',
      label: `Other (${tail.length})`,
      costUSD: tail.reduce((s, m) => s + m.costUSD, 0),
      slot: 4,
    });
  }

  const total = segs.reduce((s, x) => s + x.costUSD, 0) || 1;

  return (
    <div className="viz-panel">
      <div className="split-bar" role="img" aria-label="Spend share by model">
        {segs.map((s) => (
          <div
            key={s.key}
            className={`split-seg seg-${s.slot}`}
            style={{ flexGrow: s.costUSD }}
            title={`${s.label} — ${fmtUSD(s.costUSD)} · ${pct(s.costUSD, totalCost)}`}
          />
        ))}
      </div>
      <ul className="split-legend">
        {segs.map((s) => (
          <li key={s.key}>
            <span className={`dot seg-${s.slot}`} />
            <span className="split-name">{s.label}</span>
            <span className="split-num">
              {fmtUSD(s.costUSD)}
              <span className="split-pct">{((s.costUSD / total) * 100).toFixed(1)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
