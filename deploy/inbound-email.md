# Turning on the e-mail inbox

The code is ready: a Cloudflare Email Worker (`apps/email-worker`) receives each mail and POSTs it, signed, to `/api/inbound-email`; the worker job `email.received` turns attachments into documents. It needs a domain. Everything below is free except the domain (about 250 Kč a year).

## Steps for Josef

1. Buy the domain (for example `sysel.cz`) at any Czech registrar.
2. Create a free Cloudflare account at dash.cloudflare.com, click **Add a domain**, type the domain, pick the **Free** plan, and change the domain's nameservers at the registrar to the two Cloudflare shows.
3. In Cloudflare open the domain, then **Email** › **Email Routing** › **Get started**. Add the records it offers for the subdomain `in` (so addresses look like `firma-ab12cd34@in.sysel.cz`).
4. Make a long random secret: on any computer run `openssl rand -hex 32`, or ask Claude for one. Keep it for steps 5 and 6.
5. In Render open the `shoebox-test` service › **Environment** and add:
   - `SHOEBOX_INBOUND_WEBHOOK_SECRET` = the secret from step 4
   - `SHOEBOX_INBOUND_DOMAIN` = `in.sysel.cz` (your domain with `in.` in front)
   Save; Render redeploys.
6. Deploy the mail worker (Claude can do this in a session with your Cloudflare API token): from `apps/email-worker`, set `INBOUND_URL` in `wrangler.toml` to `https://shoebox-test.onrender.com/api/inbound-email`, then `npx wrangler deploy` and `npx wrangler secret put INBOUND_WEBHOOK_SECRET` (paste the step 4 secret).
7. In Cloudflare **Email Routing** › **Routing rules** › **Catch-all address**: action **Send to a Worker**, worker `sysel-mail`. Save.
8. Test: send an invoice PDF from your own mailbox to the address shown at the end of the firm setup. It appears in the Inbox within a minute (longer if Render was asleep; the sending server retries).

## Notes

- A mail that fails both SPF and DKIM is stored but held back (not read). There is no screen to release it yet.
- `+banka` addresses are stored for the Phase 2 bank-notice import and create no documents yet.
- Inline signature images, calendar invites and tiny logos are skipped. HEIC and Office files in e-mail are skipped for now.
