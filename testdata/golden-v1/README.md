# golden-v1

Anonymized golden test set for Shoebox (Czech document organizer for OSVČ). 20 arrivals, 18 distinct documents.

**No real personal data. Public companies keep their real public identifiers.**

Contract: `labels.json` (schema in `docs/v3/modules/M12-platform-ops-security.md` §4.10). Money in labels is a string with a dot decimal. Extra keys beyond the M12 schema (`links`, `links_absent`, `statement`, `filing`, `embedded_isdoc`, `buyer_dic`, `card_last4`, `reference_amounts`, `changed_values`) are extensions for M01/M02/M07/M09 acceptance tests.

## How it was made

Synthetic test documents. Every file was built as a new PDF (or PNG) that mimics a typical document layout, including its quirks. A text layer exists where such documents usually have one; the Decathlon PNG has none. Embedded ISDOC uses the usual attachment filename patterns (`faktura_<number>.isdoc`). Identifiers of private persons and small firms are fictional and were checked as unregistered in ARES (2026-10-25). Logos of public companies were reproduced as images; the cleaning company logo is a fake. The PDF Creator metadata only mimics a typical generator; Title, Author and Subject are empty.

## Files (`docs/`)

| File | Represents | Class |
|---|---|---|
| `Faktura_2026091_Havranek M.pdf` | Cleaning company invoice, August, 11 600.00 CZK, non-VAT-payer, ISDOC, QR Platba+F | received_invoice |
| `Faktura_2026098_Havranek M.pdf` | Same supplier, September, 8 150.00 CZK, ISDOC, QR carries a DUZP the text does not | received_invoice |
| `Faktura_260807.pdf`, `Faktura_260907.pdf` | Property-manager invoices, 21 % VAT, DUZP differs from issue date, ISDOC, QR Platba | received_invoice |
| `26_08_Faktura_Provize Booking.pdf` | Booking.com commission for July (issued 3 Aug), 13 699.77 CZK, buyer DIČ not printed | received_invoice |
| `26_09_Faktura_Provize Booking.pdf` | Booking.com commission for August (issued 3 Sep), 11 549.94 CZK, buyer DIČ printed | received_invoice |
| `5b2e41c7-....pdf` | Cloudflare invoice, USD 10.46 (UUID file name) | received_invoice |
| `Invoice-4D2A91C7-3518204.pdf` | Anthropic Ireland, EUR 90.00, reverse charge | received_invoice |
| `UA30417938.pdf` | Apple Distribution International, 26 990 CZK, buyer without IČO/DIČ at another address | received_invoice |
| `Účtenka20261009004080520062.pdf` (two arrivals) | IKEA card receipt 1 198 CZK. One name is NFC, the other NFD (`u` + U+030C); identical bytes | received_receipt, 2nd is duplicate |
| `Receipt0757...207.png`, `Receipt0757...207 (1).png` | Decathlon card receipt 249 CZK, image only, likely personal; second download named " (1)", identical bytes | received_receipt, 2nd is duplicate |
| `4021738955.pdf` | Alza "Faktura" 117.00 CZK stating "Toto není daňový doklad" | received_invoice (not tax document) |
| `1049528146.pdf` | Alza order confirmation 2 105.00 CZK (decoy, no link to the invoice above) | order_confirmation |
| `26_08_S17_Vyuctovani.pdf`, `26_09_S17_Vyuctovani.pdf` | Property-manager statements (decoys) | settlement_statement |
| `S17_08_26_...poplatku_z_pobytu.pdf`, `S17_09_26_...` | Praha 3 monthly tourist-fee reports 4 150 / 3 500 CZK (decoys) | government_filing |
| `DPHDP3-7801011229-20260920-141836.pdf` | Own filed August 2026 DPHDP3, identified person, row 5 = 13 700 / 2 877 (decoy) | government_filing |

NFC/NFD: git and some file systems (macOS) normalize names and may collapse the two IKEA files into one. Check out on Linux, or compare by sha256 from `labels.json`.

## Links recorded in labels.json

- statement (Aug, Sept) to the manager invoice, `same_period_reconciles` (20 % column equals the invoice total);
- tourist-fee report to the statement tourist-fee column (4 150 and 3 500);
- Booking invoice for July to the filed DPHDP3, `reported_in`;
- Alza order 1049528146 and invoice 4021738955: no `fulfills` link, open expected-document row.

## Anonymization map (category level)

| Category | Treatment |
|---|---|
| Buyer (the test OSVČ) | One synthetic identity: name, IČO (mod-11 valid), rodné číslo (mod-11 valid) and the DIČ derived from it, e-mail on an example domain, address |
| Apartment and delivery addresses | Synthetic Prague addresses |
| Property manager (natural person) | Synthetic person, IČO, DIČ, CZ account (mod-11), IBAN (mod-97) |
| Cleaning company | Synthetic s.r.o. name, IČO, commercial-register entry, account, IBAN, e-mail, web |
| Order, customer, booking, invoice-number identifiers, card digits, terminal and authorization data | Replaced with same-length synthetic values |
| Data-box ID, phones, officer e-mail | Synthetic |
| Filed DPHDP3 | Synthetic taxpayer identifiers in the comb fields |
| Signatures, stamps | Not reproduced |
| SPAYD / QR Platba+F | Regenerated with the fake account. `CRC32` is added to every payload |

One fake identity is used per party in all documents, so cross-document links still work. Kept as real public identifiers: Alza, IKEA, Decathlon (Decasport), Booking.com B.V. (VAT ID and bank), Apple Distribution International (DIČ), Anthropic Ireland (VAT ID), Cloudflare (EIN, VAT-Code), Městská část Praha 3 (address, account, e-mail on its public domain). All amounts, dates, rates and tax math are unchanged: `changed_values` in labels.json is empty.

## Not reproduced

Hyperlinks and the "Pay online" annotations of the SaaS invoices. These do not affect the text layer or the labels.
