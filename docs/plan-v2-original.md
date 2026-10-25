# **OSVČ Zero-Click Accounting Plan V2**

This document serves as the master architectural blueprint and product specification for the "Digital Shoebox" SaaS platform, replacing all legacy iterations. It outlines a highly-optimized, serverless tax and accounting tool for Czech freelancers (OSVČ).

## **1\. Product Philosophy & Executive Summary**

Designed for small business owners with no accounting knowledge, the platform hides all bookkeeping complexity. It replaces traditional interfaces with automated AI data extraction, zero-click email ingestion, and push-button government XML exports. For the OSVČ, the experience is passive: they forward emails or snap photos, and the system automatically categorizes, validates via government registries, matches bank transactions, and prepares tax outputs.

## **2\. Tech Stack & Serverless Topology**

The backend leverages a purely serverless, event-driven architecture to scale to zero when idle, minimizing costs while retaining enterprise-grade processing capabilities.

| Layer | Technology | Justification   |
| :---- | :---- | :---- |
| **API Backend** | Python 3.12+ / FastAPI (Google Cloud Run) | Native async, Pydantic v2 validation, zero idle cost in serverless containers. |
| **Reconciliation Engine** | Rust 1.80+ (via PyO3) | Bypasses Python GIL for lightning-fast parsing of ABO/GBO fixed-width banking files. |
| **AI Intelligence** | Claude Haiku 5.5 & Sonnet 5.5 | Haiku for 97%+ of traffic (highly cost-effective), Sonnet strictly as an escalation fallback. |
| **Database & Auth** | Supabase (PostgreSQL 16\) | Multi-tenant Row-Level Security (RLS) and Supavisor connection pooling (port 6543). |
| **Object Storage** | Cloudflare R2 | Zero egress fees. Essential for PDF serving and ZIP exports. |
| **Inbound Email** | Cloudflare Email Routing | Zero-cost edge filtering using Cloudflare Workers to ingest documents directly to R2. |

## **3\. Multi-Channel Ingestion & Email Pipeline**

The platform supports drag-and-drop web uploads and zero-click automated email forwarding. To protect the AI from marketing spam, inbound emails pass through a strict sequence.

> * **Stage 1: Deterministic Filter (Edge):** Cloudflare Workers drop emails containing Precedence: bulk or List-Unsubscribe headers at zero cost. Attachments are saved directly to R2.  
> * **Stage 2: Haiku Text Classifier:** Emails lacking attachments (e.g., Uber, Bolt, Apple receipts) are sent to Claude Haiku 5.5 in text-only mode for extremely low cost. If classified as a receipt, the HTML body is preserved.  
> * **Image Pre-processing:** To cap token costs, all images are resized to a maximum dimension of 1,568 pixels on the longest edge and converted to 85% JPEG. Digital PDFs with text layers bypass rasterization completely.

## **4\. The Single-Pass AI Core (Claude Haiku 5.5)**

Instead of using multiple models or parsing layers, Claude Haiku 5.5 handles both data extraction and tax categorization simultaneously using tool-calling and strict JSON schemas.

> * **Anti-Hallucination:** The model is instructed to output null and flag is\_readable \= False if an IČO or amount is blurred.  
> * **VAT Balancing (Rozpis DPH):** Isolates the 21%, 12%, and 0% tax bases and their corresponding VAT amounts.  
> * **Categorization:** Evaluates the OSVČ’s business context to assign exact Czech tax groups (e.g., MATERIAL\_501, SERVICES\_518, REPRESENTATION\_513).

## **5\. Deterministic Validation & Memory Architecture**

AI outputs are never trusted blindly. Extracted data must pass four programmatic gates before hitting the database ledger:

> 1. **Mathematical Invariant:** Asserts that Base \+ VAT \== Total (allowing a ±0.50 CZK rounding tolerance).  
> 2. **Statutory Ceilings:** Flags cash receipts exceeding the 10,000 CZK legal limit, and enforces capitalization classifications for hardware assets over 80,000 CZK.  
> 3. **ARES API Registry Check:** Makes a live HTTP request to ares.gov.cz to verify the supplier IČO and fetch the canonical legal name.  
> 4. **Tenant Vendor Memory (SQL):** Checks the tenant\_vendor\_rules cache. If the user previously confirmed a vendor categorization twice, it auto-applies without querying the AI, resulting in zero latency and zero token cost for recurring bills.

*Escalation Rule:* If math balancing or legibility fails (roughly 2-3% of messy thermal receipts), the document automatically escalates to Claude Sonnet 5.5 for a secondary visual pass.

## **6\. Bank Reconciliation (Rust Core)**

Users drop standard Czech .gbo or ABO bank statements into the interface. Rather than relying on slow Python string manipulation, a natively compiled Rust pyo3 library parses the files in milliseconds.

> * Extracts counterparty accounts, variable symbols, and transaction dates at native machine speeds.  
> * Executes a SQL matching algorithm against unpaid invoices using the Variable Symbol and exact transaction amount.  
> * Automatically marks matched documents as PAID for cash-basis accounting compliance.

## **7\. Output Targets & Tax Compliance**

The platform supports two primary end-user operational modes:

### **Mode A: The Accountant Bridge**

For businesses working with an external accountant, the app exports structured data formats directly importable into professional accounting software:

> * **ISDOC 6.0.2:** The national standard XML for electronic invoicing.  
> * **Stormware Pohoda dataPack:** Generates XMLs natively mapping invoices to \<inv:invoice\> and receipts to \<vch:voucher\> agendas.

### **Mode B: The Zero-Click OSVČ Ledger**

For freelancers managing their own taxes, the app generates official Ministry of Finance EPO XMLs:

> * **DPHDP3 & DPHKH1:** Monthly/Quarterly VAT Returns and Control Reports.  
> * **DPFDP5:** Annual Income Tax Return, fully supporting both "Flat-Rate" (Paušální výdaje \- 60%) and "Actual Expenses" (Skutečné výdaje) deduction modes.

## **8\. Operational Cost Economics (Unit Model)**

Because of the serverless footprint and aggressive prompt caching with Haiku 5.5, the operating costs at scale are exceptionally low.

| Component | Monthly Usage Specification | Estimated Cost   |
| :---- | :---- | :---- |
| **Claude Haiku 5.5** | 100,000 documents (including prompt caching discounts) | \$38.50 |
| **Claude Sonnet 5.5** | \~2,500 documents (2.5% escalation rate) | \$21.00 |
| **Google Cloud Run** | Compute and webhook requests beyond the generous free tier | \~\$13.80 |
| **Supabase Pro Tier** | 8GB SSD \+ Supavisor Connection Pooler (crucial for serverless) | \$25.00 |
| **Cloudflare R2 & Edge** | 120GB Storage, Email Worker executions | \~\$1.65 |
| **Total Operating Cost** | **Processing 100,000 documents per month** | **\~\$100.00** |

At roughly \$0.001 per document, processing 100,000 files easily supports approximately 4,000 active users. At a standard retail price of 299 CZK/month, this yields over \$50,000 in monthly recurring revenue on just \$100 of infrastructure spend, representing a 99.8% gross infrastructure margin.