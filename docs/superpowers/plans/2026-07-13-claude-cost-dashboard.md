# Claude Code Cost Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local web dashboard showing Claude Code token usage and cost — summary, per-project, per-model, daily trend, cache efficiency, and per-session breakdown — computed from `~/.claude/projects/**/*.jsonl`.

**Architecture:** Pure aggregation logic in `lib/core.js` (parse JSONL text → session aggregate → API payload), tested with `node --test`. `server.js` walks the projects dir with an mtime/size file cache and serves `/api/data` + one static page via `node:http`. `public/index.html` is a single vanilla-JS page rendering all views.

**Tech Stack:** Node.js ≥ 20 (built-in `node:test`, `node:http`, `node:fs`). Zero runtime dependencies. No build step.

## Global Constraints

- Zero npm dependencies (spec: "zero runtime deps", no CDN in frontend).
- Pricing per 1M tokens: fable-5/mythos-5 $10/$50, opus $5/$25, sonnet $3/$15, haiku $1/$5; cache write 5m = 1.25× input, 1h = 2× input, cache read = 0.1× input.
- Dedup assistant messages by `message.id` (last occurrence wins).
- Cache-write TTL split from `usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`; when absent, treat `cache_creation_input_tokens` as 5m.
- Malformed lines skipped and counted; unknown models cost $0 and counted.
- Server port 3456. Data dir `~/.claude/projects`.

---

### Task 1: Core aggregation module (parse, price, aggregate)

**Files:**
- Create: `package.json`
- Create: `lib/core.js`
- Test: `test/core.test.js`

**Interfaces:**
- Produces: `parseSession(text, {sessionId, project}) → sessionAggregate`, `buildResponse(sessionAggregates[]) → apiPayload`, `getRates(model) → rates|null`, `sumTokens(tokens) → number`. Session aggregate shape: `{sessionId, project, firstTimestamp, lastTimestamp, messages, tokens:{input,output,cacheWrite5m,cacheWrite1h,cacheRead}, costUSD, models:{[model]:{tokens,costUSD,messages}}, daily:{[YYYY-MM-DD]:{costUSD,tokens}}, malformedLines, unknownModelMessages}`.

- [ ] **Step 1: Scaffold package.json**

```json
{
  "name": "claude-cost-dashboard",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write the failing test**

`test/core.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseSession, buildResponse, getRates } = require('../lib/core');

const opusLine = JSON.stringify({
  type: 'assistant',
  timestamp: '2026-07-01T10:00:00.000Z',
  cwd: '/Users/x/proj',
  message: {
    id: 'msg_1',
    model: 'claude-opus-4-8',
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 5000,
      cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 600 },
    },
  },
});

const fableLine = JSON.stringify({
  type: 'assistant',
  timestamp: '2026-07-02T11:00:00.000Z',
  message: {
    id: 'msg_2',
    model: 'claude-fable-5',
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 30,
      cache_read_input_tokens: 40,
    },
  },
});

const unknownLine = JSON.stringify({
  type: 'assistant',
  timestamp: '2026-07-02T12:00:00.000Z',
  message: { id: 'msg_3', model: 'weird-model', usage: { input_tokens: 999 } },
});

const fixture = [
  opusLine,
  opusLine, // duplicate message id — must count once
  fableLine,
  unknownLine,
  'not json {{{',
  JSON.stringify({ type: 'user', message: {} }), // no usage — ignored
].join('\n');

// Expected costs:
// msg_1 (opus $5/$25, w5m 6.25, w1h 10, read 0.5):
//   100*5 + 200*25 + 400*6.25 + 600*10 + 5000*0.5 = 500+5000+2500+6000+2500 = 16500 /1e6 = 0.0165
// msg_2 (fable $10/$50, w5m 12.5, read 1) — no breakdown, 30 treated as 5m:
//   10*10 + 20*50 + 30*12.5 + 40*1 = 100+1000+375+40 = 1515 /1e6 = 0.001515
// msg_3: unknown model → $0
const EXPECTED_COST = 0.0165 + 0.001515;

test('getRates matches by substring', () => {
  assert.strictEqual(getRates('claude-opus-4-8').input, 5);
  assert.strictEqual(getRates('claude-fable-5').output, 50);
  assert.strictEqual(getRates('sonnet').input, 3);
  assert.strictEqual(getRates('weird-model'), null);
  assert.strictEqual(getRates(null), null);
});

test('parseSession dedups, prices, and counts diagnostics', () => {
  const s = parseSession(fixture, { sessionId: 'sess-1', project: 'dir-name' });
  assert.strictEqual(s.messages, 3);
  assert.strictEqual(s.malformedLines, 1);
  assert.strictEqual(s.unknownModelMessages, 1);
  assert.strictEqual(s.project, '/Users/x/proj'); // cwd overrides dir name
  assert.strictEqual(s.firstTimestamp, '2026-07-01T10:00:00.000Z');
  assert.strictEqual(s.lastTimestamp, '2026-07-02T12:00:00.000Z');
  assert.deepStrictEqual(s.tokens, {
    input: 1109, output: 220, cacheWrite5m: 430, cacheWrite1h: 600, cacheRead: 5040,
  });
  assert.ok(Math.abs(s.costUSD - EXPECTED_COST) < 1e-9, `got ${s.costUSD}`);
  assert.ok(Math.abs(s.models['claude-opus-4-8'].costUSD - 0.0165) < 1e-9);
  assert.strictEqual(s.models['claude-opus-4-8'].messages, 1);
  assert.deepStrictEqual(Object.keys(s.daily).sort(), ['2026-07-01', '2026-07-02']);
  assert.ok(Math.abs(s.daily['2026-07-01'].costUSD - 0.0165) < 1e-9);
});

test('buildResponse rolls up summary, projects, models, daily', () => {
  const s = parseSession(fixture, { sessionId: 'sess-1', project: 'dir-name' });
  const r = buildResponse([s]);
  assert.strictEqual(r.summary.sessionCount, 1);
  assert.strictEqual(r.summary.projectCount, 1);
  assert.ok(Math.abs(r.summary.totalCostUSD - EXPECTED_COST) < 1e-9);
  assert.strictEqual(r.summary.totalTokens, 1109 + 220 + 430 + 600 + 5040);
  assert.strictEqual(r.summary.cacheReadTokens, 5040);
  // savings: opus 5000*(5-0.5)/1e6 + fable 40*(10-1)/1e6 = 0.0225 + 0.00036
  assert.ok(Math.abs(r.summary.cacheSavingsUSD - (0.0225 + 0.00036)) < 1e-9);
  assert.strictEqual(r.byProject[0].project, '/Users/x/proj');
  assert.strictEqual(r.byModel.length, 3);
  assert.strictEqual(r.daily.length, 2);
  assert.strictEqual(r.daily[0].date, '2026-07-01'); // ascending
  assert.strictEqual(r.sessions.length, 1);
});

test('buildResponse skips sessions with zero usage messages', () => {
  const empty = parseSession('', { sessionId: 'e', project: 'p' });
  const r = buildResponse([empty]);
  assert.strictEqual(r.summary.sessionCount, 0);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/core'`

- [ ] **Step 4: Write the implementation**

`lib/core.js`:

```js
'use strict';

// USD per 1M tokens. First substring match wins.
const PRICING = [
  { match: 'fable-5', rates: { input: 10, output: 50, write5m: 12.5, write1h: 20, read: 1 } },
  { match: 'mythos-5', rates: { input: 10, output: 50, write5m: 12.5, write1h: 20, read: 1 } },
  { match: 'opus', rates: { input: 5, output: 25, write5m: 6.25, write1h: 10, read: 0.5 } },
  { match: 'sonnet', rates: { input: 3, output: 15, write5m: 3.75, write1h: 6, read: 0.3 } },
  { match: 'haiku', rates: { input: 1, output: 5, write5m: 1.25, write1h: 2, read: 0.1 } },
];

function getRates(model) {
  if (!model) return null;
  const entry = PRICING.find((p) => model.includes(p.match));
  return entry ? entry.rates : null;
}

function emptyTokens() {
  return { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
}

function addTokens(target, src) {
  for (const k of Object.keys(target)) target[k] += src[k];
}

function sumTokens(t) {
  return t.input + t.output + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead;
}

function tokensOf(usage) {
  const cc = usage.cache_creation;
  let write5m;
  let write1h;
  if (cc && (cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null)) {
    write5m = cc.ephemeral_5m_input_tokens || 0;
    write1h = cc.ephemeral_1h_input_tokens || 0;
  } else {
    write5m = usage.cache_creation_input_tokens || 0;
    write1h = 0;
  }
  return {
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    cacheWrite5m: write5m,
    cacheWrite1h: write1h,
    cacheRead: usage.cache_read_input_tokens || 0,
  };
}

function costOf(tokens, rates) {
  if (!rates) return 0;
  return (
    tokens.input * rates.input +
    tokens.output * rates.output +
    tokens.cacheWrite5m * rates.write5m +
    tokens.cacheWrite1h * rates.write1h +
    tokens.cacheRead * rates.read
  ) / 1e6;
}

function parseSession(text, { sessionId, project }) {
  const byMsgId = new Map();
  let malformedLines = 0;
  let cwd = null;

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      malformedLines++;
      continue;
    }
    if (!cwd && obj.cwd) cwd = obj.cwd;
    if (obj.type !== 'assistant' || !obj.message || !obj.message.usage) continue;
    const msg = obj.message;
    const id = msg.id || obj.uuid;
    byMsgId.set(id, {
      model: msg.model || 'unknown',
      tokens: tokensOf(msg.usage),
      timestamp: obj.timestamp || null,
    });
  }

  const totals = emptyTokens();
  const models = {};
  const daily = {};
  let costUSD = 0;
  let unknownModelMessages = 0;
  let firstTimestamp = null;
  let lastTimestamp = null;

  for (const { model, tokens, timestamp } of byMsgId.values()) {
    const rates = getRates(model);
    const cost = costOf(tokens, rates);
    if (!rates) unknownModelMessages++;
    addTokens(totals, tokens);
    costUSD += cost;

    if (!models[model]) models[model] = { tokens: emptyTokens(), costUSD: 0, messages: 0 };
    addTokens(models[model].tokens, tokens);
    models[model].costUSD += cost;
    models[model].messages++;

    if (timestamp) {
      if (!firstTimestamp || timestamp < firstTimestamp) firstTimestamp = timestamp;
      if (!lastTimestamp || timestamp > lastTimestamp) lastTimestamp = timestamp;
      const date = timestamp.slice(0, 10);
      if (!daily[date]) daily[date] = { costUSD: 0, tokens: 0 };
      daily[date].costUSD += cost;
      daily[date].tokens += sumTokens(tokens);
    }
  }

  return {
    sessionId,
    project: cwd || project,
    firstTimestamp,
    lastTimestamp,
    messages: byMsgId.size,
    tokens: totals,
    costUSD,
    models,
    daily,
    malformedLines,
    unknownModelMessages,
  };
}

function buildResponse(sessionAggregates) {
  const summary = {
    totalCostUSD: 0,
    totalTokens: 0,
    sessionCount: 0,
    projectCount: 0,
    cacheReadTokens: 0,
    cacheSavingsUSD: 0,
    unknownModelMessages: 0,
    malformedLines: 0,
  };
  const byProject = new Map();
  const byModel = new Map();
  const dailyMap = new Map();
  const sessions = [];

  for (const s of sessionAggregates) {
    summary.malformedLines += s.malformedLines;
    if (s.messages === 0) continue;
    sessions.push(s);
    summary.sessionCount++;
    summary.totalCostUSD += s.costUSD;
    summary.totalTokens += sumTokens(s.tokens);
    summary.cacheReadTokens += s.tokens.cacheRead;
    summary.unknownModelMessages += s.unknownModelMessages;

    let p = byProject.get(s.project);
    if (!p) byProject.set(s.project, (p = { project: s.project, costUSD: 0, tokens: 0, sessionCount: 0 }));
    p.costUSD += s.costUSD;
    p.tokens += sumTokens(s.tokens);
    p.sessionCount++;

    for (const [model, m] of Object.entries(s.models)) {
      let e = byModel.get(model);
      if (!e) byModel.set(model, (e = { model, costUSD: 0, tokens: 0, cacheRead: 0, messages: 0 }));
      e.costUSD += m.costUSD;
      e.tokens += sumTokens(m.tokens);
      e.cacheRead += m.tokens.cacheRead;
      e.messages += m.messages;
      const rates = getRates(model);
      if (rates) summary.cacheSavingsUSD += (m.tokens.cacheRead * (rates.input - rates.read)) / 1e6;
    }

    for (const [date, d] of Object.entries(s.daily)) {
      let e = dailyMap.get(date);
      if (!e) dailyMap.set(date, (e = { date, costUSD: 0, tokens: 0 }));
      e.costUSD += d.costUSD;
      e.tokens += d.tokens;
    }
  }

  summary.projectCount = byProject.size;
  sessions.sort((a, b) => b.costUSD - a.costUSD);

  return {
    generatedAt: new Date().toISOString(),
    summary,
    byProject: [...byProject.values()].sort((a, b) => b.costUSD - a.costUSD),
    byModel: [...byModel.values()].sort((a, b) => b.costUSD - a.costUSD),
    daily: [...dailyMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    sessions,
  };
}

module.exports = { getRates, parseSession, buildResponse, sumTokens };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all 4 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json lib/core.js test/core.test.js
git commit -m "feat: core JSONL aggregation with pricing and dedup"
```

---

### Task 2: Server — scanner, incremental cache, HTTP endpoints

**Files:**
- Create: `server.js`

**Interfaces:**
- Consumes: `parseSession`, `buildResponse` from `lib/core.js`.
- Produces: `GET /api/data` → JSON payload from `buildResponse`; `GET /` → `public/index.html`.

- [ ] **Step 1: Write server.js**

```js
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parseSession, buildResponse } = require('./lib/core');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const PORT = process.env.PORT || 3456;
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');

// filePath -> { mtimeMs, size, session }
const fileCache = new Map();

function refresh() {
  const seen = new Set();
  let dirs = [];
  try {
    dirs = fs.readdirSync(PROJECTS_DIR);
  } catch (err) {
    console.error(`Cannot read ${PROJECTS_DIR}: ${err.message}`);
    return;
  }
  for (const dir of dirs) {
    const dirPath = path.join(PROJECTS_DIR, dir);
    let entries;
    try {
      entries = fs.readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const filePath = path.join(dirPath, f);
      seen.add(filePath);
      let st;
      try {
        st = fs.statSync(filePath);
      } catch {
        continue;
      }
      const cached = fileCache.get(filePath);
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) continue;
      let text;
      try {
        text = fs.readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      const session = parseSession(text, {
        sessionId: path.basename(f, '.jsonl'),
        project: dir,
      });
      fileCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, session });
    }
  }
  for (const key of fileCache.keys()) {
    if (!seen.has(key)) fileCache.delete(key);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/data') {
    refresh();
    const payload = buildResponse([...fileCache.values()].map((c) => c.session));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
    return;
  }
  if (url.pathname === '/') {
    fs.readFile(INDEX_HTML, (err, buf) => {
      if (err) {
        res.writeHead(500);
        res.end('index.html missing');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

console.time('initial scan');
refresh();
console.timeEnd('initial scan');
server.listen(PORT, () => {
  console.log(`Dashboard: http://localhost:${PORT} (${fileCache.size} session files)`);
});
```

- [ ] **Step 2: Verify endpoint against real data**

Run: `node server.js &` then `curl -s localhost:3456/api/data | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.summary, j.byProject.length, 'projects,', j.sessions.length, 'sessions')})"`

Expected: summary object with non-zero `totalCostUSD` and `sessionCount`, ~40 projects, >1000 sessions. Second `curl` should respond fast (<200ms; incremental cache hit). Kill server after.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: http server with incremental file-cache scanner"
```

---

### Task 3: Frontend page

**Files:**
- Create: `public/index.html`

**Interfaces:**
- Consumes: `GET /api/data` payload shape from Task 1 `buildResponse`.

- [ ] **Step 1: Write public/index.html**

Complete file (tiles, SVG daily bar chart, project/model tables, cache-efficiency tile + per-model read %, sortable session table with expandable detail rows, light/dark via `prefers-color-scheme`):

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claude Code Cost Dashboard</title>
<style>
  :root { color-scheme: light dark;
    --bg:#ffffff; --fg:#15181d; --muted:#68707d; --card:#f4f5f7; --border:#e2e4e9; --accent:#5b8def; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#14161a; --fg:#e8eaee; --muted:#9aa1ad; --card:#1e2127; --border:#2c3038; }
  }
  body { margin:0; font:14px/1.5 system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--fg); }
  main { max-width:1100px; margin:0 auto; padding:24px 16px 64px; }
  h1 { font-size:20px; margin:0 0 16px; }
  h2 { font-size:13px; margin:32px 0 8px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px; }
  .tile { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:14px 16px; }
  .tile .v { font-size:24px; font-weight:650; }
  .tile .l { color:var(--muted); font-size:12px; }
  table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
  th,td { text-align:left; padding:6px 10px; border-bottom:1px solid var(--border); white-space:nowrap; }
  th { color:var(--muted); font-weight:600; font-size:12px; }
  td.num, th.num { text-align:right; }
  th.sortable { cursor:pointer; user-select:none; }
  tbody tr.row { cursor:pointer; }
  tbody tr.row:hover td { background:var(--card); }
  tr.detail td { background:var(--card); font-size:12px; padding:10px 24px; white-space:normal; }
  .scroll { overflow-x:auto; }
  svg text { fill:var(--muted); font-size:10px; }
  .footnote { color:var(--muted); font-size:12px; margin-top:24px; }
</style>
</head>
<body>
<main>
  <h1>Claude Code Cost Dashboard</h1>
  <div class="tiles" id="tiles"></div>
  <h2>Daily spend — last 90 days</h2>
  <div class="scroll"><svg id="daily" height="220" style="width:100%"></svg></div>
  <h2>By project</h2>
  <div class="scroll"><table id="projects"></table></div>
  <h2>By model</h2>
  <div class="scroll"><table id="models"></table></div>
  <h2>Sessions</h2>
  <div class="scroll"><table id="sessions"></table></div>
  <p class="footnote" id="diag"></p>
</main>
<script>
const fmtUSD = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtTok = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B'
  : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
const sumTok = t => t.input + t.output + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shortProject = p => p.split('/').filter(Boolean).slice(-2).join('/');

function renderTiles(sum) {
  const readShare = sum.totalTokens ? sum.cacheReadTokens / sum.totalTokens : 0;
  const tiles = [
    [fmtUSD(sum.totalCostUSD), 'Total cost (API-equivalent)'],
    [fmtTok(sum.totalTokens), 'Total tokens'],
    [String(sum.sessionCount), `Sessions across ${sum.projectCount} projects`],
    [fmtUSD(sum.cacheSavingsUSD), 'Saved by prompt cache'],
    [(readShare * 100).toFixed(1) + '%', 'Tokens served from cache'],
  ];
  document.getElementById('tiles').innerHTML = tiles
    .map(([v, l]) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`)
    .join('');
}

function renderDaily(daily) {
  const svg = document.getElementById('daily');
  const days = daily.slice(-90);
  if (!days.length) return;
  const W = 1080, H = 220, pad = { t: 10, r: 4, b: 28, l: 48 };
  const max = Math.max(...days.map(d => d.costUSD), 0.01);
  const bw = (W - pad.l - pad.r) / days.length;
  let out = '';
  for (let i = 0; i <= 3; i++) {
    const v = (max * i) / 3;
    const y = H - pad.b - ((H - pad.t - pad.b) * i) / 3;
    out += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" stroke="var(--border)"/>`;
    out += `<text x="${pad.l - 6}" y="${y + 3}" text-anchor="end">$${v.toFixed(v < 10 ? 1 : 0)}</text>`;
  }
  days.forEach((d, i) => {
    const h = ((H - pad.t - pad.b) * d.costUSD) / max;
    const x = pad.l + i * bw;
    out += `<rect fill="var(--accent)" x="${x + 1}" y="${H - pad.b - h}" width="${Math.max(bw - 2, 1)}" height="${h}">` +
      `<title>${d.date}: ${fmtUSD(d.costUSD)} · ${fmtTok(d.tokens)} tok</title></rect>`;
    if (i % 7 === 0) out += `<text x="${x}" y="${H - 10}">${d.date.slice(5)}</text>`;
  });
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = out;
}

function renderProjects(rows) {
  document.getElementById('projects').innerHTML =
    '<thead><tr><th>Project</th><th class="num">Sessions</th><th class="num">Tokens</th><th class="num">Cost</th><th class="num">Share</th></tr></thead><tbody>' +
    rows.map(p => {
      const share = totalCost ? ((p.costUSD / totalCost) * 100).toFixed(1) + '%' : '—';
      return `<tr><td title="${esc(p.project)}">${esc(shortProject(p.project))}</td>` +
        `<td class="num">${p.sessionCount}</td><td class="num">${fmtTok(p.tokens)}</td>` +
        `<td class="num">${fmtUSD(p.costUSD)}</td><td class="num">${share}</td></tr>`;
    }).join('') + '</tbody>';
}

function renderModels(rows) {
  document.getElementById('models').innerHTML =
    '<thead><tr><th>Model</th><th class="num">Messages</th><th class="num">Tokens</th><th class="num">Cache read %</th><th class="num">Cost</th><th class="num">Share</th></tr></thead><tbody>' +
    rows.map(m => {
      const readPct = m.tokens ? ((m.cacheRead / m.tokens) * 100).toFixed(1) + '%' : '—';
      const share = totalCost ? ((m.costUSD / totalCost) * 100).toFixed(1) + '%' : '—';
      return `<tr><td>${esc(m.model)}</td><td class="num">${m.messages}</td>` +
        `<td class="num">${fmtTok(m.tokens)}</td><td class="num">${readPct}</td>` +
        `<td class="num">${fmtUSD(m.costUSD)}</td><td class="num">${share}</td></tr>`;
    }).join('') + '</tbody>';
}

let sessSort = { key: 'cost', dir: -1 };
let allSessions = [];

function detailHTML(s) {
  const rows = Object.entries(s.models)
    .sort((a, b) => b[1].costUSD - a[1].costUSD)
    .map(([model, m]) =>
      `<tr><td>${esc(model)}</td><td class="num">${m.messages}</td>` +
      `<td class="num">${fmtTok(m.tokens.input)}</td><td class="num">${fmtTok(m.tokens.output)}</td>` +
      `<td class="num">${fmtTok(m.tokens.cacheWrite5m + m.tokens.cacheWrite1h)}</td>` +
      `<td class="num">${fmtTok(m.tokens.cacheRead)}</td><td class="num">${fmtUSD(m.costUSD)}</td></tr>`)
    .join('');
  return `<div><b>${esc(s.project)}</b> · session ${esc(s.sessionId)}</div>` +
    `<table><thead><tr><th>Model</th><th class="num">Msgs</th><th class="num">Input</th><th class="num">Output</th>` +
    `<th class="num">Cache write</th><th class="num">Cache read</th><th class="num">Cost</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`;
}

function drawSessions() {
  const rows = [...allSessions].sort((a, b) => {
    const [va, vb] = sessSort.key === 'date'
      ? [a.lastTimestamp || '', b.lastTimestamp || '']
      : [a.costUSD, b.costUSD];
    return (va < vb ? -1 : va > vb ? 1 : 0) * sessSort.dir;
  });
  const table = document.getElementById('sessions');
  table.innerHTML =
    `<thead><tr><th>Project</th><th>Session</th>` +
    `<th class="sortable num" data-k="date">Last active ⇅</th><th class="num">Msgs</th>` +
    `<th class="num">Tokens</th><th class="sortable num" data-k="cost">Cost ⇅</th></tr></thead><tbody>` +
    rows.map((s, i) =>
      `<tr class="row" data-i="${i}"><td title="${esc(s.project)}">${esc(shortProject(s.project))}</td>` +
      `<td>${esc(s.sessionId.slice(0, 8))}</td><td class="num">${(s.lastTimestamp || '').slice(0, 10)}</td>` +
      `<td class="num">${s.messages}</td><td class="num">${fmtTok(sumTok(s.tokens))}</td>` +
      `<td class="num">${fmtUSD(s.costUSD)}</td></tr>`).join('') + '</tbody>';

  table.querySelectorAll('th.sortable').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.k;
    sessSort = { key: k, dir: sessSort.key === k ? -sessSort.dir : -1 };
    drawSessions();
  }));
  table.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', () => {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('detail')) { next.remove(); return; }
    const s = rows[Number(tr.dataset.i)];
    const detail = document.createElement('tr');
    detail.className = 'detail';
    detail.innerHTML = `<td colspan="6"></td>`;
    detail.firstChild.innerHTML = detailHTML(s);
    tr.after(detail);
  }));
}

let totalCost = 0;

async function main() {
  const data = await (await fetch('/api/data')).json();
  totalCost = data.summary.totalCostUSD;
  allSessions = data.sessions;
  renderTiles(data.summary);
  renderDaily(data.daily);
  renderProjects(data.byProject);
  renderModels(data.byModel);
  drawSessions();
  document.getElementById('diag').textContent =
    `${data.summary.malformedLines} malformed lines skipped · ` +
    `${data.summary.unknownModelMessages} messages with unknown model priced at $0 · ` +
    `generated ${new Date(data.generatedAt).toLocaleString()}`;
}
main();
</script>
</body>
</html>
```

- [ ] **Step 2: Verify in browser**

Run: `node server.js`, open `http://localhost:3456`.
Expected: tiles populated with non-zero cost, bar chart shows recent days, all tables filled, clicking a session row expands per-model detail, clicking Cost/Last-active headers re-sorts.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: dashboard frontend"
```

---

### Task 4: End-to-end verification + README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Run test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Cross-check totals against ccusage**

Run: `npx ccusage@latest --json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('ccusage total:', j.totals && j.totals.totalCost)})"`
and compare with dashboard `summary.totalCostUSD` (`curl -s localhost:3456/api/data`).

Expected: same order of magnitude; differences explained only by pricing-table versions (e.g. sonnet-5 intro pricing) and dedup handling. Investigate if >15% apart.

- [ ] **Step 3: Write README.md**

```markdown
# Claude Code Cost Dashboard

Local dashboard for Claude Code token usage and cost, computed from
`~/.claude/projects/**/*.jsonl`.

## Run

    npm start        # http://localhost:3456

## Test

    npm test

## Notes

- Costs are API-equivalent (usage × current Anthropic pricing); on a Max
  subscription they represent value, not billing.
- Pricing table lives in `lib/core.js` (`PRICING`) — update when Anthropic
  pricing changes.
- Refresh the page to pick up new sessions; only changed files are re-parsed.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README with run/test instructions"
```
