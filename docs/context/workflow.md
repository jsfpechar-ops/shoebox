# Workflow

This file is the single source of truth for how work is done. When the process changes, edit this file and add a `[workflow]` line in [decisions](decisions.md). Ported from the owner's the reference app repo and adapted for a new TypeScript codebase.

## Roles and models

| Role | Who | Does | Never |
|---|---|---|---|
| Orchestrator | Opus 5.5, Fable 5.1 or any chat AI | Turns backlog tickets into briefs in `docs/tasks/`, writes the tests that define each brief, reviews reports, updates context | Edits `apps/` or `packages/`, runs tests, implements, audits nobody asked for, carries one chat across tasks |
| Executor | **Haiku 5.5** (default) | Applies one brief and writes its report | Designs, guesses, touches files outside the brief, edits the brief's tests, merges, spawns subagents |
| Executor, escalated | **Sonnet 5.5**, only when the brief header says so | Same rules and limits as Haiku | Same |
| Search helper | Haiku subagent of a Claude orchestrator | Grep and summarise in 200 words; no file dumps | Writes files |
| Owner | Josef | Decides, merges, deploys, secrets, accounts | |

- A **Claude** orchestrator implements only by spawning one executor subagent (Agent tool, `model: haiku`, or `model: sonnet` for an escalated brief) with the [executor prompt](prompts.md#executor). It reads the report, not the transcript. Briefs run one after another; in parallel only when their §3 file lists do not overlap.
- Any **other** AI ends with the executor prompt filled in; the owner pastes it into a Haiku 5.5 session.
- Only the owner's exact words "implement it yourself" let an orchestrator implement.
- HIGH RISK areas (money and VAT math, tax XML, migrations and RLS, auth, deletion, anything that sends) are still executor work, but the brief gives exact code or exact tests, and the review reads the full diff of those files.

## Choosing the executor

Haiku 5.5 is the default for every brief. The orchestrator writes `Executor: Sonnet 5.5` in the header only for one of these reasons, named on the same line:

1. **Eval tuning:** LLM prompts or few-shot examples tuned against `pnpm eval` (M02), where the right change is found by trying.
2. **Visual judgement:** a UI brief that needs layout iteration from screenshots beyond the given code.
3. **Second attempt:** Haiku stopped twice on the same brief for reasons that are not a bad brief (see the cap section).

Anything else that seems to need Sonnet is a brief that is too big or too vague: split it or make it exact. Opus or Fable never execute.

## Token budget

- **Executor chats only** (Haiku, or Sonnet when escalated): checkpoint at 60k tokens, hard stop at 100k. Agents cannot count tokens exactly, so also count calls: the executor stops after 30 tool calls. At the checkpoint, stop new work and hand over.
- **No audit and no full test suite** unless the owner asks in the current message. Run only the [test-map](test-map.md) row for the changed area. CI runs the rest.
- **Cap every command's output:** `| tail -30`, `grep -m 20`, `head -50`. Never print a full log, diff, document or XML file.
- Read AGENTS.md, then status, then one routing row. Grep before you read; ranges of 150 lines or less. The `docs/v3/` specs are long: read one section, never a whole module file.
- Bugs: confirm the root cause with at most 5 greps and 2 range reads. Fixes of 40 lines or fewer go into the brief as an exact diff.
- No review swarm unless the owner names it in the current message and the change is HIGH RISK. Then 3 Haiku advisors, no peer-review round.
- Role files stay separate: orchestrators never open [executor](executor.md); the executor never opens this file. Keep AGENTS.md free of dates and status.
- **Orchestrators** (Opus, Fable) have no token or tool-call cap, but keep one chat per ticket so context stays clean. Uploaded PDFs: convert to text and grep.
- Reply to the owner: at most 150 words plus the prompt.

## When the executor reaches the cap

1. The executor commits after every step (`NNNN step k`), so a cutoff loses nothing.
2. At its checkpoint it writes the report with `Status: blocked`, `Done: steps 1 to k. Left: steps k+1 to n.`, and stops.
3. Cut off without a report: the orchestrator reads `git log --oneline -10` and `git diff --stat` on the branch and finds the last `step k` commit.
4. The orchestrator writes a continuation brief `NNNN-cont-1.md` (same branch, `Depends on` the first; only the remaining steps, anchors re-copied from the branch as it now stands) and starts a **fresh** executor. A fresh session inherits nothing, so the brief carries everything.
5. A task gets at most 3 executor sessions in all. The third may be Sonnet 5.5 (reason 3 above). After the third the orchestrator stops and asks the owner; the brief is too big and should be split.

## Flow

1. **Pick:** the next [backlog](../v3/backlog.md) ticket whose dependencies are done and whose phase is open ([phases](../v3/02-scope-and-phases.md)).
2. **Brief:** write `docs/tasks/NNNN-name.md` from the [template](../tasks/TEMPLATE.md). Each brief fits one executor session of 30 tool calls. Split a ticket into ordered briefs with `Depends on`.
3. **Execute:** the executor runs only a brief whose Status is `todo`. It sets `Status: in-progress`, works, writes `NNNN-report.md`, sets `Status: review` and opens one PR.
4. **Review** (a new orchestrator chat):
   1. Read the report.
   2. Run `gh pr checks <pr>`. CI is the truth.
   3. Run `gh pr diff <pr> --name-only` and compare with brief §3. Any extra file means a correction brief.
   4. Read the diff only for the files on the brief's risk list.
   5. Verdict: approve (the owner merges), or write `NNNN-fix-1.md`.
   6. Update status, decisions and known-issues, then set `Status: done`.
5. **Phase gate:** the brief that closes a phase runs its exit criteria; the owner confirms in that PR.

Statuses: `todo → in-progress → review → done`, plus `blocked` (reason on the Status line) and `replaced` (name the newer brief).

## Phase run

One Opus orchestrator session can work through a whole phase without waiting on the owner for each merge. Prompt: [phase run](prompts.md#phase-run).

1. **Branch:** at the start, create `phase/N` from `main` and push it (if it already exists, continue on it). Every brief branches from `phase/N` (`task/NNNN-name`) and its PR targets `phase/N`, never `main`.
2. **Loop:** take every ticket of the phase whose `Depends on` tickets are merged into `phase/N`. Brief it, spawn its executor, then review it (Flow step 4). For a `Risk: HIGH` ticket, or one the backlog names for Fable, Opus spawns one Fable subagent (Agent tool, `model: fable`) that only writes its briefs and exits. Opus checks them against the ticket's Acceptance, then spawns the executor. Up to 4 executors run at once, only when their brief §3 file lists do not overlap.
3. **Merge:** on an approve verdict with green CI, the orchestrator merges the PR into `phase/N` itself. Until P0-CI-01 lands, the test output in the executor's report is the evidence. HIGH-risk PRs merge the same way, but each one is added to the gate list (step 5) with its risk-list files.
4. **Keep going:** owner steps (accounts, secrets, clicks) go on the gate list, and the run continues with tickets that do not need them. The orchestrator stops a ticket after 3 executor sessions or the same failure twice, lists it, and moves on.
5. **Gate list:** `phase-N-gate.md` in `docs/tasks/` holds the merged tickets with their PR links, the HIGH-risk PRs and the files to read, open questions and owner steps. Update it after every merge, along with status.
6. **Usage limit:** near the owner's 5-hour or weekly limit, finish the current ticket, update the gate list and status, and stop.
7. **Stop:** when the phase GATE ticket is done, or nothing is left that is not blocked. Then open one PR `phase/N` → `main`, linking the gate list. The owner reads the HIGH-risk diffs it names and merges. Nothing reaches `main` without the owner.
8. **Resume:** a new or compacted session reads AGENTS.md, status and the gate list, then `git log --oneline -20 origin/phase/N`, and carries on from there.

## Writing briefs for the executor

The codebase is new, so most briefs create files. Two kinds of step:

- **Edit step** (an existing file): quote the exact excerpt as an anchor and give the exact diff. If the anchor is not found verbatim, the executor stops.
- **New-file step:** give the file path, the exported types and signatures exactly, and the **full test file** (the tests are the spec). The executor implements until those tests pass and may not change them. Pure logic (`packages/domain`, `validation`, `tax-xml`, `bank` parsers) always uses this kind, with fixtures from `testdata/` or inline.

Always:

- Paste the rules and spec lines the step needs into §2. The executor does not open `docs/v3/`.
- Name every file. Number every step. One step changes one file.
- Every step ends with its command and the expected result.
- Acceptance is checkable by a command or a visible fact.
- The executor can't push to `main`, merge, set secrets or create accounts. The brief says what to hand to the owner.
- One brief owns each piece of copy. A replaced brief is marked `Status: replaced by NNNN` in the same commit.

## Update triggers

| When this changes | Update |
|---|---|
| A dependency or vendor | 03 architecture and a decisions line with the reason |
| A table or column | `docs/v3/05-data-model.md`, the migration, the RLS test |
| A personal-data field or a processor | 05 retention section and a decisions line |
| A law-driven number | `packages/domain/rules` only, plus its source link (06) |
| A package or app | the [test-map](test-map.md) row |
| A hard rule | the AGENTS.md one-liner and the [rules](rules.md) section |
| A workflow, tool or model | a `[workflow]` decision, then this file, then [prompts](prompts.md) |
| A bug found or fixed | a [known-issues](known-issues.md) row added or deleted |

## Compaction

- If the lint reports a file over its cap, summarise it in the same session.
- `decisions.md`: move lines older than 90 days that nothing references to `docs/archive/decisions-YYYY.md`.
- Briefs and reports `done` for more than 60 days move to `docs/archive/tasks-YYYY/`.
- Never move live rules into the archive.
