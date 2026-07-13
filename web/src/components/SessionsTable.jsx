import { Fragment, useEffect, useMemo, useState } from 'react';
import { fmtUSD, fmtTok, sumTok, shortProject } from '../format.js';

const TRUNCATE = 200;

function fmtTurnTime(ts) {
  if (!ts) return '—';
  return ts.slice(0, 10) + ' ' + ts.slice(11, 16);
}

function Turn({ t }) {
  const [full, setFull] = useState(false);
  const long = t.prompt.length > TRUNCATE;
  const text = full || !long ? t.prompt : t.prompt.slice(0, TRUNCATE) + '…';
  return (
    <li className={'turn' + (t.flagged ? ' is-flagged' : '')}>
      <div className="turn-head">
        <span className="turn-time mono">{fmtTurnTime(t.timestamp)}</span>
        {t.flagged && <span className="turn-tag">continuation</span>}
        <span className="turn-cost mono">{fmtUSD(t.costUSD)}</span>
      </div>
      <div
        className={'turn-prompt' + (long ? ' is-clickable' : '')}
        onClick={long ? () => setFull((v) => !v) : undefined}
        title={long ? (full ? 'Click to collapse' : 'Click to expand') : undefined}
      >
        {text}
      </div>
      <div className="turn-meta">
        <span>in {fmtTok(t.tokens.input)}</span>
        <span>out {fmtTok(t.tokens.output)}</span>
        {t.subagentCostUSD > 0 && (
          <span className="turn-sub">subagent {fmtUSD(t.subagentCostUSD)}</span>
        )}
        {t.models.length > 0 && <span className="turn-models mono">{t.models.join(', ')}</span>}
      </div>
    </li>
  );
}

function PromptTimeline({ sessionKey }) {
  const [state, setState] = useState({ status: 'loading', turns: null, error: null });

  useEffect(() => {
    let live = true;
    setState({ status: 'loading', turns: null, error: null });
    fetch(`/api/session?key=${encodeURIComponent(sessionKey)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => live && setState({ status: 'ready', turns: d.turns, error: null }))
      .catch((e) => live && setState({ status: 'error', turns: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [sessionKey]);

  if (state.status === 'loading') return <div className="turn-note">Loading prompts…</div>;
  if (state.status === 'error') {
    return <div className="turn-note">Could not load prompts: {state.error}</div>;
  }
  if (!state.turns.length) return <div className="turn-note">No prompts recorded.</div>;
  return (
    <ol className="timeline">
      {state.turns.map((t, i) => (
        <Turn key={i} t={t} />
      ))}
    </ol>
  );
}

function SessionDetail({ s }) {
  const models = Object.entries(s.models).sort((a, b) => b[1].costUSD - a[1].costUSD);
  return (
    <div className="detail-inner">
      <div className="detail-head">
        <b>{s.project}</b> · session {s.sessionId}
      </div>
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th className="num">Msgs</th>
            <th className="num">Input</th>
            <th className="num">Output</th>
            <th className="num">Cache write</th>
            <th className="num">Cache read</th>
            <th className="num">Cost</th>
          </tr>
        </thead>
        <tbody>
          {models.map(([model, m]) => (
            <tr key={model}>
              <td className="mono">{model}</td>
              <td className="num">{m.messages}</td>
              <td className="num">{fmtTok(m.tokens.input)}</td>
              <td className="num">{fmtTok(m.tokens.output)}</td>
              <td className="num">{fmtTok(m.tokens.cacheWrite5m + m.tokens.cacheWrite1h)}</td>
              <td className="num">{fmtTok(m.tokens.cacheRead)}</td>
              <td className="num">{fmtUSD(m.costUSD)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="timeline-label">Prompt history</div>
      {s.key ? (
        <PromptTimeline sessionKey={s.key} />
      ) : (
        <div className="turn-note">No prompt history available.</div>
      )}
    </div>
  );
}

export default function SessionsTable({ sessions }) {
  const [sort, setSort] = useState({ key: 'cost', dir: -1 });
  const [open, setOpen] = useState(null);
  const [project, setProject] = useState('all');

  const projects = useMemo(() => {
    const names = new Set(sessions.map((s) => shortProject(s.project)));
    return [...names].sort();
  }, [sessions]);

  const rows = useMemo(() => {
    const filtered =
      project === 'all'
        ? sessions
        : sessions.filter((s) => shortProject(s.project) === project);
    return [...filtered].sort((a, b) => {
      const [va, vb] =
        sort.key === 'date'
          ? [a.lastTimestamp || '', b.lastTimestamp || '']
          : [a.costUSD, b.costUSD];
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [sessions, sort, project]);

  function toggleSort(key) {
    setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }));
    setOpen(null);
  }

  return (
    <>
      <div className="report">
        <label htmlFor="project-filter">Project</label>
        <select
          id="project-filter"
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setOpen(null);
          }}
        >
          <option value="all">All projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Session</th>
              <th className="num th-sortable" onClick={() => toggleSort('date')}>
                Last active <span className="arrow">⇅</span>
              </th>
              <th className="num">Msgs</th>
              <th className="num">Tokens</th>
              <th className="num th-sortable" onClick={() => toggleSort('cost')}>
                Cost <span className="arrow">⇅</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const id = s.sessionId + (s.lastTimestamp || '');
              const isOpen = open === id;
              return (
                <Fragment key={id}>
                  <tr
                    className={'row' + (isOpen ? ' is-open' : '')}
                    onClick={() => setOpen(isOpen ? null : id)}
                  >
                    <td title={s.project}>{shortProject(s.project)}</td>
                    <td className="mono">{s.sessionId.slice(0, 8)}</td>
                    <td className="num">{(s.lastTimestamp || '').slice(0, 10)}</td>
                    <td className="num">{s.messages}</td>
                    <td className="num">{fmtTok(sumTok(s.tokens))}</td>
                    <td className="num">{fmtUSD(s.costUSD)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="detail">
                      <td colSpan={6}>
                        <SessionDetail s={s} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
