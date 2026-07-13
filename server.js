'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  parseSession, buildResponse, mergeSessionAggregates, buildReport,
  parseTurns, attributeSubagentTurns,
} = require('./lib/core');

const PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
const PORT = process.env.PORT || 3456;
const DIST_DIR = path.join(__dirname, 'web', 'dist');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');
const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
};

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch {
    return null;
  }
}
const config = loadConfig();

// filePath -> { mtimeMs, size, sessionKey, aggregate }
const fileCache = new Map();

// Layout: <project>/<sessionId>.jsonl is the main session file;
// <project>/<sessionId>/subagents/**/agent-*.jsonl belong to that session.
function sessionKeyFor(projectDir, relPath) {
  const segments = relPath.split(path.sep);
  const sessionId = segments.length === 1 ? path.basename(segments[0], '.jsonl') : segments[0];
  return { sessionId, key: `${projectDir}/${sessionId}`, isMain: segments.length === 1 };
}

// Map a `/assets/...` URL to an absolute path inside web/dist/assets, or null if
// it would escape that directory (path-traversal guard).
function resolveAssetPath(pathname) {
  const rel = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(DIST_DIR, rel);
  return filePath.startsWith(path.join(DIST_DIR, 'assets')) ? filePath : null;
}

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
      entries = fs.readdirSync(dirPath, { recursive: true });
    } catch {
      continue;
    }
    for (const rel of entries) {
      if (!rel.endsWith('.jsonl')) continue;
      const filePath = path.join(dirPath, rel);
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
      const { sessionId, key, isMain } = sessionKeyFor(dir, rel);
      const aggregate = parseSession(text, { sessionId, project: dir });
      aggregate.isMain = isMain;
      fileCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, sessionKey: key, isMain, aggregate });
    }
  }
  for (const key of fileCache.keys()) {
    if (!seen.has(key)) fileCache.delete(key);
  }
}

function sessions() {
  const byKey = new Map();
  for (const entry of fileCache.values()) {
    let group = byKey.get(entry.sessionKey);
    if (!group) byKey.set(entry.sessionKey, (group = []));
    // main session file first so its cwd/project label wins
    if (entry.isMain) group.unshift(entry.aggregate);
    else group.push(entry.aggregate);
  }
  return [...byKey.entries()].map(([key, group]) => {
    const merged = mergeSessionAggregates(group);
    merged.key = key; // pass-through link for /api/session (no core rollup change)
    return merged;
  });
}

// Resolve a session's on-disk files by matching the cached sessionKey. The
// user-supplied key is only ever compared for equality — never joined into a
// path — so it cannot escape PROJECTS_DIR.
function sessionFilesFor(key) {
  let mainPath = null;
  const subPaths = [];
  let sessionId = null;
  let project = null;
  for (const [filePath, entry] of fileCache) {
    if (entry.sessionKey !== key) continue;
    sessionId = entry.aggregate.sessionId;
    if (entry.isMain) {
      mainPath = filePath;
      project = entry.aggregate.project;
    } else {
      subPaths.push(filePath);
      if (project == null) project = entry.aggregate.project;
    }
  }
  if (mainPath === null && subPaths.length === 0) return null;
  return { mainPath, subPaths, sessionId, project };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/data') {
    refresh();
    const payload = buildResponse(sessions(), config);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
    return;
  }
  if (url.pathname === '/api/session') {
    refresh();
    const key = url.searchParams.get('key') || '';
    const files = sessionFilesFor(key);
    if (!files) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown session key' }));
      return;
    }
    let turns = [];
    try {
      const mainText = files.mainPath ? fs.readFileSync(files.mainPath, 'utf8') : '';
      turns = parseTurns(mainText);
      for (const p of files.subPaths) {
        attributeSubagentTurns(turns, fs.readFileSync(p, 'utf8'));
      }
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ sessionId: files.sessionId, project: files.project, turns }));
    return;
  }
  if (url.pathname === '/api/report') {
    refresh();
    const payload = buildResponse(sessions(), config);
    const month = url.searchParams.get('month') || new Date().toISOString().slice(0, 7);
    const md = buildReport(payload.byClient, month, new Date().toISOString().slice(0, 10));
    res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
    res.end(md);
    return;
  }
  if (url.pathname === '/') {
    fs.readFile(INDEX_HTML, (err, buf) => {
      if (err) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('web/dist/index.html not found — run `npm run build` first.');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    const filePath = resolveAssetPath(url.pathname);
    if (!filePath) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    fs.readFile(filePath, (err, buf) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const type = MIME[path.extname(filePath)] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      res.end(buf);
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

function start() {
  console.time('initial scan');
  refresh();
  console.timeEnd('initial scan');
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Start on another port: PORT=4000 npm start`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(PORT, () => {
    console.log(`Dashboard: http://localhost:${PORT} (${fileCache.size} session files)`);
  });
}

if (require.main === module) {
  start();
}

module.exports = { sessionKeyFor, resolveAssetPath };
