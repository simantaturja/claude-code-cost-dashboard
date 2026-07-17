import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
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
    <li className={'border-t border-line pb-[11px] pt-2.5 first:border-t-0' + (t.flagged ? ' opacity-80' : '')}>
      <div className="mb-1 flex items-baseline gap-2.5">
        <span className="font-mono text-[11.5px] tracking-[0.02em] text-faint">{fmtTurnTime(t.timestamp)}</span>
        {t.flagged && (
          <span className="rounded-[4px] bg-soft px-1.5 py-[3px] font-mono text-[9.5px] font-semibold uppercase leading-none tracking-[0.06em] text-accent">
            continuation
          </span>
        )}
        <span className="ml-auto font-mono text-[12.5px] font-medium text-ink">{fmtUSD(t.costUSD)}</span>
      </div>
      <div
        className={
          'whitespace-pre-wrap break-words text-[12.5px] text-ink' +
          (long ? ' cursor-pointer hover:text-accent' : '')
        }
        onClick={long ? () => setFull((v) => !v) : undefined}
        title={long ? (full ? 'Click to collapse' : 'Click to expand') : undefined}
      >
        {text}
      </div>
      <div className="mt-[5px] flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-muted tabular-nums">
        <span>in {fmtTok(t.tokens.input)}</span>
        <span>out {fmtTok(t.tokens.output)}</span>
        {t.subagentCostUSD > 0 && (
          <span className="text-accent">subagent {fmtUSD(t.subagentCostUSD)}</span>
        )}
        {t.models.length > 0 && (
          <span className="font-mono text-[11px] text-faint">{t.models.join(', ')}</span>
        )}
      </div>
    </li>
  );
}

function PromptTimeline({ sessionKey }) {
  const [state, setState] = useState({ status: 'loading', turns: null, error: null });

  useEffect(() => {
    let live = true;
    setState({ status: 'loading', turns: null, error: null });
    api
      .session(sessionKey)
      .then((d) => live && setState({ status: 'ready', turns: d.turns, error: null }))
      .catch((e) => live && setState({ status: 'error', turns: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [sessionKey]);

  const noteCls = 'py-3 text-[12.5px] text-muted';
  if (state.status === 'loading') return <div className={noteCls}>Loading prompts…</div>;
  if (state.status === 'error') {
    return <div className={noteCls}>Could not load prompts: {state.error}</div>;
  }
  if (!state.turns.length) return <div className={noteCls}>No prompts recorded.</div>;
  return (
    <ol className="m-0 list-none p-0">
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
      <div className="mb-2.5 text-[12.5px] text-muted">
        <b className="font-semibold text-ink">{s.project}</b> · session {s.sessionId}
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
      <div className="mb-2 mt-[18px] font-mono text-[11px] font-semibold uppercase leading-none tracking-[0.07em] text-faint">
        Prompt history
      </div>
      {s.key ? (
        <PromptTimeline sessionKey={s.key} />
      ) : (
        <div className="py-3 text-[12.5px] text-muted">No prompt history available.</div>
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
      <div className="mb-3 flex items-center gap-2.5 text-[12.5px] text-muted">
        <label htmlFor="project-filter">Project</label>
        <select
          className="rounded-md border border-line bg-surface px-2 py-[5px] font-mono text-[12.5px] font-medium text-ink"
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
