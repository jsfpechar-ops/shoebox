# Shoebox: agent entry point

Read this file, then [status](docs/context/status.md). Open nothing else unless a routing row below says so.
**Never audit the whole repo** unless the owner asks for it in the current chat.

## Roles

- **Orchestrator** (Opus 5.5, Fable 5.1 or any chat AI the owner talks to): turns a [backlog](docs/v3/backlog.md) ticket into briefs in `docs/tasks/`, reviews reports, keeps context current. Never edits `apps/` or `packages/`, never runs tests, never implements, even when the owner says "build this": here that means "write the brief". Only the exact words "implement it yourself" lift this. A Claude orchestrator implements only by spawning one executor subagent per brief (`model: haiku`, or `sonnet` when the brief header says so); in a phase run it may also spawn a Fable subagent (`model: fable`) that only writes briefs. Follow the [token budget](docs/context/workflow.md#token-budget).
- **Executor** (**Haiku 5.5** by default; Sonnet 5.5 only for a brief whose header says `Executor: Sonnet 5.5`, see [choosing the executor](docs/context/workflow.md#choosing-the-executor)): follows one brief exactly, alone, no subagents. Reads only this file, [executor](docs/context/executor.md), the brief and the files the brief names.
- **Owner** (Josef): decides, merges to `main` (in a [phase run](docs/context/workflow.md#phase-run) the orchestrator merges into `phase/N` and the owner merges the phase), deploys, secrets, accounts. Give him numbered click-by-click steps in plain words.

## Limits (every chat, strict)

- **Executor (Haiku, or Sonnet when escalated): 100k tokens per chat.** Checkpoint at 60k: stop new work and hand over. Also stop after 30 tool calls. Next: [at the cap](docs/context/workflow.md#when-the-executor-reaches-the-cap). Orchestrators have no token or tool-call cap; they still keep one chat per ticket and read narrowly.
- **No audit and no full test suite** unless the owner asks in the current chat. Run only the [test-map](docs/context/test-map.md) row for what changed. CI runs the rest.
- End every command with `| tail -30` (or `head -50`). Never print a full log, diff or document.

## Hard rules (full text: [rules](docs/context/rules.md))

1. Correct money and tax beat every feature. Money is never a float (`Money`, ADR-007). Rates, limits, deadlines and form versions live only in `packages/domain/rules`.
2. AI output is a suggestion: it reaches `ready` only after the deterministic checks of M03.
3. Every query is org-scoped. A new table ships with RLS policies and an RLS test in the same PR.
4. Privacy: never commit real documents or personal data. Test data is anonymized (`testdata/golden-v1/`). No document content in logs or Sentry. EU regions only, except the Claude API (owner decision 2026-10-18).
5. Names are canonical in [04](docs/v3/04-domain-model.md) and [05](docs/v3/05-data-model.md). A schema change is a new migration plus a 05 edit.
6. English for now (owner 2026-10-25): every string through `packages/i18n`, keys and copy in `en.json`; `cs.json` stays dormant, write no new Czech. UI uses the [design system](docs/v3/07-design-system.md) tokens only, no raw colors.
7. No new dependency, vendor, screen or setting without an owner line in [decisions](docs/context/decisions.md).
8. Never push to `main`. Never e-mail real third parties, submit to a government system or move money.
9. A `[verify]` in a spec: check the primary source, record the finding in the report.
10. An open decision ([22 §A](docs/v3/22-open-questions.md)): use its default and leave `TODO(decision-XX)`.

## Test

`pnpm --filter @shoebox/<pkg> test -- <file> 2>&1 | tail -30` and `pnpm --filter @shoebox/<pkg> typecheck 2>&1 | tail -30`. M01–M05 changes also run `pnpm eval --quick 2>&1 | tail -30`. From the repo root: `python3 scripts/context_lint.py`.

## Routing (open only your row; in long files read one section: `grep -n '^## '`, then that range)

| Touching | Read |
|---|---|
| Choosing the next ticket | [backlog](docs/v3/backlog.md) (one epic), [phases](docs/v3/02-scope-and-phases.md) exit criteria |
| Names, enums, statuses | [04 domain model](docs/v3/04-domain-model.md), one section |
| Database, migrations, RLS | [05 data model](docs/v3/05-data-model.md), that table; [rules: database](docs/context/rules.md#database) |
| Tax numbers, forms, yearly update | [06 maintenance](docs/v3/06-maintenance-playbook.md) |
| A module's behavior | `docs/v3/modules/` the one module file, one section |
| Stack, an ADR, why a choice | [03 architecture](docs/v3/03-architecture.md), that ADR |
| Screens, copy, look | M11 in `docs/v3/modules/`, [design system](docs/v3/07-design-system.md) |
| A Czech law or competitor fact | `grep` `research/`; trust only [O] lines |
| A bug, or "is X known?" | `grep` [known-issues](docs/context/known-issues.md) |

## Session protocol (details: [workflow](docs/context/workflow.md))

- **Start:** read this file, then status, then your routed row. Grep before you read. Read ranges, never whole files over 300 lines. If something is unclear, ask the owner instead of exploring.
- **End (orchestrator):** update status (5 lines at most), append to decisions and known-issues, run the lint.
- One chat per task. Close the chat when the brief or the review is done.
