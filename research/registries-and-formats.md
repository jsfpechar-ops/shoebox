# Registries and document/export formats: integration specs (CZ, OSVČ/SME)

Research date: 2026-10-17. Sources: public documentation only (WebSearch/WebFetch). No logins, no form submissions, no live API calls with data.

**Legend**
- **[O]** Observed in a source fetched on 2026-10-17 (URL given).
- **[I]** Inference, or prior knowledge not re-verified today. Verify before you code against it.
- **[?]** Unknown or not verifiable from public docs.

**Research limits**
- The web-search budget ran out near the end of the session. VIES path details, Money S3 element names and parts of the ISDOC root element order therefore rest partly on prior knowledge and are marked [I].
- Some official pages render only with JavaScript or returned a binary file: the MFČR RWS documentation page, the VIES swagger YAML and the Fio API HTML page. These are noted where they apply.

---

## 0. Summary table

| # | Service / format | Protocol | Auth | Key limit | Status 2026-10 |
|---|---|---|---|---|---|
| 1 | ARES REST v3 (API 1.4) | REST/JSON, OpenAPI 3 | none | >500 req/min may lead to a block | [O] live |
| 2 | Registr DPH / nespolehlivý plátce | SOAP (document/literal) | none | 100 DIČ per status call | [O] WSDL now points to `mojedane.gov.cz/dpr/...`. No official REST found [?] |
| 3 | VIES | REST/JSON + SOAP | none | concurrency throttling (MS_MAX_CONCURRENT_REQ…) | [O] live |
| 4 | ČNB FX rates | TXT + REST/JSON (`api.cnb.cz`) | none | – | [O] live |
| 5 | QR Platba (SPAYD) / QR Faktura (SID) | string format | – | ČBA standard v1.2 (effective 2022-01-01) | [O] |
| 6 | Bank account / bank codes | decree 169/2011 + ČNB CSV | – | code list no. 255, valid from 2026-10-01 | [O] |
| 7 | ISDOC 6.0.2 | XML + ISDOC.PDF (PDF/A-3) + ISDOCX | – | – | [O] still the current version. Site moved to `archiv.mv.gov.cz` and `isdoc.cz` |
| 8 | POHODA XML | XML dataPack v2.0 | – | – | [O] XSDs on stormware.cz |
| 9 | Money S3 XML | XML (MoneyData) | – | – | [O] docs and XSD zip dated 2024-10 |
| 10 | ABO/GPC, CAMT.053, Fio API, bank APIs | fixed-width / XML / REST | token or cert | Fio: 1 request per 30 s per token | [O] Fio API doc v1.9 dated 2025-10-16 |

---

## 1. ARES – Administrativní registr ekonomických subjektů (REST)

### 1.1 Base, spec, versions
- Host: `https://ares.gov.cz`. Server base path in the OpenAPI spec: `/ekonomicke-subjekty-v-be/rest`. [O] https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/v3/api-docs
- OpenAPI title: "ARES: REST API - veřejné (verze 1.4.0)", `info.version` = 1.4. [O] same URL
- A Swagger UI is usually at `https://ares.gov.cz/swagger-ui/`. [I]
- Official docs on the MF page: "ARES – Technická dokumentace – Katalog veřejných služeb" (CZ PDF v08; EN PDF v03, 2024-02-16) and a "AresRestApi-verejne" ZIP. The page lists the files as updated 2026-08-31. Contacts: aresmfcr@mfcr.cz (technical), ares@mfcr.cz. [O] https://mf.gov.cz/cs/ministerstvo/informacni-systemy/ares

### 1.2 Endpoints (26 paths) [O] api-docs
| Method | Path | Purpose |
|---|---|---|
| GET | `/ekonomicke-subjekty/{ico}` | Core lookup by IČO (exactly 8 digits) |
| POST | `/ekonomicke-subjekty/vyhledat` | Search with a complex filter |
| GET/POST | `/ekonomicke-subjekty-vr/{ico}`, `/ekonomicke-subjekty-vr/vyhledat` | Veřejný rejstřík (obchodní rejstřík: statutory bodies, shareholders) |
| GET/POST | `/ekonomicke-subjekty-res/...` | RES (statistical register: NACE, size category) |
| GET/POST | `/ekonomicke-subjekty-rzp/...` | Živnostenský rejstřík (trade licences; useful for OSVČ) |
| GET/POST | `-nrpzs`, `-rpsh`, `-rcns`, `-szr`, `-rs`, `-ros`, `-ceu` | Healthcare providers, political parties, churches, agricultural register, schools, ROS (basic register), insolvent debtors |
| POST | `/ciselniky-nazevniky/vyhledat` | Code lists (e.g. pravní forma, finanční úřad) |
| POST | `/standardizovane-adresy/vyhledat` | RÚIAN address standardisation |
| POST | `/ekonomicke-subjekty-notifikace/vyhledat` | Change notifications |
| GET | `/ekonomicke-subjekty-notifikace/datovy-zdroj/{datovyZdroj}/cislo-davky/{cisloDavky}` | Notification batch download |

Example: `GET https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/27074358` [I], assembled from the observed host and base path.

### 1.3 Response: `EkonomickySubjekt` [O] api-docs
- Base fields (`EkonomickySubjektZaklad`): `ico`, `obchodniJmeno`, `sidlo` (Adresa), `pravniForma`, `pravniFormaRos`, `financniUrad`, `datumVzniku`, `datumZaniku`, `datumAktualizace`, `dic`.
- Additional fields: `icoId`, `adresaDorucovaci`, `czNace2008`, `czNace`, `seznamRegistraci`, `primarniZdroj`, `dalsiUdaje`, `subRegistrSzr`, `dicSkDph`.
- `Adresa` (29 fields): `kodStatu`, `nazevStatu`, `kodKraje`, `nazevKraje`, `kodOkresu`, `nazevOkresu`, `kodObce`, `nazevObce`, `kodSpravnihoObvodu`, `nazevSpravnihoObvodu`, `kodMestskehoObvodu`, `nazevMestskehoObvodu`, `kodMestskeCastiObvodu`, `nazevMestskeCastiObvodu`, `kodUlice`, `nazevUlice`, `cisloDomovni`, `doplnekAdresy`, `kodCastiObce`, `nazevCastiObce`, `cisloOrientacni`, `cisloOrientacniPismeno`, `kodAdresnihoMista`, `psc`, `textovaAdresa`, `cisloDoAdresy`, `standardizaceAdresy`, `pscTxt`, `typCisloDomovni`.
- `AdresaDorucovaci`: `radekAdresy1..3` (each max 255 characters).
- `SeznamRegistraci`: status per source (`stavZdrojeRos`, `stavZdrojeVr`, `stavZdrojeRes`, `stavZdrojeRzp`, `stavZdrojeNrpzs`, `stavZdrojeRpsh`, `stavZdrojeRcns`, `stavZdrojeSzr`, `stavZdrojeDph`, `stavZdrojeSkDph`, `stavZdrojeSd`, `stavZdrojeIr`, `stavZdrojeCeu`, `stavZdrojeRs`, `stavZdrojeRed`, `stavZdrojeMonitor`). Values come from the `StavZdroje` code list (e.g. `AKTIVNI`, `NEEXISTUJICI`, `HISTORICKY` [I]).
  - `stavZdrojeDph` tells you whether the subject is in the VAT register.
  - `stavZdrojeIr` tells you whether it is in the insolvency register.
  - Use both as cheap pre-checks. [I]
- `dic` holds the full DIČ with the `CZ` prefix (e.g. `CZ27074358`). [I]
- `pravniForma` is a code such as `101` (FO podnikající podle živnostenského zákona) or `112` (s.r.o.). Resolve codes with `/ciselniky-nazevniky/vyhledat` (code list `PravniForma`, zdroj `res`). [I]

### 1.4 Search request
- Paging and sorting (`StrankovaniARazeni`): `start` (int ≥ 0), `pocet` (int ≥ 0, no max in schema), `razeni` (array of strings, e.g. `["-obchodniJmeno"]`). [O]
- `EkonomickeSubjektyKomplexFiltr` adds `pravniFormaRos` and `czNace`. [O] It inherits `EkonomickeSubjektyZakladFiltr`. That schema was not visible in the fetch, but by prior knowledge it contains `ico` (array), `obchodniJmeno`, `sidlo` (address filter: `kodObce`, `kodUlice`, `textovaAdresa`, …), `pravniForma` (array) and `financniUrad` (array). [I]
- The result window is commonly capped at `start + pocet ≤ 1000`. [I] This is not in the schema.
- Response `EkonomickeSubjektySeznam`: `pocetCelkem`, `ekonomickeSubjekty[]`. [O]

### 1.5 Errors [O]
- HTTP status codes: 200, 400 (input error), 401, 403, 404 (subject not found), 500.
- The error body (`Chyba`) has `kod` (KodChybyEnum), `popis` and `subKod`.

### 1.6 Terms and limits [O] https://mf.gov.cz/cs/ministerstvo/informacni-systemy/ares
- Anyone may use the API if they follow the operating conditions. No API key is needed.
- MF may restrict or block users who:
  - send more than **500 requests per minute**,
  - repeatedly send incorrect or identical requests,
  - send many concurrent requests,
  - spread requests over many IPs to evade limits,
  - scan the database with random data,
  - attempt security breaches.
- MF also keeps per-user limits on total queries but does not publish the values. Unblocking requires written assurances.
- The data is informational only and not admissible as evidence in court.
- **Implementation note [I]:** cache responses per IČO (e.g. 24 h), use a single egress IP, and use the notification endpoints for change tracking instead of polling.

---

## 2. Registr plátců DPH / nespolehlivý plátce (MFČR ADIS web service)

### 2.1 Endpoint and WSDL
- WSDL (legacy host, still serving): `https://adisrws.mfcr.cz/adistc/axis2/services/rozhraniCRPDPH.rozhraniCRPDPHSOAP?wsdl` [O]
- **The `soap:address` inside that WSDL is `https://mojedane.gov.cz/dpr/axis2/services/rozhraniCRPDPH.rozhraniCRPDPHSOAP`.** [O] So the service has migrated to the MOJE daně host. Configure the endpoint so it can be changed, and test both hosts. [I]
- Namespace: `http://adis.mfcr.cz/rozhraniCRPDPH/`. Binding: SOAP document/literal. [O]
- Official info page: https://financnisprava.gov.cz/cs/dane/dane-elektronicky/danovy-portal/registr-dph [O]
  - The service is "určena výhradně pro vzdálený přístup ze SW třetích stran".
  - Launched 2013-04-01. Unreliable-payer list added 2013-08-01. Identified-person check added 2023-06-20.
  - Technical doc page: https://adisspr.mfcr.cz/pmd/dokumentace/webove-sluzby-spolehlivost-platcu. It renders only with JavaScript; the content was not readable [?].
- Web UI: https://adisspr.mfcr.cz/dpr/adis/idpr_pub/izdr/izdr.faces (also reachable through the MOJE daně portal). [O]

### 2.2 Operations [O] WSDL
| Operation | Request | Returns |
|---|---|---|
| `getStatusNespolehlivyPlatce` | `StatusNespolehlivyPlatceRequest` with `dic` (1..n) | `status` + `statusPlatceDPH[]` (InformaceOPlatciType) |
| `getStatusNespolehlivyPlatceRozsireny` | same | adds name and address (InformaceOPlatciRozsireneType) |
| `getStatusNespolehlivySubjektRozsirenyV2` | same | `statusSubjektu[]` with `typSubjektu` (also covers identified persons and VAT groups) |
| `getStatusNespolehlivySubjektRozsireny` | – | deprecated, replaced by V2 |
| `getSeznamNespolehlivyPlatce` | empty request | full list of unreliable payers |

### 2.3 Response fields [O] WSDL
- `status`: `odpovedGenerovana` (date), `statusCode` (int), `statusText`.
  - `0` OK
  - `1` OK, but too many DIČ: only the **first 100** are returned (applies to getStatusNespolehlivyPlatce)
  - `2` technological outage **0:00–0:10**
  - `3` service unavailable
- Per subject:
  - `dic`: 1–10 digits, **without the `CZ` prefix**.
  - `nespolehlivyPlatce`: `ANO` | `NE` | `NENALEZEN`.
  - `datumZverejneniNespolehlivosti`: present only when `ANO`.
  - `cisloFu`: 2–3 digits.
- V2 adds `typSubjektu`: `PLATCE_DPH` | `IDENTIFIKOVANA_OSOBA` | `SKUPINA_DPH` | `NENALEZEN` | `NESPOLEHLIVA_OSOBA`.
- `zverejneneUcty/ucet[]` holds the bank accounts published under § 96 ZDPH. Each `ucet` has:
  - `datumZverejneni` (required), `datumZverejneniUkonceni` (optional),
  - either `standardniUcet` (`predcisli` 1–6 digits optional, `cislo` 1–10 digits, `kodBanky` 4 digits) or `nestandardniUcet` (`cislo` as free string: IBAN or foreign account).
  - The response has **no separate IBAN field.** [O] Build the IBAN yourself (see §6).
- `bezVypisuUctu="ANO"` suppresses the account lists in the full unreliable-payer list. [O]
- Third-party wrappers report the full list at about 50–100 MB, meant for daily mirroring. [O] https://www.getdrio.com/mcp/dev-cz-agents-adis/md (third party, not official)

### 2.4 REST/JSON alternative in 2026?
- No official REST/JSON interface was found in public MF/FS documentation. [?]
- ARES does expose `stavZdrojeDph` (VAT-registered yes/no) but not the unreliability status or the published accounts. [O]/[I]
- Third-party MCP and REST wrappers exist (e.g. cz-agents.dev), but they are unofficial. [O]
- **Recommendation [I]:**
  - Call `getStatusNespolehlivySubjektRozsirenyV2` at invoice booking time and again on the payment date. § 109 ZDPH liability turns on the payment date: paying to an unpublished account above the limit, or paying an unreliable payer.
  - Batch up to 100 DIČ per call.
  - Handle the 00:00–00:10 outage with a retry.

---

## 3. VIES (EU VAT number validation)

- REST base: `https://ec.europa.eu/taxation_customs/vies/rest-api` [O] https://github.com/wtx-labs/vies-api-client-java, https://packages.nuget.org/packages/ViesApi
- Official OpenAPI: `https://ec.europa.eu/assets/taxud/vow-information/swagger_publicVAT.yaml` [O] (link). The fetch returned binary content, so it was not parsed [?].
- Technical-information page: https://ec.europa.eu/taxation_customs/vies/#/technical-information (JavaScript SPA, not readable) [?]
- SOAP WSDL (legacy): `https://ec.europa.eu/taxation_customs/vies/checkVatService.wsdl` [O] https://packagist.org/packages/znojil/vies

### 3.1 Endpoints
| Method | Path | Notes |
|---|---|---|
| POST | `/check-vat-number` | Production check; JSON body [O] URL https://github.com/rocketfellows/vies-vat-validation-php-sdk-rest |
| POST | `/check-vat-test-service` | Sandbox with canned responses [O] URL |
| GET | `/check-status` | Availability per member state (`vow.available`, `countries[].countryCode/availability`) [I] path, [O] fields per znojil/vies |
| GET | `/ms/{countryCode}/vat/{vatNumber}` | Simple GET variant. Its response uses `isValid` and `userError` (e.g. `VALID`, `INVALID`, `MS_UNAVAILABLE`) [I] |

### 3.2 Request (POST check-vat-number)
- `countryCode` (use `EL` for Greece [I]) and `vatNumber` (without the country prefix). [O]
- Optional:
  - `requesterMemberStateCode` and `requesterNumber`: your own VAT ID. They yield a `requestIdentifier` that serves as proof of the check. [O]/[I]
  - `traderName`, `traderStreet`, `traderPostalCode`, `traderCity`, `traderCompanyType`. [O]

### 3.3 Response
- `countryCode`, `vatNumber`, `requestDate` (ISO 8601), `valid` (bool), `requestIdentifier`, `name`, `address`. [O]
- Approximate-match fields `traderName…` / `traderNameMatch…` have values `VALID` | `INVALID` | `NOT_PROCESSED`. [O]/[I]
- `name` and `address` may be null or `---` for member states that do not disclose them. [O]

### 3.4 Errors and limits [O] https://packagist.org/packages/znojil/vies
- Most errors come back as **HTTP 200 with `errors[].code`**.
- Codes: `INVALID_INPUT`, `INVALID_REQUESTER_INFO`, `SERVICE_UNAVAILABLE`, `MS_UNAVAILABLE`, `TIMEOUT`, `VAT_BLOCKED`, `IP_BLOCKED`, `GLOBAL_MAX_CONCURRENT_REQ`, `GLOBAL_MAX_CONCURRENT_REQ_TIME`, `MS_MAX_CONCURRENT_REQ`, `MS_MAX_CONCURRENT_REQ_TIME`. A malformed request gives `VOW-ERR-1` with HTTP 500.
- There is no published numeric rate limit, but concurrency is throttled. Validate sequentially, cache results, and back off.
- Test-service input codes: 100 valid, 200 invalid, 201 INVALID_INPUT, 202, 300, 301, 302, 400, 401, 500, 501, 600, 601. [O] rocketfellows README

---

## 4. ČNB exchange rates

### 4.1 Daily fixing (TXT) [O]
- URL: `https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt?date=DD.MM.YYYY`
  - Source: https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/
- Format, as fetched 2026-10-17:
```
16.10.2026 #200
země|měna|množství|kód|kurz
Austrálie|dolar|1|AUD|15,045
Brazílie|real|1|BRL|4,258
Čína|žen-min-pi|1|CNY|3,234
```
- Line 1 is the date and the sequence number of the fixing in the year. The separator is `|`. The decimal mark is a **comma**.
- `množství` is the unit count (e.g. 100 for JPY or HUF [I]). The rate per 1 unit is `kurz / množství`.
- Published each business day **around 14:30**. A rate announced on a business day also applies to the following Saturday, Sunday and holidays. [O]
- "Kurzy ostatních měn" are published separately (monthly [I]): https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-ostatnich-men/kurzy-ostatnich-men/ [O link]

### 4.2 REST API `api.cnb.cz` [O] https://api.cnb.cz/cnbapi/api-docs
- `GET /cnbapi/exrates/daily?date=yyyy-MM-dd&lang=CZ|EN` returns `rates[]` with `validFor`, `order`, `country`, `currency`, `amount`, `currencyCode`, `rate`.
- `GET /cnbapi/exrates/daily-currency-month?currency=EUR&yearMonth=yyyy-MM`
- `GET /cnbapi/exrates/daily-year?year=YYYY`
- Other currencies:
  - `GET /cnbapi/fxrates/daily-month?yearMonth=…`
  - `/cnbapi/fxrates/daily-year`
  - `/cnbapi/fxrates/daily-range-currency?currency=…&yearMonthFrom=…&yearMonthTo=…`
- No auth required. No rate limit published. [?]

### 4.3 Which rate for VAT (§ 4 ZDPH)
- § 4 odst. 5 ZDPH: use the "kurz devizového trhu vyhlášený ČNB a platný pro plátce ke dni vzniku povinnosti přiznat daň". [O] https://portal.pohoda.cz/dane-ucetnictvi-mzdy/dph/kurz-pro-prepocet-cizi-meny-v-dph/ (2018 article). The 2004 FS/epravo texts cite the same rule as odst. 4, from before the renumbering. [O]
- An accounting entity (účetní jednotka) may use its **pevný kurz** (fixed rate under the accounting act, set for at most one calendar year). A non-accounting payer, i.e. a typical OSVČ on daňová evidence, may use **only the ČNB rate** valid on that day. [O] https://financnisprava.gov.cz/cs/dane/dane/dan-z-pridane-hodnoty/informace-stanoviska-a-sdeleni/zaklad-dane/informace-k-prepoctu-cizi-meny-na-ceskou-menu
- The day the tax obligation arises follows §§ 21–25 and § 66 (DUZP, or receipt of payment if earlier). [O] same page
- Same pages, [O] Pohoda 2018:
  - Corrections (§ 42) use the rate of the original supply.
  - Imports use the customs rate.
  - EU acquisitions use the date of the tax document, or the 15th day of the following month if the document comes later.
- **Time-of-day trap [O] Pohoda:** the rate "valid on day D" before 14:30 is still the previous business day's fixing. Supplier and customer can therefore legitimately use different rates.
  - Implementation: store `validFor` and choose the rate whose `validFor` ≤ D and is the latest. [I]
  - Before 14:30, the ČNB rate valid for today is the previous fixing. [I] Confirm with your tax advisor.
- OSS/IOSS returns use **ECB** rates (zvláštní režimy). [I] Not re-verified.
- I could not fetch the full consolidated 2026 text of § 4 (zakonyprolidi.cz returned an error). [?] Verify the current wording before relying on it.

---

## 5. QR Platba (SPAYD) and QR Faktura (SID)

### 5.1 SPAYD / QR Platba
- Standard: ČBA "Formát pro sdílení platebních údajů v rámci tuzemského platebního styku v CZK prostřednictvím QR kódů", **v1.2**, issued 2021-06-01, effective **2022-01-01**. [O] https://qr-platba.cz/wp-content/uploads/1645-standard-qr-v1-2-cerven-2021.pdf
  - History: v1.0 (2012-11), v1.1 (2015-05: standing orders, direct debit, "Zpráva pro mne"), v1.2 (instant payments).
  - No newer version was found. [?]
- Spec page: https://qr-platba.cz/pro-vyvojare/specifikace-formatu/ [O]
- Syntax [O]:
  - Header `SPD*1.0*`. Use `SCD*` for direct-debit consent.
  - Attributes are `KEY:VALUE*`. Keys are `[A-Z-]`. Values must not contain a raw `*` (encode it as `%2A`); other special characters are URL-encoded.
  - Over-length values are truncated by readers.
- MIME type `application/x-shortpaymentdescriptor`, file extension `.spayd`. [O]

| Key | Req | Max | Format / meaning [O] |
|---|---|---|---|
| ACC | yes | 46 | `IBAN` or `IBAN+BIC` |
| ALT-ACC | no | 93 | up to 2 alternative accounts, comma-separated |
| AM | no | 10 | decimal, dot separator, max 2 decimal places |
| CC | no | 3 | ISO 4217 (domestically CZK only) |
| RF | no | 16 | numeric payee reference |
| RN | no | 35 | payee name |
| DT | no | 8 | due date `YYYYMMDD` |
| PT | no | 3 | payment type; `IP` = instant payment |
| MSG | no | 60 | message for the payee |
| CRC32 | no | 8 | `[A-F0-9]` |
| NT / NTA | no | 1 / 320 | notification channel `P`/`E` and address |
| DL, FRQ, DH | no | – | standing-order and direct-debit fields (end date, frequency `1D/1M/3M/6M/1Y`, after-death flag) |
| X-VS / X-SS / X-KS | no | 10 each | variable, specific and constant symbol (digits) |
| X-PER | no | 2 | retry days, 0–30 |
| X-ID | no | 20 | payer-side internal ID |
| X-URL | no | 140 | URL for the payer's own use |
| X-SELF | no | – | message for the payer (zpráva pro mne) |

- **CRC32:** take the header plus all attributes except CRC32, sorted by key then by value, compute CRC32 and write it as uppercase hex. [O]
- All Czech banks must support ACC, ALT-ACC, AM, CC, DT, MSG, X-VS, X-SS and X-KS for domestic payments. [O]
- QR code [O]:
  - Error-correction level **M** for print.
  - Use alphanumeric mode where possible (`0-9 A-Z space $%*+-./:`).
  - Minimum size: about 23 mm for a minimal code, about 58 mm for a full one.
  - Label "QR Platba".
- Example: `SPD*1.0*ACC:CZ6508000000192000145399+GIBACZPX*AM:480.50*CC:CZK*X-VS:1234567890*MSG:Faktura 2026001`

### 5.2 QR Faktura (SID) [O] https://www.kdpcr.cz/informace/qr-faktura/popis-formatu
- Owner: Komora daňových poradců ČR (2016). The old domain qr-faktura.cz redirects to kdpcr.cz.
- Spec PDF: https://www.kdpcr.cz/informace/qr-faktura?sp=down-file&did=20206
- Header `SID*1.0*`, same syntax as SPAYD.

| Key | Req | Max | Meaning |
|---|---|---|---|
| ID | yes | 40 | document number |
| DD | yes | 8 | issue date |
| AM | yes | 18 | total amount due |
| TP | no | 1 | 0 normal, 1 RPDP (reverse charge), 2 mixed |
| TD | no | 1 | 0 non-tax, 1 corrective, 2 payment receipt, 3 installment schedule, 4 payment schedule, 5 summary, 9 other tax document (default) |
| SA | no | 1 | settles advances (1/0) |
| MSG | no | 40 | subject of the invoice |
| ON | no | 20 | order number |
| VS | no | 10 | variable symbol |
| VII / INI | no | 14 / 8 | issuer DIČ / IČO |
| VIR / INR | no | 14 / 8 | recipient DIČ / IČO |
| DUZP | no | 8 | date of taxable supply |
| DPPD | no | 8 | date the tax liability arises |
| DT | no | 8 | due date |
| TB0/T0, TB1/T1, TB2/T2 | no | 18 | base and VAT in CZK at the standard, 1st reduced and 2nd reduced rate (sign shows direction) |
| NTB | no | 18 | exempt / out of scope / non-payer amount |
| CC | no | 3 | currency (default CZK) |
| FX / FXA | no | 18 / 5 | exchange rate / unit count |
| ACC | no | 46 | issuer IBAN(+BIC) |
| CRC32 | no | 8 | checksum |
| X-SW / X-URL | no | 30 / 70 | issuing software / URL for structured invoice data |

- Since 2024 the Czech VAT rates are 21 % (standard) and 12 % (single reduced). TB2/T2 are therefore normally unused. [I]
- **QR Platba+F** [O] https://www.kdpcr.cz/informace/qr-faktura/integrace-s-qr-platbou
  1. Move ACC, AM, CC and DT to the SPD level. VS becomes X-VS.
  2. URL-encode the remaining SID string (`*` becomes `%2A`).
  3. Put the result in the `X-INV` key.
  - Example: `SPD*1.0*AM:9535.00*X-VS:1234567890*DT:20161217*CC:CZK*ACC:CZ31...*X-INV:SID%2A1.0%2AID:1963/160/2015%2ADD:20161201%2A...*`
- **Parsing implication [I]:** an OCR/QR reader in the app should decode SPD and SID, and an `X-INV` key inside SPD. This gives a deterministic extraction of DIČ, DUZP and VAT breakdown without an LLM.

---

## 6. Czech bank account numbers, bank codes, IBAN

### 6.1 Structure (vyhláška ČNB č. 169/2011 Sb.) [O] https://cnb.cz/export/sites/cnb/cs/legislativa/.galleries/vyhlasky/vyhlaska_169_2011.pdf
- Format: `[předčíslí-]základní část/kód banky`.
  - Předčíslí: at most 6 digits, leading zeros insignificant, may be omitted.
  - Základní část: 2–10 digits, at least two of them non-zero.
  - Account identifier: 16 digits in total.
  - Kód banky (kód platebního styku): 4 digits.
- **Mod-11 check** (each part separately), per the annex [O] https://CNB.cz/export/sites/cnb/en/legislation/.galleries/decrees/decree_169_2011.pdf
  - Weights from the right (position 1 to 10): **1, 2, 4, 8, 5, 10, 9, 7, 3, 6**.
  - From the left for a 10-digit part: **6, 3, 7, 9, 10, 5, 8, 4, 2, 1**.
  - Valid when `S mod 11 == 0`.
  - For the 6-digit předčíslí, use the last 6 weights from the left: 10, 5, 8, 4, 2, 1. [I] Derived from the right-aligned rule.

```ts
const W = [6,3,7,9,10,5,8,4,2,1];
const ok = (s: string) => { const d = s.padStart(10,'0'); return [...d].reduce((a,c,i)=>a+ +c*W[i],0) % 11 === 0; };
```

### 6.2 IBAN (CZ)
- 24 characters: `CZ` + 2 check digits + 4-digit bank code + 16-digit account identifier. [O] decree § 4
- In practice the 16 digits are předčíslí zero-padded to 6 followed by the základní část zero-padded to 10: `CZkk BBBB PPPPPP CCCCCCCCCC`. [I]
- Check digits per ISO 13616 / ISO 7064 mod 97-10. [I]
  1. Take `BBBB PPPPPP CCCCCCCCCC` + `1235` (C=12, Z=35) + `00`.
  2. Compute `kk = 98 − (n mod 97)`.
  3. Validate by moving the first 4 characters to the end; the result mod 97 must equal 1.
- ČNB also links an IBAN explainer and calculator from https://www.cnb.cz/cs/platebni-styk/ucty-kody-bank/ [O]

### 6.3 Bank code list (číselník kódů platebního styku) [O]
- CSV (UTF-8, `;`): https://www.cnb.cz/cs/platebni-styk/.galleries/ucty_kody_bank/download/kody_bank_CR.csv
- PDF: https://www.cnb.cz/export/sites/cnb/cs/platebni-styk/.galleries/ucty_kody_bank/download/kody_bank_CR.pdf (code list **no. 255, valid from 2026-10-01**)
- CSV header: `Kód platebního styku;Poskytovatel platebních služeb;BIC kód (SWIFT);Systém CERTIS`
- 47 rows as of 2026-10-17. Examples: `0100;Komerční banka, a.s.;KOMBCZPP;A`, `0300` ČSOB CEKOCZPP, `0600` MONETA AGBACZPP, `0800` ČS GIBACZPX, `2010` Fio, `2250` Creditas, `2700` UniCredit, `3030` Air Bank, `5500` Raiffeisenbank, `6210` mBank, `6363` Partners Banka, `8220`, `8250`, `8620` Comgate, `8660` PAYMONT UAB.
- The list still includes `6800` Sberbank CZ "v likvidaci".
- **Recommendation [I]:** refresh the list monthly (ČNB updates it at irregular intervals) and keep a BIC lookup for IBAN+BIC generation.

---

## 7. ISDOC 6.0.2

### 7.1 Where it lives (moved!) [O]
- The MV ČR pages now redirect to **`archiv.mv.gov.cz/isdoc/...`**, which carries an "archived, may be out of date" banner. https://archiv.mv.gov.cz/isdoc/clanek/aktualni-verze.aspx
- Canonical files are now under **`https://isdoc.cz/6.0.2/`**. https://isdoc.github.io/ presents the same content. Contact: isdoc@mvcr.cz.
- **Current version: 6.0.2.** The archive page dates it 23.3.2022; isdoc.github.io says 25.4.2022. No 6.0.3 or newer is mentioned. [O]

| File | URL [O] |
|---|---|
| Spec PDF / HTML | https://isdoc.cz/6.0.2/doc/isdoc.pdf, https://isdoc.cz/6.0.2/doc/isdoc.html |
| Invoice XSD | https://isdoc.cz/6.0.2/xsd/isdoc-invoice-6.0.2.xsd (+ `-dsig-` variant) |
| CommonDocument XSD | https://isdoc.cz/6.0.2/xsd/isdoc-commondocument-6.0.2.xsd |
| ISDOCX manifest XSD | https://isdoc.cz/6.0.2/xsd/isdoc-manifest-6.0.2.xsd |
| Schematron | https://isdoc.cz/6.0.2/sch/isdoc-6.0.2.sch |
| Schema docs | https://isdoc.cz/6.0.2/doc-cs/isdoc-invoice-6.0.2.html, …/doc-en/… |
| Full package ZIP (4.7 MB) | https://archiv.mv.gov.cz/isdoc/soubor/isdoc-schema-6-0-2-20220323-zip.aspx |

- Namespace: `http://isdoc.cz/namespace/2013`. Root `<Invoice xmlns="http://isdoc.cz/namespace/2013" version="6.0.2">`. [O] namespace (econnect, isdoc.html). [I] `version` value.

### 7.2 DocumentType (xs:integer) [O] XSD
1 = faktura – daňový doklad; 2 = opravný DD – dobropis; 3 = opravný DD – vrubopis; 4 = zálohová faktura (nedaňový zálohový list); 5 = daňový doklad při přijetí platby (daňový zálohový list); 6 = opravný DD při přijetí platby; 7 = zjednodušený daňový doklad.

### 7.3 Invoice root element: sequence
The root definition was not visible in the fetched portion, so this list is [I] from prior knowledge. Elements marked * were confirmed in fetched text [O].

`DocumentType`* → `SubDocumentType`? → `SubDocumentTypeOrigin`? → `TargetConsolidator`? → `ClientOnTargetConsolidator`? → `ClientBankAccount`? → `ID`* → `UUID`* → `EgovFlag`? → `ISDSID`? → `FileReference`? → `ReferenceNumber`? → `EgovClassifiers`? → `IssuingSystem`*? → `IssueDate`* → `TaxPointDate`*? → `VATApplicable`* → `ElectronicPossibilityAgreementReference` → `Note`*? → `LocalCurrencyCode`* → `ForeignCurrencyCode`*? → `CurrRate`* → `RefCurrRate`* → `Extensions`*? → `AccountingSupplierParty`* → `SellerSupplierParty`? → (`AnonymousCustomerParty` | `AccountingCustomerParty`) → `BuyerCustomerParty`? → `OrderReferences`*? → `DeliveryNoteReferences`? → `OriginalDocumentReferences`*? → `ContractReferences`? → `Delivery`? → `InvoiceLines`* → `NonTaxedDeposits`? → `TaxedDeposits`? → `TaxTotal`* → `LegalMonetaryTotal`* → `PaymentMeans`*? → `SupplementsList`*? → `Signature`*? (must be last).

Rules observed [O] https://isdoc.cz/6.0.2/doc/isdoc.html:
- `LocalCurrencyCode` is mandatory.
- On domestic-currency documents, `CurrRate` and `RefCurrRate` must equal 1.
- `TaxPointDate` (DUZP) should be filled on tax documents.
- `CompanyID` (DIČ) belongs on VAT-liable documents.
- Types 2, 3 and 6 require an `OriginalDocumentReference`.

### 7.4 Key sub-structures
- **Party** (supplier/customer) [O] XSD: `PartyIdentification` (`UserID`?, `CatalogFirmIdentification`?, `ID` = IČO [I]), `PartyName/Name`, `PostalAddress` (`StreetName`, `BuildingNumber`, `CityName`, `PostalZone`, `Country/IdentificationCode`, `Country/Name` [O] adawolfa/isdoc), `PartyTaxScheme`* (`CompanyID` = DIČ, `TaxScheme` = "VAT" [I]), `RegisterIdentification`?, `Contact`?.
- **InvoiceLine** [O] XSD, in sequence:
  1. `ID` (required)
  2. `OrderReference`?, `DeliveryNoteReference`?, `OriginalDocumentReference`?, `ContractReference`?, `EgovClassifier`?
  3. `InvoicedQuantity`? (@unitCode)
  4. `LineExtensionAmountCurr`?, `LineExtensionAmount`, `LineExtensionAmountBeforeDiscount`?
  5. `LineExtensionAmountTaxInclusiveCurr`?, `LineExtensionAmountTaxInclusive`, `LineExtensionAmountTaxInclusiveBeforeDiscount`?
  6. `LineExtensionTaxAmount`
  7. `UnitPrice`, `UnitPriceTaxInclusive`
  8. `ClassifiedTaxCategory` (`Percent`, `VATCalculationMethod`, `VATApplicable`?, `LocalReverseChargeFlag`?)
  9. `Note`?, `VATNote`?, `Item`? (`Description`, `SellersItemIdentification`…), `Extensions`?
- **TaxTotal** [O]: contains `TaxSubTotal`+ and `TaxAmount`, which must equal the sum of the subtotals.
  - `TaxSubTotal`: `TaxableAmount(Curr)`, `TaxAmount(Curr)`, `TaxInclusiveAmount(Curr)`, `AlreadyClaimed…`, `Difference…`, `TaxCategory` (`Percent`, `TaxScheme`?, `VATApplicable`?, `LocalReverseChargeFlag`?).
- **LegalMonetaryTotal** [O]: `TaxExclusiveAmount(Curr)`, `TaxInclusiveAmount(Curr)`, `AlreadyClaimedTaxExclusiveAmount(Curr)`, `AlreadyClaimedTaxInclusiveAmount(Curr)`, `DifferenceTaxExclusiveAmount(Curr)`, `DifferenceTaxInclusiveAmount(Curr)`, `PayableRoundingAmount`?, `PaidDepositsAmount(Curr)`, `PayableAmount(Curr)`. Values must reconcile with the TaxSubTotals.
- **PaymentMeans** (optional) [I]:
  - `Payment`+ with `PaidAmount`, `PaymentMeansCode` and `Details` (mandatory when used [O]).
  - `Details` for a bank transfer: `PaymentDueDate`, `ID` (account number), `BankCode`, `Name`, `IBAN`, `BIC`, `VariableSymbol`, `ConstantSymbol`, `SpecificSymbol`.
  - Optional `AlternateBankAccounts`.
  - `PaymentMeansCode` (UN/ECE 4461 subset): 10 cash, 20 cheque, 31 debit transfer, 42 bank transfer, 48 card, 49 direct debit, 50 cash on delivery (dobírka), 97 offset/zápočet.

### 7.5 PDF embedding and ISDOCX [O] https://isdoc.cz/6.0.2/doc/isdoc.html
- **ISDOC.PDF**:
  - PDF/A-3a with the XML attached as **`invoice.isdoc`**, MIME `text/xml`.
  - `AFRelationship` is `Source`, `Alternative` or `Supplement`. The attachment is referenced from the Catalog `/AF` and the `EmbeddedFiles` name tree.
  - File name suffix **`-isdoc.pdf`**.
  - Public-sector recipients additionally get `metadata-invoice-nsessl.xml`.
  - It works like Factur-X but carries an ISDOC payload. [O] econnect
- **ISDOCX**:
  - ZIP (stored or deflate; no encryption or splitting; UTF-8 file names with bit 11 set).
  - Root `manifest.xml` (ns `http://isdoc.cz/namespace/2013/manifest`) with `<maindocument filename="…isdoc"/>`. Fallback: the root-level `.isdoc` file.
  - Little adoption in practice. [O] econnect
- Inbound-pipeline idea [I]: for any incoming PDF, first look for `invoice.isdoc` or any `*.isdoc` / `*.xml` embedded file, and only then fall back to OCR/LLM.

---

## 8. Stormware POHODA XML

### 8.1 Where documented
- Overview: https://www.stormware.cz/pohoda/xml/ [O]. It links to "Podporované doklady pro import", "Seznam schémat", an XML Schema Validator, "Pro vývojáře", mServer and "plánované změny kompatibility". Those subpages were not fetched [?].
- XSDs are served at `https://www.stormware.cz/xml/schema/version_2/<name>.xsd`: `data.xsd`, `invoice.xsd`, `type.xsd`, `voucher.xsd`, `bank.xsd`, `intDoc.xsd`, … [O]
- Namespaces follow the same pattern: `http://www.stormware.cz/schema/version_2/invoice.xsd`, etc. [O]
- Import paths [I]: an XML import in the POHODA UI (Soubor → Datová komunikace → XML import) or the POHODA mServer HTTP endpoint. mServer requires a higher variant or add-on licence [?]. Responses come back as `rsp:responsePack`.

### 8.2 Envelope [O] data.xsd
```xml
<dat:dataPack xmlns:dat="http://www.stormware.cz/schema/version_2/data.xsd"
  xmlns:inv="http://www.stormware.cz/schema/version_2/invoice.xsd"
  xmlns:typ="http://www.stormware.cz/schema/version_2/type.xsd"
  version="2.0" id="EXP-2026-10-17-1" ico="12345678" application="OSVC-App" note="Import přijatých faktur">
  <dat:dataPackItem version="2.0" id="INV-0001"> <inv:invoice version="2.0"> … </inv:invoice> </dat:dataPackItem>
</dat:dataPack>
```
- `dataPack` attributes:
  - `version` = `2.0` (required).
  - `id` (required, string64). Together with the item `id` it is used to detect duplicate imports.
  - `ico` (optional, takes priority over `key`), `key`, `period`.
  - `application` (required), `programVersion`, `note` (required).
- `dataPackItem` attributes: `version` (`1.0` or `2.0`), `id` (required).
- Exactly **one** document per item. Import children include `inv:invoice`, `int:intDoc`, `bnk:bank`, `vch:voucher`, `adb:addressbook`, `ord:order`, `stk:stock`, `bka:bankAccount`, `isd:isdoc` and 30+ others. Export uses `lst:list…Request`.

### 8.3 Received invoice (`inv:invoice`) [O] invoice.xsd and type.xsd
- `invoiceType` enum:
  - Issued side: `issuedInvoice`, `issuedCreditNotice`, `issuedDebitNote`, `issuedAdvanceInvoice`, `receivable`, `issuedProformaInvoice`, `penalty`, `issuedCorrectiveTax`.
  - Received side: **`receivedInvoice`**, `receivedCreditNotice`, `receivedDebitNote`, `receivedAdvanceInvoice`, `commitment`, `receivedProformaInvoice`, `receivedCorrectiveTax`.
- `inv:invoiceHeader` is `xsd:all`, so element order is free. Key elements:
  - `invoiceType`, `number`, `symVar`, `originalDocument` (supplier's document number), `symPar`
  - dates: `date`, `dateTax` (DUZP), `dateAccounting`, `dateKHDPH` (control-statement date), `dateDue`, `dateApplicationVAT`
  - `accounting` (předkontace: `typ:ids`), `classificationVAT` (členění DPH: `typ:ids` e.g. `PD` [I], or `classificationVATType` = `inland` | `nonSubsume`), `classificationKVDPH`
  - `text`, `partnerIdentity` (`typ:address`: `company`, `name`, `city`, `street`, `zip`, `ico`, `dic`, `icDph`, `country`, `email`…), `myIdentity`
  - `paymentType` (`draft` | `cash` | `postal` | `delivery` | `creditcard` | `advance` | `encashment` | `cheque` | `compensation`), `account`, `symConst`, `symSpec`, `paymentAccount` (`accountNo`, `bankCode` [I])
  - `centre`, `activity`, `contract`, `note`, `intNote`, `liquidation`, `histRate`, `labels`, `parameters`, `validate`, …
- `inv:invoiceDetail/inv:invoiceItem` (`xsd:all`):
  - `text`, `quantity`, `unit`, `coefficient`, `payVAT` (true = prices include VAT)
  - `rateVAT` (`none` | `low` | `high` | `third` | `historyHigh` | `historyLow` | `historyThird`), `percentVAT`, `discountPercentage`
  - `homeCurrency` (`typ:unitPrice`, `typ:price`, `typ:priceVAT`, `typ:priceSum`), `foreignCurrency`
  - `accounting`, `classificationVAT`, `classificationKVDPH`, `PDP`, `CodePDP` (reverse charge), `centre`, `activity`, `contract`, `stockItem`, …
- `inv:invoiceSummary` (`xsd:all`):
  - `roundingDocument`, `roundingVAT`, `calculateVAT`, `typeCalculateVATInclusivePrice`
  - **`homeCurrency`** (`typCurrencyHome`): `typ:priceNone`, `typ:priceLow`, `typ:priceLowVAT`, `typ:priceLowSum`, `typ:priceHigh`, `typ:priceHighVAT`, `typ:priceHighSum`, `typ:price3`, `typ:price3VAT`, `typ:price3Sum`, `typ:round`
  - `foreignCurrency`
- A no-items ("bez položek") invoice carries only the summary amounts:
  - Since 2024, 21 % maps to `priceHigh*` and 12 % to `priceLow*`. `price3` is unused. [I]
  - `priceNone` holds exempt and out-of-scope amounts.

### 8.4 Other agendas [O]
- **Internal document** `int:intDoc`:
  - Header (`xsd:all`): `number`, `symVar`, `symPar`, `originalDocumentNumber`, `date`, `dateTax`, `dateAccounting`, `dateKVDPH`, `dateKHDPH`, `accounting`, `classificationVAT`, `classificationKVDPH`, `transactionTaxType`, `numberKHDPH`, `text`, `partnerIdentity`, `liquidation`, …
  - `intDocSummary` and `intDocItem` mirror the invoice structure.
- **Bank** `bnk:bank`:
  - `bankType` = `receipt` | `expense`.
  - Header: `account`, `statementNumber`, `symVar`, `dateStatement`, `datePayment`, `accounting`, `classificationVAT`, `text`, `partnerIdentity`, `paymentAccount`, `symConst`, `symSpec`, `symPar`, …
  - `bankItem` has `liquidatedDocument`. `bankSummary` has `homeCurrency` / `foreignCurrency`.
- **Cash voucher** `vch:voucher`:
  - `voucherType` = `receipt` | `expense`.
  - Header: `cashAccount`, `number`, `originalDocument`, `date`, `datePayment`, `dateTax`, `dateKHDPH`, `accounting`, `classificationVAT`, `classificationKVDPH`, `text`, `partnerIdentity`, `symPar`, …
  - `voucherSummary` / `voucherItem` follow the same pattern.

---

## 9. Money S3 XML

- Developer doc page: https://money.cz/navod/s3xmlde/ [O]
  - Spec PDF "XML přenosy": https://money.cz/wp-content/uploads/2024/10/xml_prenosy.pdf (for **Money S3 24.900**, © Seyfor). [O]
  - XSD schemas ZIP: https://money.cz/wp-content/uploads/2024/10/schemas.zip. Inside the program they are at `Data/XMLDE/Schemas`. [O]
  - Sample XML ZIP: https://money.cz/wp-content/uploads/2024/10/vzorove_xml.zip [O]
  - Support: podpora@money.cz.
- Behaviour [O]:
  - Without the **XMLDE** module only the native Money S3 format with preset options works. XMLDE adds XSLT transformation templates and configurable transfers.
  - XML values take priority over the import-configuration presets.
  - Storno invoices are not supported.
  - Received invoices are matched by document number, or by "Doklad došlý" (usually the VS) combined with the partner identity. Bank documents are matched by account plus statement item ID. GUIDs are optional.
  - Deletion uses `<DeleteImport>1</DeleteImport>`.
  - Validation against the XSD stops at the first error.
  - The user imports via *XML přenosy → Import z XML* with batch processing. [O] https://www.Competitor C.cz/podpora/ucetni-program/import-money-s3
- Element names. The PDF and pages did not list them; this is prior knowledge [I]. Verify against `schemas.zip` and the samples.
  - Root `<MoneyData ICAgendy="…" KodAgendy="…" HospRokOd="…" HospRokDo="…" description="…" ExpZkratka="…" ExpDate="…" ExpTime="…" VyberZaznamu="0">`
  - Lists: `<SeznamFaktPrij><FaktPrij>` (received invoices), `<SeznamFaktVyd><FaktVyd>`, `<SeznamIntDokl><IntDokl>`, `<SeznamBankDokl><BankDokl>`, `<SeznamPokDokl><PokDokl>`, `<SeznamFirem><Firma>`.
  - `FaktPrij` children:
    - `Doklad`, `Popis`, `DatUcPr`, `DatVyst`, `DatPln` (DUZP), `DatSplat`, `DatSkPoh` (date for the control statement / DPH)
    - `VarSymbol`, `PrijatDokl` (supplier invoice number), `KonstSym`, `Ucet`, `Druh`, `Dobropis`, `ZpVypDPH`, `SazbaDPH1`, `SazbaDPH2`
    - `SouhrnDPH` (`Zaklad0`, `Zaklad5`, `Zaklad22`, `DPH5`, `DPH22`, `SeznamDalsiSazby`). The legacy element names follow the original 5 %/22 % rate slots, not the current rates.
    - `Celkem`, `Valuty`
    - `DodOdb` (`ObchNazev`, `ObchAdresa/Ulice/Misto/PSC/Stat`, `ICO`, `DIC`)
    - `PrKont` (předkontace), `Cleneni` (členění DPH), `Stredisko`, `Zakazka`, `SeznamPolozek/Polozka`.

---

## 10. Bank statements and bank APIs

### 10.1 ABO / GPC (fixed-width)
Records are 128 characters of data plus CR LF (130 bytes total). Numeric fields are left zero-padded, text fields right space-padded. Amounts are in haléře without a decimal separator. Dates are `DDMMYY`. [O] https://www.fio.cz/docs/cz/struktura-gpc.pdf, https://testrs.gov.cz/smlouva/soubor/7444/ABO_format.pdf

**074 – statement header**
| Pos | Len | Field |
|---|---|---|
| 1–3 | 3 | `074` |
| 4–19 | 16 | client account number |
| 20–39 | 20 | short account name |
| 40–45 | 6 | old balance date |
| 46–59 | 14 | old balance |
| 60 | 1 | sign `+`/`-` |
| 61–74 | 14 | new balance |
| 75 | 1 | sign |
| 76–89 | 14 | debit turnover |
| 90 | 1 | sign (`0`/`-` at Fio) |
| 91–104 | 14 | credit turnover |
| 105 | 1 | sign |
| 106–108 | 3 | statement number |
| 109–114 | 6 | posting date |
| 115–128 | 14 | filler |

**075 – transaction**
| Pos | Len | Field |
|---|---|---|
| 1–3 | 3 | `075` |
| 4–19 | 16 | client account |
| 20–35 | 16 | counter-account (prefix + number) |
| 36–48 | 13 | document / transaction ID |
| 49–60 | 12 | amount (haléře) |
| 61 | 1 | **kód účtování**: 1 debit, 2 credit, 4 storno debit, 5 storno credit (Fio). The SERVIS 24 doc lists 3/4 for storno. |
| 62–71 | 10 | VS |
| 72–81 | 10 | KS, at Fio in the form **`BBBBKSYM`** = counterparty bank code + KS |
| 82–91 | 10 | SS |
| 92–97 | 6 | valuta (Fio: `000000`) |
| 98–117 | 20 | doplňující údaj / counterparty name |
| 118 | 1 | `0` (kód změny položky) |
| 119–122 | 4 | druh dat / currency (Fio: `0203` = CZK) |
| 123–128 | 6 | due date |

- Optional **078/079** records (AV1–AV4) carry the transaction message, up to 140 characters in total. [O] https://www.rb.cz/attachments/Micro/ucty/IB-micro-formaty-vypisu.pdf
- **Account numbers come in two encodings** [O] same RB PDF:
  - "ediční" (readable, zero-padded, e.g. `0000008271917036`),
  - "vnitřní" (digits permuted, e.g. `6031827197000000`).
  - Parsers must detect or configure which one the bank uses.
- Encoding is usually windows-1250. [I] Not stated in the fetched docs.
- Positions and code values differ slightly between banks: ČS/SERVIS 24 vs Fio vs Comgate (Comgate encodes currency in the account prefix and uses a posting code like `1102`). [O] https://help.comgate.eu/docs/en/abo
- Plan per-bank profiles. [I]

### 10.2 CAMT.053 (ISO 20022 BankToCustomerStatement)
- Czech banks provide camt.053 as "ČBA XML" or "SBA XML". [O] The Fio API lists both as statement formats.
- Typical message version: `camt.053.001.02`. Some banks may move to `.001.08`. [I]
- Key paths [I]:
  - `BkToCstmrStmt/Stmt/{Id, ElctrncSeqNb, CreDtTm, FrToDt, Acct/Id/IBAN, Bal[Tp/CdOrPrtry/Cd=OPBD|CLBD]}`
  - `Ntry/{Amt@Ccy, CdtDbtInd, Sts, BookgDt/Dt, ValDt/Dt, AcctSvcrRef, BkTxCd}`
  - `NtryDtls/TxDtls/{Refs/EndToEndId, RltdPties/{Dbtr|Cdtr}/Nm, {DbtrAcct|CdtrAcct}/Id/(IBAN|Othr/Id), RltdAgts, RmtInf/(Ustrd|Strd/CdtrRefInf/Ref)}`
- How VS/KS/SS map into these elements is bank-specific. [?] Often VS goes in `EndToEndId` or `CdtrRefInf/Ref`, sometimes prefixed `VS:`. Get each bank's MIG before parsing.

### 10.3 Fio banka API [O] https://www.fio.cz/docs/cz/API_Bankovnictvi.pdf (v1.9, 2025-10-16)
- Base URL: `https://fioapi.fio.cz/v1/rest/`
- `GET periods/{token}/{YYYY-MM-DD}/{YYYY-MM-DD}/transactions.{json|xml|csv|gpc|html|ofx}`
- `GET by-id/{token}/{year}/{id}/transactions.{fmt}`: official statement. Formats also include `pdf`, `sta` (MT940), `cba_xml`, `sba_xml` (camt.053).
- `GET last/{token}/transactions.{fmt}`: everything since the last download marker. Move the marker with `set-last-id/{token}/{id}/` or `set-last-date/{token}/{YYYY-MM-DD}/`.
- `GET lastStatement/{token}/statement`: number of the last official statement.
- `GET merchant/{token}/{from}/{to}/transactions.{xml|csv}`: card / POS terminal transactions.
- Import: payment orders are uploaded via POST in ABO, Fio XML, SEPA pain.001 or pain.008. Known URL `https://fioapi.fio.cz/v1/rest/import/` with multipart fields `token`, `type`, `file`, `lng`. [I] The URL was not in the fetched text.
- **Token** [O]:
  - 64 characters, created in internet banking (Nastavení → API) with strong authorisation (SMS or push).
  - Usable 5 minutes after creation. One token per account.
  - **Maximum validity 180 days** (auto-extension possible at login).
  - Rights: read-only, or read plus payment import.
  - **Data older than 90 days** needs a temporary history unlock, open for 10 minutes.
- **Rate limit:** minimum **30 s** between requests on the same token. [O] HTTP 409 Conflict is listed among the errors without explanation; it is commonly what a request inside the 30 s window gets. [I] Other errors: 404, 413 "Příliš mnoho položek" (too many items), 422, 500.
- **JSON shape:** `accountStatement.info` has `accountId`, `bankId`, `currency`, `iban`, `bic`, `openingBalance`, `closingBalance`, `dateStart`, `dateEnd`, `yearList`, `idList`, `idFrom`, `idTo`, `idLastDownload`. `accountStatement.transactionList.transaction[]` objects hold `columnN: {value, name, id}`.
  - column0 datum; 1 objem; 2 protiúčet; 3 kód banky; 4 KS; 5 VS; 6 SS; 7 uživatelská identifikace; 8 typ; 9 provedl; 10 název protiúčtu; 12 název banky; 14 měna; 16 zpráva pro příjemce; 17 ID pokynu; 18 upřesnění; 22 **ID pohybu** (unique key); 25 komentář; 26 BIC; 27 reference plátce.
  - Empty columns are `null`.
  - The date column is documented as `rrrr-mm-dd+GMT`, but the PDF examples show epoch milliseconds. **Accept both.** [O]

### 10.4 Other banks (business APIs)
| Bank | API | Auth / notes |
|---|---|---|
| Raiffeisenbank CZ | **Premium API**, base `https://api.rb.cz/rbcz/premium/api/`. Endpoints: `GET accounts`, `GET accounts/{accountNumber}/balance`, `GET accounts/{accountNumber}/{currencyCode}/transactions`, `POST accounts/statements` (+ `/download`), `POST payments/batches`, `GET fxrates` | Client certificate (.p12) + `X-IBM-Client-Id`. Per-second and per-day rate limits exposed in response headers; 429 when exceeded. [O] https://packagist.org/packages/vitexsoftware/rbczpremiumapi (third-party SDK) |
| Komerční banka | "KB Business API" (MojeBanka Business), "Extra service API Business" (KB+), PSD2. Docs: developers.kb.cz | [O] https://www.kb.cz/en/kbapi. Auth and pricing not public on that page [?] |
| Česká spořitelna | Erste developer portal https://developers.erstegroup.com/docs/apis: PSD2 accounts/payments, Transparent Accounts, Exchange rates. The corporate route has a monthly fee. | [O] https://openbankingtracker.com/provider/ceska-sporitelna/apis, https://help.eos.cz/en/articles/151-overview-of-banking-api-connections-imports |
| ČSOB | **CEB Business Connector**: certificate uploaded in ČSOB CEB (Settings → Business Connector), statements as MT940 (also GPC/camt [I]) | [O] https://help.eos.cz/en/articles/146-csob-ceb-business-connector |
| Moneta | own API for business accounts (XML) | [O] eos.cz overview |
| mBank, Creditas | API available (Creditas: GPC) | [O] eos.cz overview |
| Air Bank, UniCredit | no direct API listed; via aggregators (e.g. Tatra banka) | [O] eos.cz overview |
| Any bank | PSD2 AIS (requires an AISP licence from ČNB or a licensed aggregator) | [I] |

**Pragmatic plan for an OSVČ app [I]:**
1. Fio API, the most common bank among OSVČ, using a user-supplied token. Cache, and keep strictly to 1 call per 30 s per token. Re-prompt the user before the 180-day expiry.
2. Upload of GPC / camt.053 / MT940 files for all other banks.
3. A PSD2 aggregator for automatic multi-bank sync.
4. Bank-specific corporate APIs (RB Premium, KB, ČS) for larger clients.

---

## 11. Cross-cutting implementation notes [I]
- Store DIČ normalised in two forms: `CZ` + digits (for ARES and VIES) and digits only (for the ADIS SOAP call).
- Treat the published accounts from ADIS as a whitelist when matching a payment account. Compare after normalising both sides to IBAN, using §6.
- Keep the source tag (`[O]`/`[I]`) per field in the codebase's integration docs. Re-verify the [I] items, especially the ISDOC root order, Money S3 element names and VIES GET paths, by downloading the XSD ZIPs and swagger files directly at build time.
- Endpoints known to move: ADIS (adisrws.mfcr.cz → mojedane.gov.cz) and ISDOC (mv.gov.cz → archiv.mv.gov.cz / isdoc.cz). Make every registry base URL a config value.
