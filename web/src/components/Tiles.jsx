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
      <section className="grid grid-cols-1 gap-[26px] rounded-card border border-line bg-surface px-[22px] py-6 shadow-hero md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-10 md:px-8 md:pb-[26px] md:pt-[30px]">
        <div className="flex min-w-0 flex-col justify-center">
          <div className="font-mono text-[10.5px] font-semibold uppercase leading-none tracking-[0.16em] text-chart">
            API-equivalent value delivered
          </div>
          <div className="mb-2.5 mt-4 flex items-baseline gap-1 leading-[0.94] text-ink tabular-nums">
            <span className="mt-[5px] self-start font-mono text-[28px] leading-none text-faint">$</span>
            <span className="font-mono text-[58px] font-semibold leading-[0.94] tracking-[-0.045em]">{heroCost}</span>
          </div>
          <div className="graticule mb-3 mt-0.5 max-w-[420px]" aria-hidden="true" />
          <p className="max-w-[44ch] text-[13px] text-muted">
            Everything Claude Code did for you, priced at current Anthropic API rates.
          </p>
        </div>

        {last && (
          <div className="min-w-0 self-center">
            <div className="mb-3.5 flex items-end justify-between gap-3">
              <span className="font-mono text-[44px] font-semibold leading-[0.9] tracking-[-0.03em] text-gain tabular-nums">
                {last.multiple.toFixed(1)}
                <span className="ml-0.5 text-2xl font-normal text-muted">×</span>
              </span>
              <span className="max-w-[20ch] text-right text-xs leading-[1.4] text-muted">
                return on your <b className="font-semibold text-ink">${roi.subscriptionUSDPerMonth}/mo</b> plan
                {!roi.configured && ' (default)'}
              </span>
            </div>
            <div className="value-scale relative h-3 overflow-hidden rounded-[3px]">
              <div
                className="absolute inset-y-0 left-0 rounded-l-[3px] bg-gain opacity-85"
                style={{ width: fillPct + '%' }}
              />
              <div
                className="absolute -bottom-0.5 -top-0.5 w-0.5 bg-ink"
                style={{ left: breakEvenPct + '%' }}
                title="Break-even (1×)"
              />
            </div>
            <div className="mt-[7px] flex justify-between font-mono text-[10px] leading-none tracking-[0.02em] text-faint">
              <span>0×</span>
              <span className="text-muted">break-even 1×</span>
              <span>{ceiling.toFixed(1)}×</span>
            </div>
            <p className="mt-3.5 text-[12.5px] leading-[1.55] text-muted">
              {monthName(last.month)} returned <b className="font-semibold text-gain">{fmtUSD(last.valueUSD)}</b> of value — {last.multiple.toFixed(1)}× what you paid.
              {!roi.configured && (
                <span className="mt-1 block text-[11.5px] text-faint">
                  Multiple assumes a ${roi.subscriptionUSDPerMonth}/mo plan — set subscriptionUSDPerMonth in config.json to match yours.
                </span>
              )}
            </p>
          </div>
        )}
      </section>

      <div className="mt-[18px] grid grid-cols-2 border-y border-rule md:grid-cols-4">
        {tiles.map(([v, l, gain], i) => (
          <div
            className={
              'min-w-0 border-line px-[18px] pb-[15px] pt-4 ' +
              (i % 2 === 1 ? 'border-l ' : '') +
              (i >= 2 ? 'max-md:border-t ' : '') +
              (i > 0 ? 'md:border-l' : '')
            }
            key={l}
          >
            <div
              className={
                'font-mono text-[23px] font-medium leading-[1.15] tracking-[-0.02em] tabular-nums ' +
                (gain ? 'text-gain' : 'text-ink')
              }
            >
              {v}
            </div>
            <div className="mt-1 text-xs text-muted">{l}</div>
          </div>
        ))}
      </div>
    </>
  );
}
