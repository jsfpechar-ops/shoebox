# Prompts (paste as-is; replace NNNN)

## Orchestrator start

```
Shoebox repo. You are the orchestrator. Read AGENTS.md and docs/context/status.md only, then the routed files for this task. No audits. Ask me if unclear. Task: <one sentence>
```

## Next ticket

```
Shoebox orchestrator. Read AGENTS.md and docs/context/workflow.md#flow. Take the next ticket from docs/v3/backlog.md whose dependencies are done. Write its brief(s) in docs/tasks/ from TEMPLATE.md, then spawn one executor per brief (model: haiku unless the header says Sonnet 5.5) and review the reports.
```

## Phase run

```
Shoebox orchestrator (Opus 5.5). Read AGENTS.md and docs/context/workflow.md#phase-run. Run Phase N: on branch phase/N, take every ticket whose dependencies are merged there, write its briefs (HIGH-risk and Fable-listed tickets: one Fable subagent writes them), spawn executors (up to 4 in parallel when files don't overlap), review each PR and merge it into phase/N. Keep docs/tasks/phase-N-gate.md current. Stop at the GATE ticket and open phase/N -> main for me.
```

## Executor

```
You are the executor (Haiku 5.5). Read AGENTS.md, docs/context/executor.md, then docs/tasks/NNNN-*.md. Follow it exactly, in order. Open only the files it names. If any stop condition in §8 happens, stop and write the report. Finish by writing docs/tasks/NNNN-report.md in the §9 format and opening one PR.
```

## Review

```
Shoebox orchestrator. Review task NNNN: read AGENTS.md, docs/tasks/NNNN-*.md and NNNN-report.md, then follow docs/context/workflow.md#flow step 4. Don't read other files unless they're on the risk list.
```

## End of session

```
Close out: update docs/context/status.md (5 lines at most), append decisions and known-issues, run python3 scripts/context_lint.py, and list anything I must do.
```

## Yearly tax update (October)

```
Shoebox orchestrator. Read AGENTS.md and docs/v3/06-maintenance-playbook.md (the Annual Update Window section only). List what changed for next year with a primary source for each, then write one brief per rule-table change.
```
