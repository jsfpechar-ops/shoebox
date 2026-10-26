# 0411: Nightly encrypted database backup (free GitHub Action)

Status: todo
Ticket: lane D, platform (Phase 1 "backups") | Depends on: none | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Every night a GitHub Action dumps the database, encrypts it with a passphrase and keeps two copies: one in a private Supabase Storage bucket `backups` (EU, 7 rotating files by weekday) and one as a 30-day Action artifact. Supabase's free plan has no backups. Until the owner sets the secrets the job exits green with a notice.

## 2. Context

- Owner decision 2026-10-26 (decisions.md): gpg AES256, passphrase only in a repo secret; Supabase EU bucket + 30-day artifact.
- Secrets the owner adds later: `BACKUP_DATABASE_URL` (Supabase session-pooler URL, port 5432), `BACKUP_PASSPHRASE`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Supabase runs Postgres 17: the runner needs `pg_dump` 17 from the PGDG apt repo.
- Bucket creation pattern: `packages/db/migrations/0008_storage.sql` (guarded `do $$ … if to_regclass('storage.objects') is null … $$`, `insert into storage.buckets (id, name, public) values (…) on conflict (id) do nothing`). No policies: only the service role reaches it.
- Actions are pinned by SHA (see `.github/workflows/ci.yml`): `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2`.
- Never print the URL, passphrase or dump content.

## 3. Files

| Path | Action |
|---|---|
| `packages/db/migrations/0051_backups_bucket.sql` | new |
| `packages/db/migrations/meta/_journal.json` | edit: one entry |
| `.github/workflows/backup.yml` | new |
| `docs/context/known-issues.md` | edit: one line |

## 4. Steps

1. New `0051_backups_bucket.sql`:
   ```sql
   -- 0051_backups_bucket: private bucket for the nightly encrypted dump (.github/workflows/backup.yml).
   -- No storage policies: only the service role reads or writes it. Forward-only.
   do $$
   begin
     if to_regclass('storage.objects') is null then
       raise notice '0051_backups_bucket: storage.objects absent, bucket skipped';
       return;
     end if;
     insert into storage.buckets (id, name, public) values ('backups', 'backups', false)
       on conflict (id) do nothing;
   end
   $$;
   ```
   Journal: after the last entry add `{ "idx": <last idx + 1>, "version": "7", "when": 1792975329186, "tag": "0051_backups_bucket", "breakpoints": true }` (multi-line like the others). `pnpm --filter @shoebox/db exec drizzle-kit check 2>&1 | tail -5`, then `DATABASE_URL=postgresql://postgres@127.0.0.1:54399/shoebox_test pnpm --filter @shoebox/db test -- migrations 2>&1 | tail -10`.
2. New `.github/workflows/backup.yml`:
   ```yaml
   name: Nightly backup

   # Encrypted pg_dump of the Supabase database (decisions 2026-10-26). Two copies: Supabase Storage
   # bucket `backups` (EU, db-<weekday>.dump.gpg, 7 rotating files) and a 30-day artifact.
   # Restore: gpg --decrypt db-Mon.dump.gpg > db.dump; pg_restore --no-owner -d "$TARGET_URL" db.dump
   on:
     schedule:
       - cron: '30 2 * * *'
     workflow_dispatch:

   permissions:
     contents: read

   concurrency:
     group: backup
     cancel-in-progress: false

   jobs:
     backup:
       runs-on: ubuntu-24.04
       timeout-minutes: 30
       env:
         BACKUP_DATABASE_URL: ${{ secrets.BACKUP_DATABASE_URL }}
         BACKUP_PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}
         SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
         SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
       steps:
         - name: Secrets present?
           id: check
           run: |
             if [ -z "$BACKUP_DATABASE_URL" ] || [ -z "$BACKUP_PASSPHRASE" ]; then
               echo "::notice::Backup secrets are not set yet; nothing to do."
               echo "ready=false" >> "$GITHUB_OUTPUT"
             else
               echo "ready=true" >> "$GITHUB_OUTPUT"
             fi
         - name: Install pg_dump 17
           if: steps.check.outputs.ready == 'true'
           run: |
             sudo apt-get update -qq
             sudo apt-get install -y -qq postgresql-common
             sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
             sudo apt-get install -y -qq postgresql-client-17
         - name: Dump and encrypt
           if: steps.check.outputs.ready == 'true'
           run: |
             set -euo pipefail
             umask 077
             /usr/lib/postgresql/17/bin/pg_dump --format=custom --no-owner --no-privileges \
               --schema=public --schema=auth --schema=storage --schema=app \
               --file=db.dump "$BACKUP_DATABASE_URL"
             gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" \
               --symmetric --cipher-algo AES256 --output db.dump.gpg db.dump
             rm -f db.dump
             echo "Encrypted dump: $(stat -c %s db.dump.gpg) bytes"
         - name: Copy to Supabase Storage (EU)
           if: steps.check.outputs.ready == 'true' && env.SUPABASE_URL != ''
           run: |
             set -euo pipefail
             name="db-$(date -u +%a).dump.gpg"
             curl --fail --silent --show-error -X POST \
               "$SUPABASE_URL/storage/v1/object/backups/$name" \
               -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
               -H "x-upsert: true" \
               -H "Content-Type: application/octet-stream" \
               --data-binary @db.dump.gpg > /dev/null
             echo "Stored backups/$name"
         - name: Keep a 30-day artifact
           if: steps.check.outputs.ready == 'true'
           uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
           with:
             name: db-backup-${{ github.run_id }}
             path: db.dump.gpg
             retention-days: 30
             if-no-files-found: error
   ```
   Check it parses: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/backup.yml')); print('ok')" 2>&1 | tail -2`.
3. `docs/context/known-issues.md`: append one line in the file's existing format (read its last 5 lines first): the backup covers the database only, not the original files in Storage (`org-files`); a file backup is a later brief. Run `python3 scripts/context_lint.py 2>&1 | tail -3` (OK).

## 5. Do not touch

`ci.yml`, other migrations. Never print secrets or dump content. Hard rules 4, 8.

## 6. Commands

As in the steps.

## 7. Acceptance

- [ ] drizzle-kit check passes; migrations db tests pass; workflow YAML parses; context lint OK.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0411-report.md`, 150 tokens at most. Set `Status: review`. Owner steps (secrets) are listed by the orchestrator, not in the report.
