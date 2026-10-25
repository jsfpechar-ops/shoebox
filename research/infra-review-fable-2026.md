# Infra review (second opinion): is Option A right, and does an all-in-one exist?

**As of:** 2026-10-18. **Reviewer:** Fable 5.1, independent of the Opus agent that wrote `infra-ecosystems-2026.md`. **Method:** WebFetch of primary vendor docs, access date 2026-10-18 for every [O] line. Labels: **[O]** observed · **[I]** inference · **[?]** not confirmed.

## 0. Verdict: agree with changes

The research's main conclusions hold: keep Supabase + Cloud Run + Vertex `eu` + Cloudflare inbound + SES. Its five decision-relevant facts check out (section 1). Three things need changing: (a) the Vertex `eu` wording must carry Google's own caveat that endpoints "don't guarantee data residency"; (b) the regional token premium is a known number (≈10 %), not [?]; (c) the MVP infra cost is a little low, LLM spend must be shown next to it. The all-in-one answer is **no**: a Supabase-only stack breaks on the worker (section 2). Scaling: nothing in Option A hits a wall before the NFR target of 10k tenants / 200k docs a month; the first component to need money is the Supabase compute tier, then worker autoscaling (section 3).

## 1. Spot-check of the research's [O] claims

| # | Claim in research | Finding | Status |
|---|---|---|---|
| 1 | Claude on Vertex EU only as multi-region `eu`, host `aiplatform.eu.rep.googleapis.com` | **[O]** Confirmed. `eu` lists Haiku 5.5, Sonnet 5.5, Opus 5.5 and older. Same page: "Endpoints don't guarantee data residency or in-region ML processing." https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations | Correct, but the caveat must go into ADR-011 |
| 2 | Bedrock EU = `eu.` cross-region only for 5.5 models | **[O]** Confirmed for Haiku 5.5 and Sonnet 5.5: all eight `eu-*` regions show in-region "not-supported", geo and global "supported". Opus 5.5 additionally shows in-region in eu-west-2 (London, non-EU). https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html | Correct |
| 3 | Azure Foundry: Azure-hosted Claude = "Global Standard and Data Zone Standard (US)" only | **[O]** Confirmed verbatim (page dated 2026-09-21). "Hosted on Anthropic": "Data might be processed outside Azure". https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/claude-models-hosting-comparison | Correct; Azure stays out |
| 4 | Cloud Run worker pools GA 2026-04-14 | **[O]** Confirmed: release note 2026-04-14 "Support for worker pools is in General Availability (GA)". Preview since 2025-06-25. https://docs.cloud.google.com/run/docs/release-notes | Correct |
| 5 | Cloudflare Email Service sending is beta, $0.35/1k after 3,000 free, Workers Paid | **[O]** Overview: "Email Sending Beta … Available on Workers Paid plan". Pricing page: "3,000 included per month", "$0.35 per 1,000 emails". No data-location statement on either page. https://developers.cloudflare.com/email-service/ · https://developers.cloudflare.com/email-service/platform/pricing/ | Correct |
| 6 | Supabase EU (Frankfurt) | **[O]** EU member-state regions: `eu-west-1` Ireland, `eu-west-3` Paris, `eu-central-1` Frankfurt, `eu-north-1` Stockholm. `eu-west-2` London and `eu-central-2` Zurich are "Europe" but not EU; the generic "Europe" option may land there. https://supabase.com/docs/guides/platform/regions | Correct; always pick `eu-central-1` explicitly |

**Corrections and additions**

- **Regional premium is known.** Anthropic's pricing docs state regional/multi-region endpoints carry a 10 % premium over global; aggregators list Haiku 5.5 on Vertex `eu` at $0.11 in / $0.55 out per 1M tokens (global $0.10 / $0.50; >100k-token prompts $0.50 / $2.50) [I, from https://platform.claude.com/docs/en/about-claude/pricing via search and https://www.edenai.co/models/claude-haiku-5-5; not read on Google's pricing page, which is JS-rendered]. The research's [?] on this can close: budget +10 % for EU.
- **ADR-011 wording.** Replace "`europe-west*`" with "Vertex AI multi-region `eu`". Add: Google's multi-region keeps ML processing inside the EU jurisdiction, but the endpoint alone is not a residency guarantee; the privacy policy must name Google (and Anthropic) as sub-processors and reference Google's data-residency terms [I].
- **Cloud Run worker-pool price.** Google's pricing page is JS-rendered and could not be read [?]. Instance-based service pricing is $0.000018/vCPU-s and $0.000002/GiB-s (Tier 1), with 240k vCPU-s and 450k GiB-s free per month [O, via search of https://cloud.google.com/run/pricing]. One always-on 1 vCPU / 1 GiB instance is ≈ $48/month at service rates before the free tier; the "~40 % cheaper" worker-pool figure is second-hand. The research's "$15–35" is only reachable with the discount or a 0.5 vCPU instance. I put the worker at **$25–50**.

## 2. "Isn't there a service that does everything at once?"

Short answer: no. Every all-in-one fails on the same piece, the per-document worker (PDF rasterising, OCR pre-processing, 10–60 s LLM calls with retries and a DLQ) plus EU-pinned Claude.

**Supabase-only** (Postgres + RLS, Auth, Storage, Edge Functions, Queues, Cron)

- What works: database, RLS, Auth, Storage (file limit up to 500 GB on Pro [O] https://supabase.com/docs/guides/storage/uploads/file-limits), pg_cron for nightly jobs. Supabase Queues is "built on the pgmq database extension" and delivers each message once "within a customizable visibility window" [O] https://supabase.com/docs/guides/queues. The exposed API is `send`, `send_batch`, `read`, `pop`, `archive`, `delete`; retries, dead-letter queues and delayed messages are not documented [O] https://supabase.com/docs/guides/queues/api. **[I]** Transactional enqueue is preserved (it is Postgres), but the DLQ, backoff and idempotency of ADR-003 would be rebuilt by hand from `read_ct`, while pg-boss gives them for free on the same database.
- What breaks: Edge Functions have **2 s CPU time per request**, **256 MB memory**, 400 s wall-clock on Paid, 150 s request idle timeout [O] https://supabase.com/docs/guides/functions/limits. **[I]** 2 s of CPU rules out PDF rasterising and OCR pre-processing per document; the LLM call itself fits (it is I/O), but the function cannot be the worker. There is no long-lived process, so pg-boss cannot run at all; consumers would be pg_cron → pg_net → Edge Function polling, with the 2 s CPU cap applying to each invocation.
- Residency: Edge Functions "automatically execute in the region closest to the user making the request"; pinning needs the `x-region` header or the client `region` option (EU values `eu-central-1`, `eu-central-2`, `eu-west-1`, `eu-west-2`, `eu-west-3`) [O] https://supabase.com/docs/guides/functions/regional-invocation. **[I]** Every caller, including the Cloudflare Email Worker and Auth hooks, must pin, or document processing runs wherever the request came from; the default violates 03 §4.
- Claude: an Edge Function can call Vertex `eu` or Bedrock `eu.` over HTTPS with a service-account token (Google OAuth via a JWT signed in Deno, or AWS SigV4). **[I]** Feasible, but Vertex still has to exist as a second platform; "Supabase-only" is really "Supabase + GCP" anyway.
- **Verdict [I]:** Supabase-only removes the worker container and loses the worker. It is not a platform reduction, it moves the hardest part onto the weakest runtime.

**Firebase / Google-only.** Firestore is the wrong fit for money and RLS (ADR-002 was explicit); Google-only with Cloud SQL + Identity Platform is Option D in the research, which stands: auth and RLS rewrite mid-Phase-0, and no first-party mail [O, research §6]. Functions 2nd gen are Cloud Run underneath, so the "serverless" win is cosmetic [I].

**Vercel + Supabase.** Vercel hosts Next.js well, but serverless functions are request-bound and US-centred by default; Fluid compute can be pinned to `fra1`, yet there is still no place for an always-on pg-boss worker, so Cloud Run (or a Vercel-external container) comes back. Net effect: one more platform, not one fewer [I]. Vercel is a reasonable web host only if the owner strongly prefers its DX; it does not change the worker question.

**What would actually be "one service":** a single cloud where DB, auth, storage, container worker, queue and EU Claude all exist first-party. That is GCP (Option D) or AWS (Option C), and both replace Supabase Auth and every RLS policy. The research's ranking of that trade (bad in Phase 0) is right.

## 3. Scaling Option A

Assumptions per the research: MVP = 50 orgs, 5k docs/month, ~0.5 MB per file. Claude Haiku 5.5 for extraction (~5k input, ~0.5k output tokens per doc), Sonnet 5.5 escalations ~10 % of docs. 03 §4 target: 10k tenants, 200k docs/month "without re-architecture".

| Scale | Orgs / docs per month | Jobs/s (avg, 3× peak) | Postgres (Supabase) | Worker | LLM $/month [I] | Infra $/month [I] | First limit hit |
|---|---|---|---|---|---|---|---|
| 1× MVP | 50 / 5k | 0.002 / 0.006 | Pro + Micro (1 GB) $25 | 1 instance 1 vCPU | $10–30 | $55–90 | none |
| 10× | 500 / 50k | 0.02 / 0.06 | Pro + Small/Medium (2–4 GB) $40–85; storage +25 GB/month | 1–2 instances | $100–300 | $120–250 | Supabase storage free 100 GB passes in month 4 ($0.0213/GB after [O] https://supabase.com/pricing) |
| 100× | 5,000 / 500k | 0.2 / 0.6 | Pro + Large/XL (8–16 GB, dedicated vCPU) $135–235; disk ~50–100 GB; storage +250 GB/month (~$5/month more each month) | 3–6 instances, autoscaled (CREMA/KEDA) | $1,000–3,000 | $500–1,000 | Vertex quota (TPM) at month-end peaks; Supabase Team plan ($599) if an SLA or SOC 2 letter is required by accountants |

- **[I]** pg-boss is nowhere near its ~50 jobs/s revisit line even at 100× (0.6 jobs/s peak). The queue is not the bottleneck; the DB tier is a dial, not a migration.
- **[I]** The worker scales horizontally today: pg-boss is multi-consumer by design. Worker pools do not autoscale by themselves [O, research §3]; at 10× set 2 instances by hand, at 100× add the CREMA autoscaler keyed on the pg-boss queue depth. No code change.
- **[I]** Storage: 100× means ~3 TB/year, ~$65/month per TB on Supabase. If this bites, `BlobStore` (ADR-004) swaps to R2 (EU jurisdiction) in a config change; keep storage RLS until then.
- **[I]** The 100× LLM bill dominates everything else by 2–3×. Vendor memory and ISDOC/QR skips (ADR-011 guardrails) are the real cost lever, not the infra choice.
- **Corner check [I]:** nothing in Option A requires re-architecture up to and past the 03 §4 target. The sticky parts are Supabase Auth (`auth.jwt()` in RLS) and Supabase Storage RLS. Leaving Supabase at 100× would be a 2–4 week migration (Postgres dump to Cloud SQL, claims via `set_config`), not a rewrite. That is acceptable lock-in for a solo founder.

## 4. MVP cost: confirm with a small correction

- Supabase Pro $25 (includes $10 compute credit = Micro), 8 GB disk, 100 GB storage, 250 GB egress [O] https://supabase.com/pricing.
- Cloud Run web: $0–10 (scale to zero). Worker: **$25–50** (see section 1). SES < $1 [O, research]. Cloudflare $0. Sentry free.
- **Infra: $55–90/month** (research said $45–75; the worker line was optimistic). Add **LLM $10–30/month** at 5k docs on Haiku 5.5 `eu` with ~10 % Sonnet escalations [I]. **All-in ≈ $65–120/month.**

## 5. Final recommendation and decision lines

Keep Option A. Do not replatform; do not move the worker into Edge Functions. Lines for the owner to approve:

1. **decisions.md [stack]:** "Keep Supabase (eu-central-1) + Cloud Run (web service + worker pool) + Vertex AI Claude multi-region `eu` + Cloudflare inbound + SES eu-central-1. Reviewed `research/infra-ecosystems-2026.md` and `research/infra-review-fable-2026.md`. All-in-one (Supabase-only, Firebase, Vercel) rejected: no runtime for the long-running worker (2 s CPU / 256 MB on Edge Functions)." (owner)
2. **ADR-011 edit:** "Endpoint: Vertex AI multi-region `eu` (`aiplatform.eu.rep.googleapis.com`), +10 % token premium over global. Google states endpoints alone do not guarantee data residency; the privacy policy lists Google Cloud and Anthropic as sub-processors with the multi-region jurisdiction terms. Fallback: Bedrock `eu.` cross-region profile (includes London and Zurich, needs its own sub-processor note)." Known-issues line: "ADR-011 said `europe-west*`; no single EU region exists for Claude 5.5 on Vertex."
3. **ADR-002 edit:** "Region is pinned explicitly to `eu-central-1`, never the generic 'Europe' option (may deploy to London or Zurich)."
4. **ADR-003 / 03 deployment note:** "Worker = Cloud Run worker pool, 1 instance (1 vCPU, 1 GiB). At >0.05 jobs/s set 2 instances; at >0.2 jobs/s add the CREMA autoscaler on queue depth. pg-boss revisit line (~50 jobs/s) is unchanged."
5. **D-07 confirm:** SES eu-central-1. Dated reminder: "Re-check Cloudflare Email Service at GA + EU data statement."
6. **Budget line:** "MVP run-rate $65–120/month incl. LLM; 10× ≈ $250–550; 100× ≈ $1.5k–4k, LLM-dominated."
