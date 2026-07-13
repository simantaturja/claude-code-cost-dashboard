'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseSession, buildResponse, mergeSessionAggregates, getRates,
  clientOf, buildReport, DEFAULT_CONFIG, parseTurns, attributeSubagentTurns,
} = require('../lib/core');

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

test('mergeSessionAggregates combines a session file with its subagent files', () => {
  const main = parseSession(opusLine, { sessionId: 'sess-1', project: 'dir-name' });
  const sub = parseSession(fableLine, { sessionId: 'sess-1', project: 'dir-name' });
  const merged = mergeSessionAggregates([main, sub]);
  assert.strictEqual(merged.sessionId, 'sess-1');
  assert.strictEqual(merged.project, '/Users/x/proj'); // cwd from main file wins
  assert.strictEqual(merged.messages, 2);
  assert.ok(Math.abs(merged.costUSD - (0.0165 + 0.001515)) < 1e-9);
  assert.deepStrictEqual(merged.tokens, {
    input: 110, output: 220, cacheWrite5m: 430, cacheWrite1h: 600, cacheRead: 5040,
  });
  assert.strictEqual(merged.firstTimestamp, '2026-07-01T10:00:00.000Z');
  assert.strictEqual(merged.lastTimestamp, '2026-07-02T11:00:00.000Z');
  assert.strictEqual(Object.keys(merged.models).length, 2);
  assert.strictEqual(Object.keys(merged.daily).length, 2);
});

test('buildResponse skips sessions with zero usage messages', () => {
  const empty = parseSession('', { sessionId: 'e', project: 'p' });
  const r = buildResponse([empty]);
  assert.strictEqual(r.summary.sessionCount, 0);
});

const line = (o) => JSON.stringify({
  type: 'assistant',
  timestamp: o.ts,
  cwd: o.cwd,
  message: { id: o.id, model: o.model || 'claude-opus-4-8', usage: { input_tokens: o.input } },
});

// opus input rate $5/1M, so input N*1e6 → cost $5N
const dn1 = parseSession(line({ ts: '2026-06-30T10:00:00.000Z', cwd: '/absolute/path/to/clientA/projects/app', id: 'd1', input: 1e6 }), { sessionId: 'dn1', project: 'p' });
const dn2 = parseSession(line({ ts: '2026-07-01T10:00:00.000Z', cwd: '/absolute/path/to/clientA/projects/app', id: 'd2', input: 2e6 }), { sessionId: 'dn2', project: 'p' });
const cef = parseSession(line({ ts: '2026-07-05T10:00:00.000Z', cwd: '/absolute/path/to/clientB/projects/x', id: 'c1', input: 4e6 }), { sessionId: 'cef', project: 'p' });
const personal = parseSession(line({ ts: '2026-07-02T10:00:00.000Z', cwd: '/Users/other/thing', id: 'o1', input: 1e6 }), { sessionId: 'per', project: 'p' });

test('clientOf: prefix match, first-wins, default fallback', () => {
  assert.strictEqual(clientOf('/absolute/path/to/clientA/projects/app', DEFAULT_CONFIG), 'Client A');
  assert.strictEqual(clientOf('/absolute/path/to/clientB/projects/x', DEFAULT_CONFIG), 'Client B');
  assert.strictEqual(clientOf('/somewhere/else', DEFAULT_CONFIG), 'Personal');
  const cfg = { clients: { A: ['/x'], B: ['/x/y'] }, defaultClient: 'D', subscriptionUSDPerMonth: 1 };
  assert.strictEqual(clientOf('/x/y/z', cfg), 'A'); // first-wins
  assert.strictEqual(clientOf('/nope', cfg), 'D');
});

test('buildResponse byClient + monthly roll up across a month boundary', () => {
  const r = buildResponse([dn1, dn2, cef, personal]);
  const byName = Object.fromEntries(r.byClient.map((c) => [c.client, c]));
  assert.deepStrictEqual(byName['Client A'].months, { '2026-06': 5, '2026-07': 10 });
  assert.strictEqual(byName['Client A'].costUSD, 15);
  assert.strictEqual(byName['Client A'].sessionCount, 2);
  assert.deepStrictEqual(byName['Client B'].months, { '2026-07': 20 });
  assert.deepStrictEqual(byName['Personal'].months, { '2026-07': 5 });
  // cost desc
  assert.deepStrictEqual(r.byClient.map((c) => c.client), ['Client B', 'Client A', 'Personal']);
  // monthly ascending
  assert.deepStrictEqual(r.monthly, [
    { month: '2026-06', costUSD: 5, tokens: 1e6 },
    { month: '2026-07', costUSD: 35, tokens: 7e6 },
  ]);
});

test('buildReport renders markdown for a month, clients by cost desc + total', () => {
  const r = buildResponse([dn1, dn2, cef, personal]);
  const md = buildReport(r.byClient, '2026-07', '2026-07-13');
  assert.strictEqual(md, [
    '# Claude Code usage — 2026-07',
    '',
    '| Client | Cost (USD) |',
    '|---|---|',
    '| Client B | $20.00 |',
    '| Client A | $10.00 |',
    '| Personal | $5.00 |',
    '| **Total** | **$35.00** |',
    '',
    'Generated 2026-07-13 · API-equivalent value at current Anthropic pricing.',
    '',
  ].join('\n'));
});

test('buildResponse roi: multiple = monthly value / subscription, ascending', () => {
  const r = buildResponse([dn1, dn2, cef, personal]);
  assert.strictEqual(r.roi.subscriptionUSDPerMonth, 200);
  assert.deepStrictEqual(r.roi.months, [
    { month: '2026-06', valueUSD: 5, multiple: 5 / 200 },
    { month: '2026-07', valueUSD: 35, multiple: 35 / 200 },
  ]);
  const r2 = buildResponse([dn1, dn2, cef, personal], { subscriptionUSDPerMonth: 100 });
  assert.strictEqual(r2.roi.subscriptionUSDPerMonth, 100);
  assert.strictEqual(r2.roi.months[1].multiple, 35 / 100);
});

test('mergeSessionAggregates sums subagentCostUSD from non-main files', () => {
  const main = Object.assign(parseSession(opusLine, { sessionId: 'sess-1', project: 'p' }), { isMain: true });
  const sub1 = Object.assign(parseSession(fableLine, { sessionId: 'sess-1', project: 'p' }), { isMain: false });
  const sub2 = Object.assign(parseSession(fableLine, { sessionId: 'sess-1', project: 'p' }), { isMain: false });
  const merged = mergeSessionAggregates([main, sub1, sub2]);
  assert.ok(Math.abs(merged.subagentCostUSD - 0.001515 * 2) < 1e-9);
  // no subagents → 0
  const solo = mergeSessionAggregates([Object.assign(parseSession(opusLine, { sessionId: 's', project: 'p' }), { isMain: true })]);
  assert.strictEqual(solo.subagentCostUSD, 0);
});

const emptyTok = () => ({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 });
function fakeSession(o) {
  return {
    sessionId: o.sessionId, project: '/p',
    firstTimestamp: '2026-07-01T00:00:00.000Z', lastTimestamp: '2026-07-01T00:00:00.000Z',
    messages: o.messages != null ? o.messages : 10,
    tokens: o.tokens || emptyTok(),
    costUSD: o.costUSD || 0,
    models: o.models || {},
    daily: {}, malformedLines: 0, unknownModelMessages: 0,
    subagentCostUSD: o.subagentCostUSD || 0,
  };
}
const advisorById = (r) => Object.fromEntries(r.advisor.map((a) => [a.sessionId, a]));

test('advisor rule 1: low cache ratio fires below 0.5, not at threshold', () => {
  const fire = fakeSession({ sessionId: 'r1-fire', costUSD: 2, tokens: { ...emptyTok(), input: 1000, cacheRead: 100 } });
  const nofire = fakeSession({ sessionId: 'r1-thresh', costUSD: 2, tokens: { ...emptyTok(), input: 100, cacheRead: 100 } });
  const nocost = fakeSession({ sessionId: 'r1-cost', costUSD: 0.5, tokens: { ...emptyTok(), input: 1000, cacheRead: 100 } });
  const a = advisorById(buildResponse([fire, nofire, nocost]));
  assert.deepStrictEqual(a['r1-fire'].reasons, ['Low cache hit ratio (9%) — context likely rebuilt repeatedly']);
  assert.strictEqual(a['r1-fire'].estSavingUSD, 0);
  assert.ok(!a['r1-thresh']);
  assert.ok(!a['r1-cost']);
});

test('advisor rule 2: fable-5 on short session, est saving = fableCost * 0.7', () => {
  const models = { 'claude-fable-5': { costUSD: 5, messages: 5, tokens: emptyTok() } };
  const fire = fakeSession({ sessionId: 'r2-fire', costUSD: 5, messages: 10, models });
  const nofire = fakeSession({ sessionId: 'r2-long', costUSD: 5, messages: 20, models });
  const a = advisorById(buildResponse([fire, nofire]));
  assert.deepStrictEqual(a['r2-fire'].reasons, ['fable-5 on a short session — sonnet likely sufficient (est. save $3.50)']);
  assert.ok(Math.abs(a['r2-fire'].estSavingUSD - 3.5) < 1e-9);
  assert.ok(!a['r2-long']);
});

test('advisor rule 3: subagent-heavy fires above 0.6 and cost >= 5, not at threshold', () => {
  const fire = fakeSession({ sessionId: 'r3-fire', costUSD: 6, subagentCostUSD: 4 });
  const nofire = fakeSession({ sessionId: 'r3-thresh', costUSD: 5, subagentCostUSD: 3 });
  const nocost = fakeSession({ sessionId: 'r3-cost', costUSD: 4, subagentCostUSD: 4 });
  const a = advisorById(buildResponse([fire, nofire, nocost]));
  assert.deepStrictEqual(a['r3-fire'].reasons, ['67% of cost from subagents ($4.00) — check delegation value']);
  assert.ok(!a['r3-thresh']);
  assert.ok(!a['r3-cost']);
});

test('advisor sorts by cost desc and caps at 25', () => {
  const many = [];
  for (let i = 1; i <= 30; i++) {
    many.push(fakeSession({ sessionId: `s${i}`, costUSD: i, tokens: { ...emptyTok(), input: 1000 } }));
  }
  const r = buildResponse(many);
  assert.strictEqual(r.advisor.length, 25);
  assert.strictEqual(r.advisor[0].costUSD, 30);
  assert.strictEqual(r.advisor[24].costUSD, 6);
});

// ---- parseTurns / attributeSubagentTurns ----
// opus input rate is $5/1M, so input N*1e6 tokens → cost $5N (easy arithmetic).
const aLine = (o) => JSON.stringify({
  type: 'assistant',
  timestamp: o.ts,
  message: { id: o.id, model: o.model || 'claude-opus-4-8', usage: { input_tokens: o.input } },
});
const uLine = (o) => JSON.stringify({
  type: 'user',
  timestamp: o.ts,
  isMeta: o.isMeta,
  isSidechain: o.isSidechain,
  message: { content: o.content },
});

test('parseTurns: synthetic first turn, prompt filters (command/tool_result/meta), dedup, cost accumulation', () => {
  const text = [
    aLine({ ts: '2026-07-01T10:00:00.000Z', id: 'pre', input: 1e6 }), // before first prompt → synthetic turn
    uLine({ ts: '2026-07-01T10:01:00.000Z', content: 'First real prompt' }),
    aLine({ ts: '2026-07-01T10:02:00.000Z', id: 'A', input: 2e6 }),
    aLine({ ts: '2026-07-01T10:02:00.000Z', id: 'A', input: 2e6 }), // dup id → counts once
    uLine({ ts: '2026-07-01T10:03:00.000Z', content: [{ type: 'tool_result', content: 'ok' }] }), // tool_result-only → skip
    uLine({ ts: '2026-07-01T10:04:00.000Z', content: '<command-name>/clear</command-name>' }), // command wrapper → skip
    uLine({ ts: '2026-07-01T10:05:00.000Z', content: 'meta blob', isMeta: true }), // meta → skip
    uLine({ ts: '2026-07-01T10:05:30.000Z', content: 'sidechain blob', isSidechain: true }), // sidechain → skip
    aLine({ ts: '2026-07-01T10:06:00.000Z', id: 'A2', input: 1e6 }), // still belongs to first real prompt
    uLine({ ts: '2026-07-01T10:07:00.000Z', content: [{ type: 'text', text: 'Second prompt' }] }), // text block prompt
    aLine({ ts: '2026-07-01T10:08:00.000Z', id: 'B', input: 3e6 }),
  ].join('\n');

  const turns = parseTurns(text);
  assert.strictEqual(turns.length, 3);

  // synthetic first turn
  assert.strictEqual(turns[0].flagged, true);
  assert.strictEqual(turns[0].prompt, '(session continuation)');
  assert.ok(Math.abs(turns[0].costUSD - 5) < 1e-9); // pre: 1e6 * 5 / 1e6

  // first real prompt: A (2e6, deduped) + A2 (1e6) = 3e6 → $15
  assert.strictEqual(turns[1].flagged, false);
  assert.strictEqual(turns[1].prompt, 'First real prompt');
  assert.strictEqual(turns[1].timestamp, '2026-07-01T10:01:00.000Z');
  assert.strictEqual(turns[1].tokens.input, 3e6);
  assert.ok(Math.abs(turns[1].costUSD - 15) < 1e-9);
  assert.deepStrictEqual(turns[1].models, ['claude-opus-4-8']);

  // second prompt (from text block): B (3e6) → $15
  assert.strictEqual(turns[2].flagged, false);
  assert.strictEqual(turns[2].prompt, 'Second prompt');
  assert.ok(Math.abs(turns[2].costUSD - 15) < 1e-9);
  assert.strictEqual(turns[2].subagentCostUSD, 0);
});

test('attributeSubagentTurns: window attribution incl. before-first and after-last boundaries, dedup', () => {
  const main = [
    uLine({ ts: '2026-07-01T10:00:00.000Z', content: 'P1' }),
    aLine({ ts: '2026-07-01T10:01:00.000Z', id: 'm1', input: 1e6 }),
    uLine({ ts: '2026-07-01T11:00:00.000Z', content: 'P2' }),
    aLine({ ts: '2026-07-01T11:01:00.000Z', id: 'm2', input: 1e6 }),
  ].join('\n');
  const turns = parseTurns(main);
  assert.strictEqual(turns.length, 2);

  const sub = [
    aLine({ ts: '2026-07-01T09:00:00.000Z', id: 's0', input: 1e6 }), // before first window → turn 0
    aLine({ ts: '2026-07-01T10:30:00.000Z', id: 's1', input: 2e6 }), // inside turn 0 window [10:00,11:00)
    aLine({ ts: '2026-07-01T11:30:00.000Z', id: 's2', input: 3e6 }), // after last turn ts → turn 1
    aLine({ ts: '2026-07-01T11:30:00.000Z', id: 's2', input: 3e6 }), // dup → once
    aLine({ ts: '2026-07-01T11:00:00.000Z', id: 's3', input: 1e6, model: 'claude-fable-5' }), // == turn1 ts → turn 1
  ].join('\n');

  const out = attributeSubagentTurns(turns, sub);
  assert.strictEqual(out, turns); // mutates + returns

  // turn 0: main m1 (1e6→$5) + sub s0 (1e6→$5) + s1 (2e6→$10) = $20; subagent share $15
  assert.strictEqual(turns[0].tokens.input, 4e6);
  assert.ok(Math.abs(turns[0].subagentCostUSD - 15) < 1e-9);
  assert.ok(Math.abs(turns[0].costUSD - 20) < 1e-9);

  // turn 1: main m2 (1e6→$5) + s2 (3e6→$15) + s3 fable (1e6 input * $10 = $10) = $30; subagent share $25
  assert.strictEqual(turns[1].tokens.input, 5e6);
  assert.ok(Math.abs(turns[1].subagentCostUSD - 25) < 1e-9);
  assert.ok(Math.abs(turns[1].costUSD - 30) < 1e-9);
  assert.ok(turns[1].models.includes('claude-fable-5'));
});
