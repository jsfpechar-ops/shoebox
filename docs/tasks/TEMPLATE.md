# NNNN: <title>

Status: todo
Ticket: <backlog id> | Depends on: <NNNN or none> | Base commit: <sha> | Branch: task/NNNN-<short-name> | PR base: <main or phase/N>
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens
<!-- Escalation only: "Executor: Sonnet 5.5 (reason: eval tuning | visual judgement | second attempt)" -->

## 1. Objective

Two sentences: what changes, and why it matters to the user.

## 2. Context

The rules and spec lines that apply, pasted in (the executor does not open `docs/v3/`). Exact code excerpts with their file path. If an excerpt isn't found verbatim, STOP (§8).

## 3. Files

| Path | Action | What |
|---|---|---|

No other file may change.

## 4. Steps

Numbered, in order. One step changes one file and ends with its command and expected result.

- **Edit step:** anchor excerpt + exact diff.
- **New-file step:** path, exported types and signatures exactly, and the full test file. "Implement until these tests pass; do not edit the test file."

## 5. Do not touch

Paths, plus the hard rules from AGENTS.md that apply here.

## 6. Commands

The exact commands and their expected output, from the [test-map](../context/test-map.md) row for the changed area, each ending `2>&1 | tail -30`. Never the full suite.

## 7. Acceptance

- [ ] Each item can be checked by a command or a visible fact. UI work: one 375 px screenshot per changed screen (1440 only if the layout changed), axe check with 0 violations.

## 8. Stop and ask

Stop, and write the report, if:

- an excerpt is not found;
- a test fails twice, or a test the brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/NNNN-report.md` (600 tokens at most) and set `Status: review`. The report has:

1. The files changed (`git diff --stat`).
2. Each command, with the last 5 lines of its output.
3. §7 ticked.
4. Deviations, and `[verify]` findings with their source.
5. Questions.
6. Owner steps left.

## Risk list (for the reviewer)

The files whose diff the reviewer must read (always: money, VAT, tax XML, migrations, RLS, auth, anything that sends).

## Owner steps

Numbered, click-by-click, in plain words.
