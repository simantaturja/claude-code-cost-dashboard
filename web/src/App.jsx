import { useEffect, useState } from 'react';
import { api } from './api.js';
import TabNav from './components/TabNav.jsx';
import Tiles from './components/Tiles.jsx';
import DailyChart from './components/DailyChart.jsx';
import ReportControl from './components/ReportControl.jsx';
import ProjectsTable from './components/ProjectsTable.jsx';
import ModelsTable from './components/ModelsTable.jsx';
import BreakdownBars from './components/BreakdownBars.jsx';
import ModelSplit from './components/ModelSplit.jsx';
import AdvisorTable from './components/AdvisorTable.jsx';
import SessionsTable from './components/SessionsTable.jsx';
import WasteTable from './components/WasteTable.jsx';
import Diagnostics from './components/Diagnostics.jsx';

const TABS = ['overview', 'breakdown', 'advisor', 'waste', 'sessions'];

function currentTab() {
  const h = window.location.hash.slice(1);
  return TABS.includes(h) ? h : 'overview';
}

export default function App() {
  const [tab, setTab] = useState(currentTab());
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onHash = () => setTab(currentTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let live = true;
    const load = () => {
      api
        .data()
        .then((d) => live && setData(d))
        .catch((e) => live && setError(e.message));
    };
    load();
    const off = api.onDataChanged(load);
    return () => {
      live = false;
      off();
    };
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <h1 className="brand">
            <span className="brand-mark" aria-hidden="true" />
            Claude Code Cost Dashboard
          </h1>
          <TabNav tabs={TABS} active={tab} />
          {data && (
            <span className="stamp">
              generated {new Date(data.generatedAt).toLocaleString()}
            </span>
          )}
        </div>
      </header>

      <div className="app">
      {error && <div className="empty">Could not load data: {error}</div>}
      {!error && !data && <div className="empty">Loading usage data…</div>}

      {data && (
        <>
          {tab === 'overview' && (
            <>
              <Tiles summary={data.summary} roi={data.roi} />
              <h2 className="section-label">Spend</h2>
              <p className="section-note">Your daily spend over time. Switch to weekly or monthly, and hover any bar for the exact figure.</p>
              <DailyChart daily={data.daily} />
              <h2 className="section-label">Monthly report</h2>
              <p className="section-note">Download a shareable Markdown summary for any month.</p>
              <ReportControl monthly={data.monthly} />
            </>
          )}

          {tab === 'breakdown' && (
            <>
              <h2 className="section-label">By project</h2>
              <p className="section-note">Where your spend went, biggest projects first. The long tail is rolled into “Other.”</p>
              <BreakdownBars rows={data.byProject} totalCost={data.summary.totalCostUSD} />
              <h2 className="section-label">By model</h2>
              <p className="section-note">How your spend splits across models — hover any segment for the exact amount.</p>
              <ModelSplit rows={data.byModel} totalCost={data.summary.totalCostUSD} />
              <h2 className="section-label">Full detail</h2>
              <p className="section-note">Every project and model, with tokens, sessions, and cache use.</p>
              <ProjectsTable rows={data.byProject} totalCost={data.summary.totalCostUSD} />
              <div style={{ height: 14 }} />
              <ModelsTable rows={data.byModel} totalCost={data.summary.totalCostUSD} />
            </>
          )}

          {tab === 'advisor' && (
            <>
              <h2 className="section-label">Efficiency advisor</h2>
              <p className="section-note">Sessions worth a second look, with a suggested next step for each. Ranked by what it could save you.</p>
              <AdvisorTable rows={data.advisor} />
            </>
          )}

          {tab === 'waste' && (
            <>
              <h2 className="section-label">Repeated waste across sessions</h2>
              <WasteTable rows={data.waste} />
            </>
          )}

          {tab === 'sessions' && (
            <>
              <h2 className="section-label">Sessions</h2>
              <p className="section-note">Every session, newest first. Click one to see its prompts and where the cost went.</p>
              <SessionsTable sessions={data.sessions} />
            </>
          )}

          <Diagnostics summary={data.summary} generatedAt={data.generatedAt} />
        </>
      )}
      </div>
    </>
  );
}
