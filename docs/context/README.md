# Context system

The goal: every session starts from about 3–5k tokens of trusted context instead of an audit, and implementation runs on Haiku 5.5. The lint (`scripts/context_lint.py`) enforces the caps. Ported from the owner's the reference app repo.

**Layers**

- **L0:** `AGENTS.md`, always loaded. Claude Code (via `CLAUDE.md`), Cursor and Copilot read it automatically.
- **L1:** this folder, opened on demand through the AGENTS.md routing table.
- **L2:** the specs in `docs/v3/` and the evidence in `research/`, opened one section at a time for that feature.
- **Archive:** the docs/archive folder (created when first needed), never read by default.

**Files** (token cap; size = characters ÷ 4)

| File | Purpose | Cap |
|---|---|---|
| `AGENTS.md` | Roles, hard rules, routing, protocol | 1,500 |
| [status](status.md) | Now, next, blocked, owner reminders | 700 |
| [decisions](decisions.md) | Append-only, one line each | 2,200 |
| [known-issues](known-issues.md) | Open bugs and findings (grep it) | 2,500 |
| [rules](rules.md) | Full text of the hard rules | 2,500 |
| [workflow](workflow.md) | Roles, models, budget, flow, triggers | 2,600 |
| [executor](executor.md), [test-map](test-map.md) | Executor rules; which tests per change | 1,100 / 1,200 |
| [prompts](prompts.md) | Paste-ready prompts | 1,000 |
| Task brief / report | `docs/tasks/` | 12,000 / 1,500 (report target 600) |

**Models**

| Work | Model |
|---|---|
| Planning, briefs, review | Opus 5.5 or Fable 5.1 (orchestrator) |
| Implementation | Haiku 5.5; Sonnet 5.5 only for the three reasons in [workflow](workflow.md#choosing-the-executor) |
| Search helpers | Haiku 5.5 |
| In the product (M02) | Haiku 5.5 first, Sonnet 5.5 on escalation (ADR-011) |

Entry files for every AI (`CLAUDE.md`, `.github/copilot-instructions.md`, `.cursor/rules/agents.mdc`) point to AGENTS.md; the lint checks them.
