# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); versioning follows
[SemVer](https://semver.org/).

## [2.0.2] - 2026-07-17

### Security
- Dashboard server now binds to `127.0.0.1` only (previously listened on all
  network interfaces). The dashboard has no auth, so the old default exposed
  project paths, prompts, and error samples to anyone on the same LAN.

### Fixed
- Waste "retry" detection no longer false-positives when two unrelated calls
  to a tool with no identifiable target (WebFetch, WebSearch, Task,
  TodoWrite) both errored — they no longer collide and falsely confirm each
  other.
- Redundant-read detection now recognizes `MultiEdit` and `NotebookEdit` as
  legitimate file mutations, matching `Edit`/`Write` — a re-read after either
  is no longer flagged as waste.
- Credential redaction now catches glued single-dash password flags (e.g.
  `mysql -pSECRET`).

### Changed
- Softened the Waste tab's redaction copy ("credentials are redacted" →
  "recognizable credentials... review before sharing"), since keyword-less
  secrets can still slip through.

### Added
- Advisor v2: actionable findings, capacity-based framing instead of raw
  dollar "savings," a precision guard on the low-cache-hit rule, and each
  reason tagged with its rule id.
- Cross-session waste patterns: errored tool calls and redundant reads
  tracked and surfaced, with error-reason classification, a plain-language
  explainer, and a daily trend chart.

## [2.0.1]

### Added
- VS Code extension — the dashboard in a panel plus a status-bar item
  showing today's spend. Published to the VS Code Marketplace.

### Fixed
- Broadened the advisor's premium-model rule to match by pricing tier
  instead of a hard-coded model name.
- Plan-ROI multiple now flags when it's using the default $200 subscription
  price instead of one you've configured.

## [2.0.0] - 2026-07-14

### Added
- Day/Week/Month toggle on the Overview spend chart.

### Removed
- **Breaking:** client attribution — `/api/report` is now a monthly total
  only.

## [1.1.0] - 2026-07-14

### Added
- Packaged for npm as `cccost-dashboard`, installable via `npx`.

## [1.0.0] - 2026-07-13

Initial public release.

### Added
- Core JSONL aggregation with per-model pricing and message dedup.
- HTTP server with recursive session scanner, subagent merge, and an
  incremental cache.
- React dashboard: Overview, per-project/per-model breakdown, sessions list.
- Per-prompt timeline with project filter; turn parsing with subagent cost
  attribution.
- Plan-ROI tile, client attribution, and a monthly report.
- Efficiency advisor (three heuristics) in a tabbed layout.
- Demo dataset, screenshots, and a `CLAUDE_PROJECTS_DIR` override for trying
  it without real data.

### Fixed
- Daily chart bucketing switched from UTC to local calendar date, with
  calendar-gap filling.

[2.0.2]: https://github.com/simantaturja/cccost-dashboard/compare/v2.0.0...v2.0.2
[2.0.0]: https://github.com/simantaturja/cccost-dashboard/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/simantaturja/cccost-dashboard/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/simantaturja/cccost-dashboard/releases/tag/v1.0.0
