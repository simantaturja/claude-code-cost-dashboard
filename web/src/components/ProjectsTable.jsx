import { fmtUSD, fmtTok, pct, shortProject } from '../format.js';

export default function ProjectsTable({ rows, totalCost }) {
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th className="num">Sessions</th>
            <th className="num">Tokens</th>
            <th className="num">Cost</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.project}>
              <td title={p.project}>{shortProject(p.project)}</td>
              <td className="num">{p.sessionCount}</td>
              <td className="num">{fmtTok(p.tokens)}</td>
              <td className="num">{fmtUSD(p.costUSD)}</td>
              <td className="num text-muted">{pct(p.costUSD, totalCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
