# M01: Ingestion and classification

> Phase 1 (MVP). Owner packages: `apps/email-worker`, `packages/pipeline/src/ingest/*`, `packages/extraction/src/classify/*`, `packages/extraction/src/split/*`.
> Canonical names come from `04-domain-model.md` and `05-data-model.md` (this module's tables were merged into 05 on 2026-10-18).
> M01 contains **no law-dependent numbers**. Every threshold below is an operational config key (`config.ingest.*`, `config.classify.*`, `config.split.*`, `config.dedupe.*`, `config.link.*`) in `packages/pipeline/src/config.ts` (zod schema with defaults, overridable by env). The one rule-table value M01 reads is `municipal.tourist_fee` (06 §2), and only for an info-level consistency check.

---

## 1. Purpose and scope

M01 takes **every byte that reaches us** (upload, phone photo, e-mail), keeps it, makes it machine-readable, removes duplicates, cuts multi-document files apart, and answers the first question of the pipeline: **what is this paper?** (`document_class`, 04 §2.1). Only bookable classes continue to full extraction (M02). Decoys are kept, lightly extracted, linked to the documents they explain, and never booked.

**Invariant "nothing lost":** every received file, attachment, archive member and e-mail body has exactly one `ingest_items` row (§5.3). Each row reaches a terminal state within `config.ingest.terminal_sla_hours` (24) or a maintainer alert fires. Every terminal state except `ignored` is visible to the user.

| In scope (Phase 1) | Out of scope |
|---|---|
| Web upload (multi-file, drag and drop), phone camera via PWA `<input capture>`, multi-photo receipt bundles | Native apps, offline capture (Later) |
| Per-org inbound address via Cloudflare Email Worker + HMAC webhook (ADR-005); accountant forwarding; `.eml` upload | Fetching documents from links in e-mails (never; SSRF and liability) |
| `+banka` alias: stored and handed to M07 (Phase 2). In Phase 1 it is held unprocessed. | Bank notice parsing itself (M07) |
| Formats: PDF, JPEG, PNG, HEIC/HEIF, WebP, TIFF, ISDOC, ISDOCX, XML (ISDOC/EPO/CAMT detection), ZIP, `.eml` | Office files (docx/xlsx): stored as `unsupported`. TNEF `winmail.dat`, S/MIME-encrypted mail: `unsupported`. |
| Malware scan, normalization, exact / near / semantic dedupe, PDF splitting (rules + LLM; QR separator sheets Later) | Field extraction (M02), validation (M03), categorization (M04) |
| Classification into `document_class`; decoy handling, `document_links`, expected-invoice reminders | VAT reconciliation of filed returns against ledgers (M05) |
| Upload UX status, rate limits and abuse protection, failure notifications | Notification delivery plumbing (M09), screens and glossary (M11) |
| **Manual entry** "Přidat ručně" (Phase 1, §4.12), including substitute documents (náhradní doklad) | The generated "Interní / náhradní doklad" PDF (M10) |
| **Spreadsheet import** of the user's old XLSX/CSV list (Phase 2, §4.13): column mapping kept per org, preview, dedupe | AI column mapping (header suggestions only); bank CSVs (M07) |

## 2. User stories

- **P1 Petra:** "I forward the Adobe and Canva receipts from Gmail. Newsletters from the same senders don't turn into expenses."
- **P2 Tomáš:** "In the van I photograph a crumpled receipt with my iPhone (HEIC). A long receipt takes 2 photos and becomes one document. I see 'Hotovo' within seconds."
- **P3 Lucie:** "Suppliers send `faktura.pdf` + `faktura.isdoc` to my address. One document comes out, with the exact data from the ISDOC."
- **P4 Josef:** "I drop my whole September folder (invoices, the manager's settlement statements, the Praha 3 tourist-fee reports, my filed DPHDP3). Only the real invoices are booked. The rest is filed as podklady and linked. The IKEA receipt I uploaded twice (once from macOS, once from Windows) shows up once."
- **P4 Josef:** "An Alza order confirmation becomes a podklad, and 30 days later I'm reminded if the invoice never came."
- **P2 Tomáš:** "I lost the receipt for a parking fee paid in cash. I tap 'Přidat ručně', type 80 Kč and pick 'Doklad se ztratil'. If I still have a torn photo, I attach it, the app reads what it can, and I fill in the rest."
- **P1 Petra (Phase 2):** "I upload the Excel list I kept for 2025, check that the columns are guessed right, look at the first 10 rows, and import it. When I later forward the PDFs, they merge with the imported rows instead of doubling them."
- **Accountant:** "I forward a client's invoice from my own mailbox to the client's Shoebox address. It lands in their inbox attributed to me."
- **Accountant:** "In the package I see each statement linked to the invoice it reconciles, so I don't ask the client."

## 3. Inputs and outputs

**Inputs:** browser uploads (presigned PUT), Cloudflare Email Worker webhook, `.eml`/ZIP containers, user actions (reclassify, confirm split, not-a-duplicate, release from quarantine, rotate address).

**Outputs:**
- Rows in `ingest_items` (new), `inbound_emails`, `source_files`, `documents` (status up to `classifying` → handoff, or terminal `supporting`/`duplicate`/`needs_review`/`failed`), `document_links`, `expected_documents` (new), `extraction_runs` (stages `split`, `classify`), `review_questions`, `notifications`.
- Derived blobs: `org/{org_id}/derived/{sha256}/` holding `page-{n}.jpg` (vision, 150 DPI, long edge ≤ 2000 px), `thumb-{n}.jpg` (400 px), `text.json` (per-page text items with font size and bbox), `isdoc.xml` (if embedded or companion), `qr.json` (decoded QR payloads per page, shared with M02).
- Jobs for M02 (`doc.extract`; M02 picks the extraction profile `full` / `statement` / `filing` / `lite` / `none` from the class, M02 §3) and M07 (`bank.notice.parse`, `bank.statement.import_from_document`; Phase 2).
- Domain events (§6.4).

## 4. Detailed behavior and algorithms

### 4.1 Channels

#### 4.1.1 Web upload and camera (PWA)
1. The Inbox has two entry points: **"Nahrát doklady"** (`<input type=file multiple accept="application/pdf,image/*,.isdoc,.isdocx,.xml,.zip,.eml">` plus a drop zone on the whole screen) and, on touch devices, **"Vyfotit doklad"** (`<input type=file accept="image/*" capture="environment">`). Files from the capture input get `channel='camera'`.
2. Client pre-checks run before any network call: count ≤ `config.ingest.batch_max_files` (100); each file ≤ `config.ingest.max_file_bytes` (25 MiB); batch ≤ `config.ingest.batch_max_bytes` (500 MiB); extension or MIME type in the allow-list (§4.2). A file that fails gets a row with an error immediately. Nothing is uploaded for it.
3. `POST /api/v1/uploads` creates a batch. For each accepted file it creates an `ingest_items` row (`state='pending_upload'`) and returns a signed upload URL for `org/{org_id}/incoming/{ingest_item_id}` (Supabase signed upload URL; TTL `config.ingest.presign_ttl_s` 600). The client uploads with `XMLHttpRequest` (for upload progress events), at most 4 in parallel, retrying 3× with backoff 1/4/16 s, then calls `POST /api/v1/uploads/{id}/complete`. This sets `state='uploaded'` and enqueues `ingest.item.process`.
4. **Camera bundle:** after a photo, the sheet offers "Přidat další stránku" (add another page) and "Hotovo". All photos of one bundle share `bundle_id` and carry `bundle_index`. When every member is `uploaded`, `ingest.bundle.assemble` builds one PDF (pdf-lib, one JPEG per page in index order, EXIF orientation applied). That PDF is a new ingest item with `origin='camera_bundle'`, and the members end in `state='bundled'` (kept, linked by `parent_item_id`).
5. The browser leaves the page → a `beforeunload` warning only while a PUT is still running. Processing after `complete` is server-side.
6. Status is live via Supabase Realtime (`postgres_changes` on `ingest_items` and `documents` filtered by `org_id`; RLS applies). Fallback: poll `GET /api/v1/uploads/batches/{id}` every 3 s.

#### 4.1.2 Inbound e-mail (ADR-005)
**Addresses.** Main: `{inbound_email_slug}-{inbound_email_secret}@in.<domain>`. Bank alias: the same with `+banka`. `inbound_email_secret` is 8 chars of Crockford base32 (40 bits). Any other `+tag` is treated as `documents` and the tag is ignored. Rotation (§4.10) keeps the previous secret valid for `config.ingest.email_rotation_grace_days` (7) unless the user picks "zneplatnit ihned" (revoke now).

**Worker (`apps/email-worker`, ≈150 lines).** For each message:
1. If `message.rawSize > config.ingest.email_max_bytes` (25 MiB, [verify] T-07) → `message.setReject("Message too large (max 25 MB)")`, then call `/api/internal/inbound-email/rejected` (metadata only: to, from, subject, size) so the owner gets a notification. Done.
2. Parse the raw message with `postal-mime`. Compute `rawSha256`. `messageId` = the `Message-ID` header, or `sha256:{rawSha256}` when it is missing.
3. Read the authentication results (`Authentication-Results` / `ARC-Authentication-Results` added by Cloudflare, [verify] T-07) into `{spf, dkim, dmarc}`. `spoof = spf==='fail' && dkim==='fail'`.
4. `POST /api/internal/inbound-email/prepare` (HMAC, §4.10) with `{to, messageId, rawSize, attachments:[{index,size}], hasHtml}`. The web app answers one of:
   - `{decision:'unknown_recipient'}` → `setReject("Unknown recipient")`.
   - `{decision:'duplicate'}` (same `(org_id, message_id)` already exists) → accept silently.
   - `{decision:'hard_limited'}` → `setReject("Too many messages, try later")`.
   - `{decision:'accept', orgRef, uploads:{eml, html?, attachments:[{index, ingestItemId, url}]}}`.
5. PUT the raw `.eml` to `org/{org_id}/eml/{sha256(messageId)}.eml`, the HTML body to `org/{org_id}/eml/{sha256(messageId)}.html`, and each attachment to `org/{org_id}/incoming/{ingestItemId}`.
6. `POST /api/internal/inbound-email` with the manifest (§6.2 `InboundEmailWebhook`), including `spoof`.
7. Any upstream error (5xx, timeout) → **throw**. Cloudflare then returns a temporary failure, the sending MTA retries, and nothing is lost. Steps 4–6 are idempotent by `messageId`.

**Webhook handler** (`apps/web /api/internal/inbound-email`): verify the HMAC → insert `inbound_emails` (`on conflict (org_id, message_id) do nothing`; a conflict → 200 and stop) → insert one `ingest_items` row per attachment (`origin='email_attachment'`, `state='uploaded'`, disposition, content-id, size) → enqueue `email.received`. Answer within 2 s.

**Spoofed mail.** When `spoof=true`, the message is stored and **quarantined**, not dropped: `inbound_emails.spam_verdict='spoof_fail'`, all items get `state='quarantined'`, and nothing is processed. The user sees it under Inbox › Ostatní › "Zadržené e-maily" with "Uvolnit" (release, which re-enqueues `email.received` with `force=true`). Quarantine is hard-deleted after 30 days. The owner gets one notification `email_quarantined` per message. ADR-005 adopted quarantine on 2026-10-18 (03). `config.ingest.email_spoof_policy = 'quarantine' | 'drop'`, default `quarantine`.

**Accountant forwarding.** No sender allow-list by default: suppliers and accountants may send directly. When `from_address` (case-folded) equals the e-mail of a member of the org, `source_files.uploaded_by` = that user, and the UI shows "Přeposlal(a): Ing. Nováková (účetní)". The buyer-identity check in M03 catches a document forwarded to the wrong client.

**`+banka` alias.** `inbound_emails.purpose='bank_notice'`. `email.received` creates **no** document items and enqueues `bank.notice.parse` (M07). Until M07 is enabled (Phase 2), the row stays `processed_at = null`, and Settings shows "Bankovní notifikace uložíme a zpracujeme, jakmile zapnete párování plateb." If M07 returns `not_a_bank_notice`, it calls `rerouteBankNoticeToDocuments(inboundEmailId)`. M01 then sets `purpose='documents'` and runs the normal e-mail flow.

#### 4.1.3 `.eml` files (uploaded, or attached as `message/rfc822`)
They are parsed with the same `parseEmail()` the Worker uses. An uploaded `.eml` creates an `inbound_emails` row (`message_id` from its header; on conflict → `exact_duplicate` against that e-mail's items). A nested `.eml` (forwarded as attachment) does **not** create an `inbound_emails` row. Its parts become child items (`origin='archive_member'`, `parent_item_id`) and its body follows §4.5.2 with `inbound_email_id` = the outer e-mail. Maximum nesting depth `config.ingest.max_container_depth` (3).

### 4.2 Formats, sniffing and limits

The format is sniffed from bytes (`file-type` plus our checks). The declared MIME type and the extension are only hints. A mismatch is logged as `ingest_items.sniff_mismatch=true`.

| Detected format | Detection | Handling |
|---|---|---|
| `pdf` | `%PDF-` within the first 1 KiB | §4.4. If encrypted with a user password → `state='encrypted'` + question. Owner-password-only PDFs are opened normally. |
| `jpeg`, `png`, `webp` | magic bytes | raster; `page_count=1`; phash |
| `heic` | ISO-BMFF `ftyp` brand ∈ {heic, heix, hevc, heim, heis, mif1, msf1} | decode the primary image → JPEG q90 derivative ([verify] T-08: `sharp` prebuilt binaries lack HEVC; use a libvips build with libheif+libde265 or `heic-decode` WASM; record the choice) |
| `tiff` | `II*\0` / `MM\0*` | each frame is a page; `page_count` = frames; split applies |
| `isdoc` | XML, root `Invoice`, ns `http://isdoc.cz/namespace/2013` | deterministic class (R01). The visual for the UI is rendered from the XML by M02's ISDOC viewer. |
| `isdocx` | ZIP with `manifest.xml` (ns `…/2013/manifest`), else a root-level `*.isdoc` (`research/registries-and-formats.md §7.5`) | treated as one ISDOC (not expanded); any PDF inside becomes the visual |
| `epo_xml` | XML root `Pisemnost` | class `government_filing` (R02); the form code is the first child (`DPHDP3`, `DPHKH1`, `DPHSHV`, `DPFDP7`, …) |
| `camt053` | XML ns starting `urn:iso:std:iso:20022:tech:xsd:camt.053` | class `bank_statement` (R03) → M07 |
| `xml_other` | any other well-formed XML | class `other_supporting` (stored, shown) |
| `zip` | `PK\3\4`, not ISDOCX | expanded (§4.3) |
| `eml` | RFC 5322 headers in the first 4 KiB, or `message/rfc822` | §4.1.3 |
| `bank_file` | `.gpc`/`.abo` fixed-width header (`074`), `.sta` (MT940 `:20:`) | class `bank_statement` → M07 (Phase 2); Phase 1 stores it |
| anything else | – | `state='unsupported'`; the blob stays in `incoming/` for 90 days; downloadable |

XML is parsed with DTDs and external entities **disabled** (no XXE). The XML size limit is 10 MiB.

**Limits** (config, enforced server-side even when the client already checked): file 25 MiB; e-mail 25 MiB; attachments per e-mail `config.ingest.email_max_attachments` (50; the rest → `ignored` + notification); image ≤ `config.ingest.max_image_megapixels` (100 MP, `sharp limitInputPixels`) else `unsupported`; PDF pages ≤ `config.ingest.max_pdf_pages` (300; above that the item is accepted and pages beyond 300 are not rasterized, with a notice); ZIP: entries ≤ 200, uncompressed total ≤ 200 MiB, per-entry ratio ≤ 100:1, depth ≤ 2, no encrypted entries (→ `unsupported`).

### 4.3 Item processing (`ingest.item.process`)

The steps run in order. Each is idempotent: the job re-reads the row `FOR UPDATE` and skips steps whose outputs exist.

1. If `state` is terminal → return.
2. Stat the staging blob. If it is missing and `created_at` is older than 1 h → `expired`. If `size > limit` → `too_large`.
3. Stream the bytes: compute `sha256` server-side (the client value is never trusted) and sniff the format (§4.2).
4. **Malware scan:** `clamd INSTREAM` (ClamAV sidecar container in the worker Cloud Run service; `freshclam` every 6 h).
   - `FOUND` → move to `org/{org_id}/quarantine/{item_id}`, `state='infected'`, notification `ingest_infected` (in-app + e-mail to owners). Stop.
   - clamd unavailable → the job retries with backoff for up to `config.ingest.scan_max_wait_min` (30). After that it continues with `scan_status='error'`, and `ingest.rescan` retries hourly. While `scan_status ≠ 'clean'`, the original is **not downloadable** by anyone and is excluded from accountant packages. Processing (our parsers only read, never execute) continues.
   - Containers: the ZIP is scanned as a whole, and each member is scanned again as its own item.
5. Containers: `zip` / `eml` → enqueue `ingest.expand` → `state='expanded'`. Stop.
6. **Exact dedupe (§4.6.1).** On a hit → `state='exact_duplicate'`, delete the staging blob. Stop.
7. Copy staging → `org/{org_id}/files/{sha256}` (skip if it already exists) and delete staging. Insert `source_files` with `on conflict (org_id, sha256) do nothing`. A conflict means another arrival won the race → go back to step 6.
8. **Normalize** (§4.4) and update the `source_files` columns.
9. Insert `documents` (`status='received'`, `page_from=1`, `page_to=page_count`, `received_date` = the arrival date in Europe/Prague, see §4.5.3 for e-mail) `on conflict (source_file_id, page_from) do nothing`.
10. **Near-duplicate check** for raster sources (§4.6.2).
11. `state='accepted'`. Enqueue `doc.split` if `page_count ≥ 2`, else `doc.classify`. Emit `document.received`.

**`ingest.expand`:**
- ZIP members: skip directories, `__MACOSX/`, names starting with `.`, `Thumbs.db` and `desktop.ini` (these get `ignored` rows).
- ZIP member names: when flag bit 11 is set → UTF-8. Otherwise, if the bytes are valid UTF-8 → UTF-8, else CP852 (Czech Windows "Compressed folder" default, [verify]).
- Every member → a child `ingest_items` row (`origin='archive_member'`, `parent_item_id`) + `ingest.item.process`.

### 4.4 Normalization

| Step | Algorithm |
|---|---|
| Filename | Decode (browser string; RFC 2231/2047 for e-mail via postal-mime; ZIP as in §4.3). `original_filename` = the decoded string **unchanged** (NFD stays NFD). `filename_nfc = sanitize(raw.normalize('NFC'))`, where `sanitize` removes C0/C1 control chars, `/ \ : * ? " < > \|`, collapses whitespace and trims to 200 chars keeping the extension. Display, search and export always use `filename_nfc`. **Filenames are never part of any dedupe key.** |
| PDF metadata | `pdfjs-dist`: `page_count`; encryption; active content flags (`/JavaScript`, `/OpenAction`, `/Launch`, `/AA`) → `pdf_active_content=true` (we never execute it; the download dialog warns). |
| Text layer | Per page: extract text items (string, font height, bbox) → `text.json`. A page "has text" when it has ≥ 30 non-whitespace chars. `text_quality` = share of chars that are letters/digits/common punctuation and not U+FFFD or private-use (catches broken font encodings). `has_text_layer = pagesWithText/page_count ≥ 0.5 && text_quality ≥ config.ingest.min_text_quality (0.8)`. |
| Embedded ISDOC | Walk the `/Names/EmbeddedFiles` tree and the Catalog `/AF`. A file named `*.isdoc` or `invoice.isdoc`, or any embedded XML whose root ns is ISDOC → `has_embedded_isdoc=true`, saved to `derived/{sha}/isdoc.xml` (`research/registries-and-formats.md §7.5`). Invalid XML → flag `isdoc_invalid` and ignore the ISDOC. |
| Rasterization | Pages 1..min(N, `config.ingest.raster_eager_pages` 20): `page-{n}.jpg` at 150 DPI, long edge ≤ 2000 px, q85, honouring `/Rotate`; `thumb-{n}.jpg` at 400 px. Later pages are rendered lazily on request. |
| Images | Apply EXIF orientation, **strip EXIF** (GPS) from derivatives (the original is untouched), convert to sRGB JPEG q90 `page-1.jpg`. `image_width/height`. Blur score = variance of the Laplacian on a 1000-px grayscale copy; below `config.ingest.blur_warn` (60) → the upload row shows the warning "Fotka je rozmazaná – pokud nejde přečíst, vyfoťte ji znovu" (processing continues). |
| TIFF | Each frame → `page-{n}.jpg`. |
| QR prescan | `zxing-wasm` on each `thumb`-resolution page up to `config.split.qr_scan_pages` (50); payloads → `qr.json`. M02 reuses it and rescans at full resolution only when needed. |
| phash | For raster sources and image-only PDFs (`has_text_layer=false`, `page_count=1`): dHash 64-bit (grayscale, resize 9×8, compare adjacent columns) → `source_files.phash`. |

### 4.5 E-mail handling (`email.received`)

#### 4.5.1 Attachment triage (deterministic, in order; the first match wins)
| # | Condition | Result |
|---|---|---|
| A1 | `Content-Type` ∈ {`text/calendar`, `text/vcard`, `application/pkcs7-signature`, `application/pgp-signature`} or filename `smime.p7s` | `ignored` (reason `non_document_part`) |
| A2 | `application/ms-tnef` / `winmail.dat`, or `application/pkcs7-mime` (encrypted) | `unsupported` + notification "E-mail od {from} je ve formátu, který neumíme otevřít. Pošlete prosím přílohu znovu jako PDF." |
| A3 | image with `contentId` referenced as `cid:` in the HTML body | `ignored` (`inline_image`); used only when rendering the body |
| A4 | image with size < `config.ingest.min_attachment_image_bytes` (15 KiB), or decoded dimensions < 300×300 px, or filename matching `/^(image\d{3}\|logo\|signature\|podpis\|outlook-)/i` with size < 60 KiB | `ignored` (`decoration`) |
| A5 | everything else | candidate (processed by §4.3) |

`ignored` parts are visible in the e-mail detail ("3 obrázky z podpisu jsme přeskočili", "we skipped 3 signature images") with a "Přesto zpracovat" action (process anyway), which re-enqueues the item with `force=true`.

**Companion pairing (PDF + ISDOC in one e-mail or one upload batch):** when the candidates contain exactly one PDF and one ISDOC, or a PDF and an ISDOC with the same NFC filename stem, the ISDOC item gets `state='companion'` and `companion_of_item_id = pdf item`. Its XML is copied to the PDF's `derived/{sha}/isdoc.xml`, and the PDF's `has_embedded_isdoc=true`. This yields one document with exact data. Otherwise both are processed and semantic dedupe (§4.6.3) merges them.

#### 4.5.2 Body as a document
The body becomes an item (`origin='email_body'`) when:
- **(a)** no A5 candidate remains (body-only receipts from Uber, Bolt, Apple, Wolt, and newsletters too, so nothing is lost); **or**
- **(b)** A5 candidates exist **and** the body has strong receipt cues: ≥ 1 money amount with a currency (`/\d[\d  .]*[,.]\d{2}\s?(Kč|CZK|EUR|€|USD|\$)/`) **and** a cue from `RECEIPT_BODY_CUES` (`účtenka, daňový doklad, faktura, receipt, invoice, your receipt, váš doklad, celkem, total`); **or**
- **(c)** the sender domain (outer `From`, or inner `From` of a forwarded block) is in `config.ingest.body_receipt_senders` (seed: `uber.com, bolt.eu, apple.com, email.apple.com, wolt.com, google.com, paypal.com`) and (b)'s amount test passes.

**Rendering (`email.render_body`):**
1. Inline `cid:` images become data URIs. Plain-text-only bodies are HTML-escaped inside `<pre>`.
2. Prepend a header block: Od, Komu, Datum (Europe/Prague), Předmět.
3. Render with Playwright Chromium: `javaScriptEnabled:false`, **all network requests aborted**, A4, 10 mm margins, `printBackground:true`, timeout 15 s.
4. The resulting PDF is processed by §4.3 like any file (`mime_type='application/pdf'`, `channel='email'`).

`ingest_items.body_sha256` = sha256 of the canonical body: HTML → text via the same sanitizer, NFC, whitespace collapsed, tracking query strings removed from URLs. It is used for dedupe (§4.6.1), because rendered PDF bytes are not reproducible. Render failure → retry 2×, then `failed` with the raw body still readable in the e-mail detail.

#### 4.5.3 Signals and metadata
- `List-Unsubscribe`, `Precedence: bulk|list`, `Auto-Submitted ≠ no`, and `multipart/report` (DSN) are stored as features. They are **never drop rules**. They feed classification only for `email_body` items (R19, R20). An attachment's class is never influenced by them, because Alza-style invoices arrive in marketing-styled e-mails with `List-Unsubscribe`.
- **Forwarded chains:** detect forwarded blocks (`---------- Forwarded message ---------`, `Původní zpráva`, `Přeposlaná zpráva`, `Begin forwarded message:`, Outlook `From:/Sent:` blocks, Czech `Od:/Odesláno:`). Extract the inner `From` and `Date` (latest-first, up to 5 levels). The inner `From` domain feeds §4.5.2(c) and `partners.email_domains` learning (M02). `received_date` for documents from a forwarded e-mail = the innermost parseable `Date` when it is ≤ the outer date and ≥ outer − 365 days, else the outer `received_at` date (advisor question TA-01, `22-open-questions.md`).
- **Duplicate e-mails:** the same `Message-ID` → `prepare` returns `duplicate`. The same content with a new Message-ID (forwarded twice) → attachments dedupe by content hash, bodies by `body_sha256`.
- **Download-link-only e-mails** (cue `P_DOWNLOAD_LINK`: "fakturu si můžete stáhnout", "stáhnout fakturu", "download your invoice", "zobrazit fakturu" plus a link, and no A5 candidate): the body document is classified normally (usually `other_supporting`), and a review question `download_link_only` says "Faktura je jen ke stažení na webu dodavatele. Stáhněte ji a pošlete nám ji." We **never** fetch links.
- Notifications about e-mail problems go only to org members, **never to the sender** (no backscatter, no address oracle). The only signal a sender receives is the SMTP-level reject.

### 4.6 Deduplication

#### 4.6.1 Exact (content hash, per org)
- **Key:** `(org_id, sha256 of the original bytes)`. For `email_body` items the key is `(org_id, body_sha256)` among items in a terminal state ∈ {accepted, exact_duplicate}.
- **On a hit:**
  - `ingest_items.state='exact_duplicate'`, `source_file_id` = the existing one, `duplicate_of_document_id` = the oldest non-deleted document of that source file with `status ≠ 'duplicate'`.
  - If all its documents are in the trash → `duplicate_in_trash=true`, and the UI offers "Obnovit z koše" (restore from trash).
  - No new `documents` row. Emit `ingest.duplicate_detected`.
- **NFC/NFD golden case:** `IKEA_účtenka.pdf` uploaded from macOS (NFD: `u` + U+030C) and from Windows (NFC: `ú` U+00FA) with identical bytes → the second is `exact_duplicate`. Both arrivals are kept with their exact `original_filename`. `filename_nfc` is equal for both. The converse also holds: two **different** files with the same NFC name are **two** documents.

#### 4.6.2 Near-duplicate photos (perceptual hash)
For a new raster source with `phash`, find candidates: same org, `source_files.phash` within Hamming distance ≤ `config.dedupe.phash_candidate_distance` (6), created within the last 400 days, limit 20 (SQL: `bit_count(phash # $1) <= 6`).

- **Auto-duplicate** when distance ≤ `config.dedupe.phash_auto_distance` (2) **and** `|w1/h1 − w2/h2| ≤ 0.01` (re-encoded or resized copy of the same photo). The new document gets `status='duplicate'` + `document_links(from=new, to=original, kind='duplicate_of', note='phash:{d}')`.
- **Otherwise** store `ingest_items.near_duplicate_candidate_id`. The final decision is made after extraction by the secondary key in §4.6.3. Two different receipts from the same till look alike, so phash alone never decides above distance 2.

#### 4.6.3 Semantic (after extraction)
M02 calls `checkSemanticDuplicate(tx, doc)` inside its persist transaction, **before** writing `partner_id`, `document_number` and `total_gross`. This avoids hitting the `documents_semantic_dedupe` unique index.

1. **Primary key:** an existing doc with the same `(org_id, partner_id, document_number, total_gross)`, `deleted_at is null`, `status not in ('duplicate','supporting')`, `semantic_dedupe_exempt = false`. Lock it with `select … for update`.
2. **Secondary key** (receipts without a number, or `partner_id` null): the same supplier IČO (or VAT ID, or NFC-casefolded name when there is neither) + same `issue_date` + same `total_gross` + same `currency`, **and** (the same receipt time `HH:MM` if both have one, or a `near_duplicate_candidate_id` link to it). If neither has a time and there is no phash link → do **not** auto-merge. Create `review_questions(kind='possible_duplicate')` "Není to stejná účtenka jako {link}?".
3. **Which document stays primary.** Fidelity rank: ISDOC-backed 3 > PDF with text layer 2 > image or scan 1 > e-mail body render 0 > `entry_mode='manual'` without a file −1 > `entry_mode='imported'` −2. When the lower-ranked existing doc is file-less (manual or imported) **and finalized**, the captured doc does not replace it. Instead, its file is attached to the existing doc (`source_file_id`, `page_from/page_to`) through a new revision (03 §3, M03). The captured doc becomes `duplicate`, and M03 compares its extracted values with the typed or imported ones (a mismatch is a warning).
   - If the existing doc is **not** finalized and the new doc's rank is higher → the new doc becomes primary: the old one becomes `duplicate` and its links are re-pointed. The user's answered review questions and `business_flag` are copied over.
   - Otherwise the new doc becomes `duplicate`.
   - Ties → the earlier `created_at` stays primary.
4. Record a `document_links(kind='duplicate_of')`, emit `document.duplicate_detected`, and show a toast with "Zobrazit originál" (show original) and "Není duplicitní" (not a duplicate).
5. **"Není duplicitní"** → set `semantic_dedupe_exempt=true` on the newer doc, delete the link, re-enqueue the doc at `extracting`. This is audited.

### 4.7 Multi-document splitting (`doc.split`)
Skip it (→ `doc.classify`) when `page_count = 1`, when `has_embedded_isdoc`, or for format `isdoc`/`isdocx`/`epo_xml`/`camt053`. Otherwise set `status='splitting'`:

1. **QR separator sheets (Later; skip this step in Phase 1):** a page whose `qr.json` contains the exact payload `SHOEBOX*SEP*1` and has < 200 text chars is a separator. Separator pages are dropped and the PDF is cut there (hard). Settings › "Oddělovací list" downloads a printable A4 sheet (QR + "Oddělovací list – vložte mezi doklady při skenování", "Separator sheet – put it between documents when scanning").
2. **Deterministic cues** (text-layer pages only):
   - **start cue:** the page matches `/(strana|stránka|page|list)\s*1\s*(\/|z|of|ze)\s*\d+/i`, or contains an invoice-title cue (R13 cues) in its title zone (§4.8.2).
   - **continuation cue:** `/(strana|page)\s*([2-9]|\d{2,})\s*(\/|z|of)\s*\d+/i`, or the same document-number candidate as the previous page (`/(faktura|doklad|invoice)\s*(č\.|číslo|no\.?|number)?\s*[:#]?\s*([A-Z0-9\/-]{4,})/i`).
   - When every page has exactly one cue, the segmentation is decided deterministically (`method='rule'`).
3. **LLM boundary detection** (when step 2 is undecided and `page_count ≤ config.split.max_pages_llm` (40)):
   - Send Claude Haiku the thumbnails at 768 px plus the first 300 chars of each page's text.
   - Prompt `split.v1`; output `{segments:[{from,to,confidence,title?}]}`.
   - Validate: segments are contiguous, non-overlapping and cover 1..N (separator pages excluded). Invalid → treat as one segment with confidence 0.
4. **Decision:**
   - One segment → keep as is.
   - > 1 segment with min confidence ≥ `config.split.auto_accept` (0.85) → split.
   - min confidence in [0.6, 0.85) → keep as one document and ask `review_questions(kind='confirm_split', payload={segments})` "Tento PDF asi obsahuje {n} dokladů. Rozdělit?" with thumbnails.
   - Below 0.6 → keep as one.
   - `page_count > 40` → keep as one and ask `confirm_split` with a manual page-range editor.
5. **Applying a split:** in one transaction, update the existing doc to the first segment's `page_from/page_to` and insert one `documents` row per further segment (the same `source_file_id`), each `status='classifying'`. Enqueue `doc.classify` for each. Record an `extraction_runs(stage='split', method='rule'|'llm', …)`.
6. **Idempotency:** `stage_version.split` is stored on all segment docs. A rerun with the same version is a no-op. A rerun with a new version re-splits only if **no** segment doc is `finalized` or has user answers. Otherwise it records a proposal question.
7. A manual split (`POST /documents/{id}/split`) applies the same transaction with `method='user'` and deletes the derived segment docs that are no longer valid (soft delete).

### 4.8 Classification (`doc.classify`)

#### 4.8.1 Overview
`status='classifying'`. Build `ClassFeatures` (§6.1) → run deterministic rules → decide or call the LLM → fuse → apply guards → set `class`, `class_confidence`, `class_source`, `class_rule_ids` → route (§4.9). Every run writes `extraction_runs(stage='classify', method='rule'|'llm'|'llm_escalated', model, prompt_version, tokens, cost, latency, ok)`.

#### 4.8.2 Text normalization and the title zone
- `norm(s)` = NFKC → lowercase → collapse whitespace. `fold(s)` = `norm(s)` without diacritics.
- A cue matches when `fold(cue)` occurs in `fold(text)` (OCR often drops diacritics).
- **Title zone (text-layer PDFs):** take page 1 text items in the top 40 % of the page with font height ≥ 1.25 × the page's median font height, and concatenate the 5 largest lines. If none qualify (uniform fonts), use the first 8 non-empty lines of page 1. For no-text sources the title zone is the LLM's `title_text` (§4.8.4).
- **Body text** = the first 3 pages, max 20 000 chars.

#### 4.8.3 Cue catalog and rules (data: `packages/extraction/src/classify/cues.cs.ts`, versioned with `classify_rules_version`)

Cue sets (Czech + English; extensible without code changes):

| Cue id | Phrases |
|---|---|
| `T_INVOICE` | faktura, faktura – daňový doklad, daňový doklad, invoice, tax invoice, rechnung |
| `T_RECEIPT` | účtenka, zjednodušený daňový doklad, pokladní doklad, prodejní doklad, paragon, receipt, platba kartou, fik, bkp |
| `T_CREDIT` | opravný daňový doklad, dobropis, credit note, storno faktury |
| `T_PROFORMA` | zálohová faktura, proforma, pro forma, výzva k platbě, zálohový list |
| `T_ADVANCE_TAX` | daňový doklad k přijaté platbě, daňový doklad k platbě, daňový zálohový list |
| `T_ORDER` | objednávka, potvrzení objednávky, rekapitulace objednávky, shrnutí objednávky, order confirmation, your order |
| `P_NOT_TAX_STRICT` | nemá náležitosti daňového dokladu |
| `P_NOT_TAX` | není daňový doklad, toto není daňový doklad, nejedná se o daňový doklad |
| `P_TAX_STRUCT` | datum uskutečnění zdanitelného plnění, duzp, datum zdan. plnění, rekapitulace dph, základ daně, sazba dph |
| `T_DELIVERY` | dodací list, delivery note |
| `T_SETTLEMENT` | vyúčtování, přehled vyúčtování, vyúčtování pobytů, settlement, statement |
| `P_OWNER_MANAGER` | správce, majitel, podíl majitele, odměna správce; regex `/\d{1,2}\s?%\s?(správce\|majitel)/` |
| `T_EPO_DPH` | přiznání k dani z přidané hodnoty |
| `T_EPO_KH` | kontrolní hlášení (when with `P_EPO_FORM`) |
| `T_EPO_SH` | souhrnné hlášení (when with `P_EPO_FORM`) |
| `T_EPO_DPFO` | přiznání k dani z příjmů fyzických osob |
| `T_CSSZ_ZP` | přehled o příjmech a výdajích osvč |
| `P_EPO_FORM` | finančnímu úřadu pro, územní pracoviště, daňové identifikační číslo, ≥ 10 row labels matching `/\bř(ádek|\.)\s?\d{1,3}\b/` |
| `T_MUNICIPAL_FEE` | poplatek z pobytu, místní poplatek z pobytu |
| `P_MUNICIPAL` | městská část, úřad městské části, magistrát, obecní úřad, hlášení, měsíční hlášení, ohlášení, lůžkonoc, počet nocí, počet osobonocí ([verify] exact wording against golden fixtures) |
| `T_BANK_STMT` | výpis z účtu, bankovní výpis, account statement |
| `P_BALANCE` | počáteční zůstatek, konečný zůstatek, opening balance, closing balance |
| `T_PLATFORM` | payout, výplata, earnings, transaction history, payment overview, přehled plateb, výpis plateb |
| `T_CONTRACT` | smlouva, smluvní strany, uzavírají tuto, článek i |
| `P_DOWNLOAD_LINK` | stáhnout fakturu, fakturu si můžete stáhnout, download your invoice, zobrazit fakturu |

Platform issuers: `config.classify.platform_issuers` (`airbnb`, `booking.com`, `comgate`, `gopay`, `paypal`, `stripe`, `zásilkovna`, `shoptet`). Matched in `fold(text)` of page 1.

Rules. Kinds: **hard** (decides; LLM skipped), **strong**, **weak**, plus **veto** sets (classes the final decision may not be without review). "title" = title zone, "text" = body text.

| Id | Kind / weight | Condition | Class | Vetoes |
|---|---|---|---|---|
| R01 | hard | ISDOC present (file, ISDOCX, embedded or companion). `DocumentType` 1→invoice, 2/3/6→credit note, 4→`received_proforma`, 5→`received_advance_tax_doc`, 7→`received_receipt`. Direction: `AccountingSupplierParty` IČO/DIČ = org → issued_* | per map | – |
| R02 | hard | format `epo_xml` | `government_filing` | – |
| R03 | hard | format `camt053` or `bank_file` | `bank_statement` | – |
| R04 | weak 0.6 | QR SID present: TD=1 → credit note; TD=0 → `received_proforma`; TD 9/absent → `received_invoice` (`registries-and-formats.md §5.2`) | per TD | – |
| R05 | strong 0.97 | (`T_EPO_DPH`\|`T_EPO_DPFO`\|`T_CSSZ_ZP` in title) or (`T_EPO_*` in text and `P_EPO_FORM`) | `government_filing` | all bookable |
| R06 | strong 0.96 | `T_MUNICIPAL_FEE` in text and `P_MUNICIPAL` in text and not `T_INVOICE` in title | `government_filing` | all bookable |
| R07 | strong 0.97 | `T_ORDER` in title and not `T_INVOICE` in title and (`P_NOT_TAX_STRICT` or `P_NOT_TAX` or not `P_TAX_STRUCT`) | `order_confirmation` | `received_invoice`, `received_receipt` |
| R08 | weak 0.6 | `T_ORDER` in title only | `order_confirmation` | – |
| R09 | strong 0.92 | `T_SETTLEMENT` in title and `P_OWNER_MANAGER` in text and not `P_TAX_STRUCT` and not `T_INVOICE` in title | `settlement_statement` | `received_invoice` |
| R10 | strong 0.95 | `T_CREDIT` in title | `received_credit_note` | – |
| R11 | strong 0.95 | `T_PROFORMA` in title and not `T_ADVANCE_TAX` | `received_proforma` | – |
| R12 | strong 0.95 | `T_ADVANCE_TAX` in title | `received_advance_tax_doc` | – |
| R13 | strong 0.90 | `T_INVOICE` in title and (`P_TAX_STRUCT` or ≥ 1 amount) | `received_invoice` | – |
| R14 | strong 0.90 | ≥ 2 distinct `T_RECEIPT` cues in text, or `T_RECEIPT` in title | `received_receipt` | – |
| R15 | strong 0.90 | `T_DELIVERY` in title and not `T_INVOICE` in title | `delivery_note` | `received_invoice` |
| R16 | strong 0.93 | `T_BANK_STMT` in title/text and `P_BALANCE` | `bank_statement` | all bookable |
| R17 | strong 0.90 | platform issuer and `T_PLATFORM` and not `T_INVOICE` in title | `platform_statement` | – |
| R18 | weak 0.7 | `T_CONTRACT` ≥ 2 cues and `page_count ≥ 2` | `contract` | – |
| R19 | weak 0.7 | `email_body` and (`listUnsubscribe` or `precedenceBulk`) and no money amount with currency | `non_document` | – |
| R20 | hard | `email_body` and (`autoSubmitted` or DSN `multipart/report`) and no money amount | `non_document` | – |

> `P_NOT_TAX` ("není daňový doklad") is **not** a class cue by itself. The golden Alza "Faktura" (117 Kč, "Toto není daňový doklad") is a bookable `received_invoice` with `tax_doc_status='not_tax_document'` (decided in M02/M03). M01 passes the phrase hit in `class_rule_ids` as `F_NOT_TAX_PHRASE` for M02.

#### 4.8.4 LLM classifier (Claude Haiku 5.5, prompt `classify.v1`)
- **Input:**
  - page images 1–2 at 1024 px;
  - body text (≤ 6 000 chars) and title zone;
  - `filename_nfc`;
  - e-mail context (from domain, inner from domain, subject, first 500 chars of body, `listUnsubscribe`);
  - the rule hits as hints;
  - the cue-id list with phrases.
- The cached static system prompt contains: the 16 class definitions from 04 §2.1 with Czech examples, the explicit decoy guidance (order confirmation ≠ invoice; property-manager "Vyúčtování" with an owner/manager split = settlement statement; municipal tourist-fee reports and EPO forms = government filing; "není daňový doklad" on a "Faktura" is still an invoice) and 12 few-shot summaries.
- **Output** (JSON schema, zod `LlmClassOutput`): `{class, confidence, title_text, direction_hint: 'received'|'issued'|'none', cue_hits: CueId[], multi_document_suspected: boolean, evidence:[{quote, page}] (≤ 3)}`.
- For no-text sources, the rules run a **second pass** on `title_text` + `cue_hits` before fusion.
- **Escalation** to Sonnet 5.5 (`method='llm_escalated'`, same input + both hypotheses) when the fused confidence < `config.classify.escalate_below` (0.75) or rule and LLM disagree.
- **Budget:** if the per-tenant LLM budget (ADR-011) is exhausted, rules only; undecided → `needs_review`.

#### 4.8.5 Fusion (pure function `fuseClassification`)
```
hits = runClassRules(features)
if any hard hit: pick by priority R01 > R02 > R03 > R20; return {class, conf: 0.99, source: 'rule'}
score[c] = 1 − Π(1 − w) over strong/weak hits for c          // noisy-OR
vetoed   = ⋃ vetoes of hits with weight ≥ 0.9
top, second = two highest score classes (tie → lower R-number of strongest hit)
if score[top] ≥ classify.rule_accept (0.95) and score[second] < 0.5 and top ∉ vetoed:
    return {top, score[top], 'rule'}
llm = classifyWithLlm(...)                                      // Haiku
if score[top] < 0.5:            d = {llm.class, llm.confidence}
elif llm.class == top:          d = {top, max(llm.confidence, score[top])}
else:                           d = {llm.class, min(llm.confidence, 1 − score[top])}; disagreement = true
if d.conf < classify.escalate_below or disagreement: d = sonnet result fused the same way (rules vs Sonnet)
GUARDS (asymmetric safety):
  G1 d.class ∈ vetoed                                            → needs_review
  G2 d.class bookable and d.conf < classify.accept_bookable (0.85) → needs_review
  G3 d.class ∈ supporting classes and d.conf < classify.accept_supporting (0.80) → needs_review
  G4 d.class = non_document and d.conf < classify.accept_non_document (0.90) → needs_review
  G5 d.class non-bookable and (R01 or R13 hit with P_TAX_STRUCT and a VAT recap amount) → needs_review
needs_review → review_questions(kind='which_class', payload={candidates: top 3 with conf})
```
"Bookable" = the ✅ classes of 04 §2.1 (`received_invoice`, `received_receipt`, `received_credit_note`, `received_advance_tax_doc`, `issued_invoice`, `issued_credit_note`, `platform_statement`). "Supporting" = `settlement_statement`, `order_confirmation`, `delivery_note`, `government_filing`, `contract`, `other_supporting`, `bank_statement`, `received_proforma`.

#### 4.8.6 Direction reconciliation (`reconcileDirection`, called by M02 after parties are extracted)
- **Supplier is the org** (supplier IČO = org IČO, or supplier DIČ = org DIČ) → `received_invoice→issued_invoice`, `received_credit_note→issued_credit_note`, `direction='out'`.
- **Buyer is the org** → keep received_*, `direction='in'`.
- **Both or neither** → keep, and `review_questions(kind='confirm_direction')` only if neither matches **and** the doc is bookable. M03's buyer check reports the mismatch.
- `platform_statement` → `direction='out'`. Supporting classes → `direction=null`.

### 4.9 Routing after classification and decoy handling

| Class | Next status / job | What we store | Linking (`doc.link_supporting`, §4.9.1) | Reminder |
|---|---|---|---|---|
| bookable classes | `extracting`, `doc.extract` (profile `full`) | full fields (M02) | as target of the links below | – |
| `received_proforma` | `extracting`, `doc.extract` (profile `full`). Continues through M03 to `ready` (payable tracking); never creates ledger entries (04 §2.1). | full fields | `settles` (final invoice → proforma) by VS or order number + amount | `expected_documents(kind='final_invoice', expected_by = paid_at or issue_date + config.link.proforma_final_days (30))` |
| `order_confirmation` | `extracting`, `doc.extract` (profile `lite`) → `supporting` | supplier, order_number, order date, total_gross, currency, item summary | `fulfills` (invoice → order) | `expected_documents(kind='invoice', expected_by = order date + config.link.order_invoice_days (30))` |
| `settlement_statement` | `doc.extract` (profile `statement`) → `supporting` | issuer, period_from/to, gross, cleaning, tourist_fee_total, manager_fee_total, owner_total, per-stay rows | `same_period_reconciles` (statement → manager invoice); (municipal report → statement) | – |
| `government_filing` | `doc.extract` (profile `filing`) → `supporting` | the `filing.*` field keys of 04 §9.4: `filing.form_code` (DPHDP3, DPHKH1, DPHSHV, DPFDP7, CSSZ_PREHLED, ZP_PREHLED, MUNICIPAL_TOURIST_FEE, OTHER), `filing.period_start/_end`, `filing.filer_dic`, `filing.kind`, the printed rows `filing.rows.{n}.base/.tax` (EPO forms, needed from Phase 3), municipal: `filing.municipality`, `filing.bed_nights`, `filing.rate`, `filing.fee_total` | `reported_in` (bookable doc → filing); municipal → statement | emits `government_filing.ingested` (M05/M09 use it as profile evidence and to close the obligation `tourist_fee_report`/`vat_return` for that period) |
| `delivery_note` | `doc.extract` (profile `lite`) → `supporting` | supplier, number, order ref | `supports` (delivery note → invoice) by order or delivery number | – |
| `contract`, `other_supporting` | `doc.extract` (profile `lite`, summary only) → `supporting` | `summary_cs`, parties | – | – |
| `bank_statement` | `supporting` + `bank.statement.import_from_document` (M07, Phase 2) | – | – | Phase 1 notice "Bankovní výpisy načteme od fáze 2" |
| `non_document` | `supporting` immediately | nothing extracted | – | – |

`supporting` means **"kept, never booked"** (04 §2.4). The UI never says "zamítnuto" (rejected). It shows the class label (§7) under the "Podklady" (supporting) or "Ostatní" (other) tab. The `lite`, `statement` and `filing` profiles are implemented by M02 with the per-class schemas above. On completion M02 emits `document.extracted`, and M01's `doc.link_supporting` sets the final `supporting`.

#### 4.9.1 Linking algorithms (`doc.link_supporting`; runs on `document.extracted` of a supporting doc **and** on `document.ready` of a bookable doc, searching the other side)
All links have `created_by='system'` and a `note` with the matched keys. Partner match = equal IČO, else equal VAT ID, else Jaro-Winkler ≥ 0.92 on the folded name without legal suffix (`s.r.o.`, `a.s.`, `B.V.`, `Ltd`, `Inc.`).

1. **Order → invoice (`fulfills`):**
   - Candidates: `received_invoice`/`received_receipt` of the same partner with `issue_date` ∈ [order_date − 3 d, order_date + `config.link.order_window_days` (90)].
   - Score: order number equal (`documents.order_number`, or the order number appearing in the invoice text) → 1.0; else |total_gross − order total| ≤ 1.00 → 0.8; else 0.
   - Accept ≥ 0.8; tie → the nearest issue_date, then the earliest `created_at`. One invoice may fulfil one order.
   - On link → `expected_documents.state='fulfilled'`.
2. **Settlement statement → manager invoice (`same_period_reconciles`):**
   - Candidates: `received_invoice` from the statement issuer (partner match) with `duzp` ∈ [period_from, period_to + 45 d] or an overlapping service period, and |total_gross − manager_fee_total| ≤ 1.00 CZK.
   - Exactly 1 → link. > 1 → the nearest duzp to period_to; still tied → no link + an info note. 0 → none (retried on later events).
3. **Municipal report → settlement statement (`same_period_reconciles`):**
   - Same calendar month and |report.fee_total − statement.tourist_fee_total| ≤ 1.00.
   - Info check: `bed_nights × rules.at(period_end).municipal.tourist_fee[municipality].rate_per_bed_night == fee_total`. A mismatch creates a `validation_results(rule_id='MUNI_FEE_ARITH', severity='info')`.
4. **Bookable → filed DPHDP3 (`reported_in`):**
   - Only when the filer DIČ = org DIČ (else the review question `foreign_filing` "Toto přiznání patří jinému subjektu (DIČ {x}). Ponechat?").
   - Link every bookable doc whose `vat_point_date` ∈ the filing period and whose lines have a self-assessed or domestic VAT treatment.
   - The row-by-row comparison is M05's job. M01 only links and passes the extracted rows in the event.
5. **Delivery note → invoice (`supports`):** an order or delivery-note number referenced by the invoice + partner match.

**Expected documents:** `expected.sweep` (daily 07:00 Europe/Prague):
- open rows with `expected_by ≤ today` → notification `expected_invoice_overdue` (once), then remind at most weekly while open, and expire after 120 days (`state='expired'`);
- user actions: "Nahrát fakturu" (upload invoice), "Faktura nepřijde" (`dismissed`), "Připomenout za týden" (`expected_by += 7`).

### 4.10 Abuse protection, rate limits, security
- **Webhook HMAC:**
  - header `X-Shoebox-Signature: t={unix},v1={hex(HMAC-SHA256(secret, t + "." + rawBody))}`;
  - reject when `|now − t| > 300 s`;
  - two secrets are accepted during rotation (`INBOUND_WEBHOOK_SECRETS`, a list newest first, M12 §4.13);
  - constant-time compare;
  - the routes are not reachable without the signature (401, no body).
  - `prepare` uses the same scheme. The returned `orgRef` is an HMAC-signed `{org_id, exp:+15 min}` token.
- **Inbound rate limits** (counted on `inbound_emails` by `(org_id, received_at)` and `(org_id, from_address, received_at)`):
  - soft limits `config.ingest.email_soft_per_hour` (200/org), `email_soft_per_sender_hour` (50), `email_soft_per_day` (1 000/org) → accept, store, process at the low-priority queue level, and send one notification `inbound_flood` "Na vaši adresu přišlo neobvykle mnoho e-mailů. Zpracováváme je pomaleji. Pokud to nejste vy, změňte adresu.";
  - hard limit = 5 × soft → `prepare` returns `hard_limited` (SMTP reject).
- **Upload rate limits:** per user 300 files/hour, 2 000/day (`config.ingest.upload_per_user_hour`, `_day`) → HTTP 429 + `Retry-After`.
- **Address rotation:** `rotateInboundAddress(org, mode: 'grace' | 'immediate')` generates a new secret and stores the old one in `inbound_email_secret_prev` with `_prev_until` (05 §2). Audited.
- **No outbound mail to senders, ever.** Presigned URLs are single-key, TTL 10 min. Uploaded size is re-verified server-side (Supabase signed uploads don't bind content-length, [verify]).
- **Serving files:** from the storage origin with `Content-Disposition: attachment` for non-PDF/non-image types, `X-Content-Type-Options: nosniff`, and blocked while `scan_status ≠ 'clean'`.
- **Tenant isolation:** every worker query goes through `withTenant(orgId)`. The Email Worker never sees org IDs except inside `orgRef`.

### 4.11 Pipeline state machine (M01 part; `documents.status` values from 05)

| From | Event / job | To | Notes |
|---|---|---|---|
| – | `ingest.item.process` step 9 | `received` | |
| `received` | `doc.split` starts (`page_count ≥ 2`) | `splitting` | |
| `received` | `doc.classify` starts (`page_count = 1`) | `classifying` | |
| `splitting` | split decided | `classifying` (each segment) | |
| `classifying` | bookable or proforma, confident | `extracting` | handoff to M02 |
| `classifying` | supporting class, confident | `extracting` (profile `lite`/`statement`/`filing`) → `supporting` via `doc.link_supporting` | |
| `classifying` | `non_document` / `bank_statement` | `supporting` | |
| `classifying` | guard fired | `needs_review` | `which_class` question |
| `needs_review` (M01 question) | user answers `which_class` | `classifying` → routed with `class_source='user'`, conf 1.0 | |
| any non-finalized | phash auto / semantic duplicate | `duplicate` | `duplicate_of` link |
| `duplicate` | "Není duplicitní" | `extracting` | `semantic_dedupe_exempt=true` |
| `supporting` / `ready` (not finalized) | user "Změnit typ" (reclassify) | `classifying` → routed | prior extracted fields are kept (`is_current=false` when superseded) |
| any | job dead-lettered | `failed` | notification + "Zkusit znovu" |
| – | manual entry saved without a photo (§4.12) | `validating` | no split, classify or extract |
| – | manual photo attached (§4.12) | `extracting` (profile `full`, `fillGaps`) | skips split and classify |
| – | spreadsheet row imported (§4.13) | `validating` (or `duplicate`) | no file |

Writes use a compare-and-set: `update documents set status=$to … where id=$id and status=$from`. 0 rows → a concurrent transition won; the job exits successfully (idempotent). `finalized` documents are never reclassified (a correction goes through M03 revisions).

### 4.12 Manual entry ("Přidat ručně", Phase 1)
Manual entry is always available (04 §2.2a), from the Inbox ("Přidat ručně") and from any failed or unreadable item ("Zadat ručně"). It uses **the same form as the review screen** (M11 document detail), empty.

1. **Form:**
   - **Typ** (type): `received_receipt` "Účtenka / hotovostní výdaj" (default), `received_invoice` "Faktura přijatá" or `issued_invoice` "Faktura vydaná".
   - **Required:** `issue_date` (default today), `total_gross` (`Money`), `currency` (default CZK), partner name (free text; the IČO is optional and filled from ARES by M03 when given), one-line description.
   - **Optional:** `document_number`, `payment_method` (default `cash`), `duzp`, `due_date`, and the VAT rate/amount (shown only to `platce`).
   - **Optional:** "Doklad se ztratil / je poškozený / nebyl vystaven" → `substitute_reason` ∈ {`lost`,`damaged`,`never_issued`,`other`}.
   - **Optional:** "Přiložit fotku" (attach photo).
2. **Photo attached** (it may be damaged):
   - The photo goes through §4.1.1/§4.3 with `manual=true`: scan, normalize, exact dedupe. An exact duplicate → "Tento doklad už máte · Otevřít" and no new document.
   - The document is created at once with `entry_mode='manual'`, the chosen `class`, `class_source='user'`, `class_confidence=1`, `status='extracting'`. Split and classify are skipped.
   - `doc.extract` with `fillGaps: true` (M02, profile `full`) runs. Extracted values are written as non-user `document_fields` and prefill **only empty** form fields. A value the user typed is never overwritten.
   - While extraction runs, the form shows "Čtu fotku…". "Uložit hned" (save now) discards the pending extraction result for fields the user has filled.
3. **Save** (`saveManualDocument`), in one transaction:
   - Every typed value → `document_fields(source='user', set_by=user, is_current=true)`; superseded rows → `is_current=false`. The `documents` columns are set from current fields.
   - One `document_lines` row (`line_type='item'`, description, gross, plus net/VAT when given). M04 categorizes it.
   - `substitute_reason` set → `tax_doc_status='not_tax_document'` (04 §2.2a; the accountant may override). Otherwise `tax_doc_status` stays `unknown` (M03 decides).
   - `direction` from the class (§4.8.6). `received_date` = today.
   - `checkSemanticDuplicate` (§4.6.3; rank −1 without a photo). A hit → toast "Tento doklad už máte" with "Zobrazit / Přesto uložit" (the latter sets `semantic_dedupe_exempt=true`).
   - `status='validating'` + the M03 job. Without a photo: `source_file_id = null`, no `ingest_items` row (nothing was received).
4. **Payment:** `payment_method ∈ {cash, card}` with a past `issue_date` → `is_paid_per_document=true`. M07 creates the document-evidence transaction, as for card receipts.
5. **Audit:** `audit_log(entity='documents', action='manual_create')`.

### 4.13 Spreadsheet import (Phase 2)
Goal: small OSVČ stop keeping a parallel Excel list (04 §2.2a). Entry points:
- Inbox › "Nahrát" › "Importovat tabulku (XLSX/CSV)";
- in Phase 2, a XLSX/CSV dropped into the normal upload that M07's bank-format detector does not recognize → row action "Importovat jako seznam dokladů?" (instead of `unsupported`).

1. **Upload:** `POST /api/v1/imports` → signed URL → `import.spreadsheet.parse`.
   - The file is kept as a `source_files` row (`channel='import'`) without a document; its `ingest_items` row has `origin='spreadsheet_import'` and ends `expanded`.
   - The same file again → exact dedupe → "Tento soubor jste už importovali {date}".
   - Limits: 5 MiB, 5 000 rows, 50 columns.
2. **Parse:**
   - XLSX via `exceljs` (decision D-12; SheetJS CE is the alternative if `.xls` is needed). The first sheet by default; the user can pick another.
   - CSV: encoding = UTF-8 if there is a BOM or the bytes are valid UTF-8, else windows-1250. Delimiter = the most frequent of `;` `,` `\t` in the first 20 lines.
   - Header row = the first of the first 10 rows with ≥ 3 non-empty text cells.
3. **Mapping suggestion** (pure, no AI): headers are folded (§4.8.2) and matched against a synonym table (data `import-synonyms.cs.ts`):

   | Target | Synonyms (examples) | Value sniff (fallback) |
   |---|---|---|
   | `issue_date` (required) | datum, datum vystavení, vystaveno, date | first column with ≥ 80 % dates |
   | `partner_name` | dodavatel, odběratel, firma, partner, název, protistrana | – |
   | `partner_ico` | ičo, ič, ico | ≥ 80 % 8-digit values passing the IČO mod-11 check |
   | `document_number` | číslo, číslo faktury, č. dokladu, doklad, invoice no | – |
   | `total_gross` (required) | částka, celkem, s dph, cena, amount, total | – |
   | `total_vat` | dph, daň | – |
   | `paid` | zaplaceno, uhrazeno, datum úhrady, paid | ≥ 80 % yes/no tokens or dates |
   | `direction` (optional) | typ, příjem/výdaj | – |
   | also `total_net`, `currency`, `variable_symbol`, `due_date`, `description` | bez dph, základ · měna · vs · splatnost · popis, poznámka | – |

   - **Direction option:** "Všechno jsou výdaje" (default) / "Všechno jsou příjmy" / "Podle sloupce {X}" (the user maps the values) / "Podle znaménka částky" (sign of the amount).
   - **Reuse:** the mapping is saved per org in `import_mappings` (`kind='documents'`, shared table with M07's bank CSV mappings) keyed by `header_signature` = sha256 of the folded header list. A later file with the same signature preselects it.
4. **Value parsing:**
   - amounts: `1 234,50`, `1.234,50`, `1234.5`, with an optional `Kč`/`CZK`/`€` → `Money`;
   - dates: `1. 3. 2026`, `01.03.2026`, `2026-03-01`, Excel serials;
   - paid: `ano/ne/x/✓/1/0` or a date (a date = paid on).
   - A row missing a required value is **skipped** with its reason. Rows that are entirely empty are ignored silently.
5. **Preview** (`previewImport`): the first 10 parsed rows as target fields, with invalid cells highlighted, plus totals: "Naimportujeme {n} řádků · {s} přeskočíme ({reasons}) · {d} už máte". Nothing is written before "Importovat".
6. **Import** (`import.spreadsheet.run`, idempotent per `(import_id, row)`): for each valid row:
   - insert `documents`:
     - `entry_mode='imported'`, `source_file_id=null`, `import_id`, `import_row`;
     - `class`: expense → `received_invoice` when there is a document number, else `received_receipt`; income → `issued_invoice`;
     - `class_source='user'`, `direction` from the class, `tax_doc_status='unknown'`, `received_date` = the import date;
   - values → `document_fields(source='user')` (the user's own records), plus one `document_lines` row;
   - paid → `is_paid_per_document=true` + field `payment.paid_on` (M07 creates the document-evidence transaction);
   - `checkSemanticDuplicate` (rank −2): a duplicate of an existing doc → `status='duplicate'` + link. A duplicate of an earlier row in the same file → skipped as `duplicate_in_file`. Otherwise `status='validating'` + the M03 job.
   - Batched 200 rows per transaction. Progress is shown on the import card.
7. **Later captured documents** merge via §4.6.3 (the captured one becomes primary, or its file is attached when the imported doc is finalized).
8. **Undo:** "Vrátit import" within 30 days soft-deletes the import's documents that are not finalized and were not edited by the user. It reports the rest.

### 4.14 Failure handling and notifications
| Failure | Behavior | User sees (in-app; e-mail to owners when marked ✉) |
|---|---|---|
| Upload PUT fails 3× | item stays `pending_upload`; `expired` after 1 h | row "Nahrání selhalo – zkusit znovu" (button) |
| Unsupported / too large / encrypted | terminal state; blob kept 90 days | row with reason + "Stáhnout" / for PDFs "Zadat heslo" (password, decrypted in memory, never stored) |
| Infected | quarantine | "Soubor {name} obsahuje škodlivý kód. Nezpracovali jsme ho." ✉ |
| E-mail too large / hard-limited | SMTP reject | "E-mail od {from} ({size} MB) byl odmítnut – maximum je 25 MB." ✉ |
| LLM unavailable | jobs retry with backoff up to 6 h. Rule-decided docs continue. | the doc shows "Čeká na zpracování" |
| Render / normalize error | 3 retries → `failed` | "Doklad se nepodařilo zpracovat. Zkusit znovu / Nahlásit" ✉ (hourly digest) |
| Job in DLQ `ingest.dlq` | Sentry (no content), `failed` | as above |
| Item not terminal after 24 h | maintainer alert | – |

E-mail notifications are batched: at most one per `kind` per hour per org (M09 delivery).

## 5. Data

### 5.1 Read
`organizations` (slug, secret, settings), `memberships` (sender attribution), `taxpayer_profiles` (org IČO/DIČ via `profile.at(date)`), `partners`, `documents`, `source_files`, `inbound_emails`, `document_fields` (supporting values for linking), `rules.at()` (`municipal.tourist_fee`).

### 5.2 Written
`inbound_emails` (all columns; `spam_verdict` ∈ {`pass`,`spoof_fail`,`unknown`}; `processed_at`), `source_files` (all columns), `documents` (`status`, `page_from/page_to`, `class`, `class_confidence`, `direction`, `received_date`, `stage_version.split/.classify`, + proposed), `document_links`, `extraction_runs` (stage `split`/`classify`), `review_questions` (kinds `which_class`, `confirm_split`, `possible_duplicate`, `confirm_direction`, `download_link_only`, `foreign_filing`, `encrypted_pdf`), `validation_results` (`MUNI_FEE_ARITH` only), `notifications` (kinds `ingest_failed`, `ingest_infected`, `ingest_unsupported`, `email_rejected`, `email_quarantined`, `inbound_flood`, `expected_invoice_overdue`, `bank_notices_held`), `audit_log` (reclassify, split, not-duplicate, release, rotate, manual_create, import, import_undo), `ingest_items`, `expected_documents`, `documents.entry_mode` / `substitute_reason` (05), `document_fields` and `document_lines` (manual entry and import only, `source='user'`), `import_mappings`, `spreadsheet_imports`.

### 5.3 Schema
Merged into 05 on 2026-10-18; see 05 §4 `ingest_items`, `source_files` (phash, scan_status, text_quality…), `documents` (class_source, class_rule_ids, semantic_dedupe_exempt, import_id/import_row), `expected_documents`, 05 §2 `organizations` (inbound_email_secret_prev*), 05 §6 `import_mappings` (shared with M07, `kind='documents'`) and `spreadsheet_imports`, and 05 §11 for the storage lifecycle (`incoming/` 24 h or 90 days, `quarantine/` 30 days, `derived/` follows its source file).

## 6. Interfaces

### 6.1 Types and public functions (`packages/pipeline/src/ingest/index.ts`, `packages/extraction/src/classify/index.ts`)
```ts
export type IngestOrigin = 'upload'|'email_attachment'|'email_body'|'archive_member'|'camera_bundle'|'spreadsheet_import';
export type IngestState = 'pending_upload'|'uploaded'|'processing'|'accepted'|'exact_duplicate'|'companion'|'expanded'
  |'bundled'|'ignored'|'unsupported'|'too_large'|'infected'|'encrypted'|'quarantined'|'failed'|'expired';
export type DetectedFormat = 'pdf'|'jpeg'|'png'|'webp'|'heic'|'tiff'|'isdoc'|'isdocx'|'epo_xml'|'camt053'
  |'xml_other'|'zip'|'eml'|'bank_file'|'unsupported';
export type CueId = 'T_INVOICE'|'T_RECEIPT'|'T_CREDIT'|'T_PROFORMA'|'T_ADVANCE_TAX'|'T_ORDER'|'P_NOT_TAX_STRICT'|'P_NOT_TAX'
  |'P_TAX_STRUCT'|'T_DELIVERY'|'T_SETTLEMENT'|'P_OWNER_MANAGER'|'T_EPO_DPH'|'T_EPO_KH'|'T_EPO_SH'|'T_EPO_DPFO'|'T_CSSZ_ZP'
  |'P_EPO_FORM'|'T_MUNICIPAL_FEE'|'P_MUNICIPAL'|'T_BANK_STMT'|'P_BALANCE'|'T_PLATFORM'|'T_CONTRACT'|'P_DOWNLOAD_LINK';

export interface ClassFeatures {
  format: DetectedFormat; pageCount: number; hasTextLayer: boolean; textQuality: number | null;
  isdoc?: { documentType: 1|2|3|4|5|6|7; supplierIco?: string; supplierDic?: string; customerIco?: string };
  epo?: { formCode: string };
  qr: { sidTd?: string; sidTp?: string; spayd: boolean; separatorPages: number[] };
  titleText: string;            // title zone (§4.8.2) or LLM title_text
  bodyText: string;             // ≤ 20 000 chars, first 3 pages
  cueHitsTitle: CueId[]; cueHitsText: CueId[];
  moneyAmountCount: number; hasVatRecapAmounts: boolean;
  platformIssuer?: string;
  email?: { fromDomain: string; innerFromDomain?: string; subject: string; listUnsubscribe: boolean;
            precedenceBulk: boolean; autoSubmitted: boolean; isDsn: boolean; isBodyRender: boolean };
  filenameNfc: string;
  image?: { width: number; height: number; blurScore: number };
  org: { ico: string; dic: string | null };
}
export interface RuleHit { ruleId: `R${number}` | 'F_NOT_TAX_PHRASE'; kind: 'hard'|'strong'|'weak'; weight: number;
  class: DocumentClass | null; vetoes: DocumentClass[] }
export interface ClassDecision { class: DocumentClass; confidence: number; source: 'rule'|'llm'|'llm_escalated'|'user';
  ruleIds: string[]; needsReview: boolean; candidates: { class: DocumentClass; confidence: number }[];
  multiDocumentSuspected: boolean }

// Intake
export function createUploadBatch(ctx: UserCtx, input: CreateUploadBatchInput): Promise<CreateUploadBatchResult>;
export function completeUpload(ctx: UserCtx, ingestItemId: string): Promise<void>;
export function prepareInboundEmail(req: SignedRequest<PrepareInboundEmail>): Promise<PrepareInboundEmailResult>;
export function handleInboundEmailWebhook(req: SignedRequest<InboundEmailWebhook>): Promise<{ inboundEmailId: string | null }>;
export function recordRejectedEmail(req: SignedRequest<RejectedEmail>): Promise<void>;
export function rerouteBankNoticeToDocuments(orgId: string, inboundEmailId: string): Promise<void>;
export function parseEmail(raw: ArrayBuffer): Promise<ParsedEmail>;                 // shared with apps/email-worker
export function triageAttachments(email: ParsedEmail): AttachmentDecision[];        // §4.5.1, pure
export function decideBodyDocument(email: ParsedEmail, candidates: AttachmentDecision[]): BodyDecision; // §4.5.2, pure
export function canonicalBodyHash(email: ParsedEmail): string;                     // pure
export function extractForwardedHeaders(text: string): { from?: string; date?: string }[]; // pure
// Normalization
export function sniffFormat(head: Uint8Array, tail?: Uint8Array): DetectedFormat;   // pure
export function normalizeFilename(raw: string): { original: string; nfc: string };  // pure, idempotent
export function decodeZipEntryName(bytes: Uint8Array, utf8Flag: boolean): string;    // pure
export function normalizeSourceFile(orgId: string, sourceFileId: string): Promise<NormalizationResult>;
export function detectEmbeddedIsdoc(pdf: Uint8Array): Promise<{ xml: string; name: string } | null>;
export function dHash64(image: Uint8Array): Promise<bigint>;
export function hamming64(a: bigint, b: bigint): number;                            // pure
// Dedupe
export function findExactDuplicate(tx: Tx, orgId: string, key: { sha256?: string; bodySha256?: string }): Promise<ExactDupHit | null>;
export function findNearDuplicates(tx: Tx, orgId: string, phash: bigint, aspect: number): Promise<NearDupCandidate[]>;
export function checkSemanticDuplicate(tx: Tx, doc: SemanticKeyInput): Promise<SemanticDupResult>; // called by M02
export function markNotDuplicate(ctx: UserCtx, documentId: string): Promise<void>;
// Split
export function deterministicSegments(pages: PageCueInput[]): Segment[] | null;     // pure
export function validateSegments(segs: Segment[], pageCount: number, separators: number[]): boolean; // pure
export function applySplit(tx: Tx, documentId: string, segs: Segment[], method: 'rule'|'llm'|'user'): Promise<string[]>;
// Classify
export function buildClassFeatures(orgId: string, documentId: string): Promise<ClassFeatures>;
export function runClassRules(f: ClassFeatures): RuleHit[];                         // pure
export function fuseClassification(hits: RuleHit[], llm: LlmClassOutput | null, escalated: LlmClassOutput | null): ClassDecision; // pure
export function classifyWithLlm(f: ClassFeatures, pages: PageImage[], model: 'haiku'|'sonnet', hints: RuleHit[]): Promise<LlmClassOutput>;
export function reconcileDirection(cls: DocumentClass, parties: { supplier?: PartyIds; buyer?: PartyIds }, org: PartyIds):
  { class: DocumentClass; direction: 'in'|'out'|null; askUser: boolean };            // pure, called by M02
export function reclassifyByUser(ctx: UserCtx, documentId: string, cls: DocumentClass): Promise<void>;
// Manual entry (§4.12)
export interface ManualEntryInput { class: 'received_receipt'|'received_invoice'|'issued_invoice'; issueDate: string;
  totalGross: Money; currency: string; partnerName: string; partnerIco?: string; description: string;
  documentNumber?: string; paymentMethod?: 'cash'|'card'|'bank_transfer'|'other'; duzp?: string; dueDate?: string;
  categoryCode?: string; businessFlag?: 'business'|'personal'|'mixed';   // "Za co" and the Firemní/Soukromé/Napůl chip (M11 §5.1a); typed → source 'user'
  vat?: { ratePct: string; net: Money; vat: Money }; substituteReason?: 'lost'|'damaged'|'never_issued'|'other';
  photoIngestItemId?: string; allowDuplicate?: boolean }
export function startManualDocument(ctx: UserCtx, photoIngestItemId: string, cls: ManualEntryInput['class']): Promise<{ documentId: string }>;
export function saveManualDocument(ctx: UserCtx, documentId: string | null, input: ManualEntryInput):
  Promise<{ documentId: string } | { duplicateOf: string }>;
// Spreadsheet import (§4.13)
export type ImportTarget = 'issue_date'|'partner_name'|'partner_ico'|'document_number'|'total_gross'|'total_vat'|'total_net'
  |'currency'|'paid'|'direction'|'variable_symbol'|'due_date'|'description';
export interface ImportMapping { columns: Partial<Record<ImportTarget, number>>; headerRow: number; sheet?: string;
  directionMode: 'all_expense'|'all_income'|'by_column'|'by_sign'; directionValues?: Record<string,'in'|'out'> }
export function parseSpreadsheet(bytes: Uint8Array, format: 'xlsx'|'csv', sheet?: string): ParsedSheet;      // pure
export function suggestMapping(headers: string[], sample: string[][]): ImportMapping;                        // pure
export function parseImportRow(row: string[], m: ImportMapping): { ok: true; value: ImportRow } | { ok: false; reason: string }; // pure
export function previewImport(ctx: UserCtx, importId: string, m: ImportMapping): Promise<ImportPreview>;   // first 10 rows + counts
export function startImport(ctx: UserCtx, importId: string, m: ImportMapping): Promise<void>;              // saves mapping, enqueues run
export function undoImport(ctx: UserCtx, importId: string): Promise<{ removed: number; kept: number }>;
// Linking
export function linkSupportingDocuments(orgId: string, documentId: string): Promise<LinkResult[]>;
export function rotateInboundAddress(ctx: UserCtx, mode: 'grace'|'immediate'): Promise<{ address: string }>;
```

### 6.2 Payload schemas (zod, `packages/pipeline/src/ingest/schemas.ts`)
```ts
export const CreateUploadBatchInput = z.object({
  channel: z.enum(['upload','camera']),
  bundle: z.boolean().default(false),
  files: z.array(z.object({ clientId: z.string().max(64), name: z.string().min(1).max(1024),
    size: z.number().int().positive(), type: z.string().max(255) })).min(1).max(100),
});
export const PrepareInboundEmail = z.object({ v: z.literal(1), to: z.string().max(320), messageId: z.string().max(998),
  rawSize: z.number().int().positive(), hasHtml: z.boolean(),
  attachments: z.array(z.object({ index: z.number().int().min(0), size: z.number().int().min(0) })).max(100) });
export const InboundEmailWebhook = z.object({
  v: z.literal(1), orgRef: z.string(), to: z.string(), purpose: z.enum(['documents','bank_notice']),
  messageId: z.string().max(998), rawSha256: z.string().regex(/^[0-9a-f]{64}$/), rawSize: z.number().int(),
  emlKey: z.string(), htmlKey: z.string().nullable(),
  envelopeFrom: z.string().nullable(), headerFrom: z.string().nullable(), subject: z.string().max(998).nullable(),
  date: z.string().datetime({ offset: true }).nullable(), receivedAt: z.string().datetime({ offset: true }),
  auth: z.object({ spf: z.string(), dkim: z.string(), dmarc: z.string() }), spoof: z.boolean(),
  listUnsubscribe: z.boolean(), precedenceBulk: z.boolean(), autoSubmitted: z.boolean(), isDsn: z.boolean(),
  bodyText: z.string().max(200_000).nullable(),
  attachments: z.array(z.object({ index: z.number().int(), ingestItemId: z.string().uuid(), key: z.string(),
    filename: z.string().nullable(), mimeType: z.string(), size: z.number().int(), sha256: z.string().length(64),
    disposition: z.enum(['attachment','inline']), contentId: z.string().nullable() })).max(100),
});
const Base = z.object({ orgId: z.string().uuid(), v: z.number().int().positive() });
export const IngestItemProcessJob   = Base.extend({ ingestItemId: z.string().uuid(), force: z.boolean().default(false) });
export const IngestExpandJob        = Base.extend({ ingestItemId: z.string().uuid(), depth: z.number().int().max(3) });
export const IngestBundleJob        = Base.extend({ bundleId: z.string().uuid() });
export const IngestRescanJob        = Base.extend({ sourceFileId: z.string().uuid() });
export const EmailReceivedJob       = Base.extend({ inboundEmailId: z.string().uuid(), force: z.boolean().default(false) });
export const EmailRenderBodyJob     = Base.extend({ inboundEmailId: z.string().uuid(), ingestItemId: z.string().uuid() });
export const DocSplitJob            = Base.extend({ documentId: z.string().uuid() });
export const DocClassifyJob         = Base.extend({ documentId: z.string().uuid(), reason: z.enum(['pipeline','user','reprocess']) });
export const DocLinkSupportingJob   = Base.extend({ documentId: z.string().uuid(), trigger: z.enum(['extracted','ready']) });
export const ExpectedSweepJob       = z.object({ day: z.string().date() });
export const ImportParseJob         = Base.extend({ importId: z.string().uuid() });
export const ImportRunJob           = Base.extend({ importId: z.string().uuid(), fromRow: z.number().int().min(0) });
```

### 6.3 Jobs (pg-boss)
`singletonKey` = `{org_id}:{stage}:{entity_id}:{v}` (ADR-003), where `v` = the current stage version from `config.versions` (`ingest: 1, split: 1, classify: 1, link: 1`). `retryLimit 5, retryBackoff true, retryDelay 10 s`, dead letter `ingest.dlq`.

| Job | Trigger | Concurrency | Timeout |
|---|---|---|---|
| `ingest.item.process` | upload complete, e-mail received, expand | 16/worker | 120 s |
| `ingest.expand` | container detected | 4 | 120 s |
| `ingest.bundle.assemble` | all bundle members uploaded | 4 | 60 s |
| `ingest.rescan` | hourly while `scan_status='error'` | 2 | 60 s |
| `ingest.cleanup` | daily 03:10 | 1 | 15 min |
| `email.received` | webhook | 8 | 60 s |
| `email.render_body` | body decision | 2 (Chromium) | 30 s |
| `doc.split` | `page_count ≥ 2` | 8 | 90 s |
| `doc.classify` | after split / single page / user | 16 | 90 s |
| `doc.link_supporting` | `document.extracted` (supporting), `document.ready` (bookable) | 8 | 30 s |
| `expected.sweep` | daily 07:00 Europe/Prague | 1 | 10 min |
| `import.spreadsheet.parse` | import file uploaded (Phase 2) | 2 | 60 s |
| `import.spreadsheet.run` | "Importovat" (Phase 2); re-enqueues itself every 200 rows with `fromRow` | 2 | 120 s |

### 6.4 Events (outbox table → pg-boss `publish`)
`document.received {documentId, sourceFileId, channel}` · `document.classified {documentId, class, confidence, source}` · `ingest.duplicate_detected {ingestItemId, duplicateOfDocumentId}` · `document.duplicate_detected {documentId, originalId, method:'phash'|'semantic'}` · `document.supporting_linked {fromId, toId, kind}` · `government_filing.ingested {documentId, formCode, periodStart, periodEnd, filerDic, rows}` · `expected_document.created|fulfilled|overdue {id}` · `ingest.failed {ingestItemId|documentId, code}`.

### 6.5 API routes
| Route | Auth | Purpose |
|---|---|---|
| `POST /api/v1/uploads` | owner, member | create batch → signed URLs |
| `POST /api/v1/uploads/{itemId}/complete` | owner, member | mark uploaded |
| `GET /api/v1/uploads/batches/{batchId}` | members | per-file status (polling fallback) |
| `POST /api/v1/ingest-items/{id}/retry` · `/process-anyway` · `/release` | owner, member | failed / ignored / quarantined item actions |
| `POST /api/v1/documents/{id}/reclassify {class}` | owner, member | user class |
| `POST /api/v1/documents/{id}/split {segments}` | owner, member | manual split |
| `POST /api/v1/documents/{id}/not-duplicate` | owner, member | §4.6.3 step 5 |
| `POST /api/v1/expected-documents/{id}/dismiss` · `/snooze` | owner, member | reminders |
| `POST /api/v1/settings/inbound-address/rotate {mode}` | owner | rotation |
| `POST /api/v1/documents/manual` · `PUT /api/v1/documents/{id}/manual` | owner, member | §4.12 start (with photo) / save |
| `POST /api/v1/imports` · `POST /api/v1/imports/{id}/preview` · `/start` · `/undo` · `GET /api/v1/imports/{id}` | owner, member | §4.13 (Phase 2) |
| `GET /api/v1/settings/separator-sheet.pdf` | members | printable QR separator (Later) |
| `POST /api/internal/inbound-email/prepare` · `/api/internal/inbound-email` · `/api/internal/inbound-email/rejected` | HMAC | Email Worker |

## 7. UX touchpoints (copy follows the M11 glossary)

- **Inbox upload panel:** a row appears within 300 ms per file, with the NFC name, size, a progress bar and a status chip. Statuses map from `ingest_items.state` + `documents.status`:

| i18n key | Czech copy |
|---|---|
| `ingest.status.uploading` | Nahrávám… {pct} % |
| `ingest.status.checking` | Kontroluji soubor |
| `ingest.status.reading` | Čtu doklad |
| `ingest.status.done` | Hotovo · {classLabel} · {partner} · {amount} |
| `ingest.status.supporting` | Uloženo jako podklad · {classLabel} (neúčtuje se) |
| `ingest.status.duplicate` | Tento doklad už máte · Zobrazit |
| `ingest.status.duplicate_trash` | Tento doklad máte v koši · Obnovit |
| `ingest.status.needs_review` | Potřebujeme vaši odpověď (1 otázka) |
| `ingest.status.unsupported` | Tento formát zatím neumíme přečíst. Soubor jsme uložili. |
| `ingest.status.too_large` | Soubor je větší než 25 MB. Zkuste ho zmenšit nebo rozdělit. |
| `ingest.status.encrypted` | PDF je zaheslované · Zadat heslo |
| `ingest.status.infected` | Soubor obsahuje škodlivý kód a nebyl zpracován. |
| `ingest.status.failed` | Nepodařilo se zpracovat · Zkusit znovu |
| `ingest.warn.blurry` | Fotka je rozmazaná – pokud nejde přečíst, vyfoťte ji znovu. |
| `ingest.batch.summary` | {n} dokladů zpracováno · {d} duplicitních · {s} podkladů · {q} otázek |

- **Camera sheet:** `ingest.camera.add_page` "Přidat další stránku" · `ingest.camera.done` "Hotovo" · `ingest.camera.tip` "Položte účtenku na tmavý podklad a vyfoťte ji celou."
- **Class labels** (`classify.class.*`): received_invoice "Faktura přijatá" · received_receipt "Účtenka" · received_credit_note "Dobropis přijatý" · received_advance_tax_doc "Daňový doklad k záloze" · received_proforma "Zálohová faktura" · issued_invoice "Faktura vydaná" · issued_credit_note "Dobropis vydaný" · platform_statement "Výpis z platformy" · settlement_statement "Vyúčtování od správce" · order_confirmation "Objednávka" · delivery_note "Dodací list" · bank_statement "Bankovní výpis" · government_filing "Úřední formulář / podání" · contract "Smlouva" · other_supporting "Jiný podklad" · non_document "Není doklad" · unknown "Nerozpoznáno".
- **Questions:**
  - `classify.q.which_class` "Co je to za doklad?" (top 3 + "Jiné…");
  - `split.q.confirm` "Tento PDF asi obsahuje {n} dokladů. Rozdělit?" (Rozdělit / Je to jeden doklad);
  - `dedupe.q.possible` "Není to stejná účtenka jako tato z {date}?" (Ano, duplicitní / Ne, jsou dvě);
  - `email.q.download_link_only` (§4.5.3).
- **Decoy explanation** on the document detail (one sentence, `classify.why.*`):
  - order_confirmation: "Objednávka není daňový doklad. Uložili jsme ji jako podklad a počkáme na fakturu.";
  - settlement_statement: "Vyúčtování od správce slouží ke kontrole. Účtuje se faktura správce, kterou jsme k němu připojili.";
  - government_filing (DPHDP3): "Vaše podané přiznání DPH za {period}. Neúčtuje se; slouží ke kontrole.";
  - municipal: "Hlášení poplatku z pobytu za {period} ({fee} Kč). Neúčtuje se.";
  - all with a "Změnit typ" link (change type).
- **Manual entry:**
  - `manual.cta` "Přidat ručně";
  - `manual.substitute` "Doklad se ztratil / je poškozený / nebyl vystaven";
  - `manual.substitute_hint` "Uložíme ho jako náhradní doklad. Pro daň z příjmů se počítá, DPH z něj neuplatníme – rozhodne účetní.";
  - `manual.reading_photo` "Čtu fotku… doplňte, co chybí.";
  - `manual.save_now` "Uložit hned".
- **Spreadsheet import (Phase 2):**
  - `import.cta` "Importovat tabulku (XLSX/CSV)";
  - `import.mapping.title` "Zkontrolujte, co je v kterém sloupci";
  - `import.mapping.reused` "Použili jsme nastavení z minulého importu.";
  - `import.preview.summary` "Naimportujeme {n} řádků · {s} přeskočíme · {d} už máte";
  - `import.done` "Hotovo. Excel už vést nemusíte – nové doklady stačí přeposílat.";
  - `import.undo` "Vrátit import".
- **Reminder:** `expected.overdue` "K objednávce od {partner} z {date} ({amount}) zatím nemáme fakturu." (Nahrát fakturu / Faktura nepřijde / Připomenout za týden).
- **Settings › Příjem dokladů** (one card, counts as 2 settings):
  - the address with copy;
  - the `+banka` address;
  - "Změnit adresu" (with "staré adrese ponechat 7 dní" (keep the old address 7 days) on by default);
  - the separator sheet download (Later);
  - quarantine list link.
  - Copy: "Na tuto adresu můžete přeposílat faktury, nebo ji dejte dodavatelům a účetní."

## 8. Edge cases and failure modes
1. NFD vs NFC filename, identical bytes → one document. Different bytes, same NFC name → two documents. A filename with a `/` or control chars is sanitized; the original is kept.
2. The same file in an e-mail and in a ZIP in the same batch → the first processed wins; the other → `exact_duplicate` (race resolved by the `source_files` unique constraint, §4.3 step 7).
3. The user re-uploads their own Shoebox export ZIP → every member is `exact_duplicate`; the summary reads "45 souborů už máte".
4. `faktura.pdf` + `faktura.isdoc` → one document (companion). An ISDOC whose numbers differ from the PDF → M03 flags it; ISDOC remains the data source (ADR-006).
5. ISDOC.pdf with an invalid embedded XML → `isdoc_invalid`, fall back to the text/LLM path.
6. A 2-page single invoice with "Strana 1/2, 2/2" → never split. A 3-invoice scan without page numbers → LLM split. A scan with QR separators → split without the LLM (Later).
7. A merged PDF where one segment is an order confirmation and another an invoice → each segment classified independently.
8. Thermal receipt photo, no text layer → no rules fire before the LLM; second-pass rules on `cue_hits`; R14 typically confirms.
9. A HEIC burst/Live Photo container → the primary image only. HEIC decode fails → `failed` with the copy "Fotku se nepodařilo otevřít. Zkuste ji poslat jako JPEG."
10. A 100 MP panorama → `unsupported` (pixel limit). A zero-byte file → `unsupported` (`empty`).
11. An e-mail with 60 attachments → the first 50 processed (by MIME order), the rest `ignored` (`attachment_limit`) + notification.
12. A body-only Uber receipt forwarded twice → the second body is `exact_duplicate` via `body_sha256`. The same receipt forwarded once and also uploaded as a PDF from the Uber app → semantic duplicate (secondary key: partner + date + total + time).
13. A newsletter from Alza → `non_document` (R19 + LLM ≥ 0.9). An Alza invoice e-mail with `List-Unsubscribe` and a PDF attachment → the attachment is classified on its content only.
14. A DSN bounce / auto-reply → `non_document` via R20. We never reply.
15. A message to both the main and the `+banka` alias with the same Message-ID → the first stored wins; the second `prepare` returns `duplicate` (logged with both purposes).
16. A rotated address after the grace period → SMTP reject "Unknown recipient". The user saw the rotation warning.
17. Clock skew > 300 s between the Worker and the web app → 401; the Worker throws → MTA retry. A Sentry alert fires on > 5 in 10 min.
18. ClamAV down for hours → processing continues, downloads and packages stay blocked, maintainer alert after 1 h.
19. A government filing of another taxpayer (e.g. the accountant forwards the wrong client's DPHDP3) → `foreign_filing` question; never used as profile evidence.
20. The user reclassifies a decoy to `received_invoice` → full extraction runs. `class_source='user'`. The eval harness counts it as a classifier miss.
21. LLM split returns overlapping or gapped segments → rejected as invalid → single doc.
22. A password PDF with the password given → decrypted in memory for normalization. The decrypted copy is stored as a derived `decrypted.pdf` (scanned, `origin='original'`); the password is never persisted.
23. An org deleted while e-mail is in flight → `prepare` returns `unknown_recipient`; webhooks for unknown `orgRef` → 410.

## 9. Acceptance criteria and test plan

### 9.1 Acceptance criteria
1. **Golden decoys:** in `testdata/golden-v1`, all 6 decoys get a non-bookable class: Alza order confirmation → `order_confirmation`; both property-manager statements → `settlement_statement`; both Praha 3 tourist-fee reports → `government_filing`; the filed DPHDP3 (Aug 2026) → `government_filing`. None reaches `extracting` with `profile='full'`. 0 ledger rows reference them.
2. **Golden bookables:** all 12 get a bookable class: cleaning ×2, property-manager invoices ×2, Booking.com ×2, Cloudflare, Anthropic, Apple, Alza "Faktura" 117 Kč → `received_invoice`; IKEA, Decathlon → `received_receipt`. The Alza 117 Kč invoice is **not** a decoy, and `class_rule_ids` contains `F_NOT_TAX_PHRASE`.
3. **Golden duplicates:**
   - the IKEA PDF uploaded as NFC and NFD names yields exactly one `documents` row and two `ingest_items` rows (one `accepted`, one `exact_duplicate` pointing to it), with both `original_filename` values preserved byte-for-byte;
   - the second Decathlon PNG yields `exact_duplicate` (identical bytes) or `documents.status='duplicate'` with a `duplicate_of` link (re-encoded).
   - Both are counted by `pnpm eval` as detected.
4. **Nothing lost (golden):** the 20 input files produce 20 `ingest_items` rows. All are terminal. 18 non-duplicate documents exist. No row is `failed`, `ignored` or `expired`. Each of the 18 documents is reachable from the Inbox.
5. **Links (golden):**
   - statement (Aug) → manager invoice 12 960,84 and statement (Sept) → manager invoice 9 749,44 (`same_period_reconciles`);
   - Praha 3 report 3 500 → statement with tourist fee 3 500, and 4 150 → 4 150;
   - Booking July invoice → filed DPHDP3 Aug 2026 (`reported_in`) once its `vat_point_date` falls in August;
   - the Alza order confirmation (2 105 Kč) has **no** `fulfills` link to the 117 Kč Alza invoice, and has an open `expected_documents` row.
6. A body-only HTML receipt e-mail (fixture `uber.eml`) produces one PDF document with a text layer, classified `received_receipt` or `received_invoice`, and with no remote network requests during rendering (asserted by request interception).
7. A newsletter fixture with `List-Unsubscribe` and no amounts → one `non_document` document in Ostatní. An Alza invoice e-mail with `List-Unsubscribe` → `received_invoice`.
8. Signature images (`image001.png` 8 KiB; cid-inline logo) → `ignored` items, visible in the e-mail detail. Zero documents from them.
9. A forwarded-as-attachment `.eml` containing a PDF → one document whose `inbound_email_id` = the outer e-mail.
10. The same `.eml` delivered twice (same Message-ID) → one `inbound_emails` row. The same content forwarded twice (new Message-ID) → no extra documents.
11. A 3-invoice merged PDF (no page numbers) → 3 documents with correct `page_from/page_to`. A 2-page invoice with "Strana 1/2" → 1 document, and no LLM split call is made (asserted on `extraction_runs`). (Later) A QR-separated 3-doc scan → 3 documents, separator pages excluded, no LLM call.
12. `faktura.pdf` + `faktura.isdoc` in one e-mail → 1 document, the ISDOC item `companion`, `has_embedded_isdoc=true`, `class_source='rule'` (R01).
13. EPO XML (`Pisemnost/DPHDP3`) upload → `government_filing` with no LLM call. CAMT.053 → `bank_statement`.
14. HEIC iPhone photo → processed; `page-1.jpg` exists without GPS EXIF.
15. EICAR test file → `infected`, never downloadable, a notification is created. A ZIP containing EICAR → the member is `infected`, other members are processed.
16. ZIP bomb fixture (ratio > 100:1) → `unsupported`; worker memory stays < 512 MiB.
17. XXE XML fixture → parsed without resolving entities (no file or network access).
18. A webhook with a bad signature or a stale timestamp → 401 and no rows. A replayed valid webhook → no duplicate rows.
19. A 30 MiB e-mail → SMTP reject + an `email_rejected` notification. A 201st e-mail in one hour → processed at low priority + one `inbound_flood` notification. Mail beyond 5× soft → rejected.
20. `fuseClassification` is pure and deterministic: the same inputs give the same output (property test with 1 000 random hit sets).
21. Guard G1: any input with an R05/R06/R07 hit and an LLM answer of `received_invoice` ends in `needs_review`, never in `extracting`.
22. Every M01 job is idempotent: running any job twice with the same payload changes no rows the second time (integration test per job).
23. Semantic dedupe: the same invoice as a scanned JPEG then as an ISDOC.pdf → the ISDOC.pdf is primary and the JPEG is `duplicate` (when not finalized). "Není duplicitní" leaves both active without a unique-index error.
24. Upload UX: a row appears < 300 ms after the drop (Playwright), upload progress updates at least every 500 ms, and the status reaches "Hotovo" without a reload.
25. Latency: p50 from `complete` to `classifying` done < 4 s for single-page PDFs (staging), leaving the M02–M04 budget within 15 s overall (01 §7).
26. Phase 1 E2E (02): forward an e-mail with 3 attachments → 3 documents → answer 1 question → totals update.
27. **Manual entry without a photo:** saving {receipt, 80 Kč, cash, "Parkování"} creates a document with `entry_mode='manual'`, `source_file_id` null and `class_source='user'`. All its `document_fields` have `source='user'`. It has one line. It goes straight to `validating`, with no `extraction_runs` rows for `split`, `classify` or `extract`.
28. **Substitute document:** the same save with `substitute_reason='lost'` gives `tax_doc_status='not_tax_document'`.
29. **Manual entry with a damaged photo:** extraction runs (`fill_gaps`). A field the user typed before or after extraction keeps its `source='user'` value. Empty fields are prefilled from extraction. The document ends with `entry_mode='manual'` and a `source_file_id`.
30. **Duplicate on manual save:** saving a manual entry whose partner, number and total match an existing document shows "Tento doklad už máte". "Přesto uložit" saves it with `semantic_dedupe_exempt=true` and no unique-index error.
31. **(Phase 2) Mapping suggestion:** for a CSV in windows-1250 with `;` delimiters and headers `Datum;Dodavatel;IČO;Číslo faktury;Částka;DPH;Zaplaceno`, `suggestMapping` maps all 7 columns correctly with no AI call. A second file with the same headers reuses the saved `import_mappings` row.
32. **(Phase 2) Preview:** it shows exactly the first 10 parsed rows and the import/skip/duplicate counts. It writes no documents.
33. **(Phase 2) Import:** a 120-row XLSX produces one document per valid row with `entry_mode='imported'` and `import_row` set. Rows missing a date or amount are skipped with a reason. Re-running the job writes no extra rows. Uploading the same file again reports "už importovali".
34. **(Phase 2) Merge:** importing a row {Alza, 2026-0001, 117,00} and later uploading that invoice's PDF leaves one active document (the captured PDF primary when the imported one is not finalized; otherwise the file is attached to the imported document via a revision) and one `duplicate_of` link.
35. **(Phase 2) Undo:** "Vrátit import" soft-deletes the untouched, non-finalized imported documents and reports how many were kept.

### 9.2 Test plan
- **Unit (vitest):**
  - `normalizeFilename` (NFD/NFC, control chars, length);
  - `decodeZipEntryName` (UTF-8 flag, CP852);
  - `sniffFormat` (each format plus mismatched extensions);
  - `triageAttachments`, `decideBodyDocument`, `extractForwardedHeaders` (Gmail, Outlook CZ/EN, Apple Mail, Seznam);
  - `canonicalBodyHash` stable across tracking parameters;
  - `runClassRules` per rule with positive and negative fixtures (incl. "Vyúčtování elektřiny" utility invoice with DUZP → **not** R09; "Faktura… není daňový doklad" → R13 and not R07);
  - `fuseClassification` truth table for G1–G5;
  - `deterministicSegments`, `validateSegments`;
  - `reconcileDirection`;
  - `hamming64`.
- **Property (fast-check):**
  - `normalizeFilename(normalizeFilename(x).nfc).nfc === normalizeFilename(x).nfc`;
  - NFC/NFD variants of any name map to the same `nfc`;
  - dHash distance ≤ 4 under JPEG re-encode q ∈ [70, 95] and resize ±20 % on 30 receipt photos;
  - distance > 6 between 50 pairs of different receipts from the same shop (measured; adjust `phash_*` config if the corpus disagrees).
- **Integration (local Supabase + pg-boss + fake LLM + ClamAV container):**
  - every job happy path + retry + idempotency;
  - the webhook HMAC;
  - RLS on `ingest_items` and `expected_documents` added to the cross-tenant suite;
  - races (two arrivals with the same sha256 in parallel → one `source_files` row).
- **E2E (Playwright):** upload batch with progress; camera bundle (2 photos → 1 document); e-mail via the local fake inbound endpoint (`pnpm dev`); reclassify; confirm split; not-duplicate; rotate address.
- **Eval (`pnpm eval`, M12):** the golden set with live or recorded LLM. Reports a confusion matrix over `document_class`, decoys-booked count (must be 0), duplicates detected (must be 2/2), links found (AC 5) and LLM calls per document.
- **Fixtures** (`packages/testkit/fixtures/ingest/`, synthetic, no real data): `uber.eml`, `bolt.eml`, `apple-receipt.eml`, `newsletter-alza.eml`, `alza-invoice-with-unsubscribe.eml`, `signature-logo.eml`, `fwd-as-attachment.eml`, `fwd-inline-outlook-cz.eml`, `pdf-plus-isdoc.eml`, `download-link-only.eml`, `dsn-bounce.eml`, `tnef.eml`, `three-invoices.pdf`, `two-page-invoice.pdf`, `qr-separated.pdf`, `isdoc-embedded.pdf`, `invalid-isdoc-embedded.pdf`, `invoice.isdocx`, `dphdp3-pisemnost.xml`, `camt053.xml`, `xxe.xml`, `encrypted.pdf`, `active-content.pdf`, `iphone.heic`, `multipage.tiff`, `eicar.txt`, `eicar-in.zip`, `zipbomb.zip`, `cp852-names.zip`, `ikea-nfc.pdf`/`ikea-nfd.pdf` (same bytes), `receipt-reencoded.jpg`, `torn-receipt.jpg` (manual + photo), `evidence-2025-cp1250.csv`, `evidence-2025.xlsx` (merged header cells, Excel serial dates, an amount column with "Kč"), `evidence-mixed-direction.xlsx`.
- **Unit tests for import:** `suggestMapping` synonyms and value sniffing; `parseImportRow` amount and date formats; CSV encoding and delimiter detection; in-file duplicate rows.

## 10. Maintenance
| Source of change | Frequency | Containment | Effort/yr |
|---|---|---|---|
| Cue phrases (new form headings, new e-shop templates, municipal report wording) | a few per year | data file `cues.cs.ts` + rule unit tests + golden/eval; misclassifications surface through the user "Změnit typ" rate | 0.5 d |
| `body_receipt_senders`, `platform_issuers` lists | occasional | config data | 0.25 d |
| LLM model/prompt (`classify.v1`, `split.v1`) | 1–2×/yr | `LlmClient`, eval harness gates (06 §1) | 0.5 d |
| Cloudflare Email Workers runtime / `postal-mime` | rare | ≈150 lines, contract test with recorded `.eml` fixtures | 0.25 d |
| Chromium (body render), ClamAV image, HEIC decoder, pdfjs | monthly Renovate | pinned images; fixture render snapshot tests | 0.5 d |
| Import header synonyms, Excel/CSV quirks (Phase 2) | occasional | data file `import-synonyms.cs.ts` + fixtures | 0.25 d |
| ISDOC version (6.0.2 is current, `registries-and-formats.md §7.1`) | rare | namespace check + XSD vendored by M02 | 0 d unless a version ships |

**Monitors (06 §3 style, maintainer only):**
- share of docs in `needs_review` from classification > 10 % over 7 days;
- user reclassification rate > 3 % over 7 days;
- `non_document` share of attachments > 5 %;
- items not terminal after 24 h > 0;
- render failures > 2 % per day;
- `scan_status='error'` older than 1 h;
- inbound reject rate (size or limit) > 1 % per day;
- LLM classify calls per document > 0.8 (deterministic rules are degrading).

**Estimated total: ~2 days/year.** M01 holds no tax law.

## 11. Open questions
Consolidated in `22-open-questions.md`: D-08 (ClamAV), D-12 (XLSX library), TA-01 (received date of forwarded e-mails), T-07 (Cloudflare limits and auth verdicts), T-08 (HEIC), T-09 (golden cue wording), T-10 (ZIP encoding, iOS HEIC), T-11 (signed-upload size). Resolved on 2026-10-18 (22 §F): quarantine for spoofed mail, status `supporting`, `field_source='user'` for typed and imported values.
