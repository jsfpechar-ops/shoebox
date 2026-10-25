# Bank connectivity for Czech banks: research for the OSVČ bookkeeping app

**As of:** 2026-10-17. **Method:** only public web sources (WebSearch/WebFetch). No logins, no forms, no browser tools.
**Labels:** **[O]** observed in a source (URL given) · **[I]** my inference · **[?]** unknown or unverified.

---

## 0. TL;DR

1. **No single cheap pipe covers "all Czech banks" in 2026.** The free GoCardless/Nordigen tier is closed to new signups [O]. Enable Banking covers only the big four (ČS, ČSOB, KB, RB) and needs your own licence for Czech users [O]. Finbricks, the Czech-native option, has gaps (ČSOB, UniCredit) and was "temporarily suspended" in ABRA Flexi as of May 2026 [O].
2. **The Czech incumbents (Competitor C, Competitor D) mostly don't use PSD2 at all.** They parse **bank e-mail notifications** (VS + amount) and add the **Fio API token** on top [O]. This is the proven, licence-free, zero-marginal-cost MVP path.
3. **Several banks offer proprietary, token-style business APIs** that the client switches on themselves: Fio (free) [O], MONETA (business accounts) [O], Creditas (64-char key) [O], KB API Business (Basic free, Plus 100 CZK/mo, Pro 500 CZK/mo) [O], RB Premium API (mTLS cert) [O], ČSOB Business Connector (free for business clients, as of 2023) [O], Revolut Business API [O], Wise personal token for business accounts [O].
4. **Your own PSD2 AISP permit in CZ** is a full ČNB *povolení* ("správce informací o platebním účtu", §41–57 of Act 370/2017). It needs a Czech seat, a 3-year business plan, PI insurance and governance. The statutory decision period is 3 months, which in practice means 6–12 months [O/I]. Don't do this for the MVP.
5. **Recommendation:** MVP = Fio/MONETA/Creditas tokens + e-mail notification ingest + statement upload (GPC/ABO, CAMT.053, MT940, CSV). Scale = add one licensed aggregator under its licence (Salt Edge partner programme or Finbricks), with marginal cost roughly 1–2 EUR per account per month [I]. Consider your own licence only beyond about 10k connected accounts [I].

---

## 1. Which banks matter for OSVČ

- Among **OSVČ** users of Competitor C (2025): **Air Bank 17%, Česká spořitelna 16%, ČSOB 15%**. Next come RB, KB, Fio, MONETA, mBank and UniCredit (no percentages published) [O] https://www.Competitor C.cz/blog/2025/08/29/zastoupeni-bank
- Among **legal entities**: **Fio 33%**, then RB and KB [O] (same URL).
- [I] So an OSVČ-focused MVP needs Air Bank, ČS and ČSOB early. Fio's direct API alone covers only a minority of OSVČ, though a large share of s.r.o.

---

## 2. Bank by bank

Columns:
- **(a)** Proprietary or "token" access the client can switch on without a TPP licence.
- **(b)** PSD2 AIS (licensed TPP + eIDAS QWAC). Czech banks follow the ČBA "Český standard pro open banking" or Berlin Group NextGenPSD2 [O] https://www.fiskil.com/open-finance-tracker/czech-republic
- **(c)** Statement export formats.
- **E-mail** = whether Competitor C/Competitor D can match payments from the bank's notification e-mails.

| Bank | (a) Token / proprietary API | (b) PSD2 AIS | (c) Export formats | E-mail notif. |
|---|---|---|---|---|
| **Fio banka** | **Yes, free.** 64-char token per account, read-only or read+payments, max 180 days, optional auto-extension on each login, ≥30 s between calls, >90-day history needs SCA unlock [O] | Covered by GoCardless (legacy) [O]. Finbricks covers domestic transactions only [O]. Not covered by Enable Banking [O] | Movements: CSV, GPC, HTML, JSON, OFX, Fio XML. Statements: also PDF, **MT940 (.STA)**, **ČBA XML (CAMT.053)**, SBA XML (CAMT.053) [O] | Yes [O] |
| **Česká spořitelna** | No free token found. A "ČS API" for accounting software carries a monthly fee from ČS [O EOS]. Money S3 warns of possible fees under the bank's price list [O] | Yes: developers.erstegroup.com, PSD2 accounts API [O]. Enable Banking, Tink, GoCardless and Finbricks cover it [O]. SCA via George klíč or SMS, no app-to-app redirect via Enable Banking [O] | CSV (manual import) [O EOS]. ABO/CAMT/MT940 from George Business [?] | Yes, also George Business. Only one notification address, so forwarding is needed [O] |
| **ČSOB** | **Business Connector**: free for business clients including živnostníci (2023 article) [O]. Needs a CEB contract and a .pfx client certificate [O Money S3]. Statements are daily (after midnight) and retained 45 days [O]. Dativery's resale price is €13.95 + €3.95/mo [O] | Yes. Enable Banking (Smart Key or HW token) [O] and GoCardless [O]. **Not supported by Finbricks: no unique transaction ID** [O Flexi] | CSV, MT940 [O EOS]. Also XML payment statement [O Dativery] | Yes [O] |
| **Komerční banka** | **KB API Business** (FOP/PO with a paid Business tariff in KB+): Basic free (D-1 data and statements), Plus 100 CZK/mo (intraday, 2-year history), Pro 500 CZK/mo (real-time notifications) [O]. **STATDA** statements API: formats KM, BEST, with XML planned for 2026; renew every 12 months; 50 downloads/mo free [O] | Yes, ČBA standard. Needs a PSD2 licence and qualified cert, via developers.kb.cz [O]. Enable Banking and Finbricks cover it [O] | CSV [O EOS], KM/BEST [O]. Other formats [?] | Yes. KB+ allows one address, so forwarding is needed. No balance [O] |
| **Raiffeisenbank** | **Premium API**: client ID from developers.rb.cz/premium, bank approval, mTLS cert from internet banking [O]. Endpoints for transactions, statements, balances and batch payments [O]. Price [?] | Yes. Enable Banking (Mobilní eKonto SCA) and Finbricks [O] | CSV [O EOS]. ABO structure documented by RB [O] https://www.rb.cz/attachments/elektronicke-bankovnictvi/abo-data-structure-description.pdf | Yes [O] |
| **Air Bank** | None found [?] | Yes: AISP API v3 since 24.4.2020, **licensed entities only** [O] https://www.airbank.cz/api/ais. Covered by Finbricks and GoCardless [O]. Not listed by Enable Banking [O] | CSV [O EOS]. Others [?] | Yes [O] |
| **MONETA** | **Yes for business accounts**: token generated in internet banking [O] https://help.eos.cz/en/articles/159-moneta-money-bank-api | PSD2 exists [O]. Finbricks covers it [O]. Not covered by Enable Banking [O]. Tink and GoCardless per tracker [O] | XML [O EOS]. Others [?] | Yes [O] |
| **UniCredit Bank CZ/SK** | None found [?]. EOS uses Tatra banka as intermediary [O] | PSD2 [I]. **Not supported by Finbricks: no unique transaction ID** [O] | CSV [O EOS]. MT940/CAMT [?] | Incoming and outgoing yes, balance no [O] |
| **mBank CZ** | EOS lists "API" without detail [O] | Finbricks covers domestic transactions only [O] | [?] | **No.** Notification format is unusable (Competitor D, Competitor C) [O] |
| **Banka Creditas** | **Yes**: 64-char "security key" API since 2017, JSON, read or read+payments [O] https://www.lupa.cz/aktuality/creditas-banka-spustila-api-pro-automaticke-zpracovani-dat-z-uctu-je-treti-v-cr/ | Finbricks and GoCardless [O] | GPC [O EOS] | Yes [O] |
| **Partners Banka** | [?] | No developer portal listed [O tracker]. Coverage [?] | [?] | **No** (Competitor C) [O] |
| **Trinity Bank** | [?] | [?] | [?] | [?] |
| **PPF banka** | API (corporate) [O EOS] | [?] | [?] | [?] |
| **Citfin** | [?] | [?] | [?] | Incoming yes [O Competitor C] |
| **Revolut Business** | **Business API**: access token, transactions endpoint, webhooks [O] https://developer.revolut.com/docs/guides/manage-accounts/use-cases/accounts-and-transactions-syncing. Separate Open Banking API for TPPs [O] | Via aggregators [I] | CSV/PDF [I] | [?] |
| **Wise Business** | **Personal API token for business accounts** (SMB self-automation) [O] https://docs.wise.com/api-docs/features/authentication-access/personal-tokens. EU PSD2 restrictions on statements [?] | Via aggregators [I] | CSV, CAMT.053, MT940 [I] | [?] |
| **Tatra banka (SK)** | Premium API. Money S3 says it "supports connection to other banks too" [O]. EOS uses it to reach ČS, UniCredit, Air Bank and RB [O] https://help.eos.cz/en/articles/151-overview-of-banking-api-connections-imports | — | — | — |

Sources: Fio [O] https://www.fio.cz/docs/cz/API_Bankovnictvi.pdf (v1.9, 16 Oct 2025) · KB [O] https://www.kb.cz/cs/kbapi/extra-sluzba-api-business, https://www.kb.cz/cs/kbapi/sluzby-kb-api/vypisy-z-uctu-pres-api-statda, https://www.kb.cz/cs/open-banking/kb-api/kb-api-services/account-information-service-(ais) · ČSOB BC [O] https://www.pruvodcepodnikanim.cz/clanek/business-connector-od-csob-prinasi-radu-vylepseni/ · Money S3 [O] https://money.cz/navod/propojeni-money-s3-s-bankami-pres-api/ · RB Premium [O] https://packagist.org/packages/vs-point/rb-premium · Enable Banking CZ [O] https://enablebanking.com/docs/markets/cz/ · Finbricks via Flexi [O] https://intercom.help/podpora-flexi/cs/articles/7470785-online-stahovani-vypisu-finbricks · E-mail matching [O] https://www.Competitor C.cz/podpora/automatizace/parovani-plateb-s-bankou and https://www.Competitor D.cz/?p=12492

### Key observations

- **[O] Unique transaction IDs are not guaranteed.** Flexi could not use Finbricks for ČSOB and UniCredit because those banks don't return a unique ID per transaction. Deduplication must therefore rely on a composite key (date, amount, counterparty, VS, running balance) [I].
- **[O] Token or key APIs need manual setup by the user** (Fio: Settings > API, wait about 5 minutes, then paste the token). Competitor C emails users before a token expires [O] https://www.Competitor C.cz/podpora/parovani/fio-api
- **[O] Fio: one token per consumer.** Fio tracks the "last downloaded" marker per token, so a token shared with another app breaks sync. Ask the user for a dedicated token.
- **[I] Certificate-based business APIs** (ČSOB BC, RB Premium) are possible in a SaaS but have high onboarding friction: the user downloads a .pfx or .p12 and uploads it with its password. That means handling secrets carefully (KMS, per-tenant encryption).

---

## 3. Aggregators covering Czech banks (2026)

| Aggregator | CZ coverage | Licence model for you | Pricing | Consent / SCA | Status 2026 |
|---|---|---|---|---|---|
| **GoCardless Bank Account Data (ex-Nordigen)** | Air Bank, Creditas, ČS, ČSOB, Fio [O fintable]. MONETA per tracker [O] | Licensed AISP. Previously usable without your own licence [I] | Free tier (historical) | 90/180 days [I] | **Closed to new signups.** "From July 2025 onwards, GoCardless has stopped accepting new Bank Account Data accounts" [O] https://actualbudget.org/docs/advanced/bank-sync/gocardless/. "Registration is unfortunately closed" [O] https://docs.firefly-iii.org/how-to/data-importer/import/gocardless/. "Closed to new signups and being wound down" (reviewed 8 Jun 2026) [O] https://www.openbankingtracker.com/guides/free-open-banking-apis. **Not an option.** |
| **Finbricks** (CZ, owned by KB since 2022) | MONETA, ČS, Fio (domestic only), Air Bank, mBank (domestic only), Creditas, RB, KB. **Not ČSOB or UniCredit** [O Flexi]. "11 key Czech banks" in 2022 [O] https://cc.cz/vyuzivaji-ho-miliony-cechu-aniz-by-to-vedeli-komercni-banka-investuje-do-mladeho-ceskeho-startupu/ | **"Available for partners without a PSD2 licence"** [O] https://www.finbricks.com/index_en.html | Custom quote [O]. Flexi resale: **199 CZK/mo for the first account, 49 CZK/mo per additional account** (ex VAT) [O] | **180-day token**, then re-authorise in the bank [O]. Default sync covers the last week only [O] | Active, but Flexi says Finbricks support is **"temporarily suspended"** (article dated 18 May 2026, no reason given) [O] https://podpora.flexibee.eu/en/articles/7470785-online-statement-downloads-finbricks. Ask Finbricks directly about stability [I] |
| **Salt Edge** | Listed among CZ aggregators [O] https://openbankingtracker.com/country/czech-republic/aggregators. Per-bank coverage [?] | **Partner Program: no own PSD2 licence or eIDAS cert needed.** Salt Edge is the licensed AISP [O] https://connect.shoptetpay.com/products/account_information/partner_program | Sales-led, usage-based [O] https://blog.finexer.com/salt-edge-pricing/ (competitor source) | [?] | Active [O]. Note that Shoptet Pay white-labels it, which is Czech precedent [O] |
| **Enable Banking** | **ČS, ČSOB, KB, RB only.** MONETA and Fio not yet [O] https://enablebanking.com/docs/markets/cz/ | **Does not serve PSUs resident in CZ.** Only TPPs with their own licence can use it for Czech banks [O] | Free "restricted production" for your own linked accounts. Full production needs contract and KYB [O] | Redirect, app-to-app rare [O] | Active, but **needs your own licence for CZ** |
| **Tink (Visa)** | ČS at least [O] https://banq.ai/api-aggregators/tink. Fio and MONETA per tracker [O] | Licensed by Swedish FSA (AIS/PIS, passported) [O]. Whether you can act under Tink's licence [?] | Sales-led, Standard and Enterprise tiers [O] | [?] | Active, enterprise-oriented [O] |
| **Yapily** | CZ not confirmed [?] | FCA + Bank of Lithuania [O] https://www.openbankingtracker.com/yapily | Sales-led [O] | [?] | Active |
| **TrueLayer** | 19 countries, CZ not confirmed [?]. Likely not [I] | — | ~£0.10–0.30 per call (biased source) [O] | — | — |
| **Plaid EU** | **CZ not supported** (18 European countries listed) [O] https://support.plaid.com/hc/en-us/articles/27895826947735-What-Plaid-products-are-supported-in-each-country-and-region | — | — | — | Not usable |
| **Tatra banka Premium API** | Used by EOS to reach ČS, UniCredit, Air Bank and RB [O] | Bank-to-bank service. Likely requires the client to hold a Tatra relationship [?] | [?] | [?] | Niche option worth asking about [I] |
| **Lunch Flow, Synci, open-banking.io, etc.** | Tracker lists Lunch Flow and Synci for Fio and MONETA [O] | Consumer or indie tools. Licensing [?] | open-banking.io ~€3/mo (author-affiliated) [O] | [?] | Not suitable as a B2B base [I] |
| **Bank iD (bankovní identita)** | Identity, not AIS [I] | — | — | — | Use for KYC/login, not for transaction feeds [I] |
| **Banking.dev, Ecomail** | No evidence of Czech AIS [?]. Ecomail is e-mail marketing [I] | — | — | — | Not relevant |

The tracker lists 35 aggregators with CZ coverage in total [O] https://openbankingtracker.com/country/czech-republic/aggregators. Most only cover the large banks [I].

### Consent duration and SCA UX
- **[I] PSD2 RTS amendment** (Delegated Reg. (EU) 2022/2360, applicable since 25 Jul 2023) extended the AIS exemption from 90 to **180 days**, and it is mandatory for banks with a dedicated interface. A bank confirms "90 days extended to 180 days" [O] https://developer.crelan.be/node/43
- **[O] Concrete CZ evidence:** Finbricks tokens last 180 days [O Flexi]. Fio tokens last at most 180 days, auto-extended on each internet banking login [O]. KB STATDA must be renewed every 12 months [O].
- **[O] ČNB opinion RS2025-28 (27 Nov 2025)** on minimum open-banking UX requires app-to-app redirect with automatic return, a single SCA (no double authentication), and no extra credential entry. It is aimed mainly at PIS but signals better redirect UX at Czech banks going forward [O] https://www.epravo.cz/top/clanky/regulatorni-posun-v-oblasti-platebnich-sluzeb-stanovisko-cnb-k-minimalni-uzivatelske-zkusenosti-meni-podminky-pro-open-banking-120565.html
- **[I] UX recommendations:**
  - Show "connection expires in N days" in the UI.
  - Send e-mail and push reminders at D-14, D-3 and D0.
  - Offer one-click re-consent.
  - When a connection lapses, fall back to statement upload so the books never stall.

---

## 4. Regulation: what licence do you need?

### 4.1 Your own AISP licence in CZ
- **[O]** Act 370/2017 Sb., Hlava III (§41–57): a "správce informací o platebním účtu" needs a **ČNB permit (povolení)**, not just a registration [O] https://www.mesec.cz/zakony/zakon-o-platebnim-styku/f6140460/
- **Conditions (§42) [O]:**
  - registered and real seat in CZ
  - 3-year business plan with budget
  - **liability insurance or equivalent guarantee** (§46, minimum set by decree)
  - adequate technical and organisational resources
  - management and control system (risk, internal control, IT security)
  - trustworthy, qualified management
- **No minimum capital** [O] https://www.epravo.cz/top/clanky/spravce-informaci-o-platebnim-uctu-dle-zakona-o-platebnim-styku-106781.html
- **Application [O]:** electronic only (data box or e-signed e-mail), under Vyhláška 1/2022. ČNB forms are available [O] https://www.cnb.cz/cs/dohled-financni-trh/vykon-dohledu/povolovaci-a-schvalovaci-rizeni/povolovaci-schvalovaci-rizeni-a-zapis-do-registru-platebni-instituce-a-poskytovatel-platebnich-sluzeb-maleho-rozsahu/
- **Timeline:** statutory **3 months from a complete application** [O]. Applications "almost always" have defects, so expect longer [O epravo]. For payment institutions a law firm quotes 6–12 months end to end [O] https://arws.cz/novinky-v-arrows/jak-ziskat-povoleni-k-cinnosti-platebni-instituce-v-ceske-republice. I estimate 6–12 months for an AISP too [I].
- **Fees and costs:**
  - The PI application fee is 20,000 CZK [O arws]. The AISP fee is [?].
  - eIDAS QWAC/QSealC certificates cost about €2–6k/yr (biased source) [O] https://dev.to/johnfrandsen/gocardless-bank-account-data-alternatives-what-to-use-when-signups-are-disabled-326d
  - [I] Total first-year cost: legal 300–800k CZK, PI insurance 50–200k CZK/yr, compliance/AML/IT-security officer 0.5–1 FTE, ISMS work, ongoing ČNB reporting [O] https://portal.gov.cz/sluzby-vs/hlaseni-informacnich-povinnosti-o-cinnosti-spravce-informaci-o-platebnim-uctu-S50482. All in, roughly 1.5–4 M CZK in year one.
- **§49 [O]:** a správce may not provide any other payment service.

### 4.2 Using an aggregator's licence instead
- **[O]** Salt Edge (partner programme) and Finbricks both state that partners don't need their own PSD2 licence.
- **[O]** A foreign licensed AISP can operate in CZ via passporting, branch or *pověřený zástupce* (§57).
- **[I]** In this model the aggregator is the regulated AISP towards the user. Your app is its partner (sometimes formally an agent or technical service provider) and receives data with the user's consent.
- **[I] Contract checklist:**
  - who is GDPR controller for the raw AIS data
  - consent screen branding ("powered by X")
  - liability and SLA per bank
  - data retention after consent ends
  - exit and portability terms
- **[O] Enable Banking is the exception:** it does not serve Czech-resident PSUs, so it needs your own licence.

### 4.3 Licence-free channels (what incumbents do)
- **[O]** Competitor C and Competitor D match payments from **bank e-mail notifications** forwarded to a per-account address (`bank.X.Y@invoicemail.cz`, `…@itsmybill.eu`). Competitor C also uses the Fio token.
- **[O]** Money S3, EOS and ABRA Flexi connect via each bank's **proprietary business APIs** (Fio, MONETA, KB, RB Premium, ČSOB BC), with the user generating credentials.
- **[I]** In these models the user retrieves or forwards their own data, or authorises the software under the bank's own contract, so the software vendor is arguably not providing a PSD2 AIS. The whole Czech accounting-software market works this way.
- **[?]** This is a legal grey area for a pure SaaS that pulls data on the user's behalf. **Get a short written legal opinion** (fintech law firm, about 20–50k CZK [I]) before launch, especially on whether systematic polling of Fio tokens counts as AIS.

### 4.4 PSD3 / PSR outlook
- **[O]** Provisional political agreement in late November 2025. Publication was expected in H1 2026. PSR applies about 18 months after entry into force, and PSD3 is transposed within 18 months, so applicability is targeted around **Q2/Q3 2028** [O] https://worldline.com/en/home/main-navigation/resources/blogs/2026/the-scope-and-timeline-are-locked-in-for-psd3-and-psr-what-should-psps-know and https://www.taylorwessing.com/en/insights-and-events/insights/2025/11/eu-lawmakers-strike-a-deal-on-payments-reforms
- **[O] Changes relevant to AIS:** a **permission dashboard** at the bank where users see and revoke TPP access, plus more standardised APIs. AIS providers are brought into the unified PSD3/PSR licensing framework.
- **[?]** Whether the official text was published in the OJ by Oct 2026, and the final re-authentication rules (proposals discussed removing the 180-day re-SCA for AIS).
- **[?]** FiDA (Financial Data Access) status in 2026.
- **[I]** For 2026–2027 planning, assume PSD2 rules (180 days) remain in force.

### 4.5 GDPR
- **[I] Roles:** you are the **controller** for bookkeeping data (Art. 6(1)(b), contract with the OSVČ). A licensed aggregator is usually an **independent controller** for the AIS leg. Your LLM, OCR and hosting vendors are **processors** (DPAs, EU region, no training on customer data).
- **[I] DPIA recommended:** large-scale processing of financial data plus automated/AI processing. Bank feeds also contain **third-party personal data** (counterparty names, accounts, card-merchant data). Justify this under legitimate interest and data minimisation.
- **[I] Retention:** accounting records must be kept 5 years under the Accounting Act and 10 years for VAT documents. Bank feed data linked to accounting entries follows that. Unlinked raw data should be deleted sooner.
- **[I] PSD2 Art. 67** (if under an aggregator's licence): data may be used only for the service the user explicitly requested. Don't reuse it for marketing or credit scoring without separate consent.
- **[I] Security:** encrypt tokens and certificates per tenant (KMS), scope access, keep audit logs, and support revocation. Treat Fio/MONETA tokens with payment rights as **critical**, and request read-only tokens only.

---

## 5. Matching logic: best practice

### 5.1 Data you get
- **GPC/ABO (record 075)** [O] https://www.fio.cz/docs/cz/struktura-gpc.pdf:
  - fixed 130-char lines, amounts in haléře
  - counter-account (16 digits)
  - **VS (10)**, **KS as BBBBKSYM (bank code + KS)**, **SS (10)**
  - abbreviated name (20 chars)
  - posting code: 1 debit, 2 credit, **4/5 storno**
  - dates in DDMMYY
  - Encoding is unspecified [O]. In practice it's CP1250 [I].
- **CAMT.053 (ČBA XML)** [I]: VS/KS/SS usually sit in `Refs/EndToEndId` or structured `RmtInf`. ČBA profiles use EndToEndId as `VS.../SS.../KS...`, but verify per bank. Also present: `NtryRef`/`AcctSvcrRef` for dedup and `Chrgs` for fees.
- **E-mail notifications** [O]: account, amount, VS and counterparty in bank-specific text templates. mBank's format can't be parsed [O]. KB+ and ČS allow only one notification address, so users must forward [O].
- **Fio JSON** [O]: carries a movement ID, which is the most reliable dedup key.

### 5.2 Matching cascade (score-based) [I]
1. **Exact:** VS = invoice number (normalise leading zeros) **and** amount = outstanding amount **and** currency matches. Auto-match with confidence ≥0.98.
2. **VS + amount within tolerance** (±1 CZK rounding, or ± a known fee). Auto-match and flag the difference as rounding or fee.
3. **Counterparty account + amount + date window** (invoice due date −30/+60 days). Useful when VS is missing. Learn the counterparty-account-to-customer mapping from past confirmed matches.
4. **Free text:** regex for an invoice number in the message/note. Competitor C accepts a 5–10 char number in the note as VS for foreign payments [O]. Use fuzzy matching (Levenshtein, token-set) of counterparty name against customer name or IČO.
5. **LLM fallback:** for the remaining unmatched items, propose candidates with a reason. The user confirms, and each confirmation feeds back into the rules.

### 5.3 Special cases
- **Card payments (no VS)** [I]:
  - Match receipts and expense documents on **merchant name** (normalise "GOOGLE*GSUITE", "PAYPAL *X", MCC if available) + **amount** + **date window** (booking lags transaction by 1–3 business days).
  - For FX card payments, match on original currency amount if the bank provides it. Otherwise accept a ±3% tolerance and record the realised FX difference (kurzový rozdíl).
- **FX payments** [O/I]:
  - Competitor C notes that payments in a currency other than the account currency are converted at the ČNB rate and then fail to match [O].
  - Match on **original currency and amount** where the feed provides it (CAMT `AmtDtls/InstdAmt`). Otherwise match the invoice amount × ČNB rate on the booking date ±2%, and post the FX difference to 563/663 [I].
- **Partial payments and instalments:** keep an outstanding balance per invoice and allow N-to-1 matches. Competitor D matches to "unpaid or partly paid" invoices [O].
- **Overpayments:** allow N-to-1 and flag overpayment as a liability or refund.
- **One payment for several invoices:** solve as a subset-sum over the customer's open invoices with the same counterparty account, then suggest the split [I].
- **Corrective documents (dobropis):** Competitor C fails to match after a corrective tax document changes the amount [O]. Match against the **net outstanding after credit notes** instead [I].
- **Bank fees and interest:** auto-categorise by posting type and text (e.g. "Poplatek", "Úrok"). These need no document, so create an internal document [I].
- **Payment gateways (Stripe, PayPal, GoPay, Comgate, SumUp):** payouts arrive **net of fees** in batches. Import the gateway settlement report and match payout = Σ(gross) − fees [I]. Competitor C pairs GoPay and PayPal directly [O].
- **Storno (GPC codes 4/5):** reverse the earlier match [O codes, I handling].
- **Duplicates across channels** (e-mail + API + upload of the same transaction): use the bank transaction ID where available. Otherwise dedupe on a hash of (account, booking date, amount, VS, counterparty, sequence within day). This is necessary because ČSOB and UniCredit lack unique IDs via Finbricks [O].
- **Own transfers between the user's accounts:** detect both legs and match them to each other, not to documents [I].

---

## 6. Recommendation and cost estimates

### 6.1 MVP (months 0–6): licence-free, multi-channel ingest

| Channel | Banks covered | Effort | Marginal cost |
|---|---|---|---|
| **Fio API token** (read-only) | Fio | Low | 0 [O free] |
| **MONETA business token** | MONETA (business accounts) | Low–med | 0 [?] |
| **Creditas key API** | Creditas | Low | 0 [?] |
| **E-mail notification ingest** (per-account inbound address, bank-specific parsers) | Air Bank, ČS, ČSOB, KB, RB, MONETA, UniCredit, Creditas, Fio, Citfin [O] | Med (about 10 templates, templates change) | ~0. Inbound mail €0–20/mo [I] |
| **Statement upload/import** (GPC/ABO, CAMT.053, MT940, CSV, OFX) | All banks, including mBank, Partners, Revolut, Wise | Med | 0 |
| **Revolut Business API / Wise token** (optional) | Revolut, Wise | Low–med | 0 [O token-based] |

- [I] This covers essentially every OSVČ (Air Bank, ČS and ČSOB together make up ~48% [O]) with no licence and no per-connection fees.
- **Weaknesses [I]:**
  - E-mail gives incoming and outgoing payments but not card-spend detail at every bank.
  - E-mail has no backfill, and Competitor C notes no retroactive matching [O].
  - Fix gaps with a monthly statement upload, i.e. the "close the month" ritual.
- **[I] Estimated monthly run cost at 500–2,000 users:** €100–400 (hosting, mail ingest, monitoring). LLM matching fallback adds €0.02–0.10 per user per month.
- **[I] Optional add-on for power users:** KB API Business Basic (free) and RB Premium / ČSOB Business Connector (certificate upload), if users ask.

### 6.2 Growth (months 6–18): add one licensed aggregator, under its licence
- **[I] Shortlist:**
  - **Finbricks:** Czech, ČS/KB/RB/MONETA/Air Bank/Creditas/Fio, partner without licence. But no ČSOB or UniCredit, and the Flexi suspension needs explanation.
  - **Salt Edge partner programme:** no licence, Czech precedent via Shoptet Pay. CZ coverage list [?].
  - Ask both for written CZ coverage, uptime per bank, price per active connection, and their stance on agent/partner status.
- **[I] Cost anchor:** Flexi resells Finbricks at 199 CZK for the first account and 49 CZK per additional account per month [O]. That implies wholesale of about €0.5–2 per account/month at volume [I]. At 2,000 connected accounts: **€1–4k/month** [I].
- **[I] Product positioning:** pass the cost on as a "Premium: automatic bank sync" tier (e.g. +49–99 CZK/mo), and keep e-mail and upload in the base tier.
- **[I] Keep the e-mail and token channels** as fallbacks during aggregator outages and for ČSOB and UniCredit.

### 6.3 Scale (18+ months, >10k connected accounts): consider your own AISP permit
- [I] Cost 1.5–4 M CZK in year one plus about 1–2 M CZK/yr ongoing. Timeline 6–12 months [O/I].
- [I] Then integrate the big 4–5 banks directly via ČBA/Berlin Group APIs (free for licensed TPPs under PSD2 [O tracker FAQ]). Enable Banking becomes usable as an infrastructure layer at that point (ČS, ČSOB, KB, RB) [O].
- [I] Re-evaluate once PSR applies (~2028): the permission dashboard and new re-auth rules may reduce churn from consent expiry.

### 6.4 Decision summary
| Stage | Path | Licence | Est. monthly cost |
|---|---|---|---|
| MVP | Fio/MONETA/Creditas tokens + e-mail ingest + statement upload | None (get a legal opinion) | €100–400 total [I] |
| Growth | + Finbricks or Salt Edge (partner model) | Aggregator's | + €0.5–2 per connected account [I] |
| Scale | Own ČNB AISP permit + direct bank APIs | Own | ~€6–15k/mo fixed compliance + infra [I] |

---

## 7. Open questions to resolve by direct contact (not answerable from public sources)
1. **[?] Finbricks:** current status after the "temporary suspension" in Flexi (May 2026), wholesale pricing, ČSOB/UniCredit roadmap, whether partners formally become agents.
2. **[?] Salt Edge:** exact Czech bank list (Air Bank, Fio, MONETA, Creditas?), price per connection, GDPR role split.
3. **[?] MONETA token:** eligibility (business accounts only?), validity, rate limits, formats.
4. **[?] ČS:** price list for its "API for accounting software" (EOS mentions a monthly fee), and whether the OSVČ George tier qualifies.
5. **[?] AISP licence:** ČNB administrative fee, minimum insurance amount (EBA PII guideline formula), current processing times. Ask a fintech law firm.
6. **[?] Legal opinion:** does a SaaS polling a user-generated Fio/MONETA token count as providing AIS?
7. **[?] Air Bank, mBank, Partners, Trinity:** any non-PSD2 token API or export formats (CAMT.053/GPC). Check public help pages or support.
8. **[?] PSD3/PSR:** final OJ publication date and final AIS re-authentication rule.
