# Infrastructure ecosystems: alternatives to the current stack (2026)

**As of:** 2026-10-18. **Method:** public vendor docs and pricing pages (WebSearch/WebFetch), access date 2026-10-18 for every [O] line. No accounts, no consoles.
**Labels:** **[O]** observed in the source given · **[I]** our inference · **[?]** unknown or not confirmed.
**Question (owner):** "Is serverless still on the table? Show me a different ecosystem." And: why SES for outbound mail, not Google Cloud or Cloudflare?

---

## 0. TL;DR

1. **Serverless is already the plan.** Cloud Run is serverless containers (scale to zero, pay per use). The only non-FaaS piece is the long-running pg-boss worker (ADR-003). Since April 2026, Cloud Run **worker pools** are GA for exactly this kind of pull-based background work [O]. Pure FaaS (Workers, Lambda) would force a rewrite of ADR-003 and lose the "enqueue in the same DB transaction" property [I].
2. **Claude in the EU is the hard constraint, and it rules out two ecosystems.** First-party Anthropic API: `inference_geo` is only `us` or `global`, workspace geo only `us` [O]. Azure Foundry: Azure-hosted Claude offers only Global Standard and Data Zone Standard (US) [O]. EU Claude exists only on **Vertex AI (`eu` multi-region)** and **Bedrock (`eu.` cross-region profiles)** [O].
3. **Finding that changes ADR-011:** on Vertex, Claude Haiku 5.5 is available in **no single region**, only in the global endpoint and the US/EU **multi-region** endpoints (`aiplatform.eu.rep.googleapis.com`, location `eu`) [O]. ADR-011's "`europe-west*`" wording is out of date [I].
4. **Outbound e-mail:** Google Cloud has **no** first-party sending service [O]. Cloudflare Email Service sending is **beta**, priced $0.35/1,000 after 3,000 free [O], with no EU data-location statement found [?]. SES costs $0.10/1,000 [O] and the owner already runs it. **Keep SES (D-07 default).** Look again at Cloudflare at GA, because it would cut the platform count from 4 to 3.
5. **Recommendation:** keep the current stack. Make small corrections (Vertex `eu` endpoint, worker pool for the worker), and try "different stuff" in a contained way (section 8), not by replatforming during Phase 0.

---

## 1. Constraints any ecosystem must meet (from 03 and AGENTS.md)

- Postgres + RLS keyed on `org_id` from JWT claims (ADR-002). Phase 0 is building this now with the Supabase CLI and RLS tests (decisions 2026-10-18 [deps]).
- A job pipeline with retries, a dead-letter queue (DLQ), idempotency and scheduled jobs (ADR-003). Per-document OCR/LLM runs take seconds to a minute (p95 < 60 s, 03 §4).
- All storage and processing in the EU (03 §4 "Data residency"). Claude via an EU endpoint (ADR-011).
- Vendor minimalism, with a yearly maintenance cost for each vendor (ADR-004b). Small budget, solo founder.

## 2. Claude in an EU region: facts per provider

- **[O]** Anthropic first-party API: "Only `"us"` and `"global"` are available" for inference geo; "Workspace geo: Only `"us"` is currently available." https://platform.claude.com/docs/en/manage-claude/data-residency
- **[O]** Anthropic regional compliance page, Europe row: AWS Bedrock "Included", GCP Vertex "Included", Microsoft Foundry "Coming soon". https://claude.com/regional-compliance
- **[O]** Vertex AI, Claude Haiku 5.5 (GA 2026-10-07): availability is "global endpoint", US "Multi-region", Europe "Multi-region". ML processing is US multi-region, Europe multi-region and asia-southeast1. No single EU region is listed. https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/haiku-5-5
- **[O]** Vertex EU multi-region: location `eu`, host `https://aiplatform.eu.rep.googleapis.com`. Multi-region endpoints keep "machine learning processing of Customer Data … within a specific jurisdictional boundary". Claude 5.x models are listed on `us`/`eu`. The same page warns: "Endpoints don't guarantee data residency", see the data-residency page. https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations
- **[O]** Multi-region endpoints for Claude: preview on 2026-04-15, GA on 2026-05-15. "Prices may vary across locations … generally lower on global endpoints." https://cloud.google.com/blog/products/ai-machine-learning/multi-region-endpoints-for-claude-available-on-vertex-ai
- **[O]** Bedrock: Haiku 5.5, Sonnet 5.5 and Opus 5.5 are "not-supported" in-region in any EU region. Geo (EU cross-region inference) is "supported" from eu-central-1, eu-central-2, eu-north-1, eu-south-1, eu-south-2, eu-west-1, eu-west-2 and eu-west-3. https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html
- **[I]** The Bedrock EU geography includes London (eu-west-2) and Zurich (eu-central-2). Both are outside the EU, although they have adequacy decisions. Under a strict reading of 03 §4 ("in the EU"), this needs a sub-processor note or an owner OK. Vertex `eu` avoids the question.
- **[O]** Azure Foundry, "Hosted on Azure": deployment types are "Global Standard and Data Zone Standard (US)". "Hosted on Anthropic": "Data might be processed outside Azure". Anthropic is the data processor in both cases. https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/claude-models-hosting-comparison
- **[O]** Microsoft Q&A (2026-04-25, staff moderator): "even when an EU region such as Sweden Central … is selected, inference execution does not yet occur entirely within Azure-operated data center boundaries"; target "2026". https://learn.microsoft.com/en-sg/answers/questions/5867930/timeline-for-claude-in-microsoft-foundry-to-run-on
- **[I]** Consequence: any ecosystem other than GCP or AWS still needs Vertex or Bedrock as the LLM vendor. That is one extra platform, plus cross-cloud auth (workload identity federation or keys). EU-sovereign clouds (Scaleway, Hetzner, OVH) cannot host Claude themselves.
- **[?]** Claude 5.5 token prices on Vertex `eu` versus global. Prices are per model and region, so check the Vertex pricing page before budgeting. LLM spend is roughly the same in every option below, so it is left out of the infra cost lines.

## 3. Option A: current plan (baseline, with fixes)

Supabase EU (Postgres, Auth, Storage) + Cloud Run (web + worker) + Vertex Claude + Cloudflare inbound + SES outbound + Sentry EU.

- **[O]** Cloud Run worker pools: GA (release notes, 2026-04-14), "for non-HTTP, pull-based background processing". Worker pools list cheaper than instance-billed services and have their own free tier; the second-hand figure is ~40 % less per vCPU-hour. https://docs.cloud.google.com/run/docs/release-notes · https://cloud.google.com/run/pricing
- **[O]** The worker-pool docs say pools do not autoscale by themselves; autoscaling comes from the CREMA/KEDA autoscaler. https://docs.cloud.google.com/run/docs/configuring/workerpools/workerpools-cost-optimization
- **[I]** For the MVP, one worker-pool instance (1 vCPU, 1 GiB) running pg-boss is enough: 5k docs/month is about 0.002 jobs/s, far below ADR-003's ~50 jobs/s revisit line.
- **Changes needed:** ADR-011 endpoint becomes Vertex `eu` multi-region (not `europe-west*`). The 03 deployment note says "worker = Cloud Run worker pool, 1 instance". Nothing in Phase 0 changes.
- **Cost (MVP) [I]:** Supabase Pro ~$25 plus compute, Cloud Run web ~$0–10, worker ~$15–35, SES <$1, Cloudflare $0, Sentry free tier. **About $45–75/month** before LLM.
- **Maintenance [I]:** ~4–6 days/year (03 ADR-004b figures plus Supabase major upgrades).
- **Lock-in [I]:** low to medium. Postgres is portable; Supabase Auth's `auth.jwt()` is the sticky part.

## 4. Option B: Cloudflare-first serverless

Workers (Next.js via OpenNext) + Queues/Workflows + R2 (EU jurisdiction) + Hyperdrive to a Postgres (Supabase or Neon) + Email Routing in + Email Service out + Claude via Vertex/Bedrock.

- **[O]** OpenNext for Cloudflare supports Next.js 16 and the latest 14/15 minors on the Node.js runtime. "Node Middleware … not yet supported." Worker size limit is 10 MiB compressed on Paid. https://opennext.js.org/cloudflare
- **[O]** Workers Paid limits: CPU 30 s default and 5 min max per HTTP request; Queue consumers and Cron run up to 15 min wall time; memory **128 MB per isolate**. https://developers.cloudflare.com/workers/platform/limits/
- **[O]** Workflows: up to 10,000 steps by default (25,000 max); CPU up to 5 min per step; `step.sleep` up to 365 days; 50,000 concurrent instances. https://developers.cloudflare.com/workflows/reference/limits/
- **[O]** R2 EU jurisdiction "guarantee[s] objects in a bucket are stored within a specific jurisdiction"; it is set at creation and cannot be changed. https://developers.cloudflare.com/r2/reference/data-location/
- **[O]** Data Localization Suite: Regional Services limits *TLS termination* to a region (EU available). Workers and Durable Objects (with jurisdiction) are compatible. Under an EU Customer Metadata Boundary, Workers logs and analytics are unavailable. Workers KV and D1 have no jurisdiction support. Queues, Workflows, Hyperdrive and Email Sending are **not listed**. https://developers.cloudflare.com/data-localization/compatibility/ · https://developers.cloudflare.com/data-localization/regional-services/
- **[?]** Whether DLS needs an Enterprise plan; the page does not say. Regional Services is enabled "through your account team" [O, regional-services page]. **[I]** Without DLS, Worker compute runs in whatever PoP serves the request, which breaks the "processing in the EU" NFR for document handling.
- **[I]** 128 MB of memory makes PDF rasterisation and OCR pre-processing (M02) awkward inside a Worker. A container would still be needed (Cloudflare Containers or Cloud Run), which brings the platform count back up.
- **[I]** ADR-003 is replaced by Queues + Workflows. Jobs can no longer be enqueued atomically with the DB write, so an outbox table is needed. The pg-boss DLQ and idempotency design is rewritten.
- **Changes:** ADR-003, ADR-004 (R2 instead of Supabase Storage; storage RLS is lost, so access checks move to code), ADR-004b, the deployment parts of ADR-010, and P0 CI/deploy tickets. Auth can stay on Supabase.
- **Cost (MVP) [I]:** Workers Paid ~$5 base (not re-verified), Postgres ~$19–25, R2 ~$1, e-mail within the 3k free tier. **About $30–45/month.** The cheapest option.
- **Maintenance [I]:** ~5–8 days/year (OpenNext churn, beta products, DLS questions).
- **Lock-in [I]:** high. Workers runtime, Queues and Workflows APIs are proprietary.
- **Phase 0 risk [I]:** medium to high. Deploy and CI are redone, and the residency story is unproven.

## 5. Option C: AWS serverless

Lambda (or Fargate) + SQS/Step Functions + S3 + SES + Bedrock (eu profiles) + RDS/Aurora Serverless v2 Postgres + Cognito.

- **[O]** Bedrock EU = cross-region `eu.` inference only, for the 5.5 models (section 2).
- **[O]** SES: $0.10/1,000 e-mails, $0.12/GB of attachments; dedicated IP $24.95/month (not needed). https://aws.amazon.com/ses/pricing/
- **[I]** pg-boss can keep running on a Fargate task (1 always-on task, ~$10–30). The alternative is SQS + Lambda, which needs ADR-003 rewritten plus an outbox.
- **[I]** Leaving Supabase Auth for Cognito changes every RLS policy's claim source (`auth.jwt()`) and the Phase 0 RLS test harness. Keeping Supabase Auth with RDS is awkward: Supabase Auth is tied to Supabase Postgres.
- **[I]** Cost traps: a NAT Gateway (~$35/month per AZ) once Lambda or Fargate sits in a private VPC; RDS Multi-AZ doubles the DB cost.
- **Changes:** ADR-002 (RDS + Cognito or custom auth), ADR-003, ADR-004 (S3), ADR-011 (Bedrock), ADR-012 (Cognito), ADR-004b (AWS replaces GCP; Cloudflare stays for inbound unless SES inbound is used).
- **Cost (MVP) [I]:** RDS t4g.micro/small ~$15–30 (Aurora Serverless v2 floor ~$45+), Fargate worker ~$10–30, Lambda/API ~$0–5, S3 ~$1, NAT ~$35 if used. **About $60–120/month.**
- **Maintenance [I]:** ~6–10 days/year (IAM, VPC, RDS upgrades, Cognito quirks).
- **Lock-in [I]:** medium. Postgres is portable; Step Functions and Cognito are sticky.
- **Phase 0 risk [I]:** high. The DB, auth and RLS test stack all change mid-phase.
- **Plus:** it consolidates outbound e-mail and LLM with a vendor the owner already uses.

## 6. Option D: Google Cloud all-in

Cloud Run (services + worker pool + jobs) + Cloud SQL Postgres (or AlloyDB) + Identity Platform + Cloud Tasks/Scheduler + GCS + Vertex `eu` Claude + an outbound partner.

- **[O]** GCP has no first-party mail service. Its tutorial recommends SendGrid, Mailgun or Mailjet, or Google Workspace relay. Egress to external TCP port 25 is blocked; Workspace relay uses 465/587. https://docs.cloud.google.com/compute/docs/tutorials/sending-mail
- **[O]** Workspace SMTP relay: up to 10,000 messages and 10,000 unique recipients per user per 24 h; 100 recipients per SMTP transaction; lower limits on trial accounts. https://knowledge.workspace.google.com/admin/gmail/advanced/route-outgoing-smtp-relay-messages-through-google
- **[I]** Workspace relay is not built for transactional mail to customers: no bounce webhooks or suppression API, and it is tied to the founder's Workspace mailbox reputation. So "Google for outbound" in practice means one more vendor (SendGrid, Mailgun or Mailjet), not one fewer.
- **[I]** Identity Platform replaces Supabase Auth, so RLS is rewritten against custom claims set via `set_config` per request. Storage RLS is lost (GCS IAM plus signed URLs in code).
- **Changes:** ADR-002, ADR-004, ADR-012, ADR-004b (Supabase out, mail partner in), the P0 DB tooling (Supabase CLI out, plain Postgres migrations via Drizzle).
- **Cost (MVP) [I]:** Cloud SQL small shared-core ~$10–30 (HA doubles it), Cloud Run ~$15–45, GCS ~$1, mail partner $0–15. **About $40–90/month.**
- **Maintenance [I]:** ~5–8 days/year (you build auth flows that Supabase gave you: magic link, MFA UI, e-mail templates).
- **Lock-in [I]:** medium.
- **Phase 0 risk [I]:** high, for the same auth and RLS reasons as AWS.

## 7. Option E: Azure

Container Apps (web + worker) or Functions + Azure Database for PostgreSQL Flexible Server + Blob Storage + Service Bus/Queue Storage + Entra External ID + Azure Communication Services (ACS) Email + Claude via Foundry.

- **[O]** Claude on Foundry has **no EU deployment** today: Azure-hosted offers only "Global Standard and Data Zone Standard (US)" (section 2). Sonnet 5.5 Global Standard lists Sweden Central as the only European region, but Global processing is not EU residency. https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/claude-models-hosting-comparison
- **[O]** Entra External ID is billed per MAU with a free tier; amounts are on aka.ms/ExternalIDPricing (not fetched). Its **Go-Local** data-residency add-on is "currently available only in Australia and Japan". https://learn.microsoft.com/en-us/entra/external-id/external-identities-pricing
- **[O]** ACS Email: $0.00025 per e-mail plus $0.00012 per MB transferred. https://learn.microsoft.com/en-us/azure/communication-services/concepts/email-pricing
- **[O]** ACS resources choose a geography (Europe, Germany and France are listed). For Email: "processes email message content in real-time, using the resource's Data Location". Data "may transit or be processed in other geographies". https://learn.microsoft.com/en-us/azure/communication-services/concepts/privacy
- **[O]** ACS Email default limits for custom domains: 30 e-mails/min and 100/hour per subscription, raised by support ticket. Both ACS pages carry a banner: "introducing breaking changes, and some services are being retired". https://learn.microsoft.com/en-us/azure/communication-services/concepts/service-limits
- **[?]** Community threads (2023, 2026) report that only "United States" was offered as the Email data location. This conflicts with the privacy doc's geography list; test in the portal before relying on it.
- **[I]** The LLM still has to come from Vertex `eu` or Bedrock `eu.`, so Azure adds a platform rather than consolidating. Entra External ID would replace Supabase Auth, which means an RLS rewrite.
- **Changes:** ADR-002, ADR-003 (pg-boss can stay on a Container Apps min-1 replica), ADR-004, ADR-004b, ADR-011 (cross-cloud), ADR-012.
- **Cost (MVP) [I]:** Postgres Flexible B1ms ~$15–25, Container Apps ~$10–40, Blob ~$1, ACS Email ~$1. **About $30–70/month** plus cross-cloud Claude.
- **Maintenance [I]:** ~7–10 days/year (two clouds, plus ACS retirements).
- **Lock-in [I]:** medium. **Phase 0 risk [I]:** high. **Verdict [I]:** not viable until Foundry ships EU Claude.

## 8. Option F: EU-sovereign (Scaleway) + Claude from Vertex/Bedrock

Scaleway Serverless Containers/Jobs + Managed PostgreSQL + Object Storage + Transactional Email (TEM), with Claude via Vertex `eu`.

- **[O]** Scaleway TEM: 300 e-mails free per organisation, then €0.25 per 1,000 (Essential, pay as you go). Scale plan is €80/month with 100,000 e-mails and a dedicated IP; 99.9 % SLA on Scale only. https://www.scaleway.com/en/pricing/managed-services/
- **[I]** Scaleway is an EU company with FR/NL/PL regions, so the residency story is the simplest of all options, except for the LLM, which still crosses to Google or AWS (section 2).
- **[I]** Auth: there is no Supabase-grade managed auth, so you either self-host Supabase/GoTrue (more maintenance) or keep Supabase Cloud for Auth only.
- **Cost (MVP) [I]:** ~€40–70/month. **Maintenance [I]:** ~7–10 days/year (smaller ecosystem, fewer managed pieces). **Phase 0 risk [I]:** high.

## 9. Outbound e-mail head-to-head (D-07)

| Provider | Price | Status / limits | EU data | Platform count effect |
|---|---|---|---|---|
| **Amazon SES** (eu-central-1) | $0.10/1k + $0.12/GB attachments [O] | Mature; owner already runs it, so DKIM and bounces are known (ADR-004b) | Region-pinned sending [I] | +1 platform (4th) |
| **Cloudflare Email Service** | 3,000/month included, then $0.35/1k; Workers Paid only [O] | **Beta** [O]. 5 MiB per message incl. attachments; 50 recipients; new accounts get a "conservative daily quota" [O] | No statement found [?] | 0 (Cloudflare is already a platform) |
| **Google Cloud** | n/a | No first-party service [O]. Workspace relay is 10k/user/day [O] but not meant for transactional mail [I] | n/a | +1 (SendGrid, Mailgun or Mailjet) |
| **Azure ACS Email** | $0.25/1k + $0.12/GB [O] | 30/min and 100/h by default [O]; retirements in progress [O] | Europe geography listed [O]; US-only reports [?] | +1 |
| **Scaleway TEM** | 300 free, then €0.25/1k [O] | SLA only on the €80 plan [O] | EU company [I] | +1 |

Sources: https://developers.cloudflare.com/email-service/platform/pricing/ · https://developers.cloudflare.com/email-service/platform/limits/ · https://developers.cloudflare.com/email-service/ · https://aws.amazon.com/ses/pricing/

- **[I]** At MVP volume (~2–5k mails/month: auth, M09 digests, M10/M12 links), every option costs under $2/month. Price does not decide this; maintenance and residency do.
- **[I]** Why not Google: it has nothing first-party, so choosing "Google" means adding SendGrid, Mailgun or Mailjet, a new vendor that nobody here operates.
- **[I]** Why not Cloudflare *today*: sending is beta, and there is no published EU processing statement for it. Its upside is real: it removes the 4th platform, and the Workers binding sits next to the inbound Email Worker (ADR-005). Revisit when it reaches GA; the `OutboundMailer` interface keeps the swap to about a day.

## 10. Comparison summary [I unless marked]

| Option | Infra $/month (MVP, excl. LLM) | Maint. days/yr | EU Claude | Lock-in | Phase 0 risk | ADRs touched |
|---|---|---|---|---|---|---|
| A Current + fixes | 45–75 | 4–6 | Vertex `eu` [O] | Low–med | None | 011 (endpoint), 03 deploy note |
| B Cloudflare-first | 30–45 | 5–8 | Cross-cloud | High | Med–high | 003, 004, 004b, 010 |
| C AWS | 60–120 | 6–10 | Bedrock `eu.` [O] | Medium | High | 002, 003, 004, 004b, 011, 012 |
| D GCP all-in | 40–90 | 5–8 | Vertex `eu` [O] | Medium | High | 002, 004, 004b, 012 |
| E Azure | 30–70 + LLM cloud | 7–10 | **None in EU** [O] | Medium | High | 002–004b, 011, 012 |
| F Scaleway | 40–70 € | 7–10 | Cross-cloud | Low | High | 002–004b, 011, 012 |

MVP assumptions: 50 orgs, ~100 users, 5k documents/month (~2.5 GB/month of new files), ~3k mails/month, one always-on worker, no HA database.

## 11. Is serverless still on the table?

- **[I]** Yes, and it is already chosen. Cloud Run services scale to zero for the web app; the worker can be a Cloud Run worker pool [O] or a min-1 service. That is serverless containers, with no VMs or Kubernetes to run.
- **[I]** What is *off* the table is pure FaaS for the pipeline (Workers or Lambda as the only compute). pg-boss needs a long-lived process. OCR/PDF work needs more than 128 MB (Workers) and benefits from containers. Replacing pg-boss gives up transactional enqueue for no gain at 0.002 jobs/s.
- **[I]** Good serverless experiments that fit inside ADR-004b: (1) the Cloudflare Email Worker you already plan (ADR-005); (2) Cloud Run **jobs** + Cloud Scheduler for nightly maintenance (rates download, retention purge) instead of pg-boss cron; (3) a Cloudflare Workers + R2 public marketing/landing site with no customer data.

## 12. Recommendation

Keep the current ecosystem (Option A) and fix two details. ADR-011 should name the **Vertex AI `eu` multi-region endpoint**, because Claude Haiku 5.5 has no `europe-west*` single region. The worker should be documented as a **Cloud Run worker pool** (GA 2026-04). Keep **Amazon SES** for D-07: it is the cheapest, it is mature, and the owner already operates it. Revisit **Cloudflare Email Service** when it is GA with an EU data statement, since it would remove a platform. Azure is ruled out until Foundry offers EU-resident Claude. AWS and GCP-all-in are coherent, but each replaces Supabase Auth and therefore every RLS policy and the Phase 0 RLS test harness. That is a bad trade in the middle of Phase 0, with no cost or maintenance win at MVP scale. Cloudflare-first is the cheapest and most "different", but it fails the EU-processing NFR unless the Data Localization Suite applies, and it rewrites ADR-003/004. To "try different stuff" without risk, do it in the three contained places in section 11.

## 13. Owner decisions this would need

1. **decisions.md [stack]:** "Keep Option A (Supabase + Cloud Run + Vertex + Cloudflare inbound + SES). Alternatives reviewed in `research/infra-ecosystems-2026.md`." (owner)
2. **ADR-011 edit:** endpoint becomes "Vertex AI multi-region `eu` (`aiplatform.eu.rep.googleapis.com`); Bedrock `eu.` profile as fallback (includes UK/CH regions, needs a sub-processor note)". Also a known-issues line: "ADR-011 said `europe-west*`; Haiku 5.5 has no single EU region on Vertex."
3. **03 deployment note / ADR-003:** "Worker runs as a Cloud Run worker pool, 1 instance; revisit autoscaling (CREMA) above ~5 jobs/s."
4. **D-07 confirm:** SES eu-central-1 as the 4th platform (already proposed 2026-10-18). Add "revisit Cloudflare Email Service at GA" as a dated reminder.
5. **Optional, if the owner wants experiments:** one decisions line per experiment from section 11 (Cloud Run jobs for nightly tasks; a Workers/R2 marketing site). Each one has a maintenance estimate under 0.5 day/year [I].
6. **Not recommended now; needs an ADR if chosen:** any switch away from Supabase Auth (Options C–F). It would supersede ADR-002/012 and reopen the Phase 0 tickets for DB migrations and RLS tests.
