import { fmtUSD, pct } from '../format.js';

// Where spend splits across models, as one 100%-stacked share bar + legend.
// Models are identity, so segments use fixed categorical slots (validated
// light+dark via the dataviz script); "Other" stays neutral gray. 2px surface
// gaps keep segments distinct. Top 3 + "Other".
const shortModel = (m) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '');

// Fixed categorical slot → utility class; slot 4 is always the neutral "Other".
const SLOT_BG = { 1: 'bg-cat-1', 2: 'bg-cat-2', 3: 'bg-cat-3', 4: 'bg-cat-other' };

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
    <div className="mb-3.5 rounded-panel border border-line bg-surface px-5 py-[18px] shadow-panel">
      <div
        className="flex h-[18px] gap-0.5 overflow-hidden rounded-[5px] bg-surface-2"
        role="img"
        aria-label="Spend share by model"
      >
        {segs.map((s) => (
          <div
            key={s.key}
            className={`min-w-[3px] transition-[flex-grow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${SLOT_BG[s.slot]}`}
            style={{ flexGrow: s.costUSD }}
            title={`${s.label} — ${fmtUSD(s.costUSD)} · ${pct(s.costUSD, totalCost)}`}
          />
        ))}
      </div>
      <ul className="mt-3.5 grid list-none grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-5 gap-y-2 p-0">
        {segs.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-[12.5px]">
            <span className={`h-2.5 w-2.5 flex-none rounded-[3px] ${SLOT_BG[s.slot]}`} />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-ink">{s.label}</span>
            <span className="ml-auto whitespace-nowrap font-mono text-xs font-medium text-muted tabular-nums">
              {fmtUSD(s.costUSD)}
              <span className="ml-2 font-normal text-faint">{((s.costUSD / total) * 100).toFixed(1)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
