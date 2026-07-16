import { shortProject } from '../format.js';

// A one-liner shown in both states so a first-time viewer knows what "waste"
// means and why the counts matter before reading any number.
function Intro() {
  return (
    <>
      <p className="waste-intro">
        Tool calls that <strong>failed and were retried</strong>, and files{' '}
        <strong>re-read when the answer was already in context</strong> — quota you
        paid for but didn&apos;t need. Shown as counts, not dollars: token usage is
        logged per message, not per tool call.
      </p>
      <p className="waste-method">
        How it&apos;s measured: an errored tool call is a tool result the log marks
        as an error; a redundant read is the same file read again with no edit in
        between (re-reading after an edit is expected, so it isn&apos;t counted).
      </p>
    </>
  );
}

// Exact counts only — token usage is per-message, not per-tool-block, so there
// is no honest per-tool dollar figure to show here.
export default function WasteTable({ rows }) {
  if (!rows || (!rows.erroredToolCalls && !rows.redundantReads)) {
    return (
      <>
        <Intro />
        <div className="empty">No repeated waste detected — tool calls mostly succeeded and context was reused.</div>
      </>
    );
  }

  return (
    <>
      <Intro />
      <p className="waste-summary">
        {rows.erroredToolCalls.toLocaleString('en-US')} errored tool calls ·{' '}
        {rows.redundantReads.toLocaleString('en-US')} redundant file reads across{' '}
        {rows.duplicateFileCount.toLocaleString('en-US')} file
        {rows.duplicateFileCount === 1 ? '' : 's'}.
      </p>

      {rows.erroredByTool.length > 0 && (
        <>
          <h2 className="section-label">Errored tool calls by tool</h2>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th className="num">Errors</th>
                </tr>
              </thead>
              <tbody>
                {rows.erroredByTool.map((t) => (
                  <tr key={t.name}>
                    <td>{t.name}</td>
                    <td className="num">{t.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {rows.topDuplicateFiles.length > 0 && (
        <>
          <h2 className="section-label">Most re-read files</h2>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th className="num">Redundant reads</th>
                </tr>
              </thead>
              <tbody>
                {rows.topDuplicateFiles.map((f) => (
                  <tr key={f.path}>
                    <td title={f.path}>{shortProject(f.path)}</td>
                    <td className="num">{f.extraReads}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {rows.byProject.length > 0 && (
        <>
          <h2 className="section-label">By project</h2>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th className="num">Errored calls</th>
                  <th className="num">Redundant reads</th>
                </tr>
              </thead>
              <tbody>
                {rows.byProject.map((p) => (
                  <tr key={p.project}>
                    <td title={p.project}>{shortProject(p.project)}</td>
                    <td className="num">{p.erroredToolCalls}</td>
                    <td className="num">{p.redundantReads}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
