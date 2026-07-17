import { shortProject } from '../format.js';
import WasteTrend from './WasteTrend.jsx';

// Human labels for the reason slugs classifyErrorReason() (lib/core.js) emits.
// 'other' covers everything not confidently matched (e.g. a bare shell exit
// code) — left uncategorized rather than guessed.
const REASON_LABELS = {
  'edit-before-read': 'Edited a file before reading it',
  'edit-string-not-found': 'Edit: replacement text not found',
  'stale-read': 'File changed since it was read',
  'file-not-found': 'File does not exist',
  'user-rejected': 'Rejected by user',
  'auto-mode-denied': 'Blocked by auto mode',
  'model-unavailable': 'Model temporarily unavailable',
  'cwd-deleted': 'Working directory was deleted',
  other: 'Other (e.g. shell exit code)',
};

// A one-liner shown in both states so a first-time viewer knows what "waste"
// means and why the counts matter before reading any number.
const METHOD_CLS = 'mb-3 max-w-[60ch] text-xs leading-[1.6] text-muted opacity-85';

function Intro() {
  return (
    <>
      <p className="mb-2 mt-1 max-w-[60ch] text-[13px] leading-[1.6] text-muted">
        Tool calls that <strong>failed and were retried</strong>, and files{' '}
        <strong>re-read when the answer was already in context</strong> — quota you
        paid for but didn&apos;t need. Shown as counts, not dollars: token usage is
        logged per message, not per tool call.
      </p>
      <p className={METHOD_CLS}>
        How it&apos;s measured: an errored tool call is a tool result the log marks
        as an error, counted only when the same tool is called again afterward
        (a retry); a redundant read is the same file read whole again with no
        edit or shell command in between (partial reads and re-reads after a
        change are expected, so they aren&apos;t counted).
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
      <p className="mb-3 mt-1 text-[13px] leading-normal text-muted">
        {rows.erroredToolCalls.toLocaleString('en-US')} errored tool calls ·{' '}
        {rows.redundantReads.toLocaleString('en-US')} redundant file reads across{' '}
        {rows.duplicateFileCount.toLocaleString('en-US')} file
        {rows.duplicateFileCount === 1 ? '' : 's'}.
      </p>

      <WasteTrend trend={rows.trend} />

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

      {rows.erroredByReason.length > 0 && (
        <>
          <h2 className="section-label">Errored tool calls by reason</h2>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Reason</th>
                  <th className="num">Errors</th>
                </tr>
              </thead>
              <tbody>
                {rows.erroredByReason.map((r) => (
                  <tr key={r.reason}>
                    <td>{REASON_LABELS[r.reason] || r.reason}</td>
                    <td className="num">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {rows.errorSamples && rows.errorSamples.length > 0 && (
        <>
          <h2 className="section-label">What the errors were</h2>
          <p className={METHOD_CLS}>
            A few concrete examples per failure kind — the command or file that
            failed and the message it returned. Recognizable credentials (keyed
            flags, tokens, auth headers) are redacted — review before sharing.
          </p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Command / target</th>
                  <th>What went wrong</th>
                </tr>
              </thead>
              <tbody>
                {rows.errorSamples.map((e, i) => (
                  <tr key={`${e.tool}-${e.reason}-${i}`}>
                    <td>{e.tool}</td>
                    <td><code title={e.target}>{e.target || '—'}</code></td>
                    <td title={e.text}>{REASON_LABELS[e.reason] || e.reason}{e.text ? `: ${e.text}` : ''}</td>
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
