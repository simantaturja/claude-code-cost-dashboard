# Design

How the dashboard turns Claude Code's local session logs into cost numbers. This
describes the system as it is today; for how to run and configure it, see the
[README](../README.md).

## Data source

Claude Code writes one JSONL file per session under `~/.claude/projects/<project-dir>/`.
Each line is one event; the ones that matter carry token usage:

- **Assistant messages** (`type: "assistant"` with `message.usage`) — priced.
- **User messages** (`type: "user"` with text content) — used only for the
  per-prompt timeline, never priced.

Subagent and workflow-agent transcripts live in nested directories under a
session (`<sessionId>/subagents/**/*.jsonl`). They belong to that session and are
merged into it.

There is **no cost field** in the logs — cost is computed from `usage` and a
pricing table.

## Layers

```
lib/core.js   pure functions: parse text → aggregates → API payload. Zero deps. Unit-tested.
server.js     filesystem scan (mtime/size cache) + HTTP endpoints. Node built-ins only.
web/          Vite + React SPA, built to web/dist, served by server.js.
```

`lib/core.js` never touches the filesystem or network — it takes JSONL text in and
returns plain objects. That is what makes the cost math testable without fixtures
on disk.

## Cost model

Pricing lives in one table, `PRICING` in `lib/core.js`, in USD per 1M tokens.
Models are matched by substring (`claude-opus-4-8` → the `opus` row), so new point
releases usually need no change. An unmatched model is priced at $0 and counted in
diagnostics.

Per message:

```
cost = ( input      × rate.input
       + output     × rate.output
       + cacheWrite5m × rate.write5m      // 5-minute cache TTL  = 1.25× input
       + cacheWrite1h × rate.write1h      // 1-hour   cache TTL  = 2×    input
       + cacheRead   × rate.read )        // cache read          = 0.1×  input
      / 1e6
```

Cache writes are split by TTL because they bill differently. The split comes from
`usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` when
present; otherwise the whole `cache_creation_input_tokens` is treated as 5-minute.

### Streaming-partial dedup

Streaming writes the same `message.id` on multiple lines as the response grows
(output 4 → 120 → 378). Counting them all would multiply the cost. `parseSession`
keeps a map keyed by `message.id` and the **last occurrence wins** — Claude Code
writes the complete message last. This invariant is pinned by a test
(`test/core.test.js`); if the log format ever changes write order, that test is the
first place to look.

### Local-time bucketing

Daily and monthly totals bucket by the machine's **local** calendar date
(`localDate` in `lib/core.js`), not UTC. Work done at 1 AM on the 1st counts toward
the month you were actually working, which matters for the monthly total report and
the Week/Month views of the spend chart.

## Aggregation

`parseSession(text, {sessionId, project})` produces a per-file aggregate: deduped
message count, token totals, cost, per-model split, per-day split, and the session's
project (from the transcript's `cwd`, falling back to the directory name).

`mergeSessionAggregates([...])` combines a session's main file with its subagent
files into one session. The main file's `cwd` wins as the project label. It also
computes `subagentCostUSD` — the cost contributed by the non-main files — which the
advisor uses.

`buildResponse(sessions, config)` rolls all sessions up into the API payload:
summary tiles, `byProject`, `byModel`, `daily`, `monthly`, `roi`, `advisor`, and
the session list. The Overview spend chart re-buckets `daily` into day / week /
month views client-side; `/api/report` renders a total-only monthly summary from
`monthly`.

## Efficiency advisor

`advisorFor(session)` runs three heuristic rules (thresholds are hand-picked, not
tuned):

| Rule | Fires when |
|---|---|
| Low cache hit ratio | cost ≥ $1 and cache-read < 50% of input-side tokens |
| Premium model, short session | used a top-tier model (`fable-5` / `mythos-5`) and < 20 messages (est. saving = `premiumCost × 0.7`) |
| Subagent-heavy | cost ≥ $5 and subagents > 60% of cost |

Only flagged sessions are returned, sorted by cost, capped at 25. It is a "look
here first" signal, not a verdict — see the README for the known limitations.

## Per-prompt timeline

Prompt text is large and sensitive, so it is **not** in the main `/api/data`
payload or the in-memory cache. `GET /api/session?key=<sessionKey>` parses one
session's files on demand and returns a turn list:

- `parseTurns(mainText)` walks the main file in order. A new turn starts at each
  genuine user prompt — filtering out tool results, meta lines, sidechains, and
  command/hook wrapper blobs (`<command-name>`, `Caveat:`, `<system-reminder>`,
  …). Assistant usage accrues into the current turn (same last-wins dedup).
  Activity before the first prompt becomes a synthetic turn flagged as a
  continuation.
- `attributeSubagentTurns(turns, subagentText)` maps each subagent message onto
  the turn whose time window `[turn.ts, nextTurn.ts)` contains it, adding to both
  the turn cost and its `subagentCostUSD`.

## Server

- **Scan** — `refresh()` walks `~/.claude/projects` recursively, `stat`-ing each
  `.jsonl`. A file is re-parsed only when its mtime or size changed; results are
  cached per path. The walk is synchronous and runs per request — fine for a
  single local user, a latency cliff only at very large history sizes.
- **Endpoints** — `/api/data` (JSON), `/api/report?month=` (markdown),
  `/api/session?key=` (per-prompt), `/` and `/assets/*` (the built SPA).
- **Safety** — the `/api/session` key is only ever compared for equality against
  cached session keys, never joined into a path; `resolveAssetPath` confines asset
  requests to `web/dist/assets`. Both are unit-tested in `test/server.test.js`.

## What is intentionally not here

- No database — everything is derived from the JSONL files on each request.
- No auth / no network calls — it binds to localhost and reads local files only.
- No historical pricing — one current table; restating old months uses today's
  rates.
- No live streaming — refresh the page to pick up new sessions.
