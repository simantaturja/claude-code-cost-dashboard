import { fmtUSD, fmtTok, pct } from '../format.js';

export default function ModelsTable({ rows, totalCost }) {
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th className="num">Messages</th>
            <th className="num">Tokens</th>
            <th className="num">Cache read %</th>
            <th className="num">Cost</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.model}>
              <td className="mono">{m.model}</td>
              <td className="num">{m.messages}</td>
              <td className="num">{fmtTok(m.tokens)}</td>
              <td className="num">{pct(m.cacheRead, m.tokens)}</td>
              <td className="num">{fmtUSD(m.costUSD)}</td>
              <td className="num text-muted">{pct(m.costUSD, totalCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
