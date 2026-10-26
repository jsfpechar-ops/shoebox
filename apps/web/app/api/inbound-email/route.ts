import { createInboundEmailStore, type InboundEmailStore } from '@shoebox/db/inbound-email';
import { createSupabaseBlobStore } from '@shoebox/platform';
import { enqueueEmailReceived } from '../../../src/documents/enqueue';
import { handleInboundEmail, INBOUND_MAX_BYTES } from '../../../src/inbound-email/webhook';

export const runtime = 'nodejs';

let store: InboundEmailStore | undefined;

/** Called by the Cloudflare mail worker only; signed, no session (M01 §4.1.2). */
export async function POST(request: Request): Promise<Response> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > INBOUND_MAX_BYTES) return Response.json({ error: 'too_large' }, { status: 413 });
  const databaseUrl = process.env.DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!databaseUrl || !supabaseUrl || !serviceKey)
    return Response.json({ error: 'retry' }, { status: 503 });
  store ??= createInboundEmailStore(databaseUrl);
  const blobs = createSupabaseBlobStore({ url: supabaseUrl, apiKey: serviceKey });
  const db = store;
  const result = await handleInboundEmail(
    {
      secret: process.env.SHOEBOX_INBOUND_WEBHOOK_SECRET ?? '',
      findOrg: (slug, secret, now) => db.findOrg(slug, secret, now),
      putEml: async (path, body) => {
        try {
          await blobs.put(path, body, 'message/rfc822');
        } catch (error) {
          // The same mail stored before: the object already exists, which is fine.
          if (
            !(
              error instanceof Error &&
              'status' in error &&
              (error.status === 409 || error.status === 400)
            )
          )
            throw error;
        }
      },
      insertEmail: (row) => db.insertEmail(row),
      enqueue: enqueueEmailReceived,
      now: () => new Date(),
    },
    {
      to: request.headers.get('x-shoebox-to') ?? '',
      from: request.headers.get('x-shoebox-from'),
      signature: request.headers.get('x-shoebox-signature'),
      body: new Uint8Array(await request.arrayBuffer()),
    },
  );
  return Response.json(result.body, { status: result.status });
}
