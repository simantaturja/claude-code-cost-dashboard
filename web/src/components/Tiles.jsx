import { fmtUSD, fmtTok } from '../format.js';

function monthName(month) {
  const [y, m] = month.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', { month: 'long' });
}

export default function Tiles({ summary, roi }) {
  const readShare = summary.totalTokens ? summary.cacheReadTokens / summary.totalTokens : 0;
  const heroCost = fmtUSD(summary.totalCostUSD).replace('$', '');
  const last = roi.months[roi.months.length - 1];
  const ceiling = Math.max(1, ...roi.months.map((m) => m.multiple));
  const fillPct = last ? Math.min(100, (last.multiple / ceiling) * 100) : 0;
  const breakEvenPct = Math.min(100, (1 / ceiling) * 100);

  const tiles = [
    [fmtTok(summary.totalTokens), 'Total tokens'],
    [String(summary.sessionCount), `Sessions across ${summary.projectCount} projects`],
    [fmtUSD(summary.cacheSavingsUSD), 'Saved by prompt cache'],
    [(readShare * 100).toFixed(1) + '%', 'Tokens served from cache'],
  ];

  return (
    <>
      <section className="hero">
        <div className="hero-figure">
          <div className="eyebrow">Total API-equivalent value</div>
          <div className="value">
            <span className="unit">$</span>
            {heroCost}
          </div>
          <div className="sub">Usage priced at current Anthropic API rates</div>
        </div>

        {last && (
          <div className="meter">
            <div className="meter-head">
              <span className="meter-title">
                {monthName(last.month)} value vs ${roi.subscriptionUSDPerMonth}/mo plan
                {!roi.configured && ' (default)'}
              </span>
              <span className="meter-read">
                {last.multiple.toFixed(1)}
                <span className="x">×</span>
              </span>
            </div>
            <div className="track">
              <div className="fill" style={{ width: fillPct + '%' }} />
              <div
                className="break-even"
                style={{
                  position: 'absolute',
                  left: breakEvenPct + '%',
                  top: 0,
                  bottom: 0,
                  width: '2px',
                  background: 'var(--surface)',
                }}
                title="Break-even (1×)"
              />
            </div>
            <div className="ticks">
              <span>0×</span>
              <span>break-even 1×</span>
              <span>{ceiling.toFixed(1)}×</span>
            </div>
            <div className="meter-note">
              {monthName(last.month)} returned {fmtUSD(last.valueUSD)} of API-equivalent value.
              {!roi.configured &&
                ` Multiple assumes a $${roi.subscriptionUSDPerMonth}/mo plan — set subscriptionUSDPerMonth in config.json to match yours.`}
            </div>
          </div>
        )}
      </section>

      <div className="tiles">
        {tiles.map(([v, l]) => (
          <div className="tile" key={l}>
            <div className="v">{v}</div>
            <div className="l">{l}</div>
          </div>
        ))}
      </div>
    </>
  );
}
