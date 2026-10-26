// Downloads every object of a Supabase Storage bucket into a folder (weekly file backup in
// .github/workflows/backup.yml). Usage: node scripts/backup-storage.mjs <bucket> <outDir>, with
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set. Prints counts only, never paths.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const [bucket, outDir] = process.argv.slice(2);
const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!bucket || !outDir || !base || !key) {
  console.error(
    'usage: backup-storage.mjs <bucket> <outDir> (needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)',
  );
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
      body: JSON.stringify({
        prefix,
        limit: PAGE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      }),
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
    if (item.name.includes('..') || item.name.includes('\\'))
      throw new Error('unexpected object name');
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
