import { fmtUSD, shortProject } from '../format.js';

export default function AdvisorTable({ rows }) {
  if (!rows.length) {
    return <div className="empty">No flagged sessions. Usage looks efficient.</div>;
  }
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Session</th>
            <th className="num">Date</th>
            <th className="num">Cost</th>
            <th className="num" title="Quota/capacity value at API-equivalent pricing — not money saved on a subscription.">Est. capacity</th>
            <th>Reasons</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.sessionId}>
              <td title={a.project}>{shortProject(a.project)}</td>
              <td className="mono">{a.sessionId.slice(0, 8)}</td>
              <td className="num">{(a.lastTimestamp || '').slice(0, 10)}</td>
              <td className="num">{fmtUSD(a.costUSD)}</td>
              <td className="num">{a.estSavingUSD ? fmtUSD(a.estSavingUSD) : '—'}</td>
              <td style={{ whiteSpace: 'normal' }}>
                {a.reasons.map((r, i) => (
                  <div key={i}>
                    <div>
                      <span
                        className="mr-1 inline-block rounded-[3px] border border-line bg-surface-2 px-[5px] py-px font-mono text-[10px] font-semibold uppercase leading-[1.4] tracking-[0.02em] text-muted"
                        title="Rule that triggered this advice"
                      >
                        {r.rule}
                      </span>{' '}
                      {r.text}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{r.action}</div>
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
