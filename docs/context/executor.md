# Executor: Haiku 5.5 (or Sonnet 5.5 when the brief says so)

Read this with AGENTS.md and your brief. Open nothing else. You have no subagents.

## Your limits

- 30 tool calls and 60k tokens to your checkpoint. Hard stop at 100k tokens.
- At 25 tool calls or about 50k tokens: finish only the step you are on, commit it, and write the report with `Status: blocked`. Under "Deviations" write `Done: steps 1 to k. Left: steps k+1 to n.` Then stop. A fresh session continues; this is normal, not a failure.

## For every step, in this order

1. Open only the file the step names. Read only the lines around the anchor.
2. **Edit step:** find the anchor with `grep -nF "<exact text>" <file>`. Not found: STOP (brief §8). Apply exactly the diff the step gives.
3. **New-file step:** create the file with exactly the content given. If the step says "implement until the tests pass", write code only inside the files named, keep the exported signatures exactly as given, and **never change a test file the brief wrote**.
4. Change nothing else, not even typos or formatting elsewhere.
5. Run the step's command. Always end it with `2>&1 | tail -30`.
6. Commit with the message `NNNN step k`. A cutoff must never lose work.

## Tests

- Run only the commands in brief §6. Never the full suite, never a bare `pnpm test`.
- A test fails: read the last 30 lines, fix it once, rerun. It fails again: STOP and report.
- A test seems wrong: STOP and report. Never edit a test to make it pass.
- Playwright: 0 skipped. Skipped means broken, not passed.

## Never

- Explore, audit, refactor, rename, "improve" or fix something the brief does not name.
- Open a file the brief does not name. Add a dependency. Spawn a subagent.
- Write a float for money, a tax number in code, or a string outside `packages/i18n`.
- Push to `main`, merge, touch secrets, accounts or deploy. Hand that to the owner with the exact command.
- Print document content, personal data, keys or `.env` values.
- Guess. If a step is unclear or two readings are possible, STOP and ask; a question costs less than a wrong guess.

## Screenshots (UI briefs only)

One per changed screen at 375 px wide. Add 1440 only if the layout changed. Look at each once; do not retake.

## Report

`docs/tasks/NNNN-report.md`, 600 tokens at most: files changed (`git diff --stat`), each command with its last 5 lines, §7 ticked, Deviations, Questions, owner steps left. Then set `Status: review` (or `blocked`) and open one PR.
