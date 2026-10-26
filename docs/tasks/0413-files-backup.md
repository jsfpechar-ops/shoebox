# 0413: Weekly encrypted backup of the original files

Status: todo
Ticket: lane D, K-D02 | Depends on: 0411 | Branch: claude/project-thread-yn56ih | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Every Sunday the backup workflow also copies every original file in the Storage bucket `org-files`, packs it, encrypts it with the same passphrase and keeps it as a 30-day Action artifact. Together with the nightly database dump, a lost Supabase project can be rebuilt.

## 2. Context

- `.github/workflows/backup.yml` (0411) has one job `backup` on cron `30 2 * * *`. Secrets: `BACKUP_PASSPHRASE`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (plus `BACKUP_DATABASE_URL` for the dump).
- The free Supabase plan has 1 GB of storage, so the file copy is not written back to Supabase: artifact only (decision line in step 4).
- Supabase Storage REST: `POST {url}/storage/v1/object/list/{bucket}` with `{prefix, limit, offset, sortBy}` lists one folder level (a folder has `id: null`); `GET {url}/storage/v1/object/{bucket}/{path}` downloads with the service key.
- Never print file names or paths (they can hold personal data): counts only.
- Biome lints `scripts/**` (console allowed there).

## 3. Files

| Path | Action |
|---|---|
| `scripts/backup-storage.mjs` | new (below) |
| `.github/workflows/backup.yml` | edit |
| `docs/context/decisions.md` | edit: extend the 2026-10-26 [deps/ops] line |
| `docs/context/known-issues.md` | edit: delete the K-D02 row |

## 4. Steps

1. New `scripts/backup-storage.mjs`:
   ```js
   // Downloads every object of a Supabase Storage bucket into a folder (weekly file backup in
   // .github/workflows/backup.yml). Usage: node scripts/backup-storage.mjs <bucket> <outDir>, with
   // SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set. Prints counts only, never paths.
   import { mkdir, writeFile } from 'node:fs/promises';
   import { dirname, join } from 'node:path';

   const [bucket, outDir] = process.argv.slice(2);
   const base = process.env.SUPABASE_URL;
   const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
   if (!bucket || !outDir || !base || !key) {
     console.error('usage: backup-storage.mjs <bucket> <outDir> (needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
     process.exit(2);
   }
   const headers = { Authorization: `Bearer ${key}`, apikey: key };
   const PAGE = 1000;

   async function list(prefix) {
     const items = [];
     for (let offset = 0; ; offset += PAGE) {
       const res = await fetch(`${base}/storage/v1/object/list/${bucket}`, {
         method: 'POST',
         headers: { ...headers, 'content-type': 'application/json' },
         body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
       });
       if (!res.ok) throw new Error(`list failed: HTTP ${res.status}`);
       const page = await res.json();
       items.push(...page);
       if (page.length < PAGE) return items;
     }
   }

   let files = 0;
   let bytes = 0;

   async function walk(prefix) {
     for (const item of await list(prefix)) {
       if (item.name.includes('..') || item.name.includes('\\')) throw new Error('unexpected object name');
       const path = prefix ? `${prefix}/${item.name}` : item.name;
       if (item.id === null) {
         await walk(path);
         continue;
       }
       const url = `${base}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
       const res = await fetch(url, { headers });
       if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
       const body = new Uint8Array(await res.arrayBuffer());
       const target = join(outDir, path);
       await mkdir(dirname(target), { recursive: true });
       await writeFile(target, body);
       files += 1;
       bytes += body.length;
     }
   }

   await walk('');
   console.log(`Downloaded ${files} files, ${bytes} bytes`);
   ```
   Check: `node --check scripts/backup-storage.mjs 2>&1 | tail -3` and `node scripts/backup-storage.mjs 2>&1 | tail -2` (prints the usage line, exit 2).
2. `.github/workflows/backup.yml`:
   - Under `schedule:` add a second line `- cron: '0 3 * * 0'` and change the comment's first line to `# Encrypted backups (decisions 2026-10-26). Nightly: pg_dump of the Supabase database, two copies:`; after the restore line add `# Weekly (Sunday): every original file in the bucket org-files, as a 30-day artifact only (free plan: 1 GB).` and `# Restore files: gpg --decrypt files.tar.gpg | tar -x; then upload the files/ tree back to org-files.`
   - On the `backup` job add, right under `backup:`, `    if: github.event_name == 'workflow_dispatch' || github.event.schedule == '30 2 * * *'`.
   - Append a second job at the end:
   ```yaml
     files:
       if: github.event_name == 'workflow_dispatch' || github.event.schedule == '0 3 * * 0'
       runs-on: ubuntu-24.04
       timeout-minutes: 60
       env:
         BACKUP_PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}
         SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
         SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
       steps:
         - name: Secrets present?
           id: check
           run: |
             if [ -z "$BACKUP_PASSPHRASE" ] || [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
               echo "::notice::File backup secrets are not set yet; nothing to do."
               echo "ready=false" >> "$GITHUB_OUTPUT"
             else
               echo "ready=true" >> "$GITHUB_OUTPUT"
             fi
         - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
           if: steps.check.outputs.ready == 'true'
         - name: Download, pack and encrypt
           if: steps.check.outputs.ready == 'true'
           run: |
             set -euo pipefail
             umask 077
             node scripts/backup-storage.mjs org-files files
             tar -cf files.tar files
             rm -rf files
             gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" \
               --symmetric --cipher-algo AES256 --output files.tar.gpg files.tar
             rm -f files.tar
             echo "Encrypted files: $(stat -c %s files.tar.gpg) bytes"
         - name: Keep a 30-day artifact
           if: steps.check.outputs.ready == 'true'
           uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
           with:
             name: files-backup-${{ github.run_id }}
             path: files.tar.gpg
             retention-days: 30
             if-no-files-found: error
   ```
   Check it parses: `python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/backup.yml')); print(sorted(d['jobs']))" 2>&1 | tail -2` (prints `['backup', 'files']`).
3. `pnpm exec biome check scripts/backup-storage.mjs 2>&1 | tail -10` (fix with `--write`).
4. `docs/context/decisions.md`: in the line starting `- 2026-10-26 [deps/ops]`, replace `+ 30-day artifact.` with `+ 30-day artifact; weekly gpg-encrypted copy of org-files as a 30-day artifact only (1 GB free plan).` `docs/context/known-issues.md`: delete the `K-D02` row. Run `python3 scripts/context_lint.py 2>&1 | tail -3` (OK).

## 5. Do not touch

`ci.yml`, the `backup` job's steps, migrations. Never print secrets, paths or file content. Hard rules 4, 8.

## 6. Commands

As in the steps.

## 7. Acceptance

- [ ] script passes `node --check` and prints its usage without env; workflow YAML parses with jobs `backup` and `files`; biome clean; context lint OK.

## 8. Stop and ask

As TEMPLATE §8.

## 9. Report

`docs/tasks/0413-report.md`, 150 tokens at most. Set `Status: review`.
