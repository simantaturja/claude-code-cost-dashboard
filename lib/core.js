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

// Prompt/hook wrappers that are not typed user prompts.
const PROMPT_WRAPPERS = ['<command-name>', '<local-command-stdout>', 'Caveat:', '<system-reminder>'];

// Extract a user prompt's text, or null when the message is not a real typed
// prompt (meta/sidechain, tool_result-only, or a command/hook wrapper blob).
function promptTextOf(obj) {
  if (obj.type !== 'user' || obj.isMeta || obj.isSidechain || !obj.message) return null;
  const content = obj.message.content;
  let text;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    const blocks = content.filter((b) => b && b.type === 'text');
    if (!blocks.length) return null; // tool_result-only (no text blocks)
    text = blocks.map((b) => b.text || '').join('');
  } else {
    return null;
  }
  const trimmed = text.trimStart();
  if (PROMPT_WRAPPERS.some((w) => trimmed.startsWith(w))) return null;
  return text;
}

function newTurn(timestamp, prompt, flagged) {
  return {
    timestamp,
    prompt,
    flagged,
    tokens: emptyTokens(),
    costUSD: 0,
    subagentCostUSD: 0,
    models: [],
  };
}

function accrue(turn, model, tokens, isSubagent) {
  addTokens(turn.tokens, tokens);
  const cost = costOf(tokens, getRates(model));
  turn.costUSD += cost;
  if (isSubagent) turn.subagentCostUSD += cost;
  if (!turn.models.includes(model)) turn.models.push(model);
}

// Walk a main session file into per-prompt turns. Each user prompt starts a
// turn; assistant messages with usage accrue into the current turn (dedup by
// message.id, last occurrence wins). Assistant activity before the first prompt
// goes into a synthetic flagged first turn.
function parseTurns(mainText) {
  const turns = [];
  const byMsgId = new Map(); // id -> { model, tokens, turnIndex }
  let current = -1;

  for (const line of mainText.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const prompt = promptTextOf(obj);
    if (prompt !== null) {
      turns.push(newTurn(obj.timestamp || null, prompt, false));
      current = turns.length - 1;
      continue;
    }

    if (obj.type === 'assistant' && obj.message && obj.message.usage) {
      if (current === -1) {
        turns.push(newTurn(null, '(session continuation)', true));
        current = 0;
      }
      const msg = obj.message;
      const id = msg.id || obj.uuid;
      byMsgId.set(id, {
        model: msg.model || 'unknown',
        tokens: tokensOf(msg.usage),
        turnIndex: current,
      });
    }
  }

  for (const { model, tokens, turnIndex } of byMsgId.values()) {
    accrue(turns[turnIndex], model, tokens, false);
  }
  return turns;
}

// Index of the turn whose window [turn.ts, nextTurn.ts) contains ts. Messages
// before the first window → first turn; at/after the last → last turn.
function turnIndexForTimestamp(turns, ts) {
  if (ts == null) return 0;
  let idx = 0;
  for (let i = 0; i < turns.length; i++) {
    const tts = turns[i].timestamp;
    if (tts != null && tts <= ts) idx = i;
  }
  return idx;
}

// Attribute a subagent file's priced messages onto the turns produced by
// parseTurns (same message-id dedup). Adds to costUSD/tokens and subagentCostUSD.
function attributeSubagentTurns(turns, subagentText) {
  if (!turns.length) return turns;
  const byMsgId = new Map();
  for (const line of subagentText.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== 'assistant' || !obj.message || !obj.message.usage) continue;
    const msg = obj.message;
    const id = msg.id || obj.uuid;
    byMsgId.set(id, {
      model: msg.model || 'unknown',
      tokens: tokensOf(msg.usage),
      timestamp: obj.timestamp || null,
    });
  }
  for (const { model, tokens, timestamp } of byMsgId.values()) {
    accrue(turns[turnIndexForTimestamp(turns, timestamp)], model, tokens, true);
  }
  return turns;
}

// Merge file-level aggregates (main session file + subagent/workflow files)
// into one session aggregate. All entries must share sessionId.
function mergeSessionAggregates(aggregates) {
  const [first, ...rest] = aggregates;
  const merged = {
    ...first,
    tokens: { ...first.tokens },
    models: {},
    daily: {},
  };
  for (const [model, m] of Object.entries(first.models)) {
    merged.models[model] = { tokens: { ...m.tokens }, costUSD: m.costUSD, messages: m.messages };
  }
  for (const [date, d] of Object.entries(first.daily)) {
    merged.daily[date] = { ...d };
  }
  for (const s of rest) {
    merged.project = merged.project || s.project;
    merged.messages += s.messages;
    merged.costUSD += s.costUSD;
    merged.malformedLines += s.malformedLines;
    merged.unknownModelMessages += s.unknownModelMessages;
    addTokens(merged.tokens, s.tokens);
    if (s.firstTimestamp && (!merged.firstTimestamp || s.firstTimestamp < merged.firstTimestamp)) {
      merged.firstTimestamp = s.firstTimestamp;
    }
    if (s.lastTimestamp && (!merged.lastTimestamp || s.lastTimestamp > merged.lastTimestamp)) {
      merged.lastTimestamp = s.lastTimestamp;
    }
    for (const [model, m] of Object.entries(s.models)) {
      if (!merged.models[model]) {
        merged.models[model] = { tokens: emptyTokens(), costUSD: 0, messages: 0 };
      }
      addTokens(merged.models[model].tokens, m.tokens);
      merged.models[model].costUSD += m.costUSD;
      merged.models[model].messages += m.messages;
    }
    for (const [date, d] of Object.entries(s.daily)) {
      if (!merged.daily[date]) merged.daily[date] = { costUSD: 0, tokens: 0 };
      merged.daily[date].costUSD += d.costUSD;
      merged.daily[date].tokens += d.tokens;
    }
  }
  merged.subagentCostUSD = aggregates
    .filter((a) => a.isMain === false)
    .reduce((sum, a) => sum + a.costUSD, 0);
  return merged;
}

function advisorFor(s) {
  const reasons = [];
  let estSavingUSD = 0;

  const t = s.tokens;
  const denom = t.input + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead;
  if (s.costUSD >= 1 && denom > 0 && t.cacheRead / denom < 0.5) {
    reasons.push(`Low cache hit ratio (${Math.round((t.cacheRead / denom) * 100)}%) — context likely rebuilt repeatedly`);
  }

  let fableCost = 0;
  for (const [model, m] of Object.entries(s.models)) {
    if (model.includes('fable-5')) fableCost += m.costUSD;
  }
  if (fableCost > 0 && s.messages < 20) {
    const save = fableCost * 0.7;
    estSavingUSD += save;
    reasons.push(`fable-5 on a short session — sonnet likely sufficient (est. save $${save.toFixed(2)})`);
  }

  const sub = s.subagentCostUSD || 0;
  if (s.costUSD >= 5 && sub / s.costUSD > 0.6) {
    reasons.push(`${Math.round((sub / s.costUSD) * 100)}% of cost from subagents ($${sub.toFixed(2)}) — check delegation value`);
  }

  if (!reasons.length) return null;
  return { sessionId: s.sessionId, project: s.project, lastTimestamp: s.lastTimestamp, costUSD: s.costUSD, estSavingUSD, reasons };
}

const DEFAULT_CONFIG = {
  subscriptionUSDPerMonth: 200,
  clients: {
    'Client A': ['/absolute/path/to/clientA/projects'],
    Client B: ['/absolute/path/to/clientB/projects'],
  },
  defaultClient: 'Personal',
};

function clientOf(project, config) {
  for (const [client, prefixes] of Object.entries(config.clients)) {
    if (prefixes.some((p) => project && project.startsWith(p))) return client;
  }
  return config.defaultClient;
}

function buildReport(byClient, month, generatedDate) {
  const money = (n) => '$' + n.toFixed(2);
  const rows = byClient
    .map((c) => ({ client: c.client, cost: c.months[month] || 0 }))
    .filter((r) => r.cost > 0)
    .sort((a, b) => b.cost - a.cost);
  const total = rows.reduce((s, r) => s + r.cost, 0);
  return [
    `# Claude Code usage — ${month}`,
    '',
    '| Client | Cost (USD) |',
    '|---|---|',
    ...rows.map((r) => `| ${r.client} | ${money(r.cost)} |`),
    `| **Total** | **${money(total)}** |`,
    '',
    `Generated ${generatedDate} · API-equivalent value at current Anthropic pricing.`,
    '',
  ].join('\n');
}

function buildResponse(sessionAggregates, config) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
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
  const byClient = new Map();
  const monthlyMap = new Map();
  const sessions = [];
  const advisor = [];

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

    const client = clientOf(s.project, cfg);
    let c = byClient.get(client);
    if (!c) byClient.set(client, (c = { client, costUSD: 0, tokens: 0, sessionCount: 0, months: {} }));
    c.costUSD += s.costUSD;
    c.tokens += sumTokens(s.tokens);
    c.sessionCount++;

    for (const [date, d] of Object.entries(s.daily)) {
      let e = dailyMap.get(date);
      if (!e) dailyMap.set(date, (e = { date, costUSD: 0, tokens: 0 }));
      e.costUSD += d.costUSD;
      e.tokens += d.tokens;

      const month = date.slice(0, 7);
      c.months[month] = (c.months[month] || 0) + d.costUSD;
      let m = monthlyMap.get(month);
      if (!m) monthlyMap.set(month, (m = { month, costUSD: 0, tokens: 0 }));
      m.costUSD += d.costUSD;
      m.tokens += d.tokens;
    }

    const flagged = advisorFor(s);
    if (flagged) advisor.push(flagged);
  }

  summary.projectCount = byProject.size;
  advisor.sort((a, b) => b.costUSD - a.costUSD);
  sessions.sort((a, b) => b.costUSD - a.costUSD);

  const monthly = [...monthlyMap.values()].sort((a, b) => (a.month < b.month ? -1 : 1));

  const roi = {
    subscriptionUSDPerMonth: cfg.subscriptionUSDPerMonth,
    months: monthly.map((m) => ({
      month: m.month,
      valueUSD: m.costUSD,
      multiple: m.costUSD / cfg.subscriptionUSDPerMonth,
    })),
  };

  return {
    generatedAt: new Date().toISOString(),
    summary,
    byProject: [...byProject.values()].sort((a, b) => b.costUSD - a.costUSD),
    byModel: [...byModel.values()].sort((a, b) => b.costUSD - a.costUSD),
    daily: [...dailyMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    byClient: [...byClient.values()].sort((a, b) => b.costUSD - a.costUSD),
    monthly,
    roi,
    advisor: advisor.slice(0, 25),
    sessions,
  };
}

module.exports = {
  getRates, parseSession, buildResponse, mergeSessionAggregates, sumTokens,
  clientOf, buildReport, DEFAULT_CONFIG, parseTurns, attributeSubagentTurns,
};
