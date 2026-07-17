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
    [fmtTok(summary.totalTokens), 'Total tokens', false],
    [String(summary.sessionCount), `Sessions across ${summary.projectCount} projects`, false],
    [fmtUSD(summary.cacheSavingsUSD), 'Saved by prompt cache', true],
    [(readShare * 100).toFixed(1) + '%', 'Tokens served from cache', false],
  ];

  return (
    <>
      <section className="statement">
        <div className="statement-main">
          <div className="eyebrow">API-equivalent value delivered</div>
          <div className="statement-figure">
            <span className="cur">$</span>
            <span className="amt">{heroCost}</span>
          </div>
          <p className="statement-sub">
            Everything Claude Code did for you, priced at current Anthropic API rates.
          </p>
        </div>

        {last && (
          <div className="roi">
            <div className="roi-head">
              <span className="roi-mult">
                {last.multiple.toFixed(1)}
                <span className="x">×</span>
              </span>
              <span className="roi-title">
                return on your <b>${roi.subscriptionUSDPerMonth}/mo</b> plan
                {!roi.configured && ' (default)'}
              </span>
            </div>
            <div className="value-bar">
              <div className="fill" style={{ width: fillPct + '%' }} />
              <div className="breakeven" style={{ left: breakEvenPct + '%' }} title="Break-even (1×)" />
            </div>
            <div className="value-ticks">
              <span>0×</span>
              <span className="be">break-even 1×</span>
              <span>{ceiling.toFixed(1)}×</span>
            </div>
            <p className="roi-note">
              {monthName(last.month)} returned <b>{fmtUSD(last.valueUSD)}</b> of value — {last.multiple.toFixed(1)}× what you paid.
              {!roi.configured && (
                <span className="cfg">
                  Multiple assumes a ${roi.subscriptionUSDPerMonth}/mo plan — set subscriptionUSDPerMonth in config.json to match yours.
                </span>
              )}
            </p>
          </div>
        )}
      </section>

      <div className="tiles">
        {tiles.map(([v, l, gain]) => (
          <div className={'tile' + (gain ? ' is-gain' : '')} key={l}>
            <div className="v">{v}</div>
            <div className="l">{l}</div>
          </div>
        ))}
      </div>
    </>
  );
}
