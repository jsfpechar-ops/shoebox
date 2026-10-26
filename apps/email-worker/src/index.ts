export const packageName = '@shoebox/email-worker' as const;

export interface EmailMessageLike {
  readonly from: string;
  readonly to: string;
  readonly rawSize: number;
  readonly raw: ReadableStream<Uint8Array>;
  setReject(reason: string): void;
}

export interface MailWorkerEnv {
  readonly INBOUND_URL: string;
  readonly INBOUND_WEBHOOK_SECRET: string;
}

export const MAX_MAIL_BYTES = 25 * 1024 * 1024;

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** `t=<unix>,v1=<hex HMAC-SHA256(secret, `${t}.${text}`)>`, Web Crypto only. */
export async function signBody(
  secret: string,
  text: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${nowSeconds}.${text}`));
  return `t=${nowSeconds},v1=${toHex(mac)}`;
}

export async function forwardEmail(
  message: EmailMessageLike,
  env: MailWorkerEnv,
  doFetch: typeof fetch = fetch,
  nowSeconds?: number,
): Promise<void> {
  if (message.rawSize > MAX_MAIL_BYTES) {
    message.setReject('Message too large (max 25 MB)');
    return;
  }
  const body = await new Response(message.raw).arrayBuffer();
  const sha = toHex(await crypto.subtle.digest('SHA-256', body));
  const signature = await signBody(
    env.INBOUND_WEBHOOK_SECRET,
    `${message.to}\n${sha}`,
    nowSeconds,
  );
  const response = await doFetch(env.INBOUND_URL, {
    method: 'POST',
    headers: {
      'content-type': 'message/rfc822',
      'x-shoebox-to': message.to,
      'x-shoebox-from': message.from,
      'x-shoebox-signature': signature,
    },
    body,
  });
  if (response.status === 404) {
    message.setReject('Unknown recipient');
    return;
  }
  if (response.status === 413) {
    message.setReject('Message too large (max 25 MB)');
    return;
  }
  if (response.status === 200 || response.status === 202) {
    return;
  }
  // Any other answer: throw so Cloudflare tells the sender to retry later.
  throw new Error(`Inbound endpoint answered ${response.status}`);
}

export default {
  email: (message: EmailMessageLike, env: MailWorkerEnv) => forwardEmail(message, env),
};
