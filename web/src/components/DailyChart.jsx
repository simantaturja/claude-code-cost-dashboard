import { useRef, useState } from 'react';
import { fmtUSD, fmtTok } from '../format.js';

const W = 1080;
const H = 220;
const PAD = { t: 12, r: 6, b: 30, l: 52 };
const GAP = 2; // surface gap between adjacent bars
const RADIUS = 4; // rounded data-end

// Path with rounded top corners, square at the baseline.
function barPath(x, y, w, h) {
  const r = Math.min(RADIUS, w / 2, h);
  if (h <= 0) return '';
  return (
    `M${x},${y + h}` +
    `L${x},${y + r}` +
    `Q${x},${y} ${x + r},${y}` +
    `L${x + w - r},${y}` +
    `Q${x + w},${y} ${x + w},${y + r}` +
    `L${x + w},${y + h}Z`
  );
}

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); };
const mondayOf = (d) => { const c = new Date(d); c.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return c; };

const MODES = [
  { id: 'day', label: 'Day', range: 'last 90 days' },
  { id: 'week', label: 'Week', range: 'last 26 weeks' },
  { id: 'month', label: 'Month', range: 'last 12 months' },
];

// Build a continuous, zero-filled series for the given mode from the daily array
// ({date:'YYYY-MM-DD', costUSD, tokens}, ascending). All math is local-time, so
// gaps read as empty slots instead of collapsing adjacent active periods.
function buildSeries(daily, mode) {
  if (!daily.length) return [];
  const newest = parse(daily[daily.length - 1].date);

  if (mode === 'day') {
    const byKey = new Map(daily.map((d) => [d.date, d]));
    const out = [];
    for (let i = 89; i >= 0; i--) {
      const cur = new Date(newest);
      cur.setDate(newest.getDate() - i);
      const key = dateKey(cur);
      const d = byKey.get(key) || { costUSD: 0, tokens: 0 };
      out.push({ key, label: key.slice(5), tip: key, costUSD: d.costUSD, tokens: d.tokens });
    }
    return out;
  }

  if (mode === 'week') {
    const agg = new Map();
    for (const d of daily) {
      const k = dateKey(mondayOf(parse(d.date)));
      const e = agg.get(k) || { costUSD: 0, tokens: 0 };
      e.costUSD += d.costUSD; e.tokens += d.tokens; agg.set(k, e);
    }
    const end = mondayOf(newest);
    const out = [];
    for (let i = 25; i >= 0; i--) {
      const cur = new Date(end);
      cur.setDate(end.getDate() - i * 7);
      const key = dateKey(cur);
      const e = agg.get(key) || { costUSD: 0, tokens: 0 };
      out.push({ key, label: key.slice(5), tip: `week of ${key}`, costUSD: e.costUSD, tokens: e.tokens });
    }
    return out;
  }

  // month
  const agg = new Map();
  for (const d of daily) {
    const k = d.date.slice(0, 7);
    const e = agg.get(k) || { costUSD: 0, tokens: 0 };
    e.costUSD += d.costUSD; e.tokens += d.tokens; agg.set(k, e);
  }
  const out = [];
  for (let i = 11; i >= 0; i--) {
    const cur = new Date(newest.getFullYear(), newest.getMonth() - i, 1);
    const key = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}`;
    const e = agg.get(key) || { costUSD: 0, tokens: 0 };
    out.push({ key, label: key, tip: key, costUSD: e.costUSD, tokens: e.tokens });
  }
  return out;
}

export default function DailyChart({ daily }) {
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [mode, setMode] = useState('day');

  const rows = buildSeries(daily, mode);
  const range = MODES.find((m) => m.id === mode).range;

  const max = Math.max(...rows.map((d) => d.costUSD), 0.01);
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const band = rows.length ? plotW / rows.length : plotW;
  const barW = Math.max(band - GAP, 1);
  const labelStep = Math.max(1, Math.ceil(rows.length / 13));

  const gridlines = [0, 1, 2, 3].map((i) => {
    const v = (max * i) / 3;
    const y = H - PAD.b - (plotH * i) / 3;
    return { v, y };
  });

  function onEnter(e, d, i) {
    const svg = e.currentTarget.ownerSVGElement;
    const wrap = wrapRef.current;
    if (!svg || !wrap) return;
    const scale = svg.getBoundingClientRect().width / W;
    const wrapBox = wrap.getBoundingClientRect();
    const svgBox = svg.getBoundingClientRect();
    const barH = (plotH * d.costUSD) / max;
    const cx = PAD.l + i * band + barW / 2;
    const topY = H - PAD.b - barH;
    setHover({
      i,
      d,
      x: svgBox.left - wrapBox.left + cx * scale,
      y: svgBox.top - wrapBox.top + topY * scale - 8,
    });
  }

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <div className="chart-head">
        <span className="chart-range">Spend — {range}</span>
        <div className="seg" role="group" aria-label="Chart granularity">
          {MODES.map((m) => (
            <button
              key={m.id}
              className={'seg-btn' + (m.id === mode ? ' is-active' : '')}
              aria-pressed={m.id === mode}
              onClick={() => { setMode(m.id); setHover(null); }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {!rows.length ? (
        <div className="empty">No spend recorded yet.</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Spend, ${range}`}>
          {gridlines.map(({ v, y }, i) => (
            <g key={i}>
              <line className="grid-line" x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} />
              <text x={PAD.l - 8} y={y + 3} textAnchor="end">
                ${v.toFixed(v < 10 ? 1 : 0)}
              </text>
            </g>
          ))}
          {rows.map((d, i) => {
            const barH = (plotH * d.costUSD) / max;
            const x = PAD.l + i * band + (band - barW) / 2;
            const y = H - PAD.b - barH;
            return (
              <g key={d.key}>
                <path
                  className={'bar' + (hover && hover.i === i ? ' is-hover' : '')}
                  d={barPath(x, y, barW, barH)}
                />
                {i % labelStep === 0 && (
                  <text x={PAD.l + i * band} y={H - 10}>
                    {d.label}
                  </text>
                )}
                <rect
                  x={PAD.l + i * band}
                  y={PAD.t}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={(e) => onEnter(e, d, i)}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {hover && (
        <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
          <div className="t-date">{hover.d.tip}</div>
          <div>
            {fmtUSD(hover.d.costUSD)} · {fmtTok(hover.d.tokens)} tok
          </div>
        </div>
      )}
    </div>
  );
}
