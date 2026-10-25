# Czech tax filings for an OSVČ bookkeeping + tax app: EPO XML, line mapping, deadlines, 2026 rules

Research date: 2026-10-17. Sources: public web only (WebSearch/WebFetch). Nothing was logged into or submitted.

Labels: **[O]** observed in a source (URL given) · **[I]** inference or knowledge from the law text that was not re-fetched in this session · **[?]** unknown, verify before shipping.

> Caveat: some official pages (XSD files, long PDFs) came back cut off through the fetch tool. Where a field list is marked [I], **download the XSD and check it before generating XML** (URLs in §1.1). Treat the XSD as the source of truth: build the XML serializer straight from the XSD (codegen) rather than from this document.

---

## 0. TL;DR for engineering

| Filing | EPO code (zkratka) | Current version (popis) | XSD | Frequency / deadline |
|---|---|---|---|---|
| VAT return | `DPHDP3` | 03.01.04, 11. 8. 2026 [O] | `https://adisspr.mfcr.cz/adis/jepo/schema/dphdp3_epo2.xsd` [O] | Monthly or quarterly, by the 25th after the period ends |
| Control statement (KH) | `DPHKH1` | 03.01.15, 11. 8. 2026 [O] | `https://adisspr.mfcr.cz/adis/jepo/schema/dphkh1_epo2.xsd` [O] | Legal persons monthly. Natural persons (FO) follow their VAT period. Due by the 25th. |
| Recapitulative statement (VIES) | `DPHSHV` | 02.01.05, 11. 8. 2026 [O] | `https://adisspr.mfcr.cz/adis/jepo/schema/dphshv_epo2.xsd` [O] | Monthly by the 25th. Quarterly allowed if the only supplies are services [I]. |
| Personal income tax return | `DPFDP7` (tax years 2024 onward; DPFDP5 = 2013–2020, DPFDP6 = 2021–2023) | 01.01.02, 23. 9. 2025 [O] | `https://adisspr.mfcr.cz/adis/jepo/schema/dpfdp7_epo2.xsd` [O] | Yearly: 1 Apr on paper, ~1 May electronically, 1 Jul with a tax advisor |
| Flat-tax regime entry notice | `DPFOPR` | 02.02.01, 23. 9. 2025 [O] | (same pattern) [I] | By 10 Jan (12 Jan in 2026) [O] |
| ČSSZ annual overview (Přehled OSVČ) | `OSVC25` (tax year 2025) | namespace `http://schemas.cssz.cz/OSVC2025` [O] | see §4.4 | 1 month after the DAP deadline |

- All EPO structures share one root, `<Pisemnost>`, wrapping a document element (`<DPHDP3>`, `<DPHKH1>`, `<DPHSHV>`, `<DPFDP7>`). The children are `Veta*` elements, and **all data sits in attributes** [O XSD].
- List of every structure and its version: `https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_seznam.faces` [O]
- Detail page per structure: `https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_detail.faces?zkratka=<CODE>` [O]
- Machine submission endpoint: `POST https://mojedane.gov.cz/dpr/epo_podani`. The body is PKCS#7 signedData with a **qualified** electronic signature. `?test=1` validates without filing. [O] (§1.6)
- 2026 headline numbers: VAT rates are **21 % / 12 %** [O]. VAT registration threshold is 2 000 000 Kč (next-year registration) or 2 536 500 Kč (registration from the next day) [O]. Paušální daň band I is **9 162 Kč/month**, retroactively from 1. 1. 2026 (was 9 984). Bands II and III are 16 745 and 27 139 Kč [O]. Minimum social advance is **5 005 Kč** (was 5 720) and minimum health advance is **3 306 Kč** [O].
- Big upcoming change: **EET 2.0** (Act 180/2026 Sb., in force mostly from **1. 1. 2027**) [O]. It also restores the student and kindergarten (školkovné) tax credits, adds a 5 000 Kč one-off EET credit and a 1 400 Kč/month "přirážka" (surcharge) option for flat-tax payers, and changes VAT bad-debt rules (§ 46). See §6.

---

## 1. EPO XML structures

### 1.1 Where the official files are

| What | URL | Label |
|---|---|---|
| List of all EPO structures with versions | https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_seznam.faces | [O] |
| DPHDP3 description | https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_detail.faces?zkratka=DPHDP3 | [O] |
| DPHKH1 description | …popis_struktury_detail.faces?zkratka=DPHKH1 | [O] |
| DPHSHV description | …popis_struktury_detail.faces?zkratka=DPHSHV | [O] |
| DPFDP7 description | …popis_struktury_detail.faces?zkratka=DPFDP7 | [O] |
| XSD pattern | `https://adisspr.mfcr.cz:443/adis/jepo/schema/<code lowercase>_epo2.xsd` (dphdp3, dphkh1, dphshv, dpfdp7) | [O] |
| Submission interface spec (Podatelna EPO) | https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/PodatelnaEPO.pdf | [O] |
| Legal basis for format: Pokyn GFŘ-D-50 (format and structure of the data message, in force from 1. 7. 2021) | https://www.dauc.cz/predpisy/971/gfr-d-50 | [O] |
| KH methodology (from 1. 1. 2024) | https://financnisprava.gov.cz/assets/cs/prilohy/d-seznam-dani/Metodicka_informace_k_vyplneni_KH_20240101.pdf | [O] |
| KH methodology (English) | https://financnisprava.gov.cz/assets/cs/prilohy/d-seznam-dani/Control_Statement_Guidelines_20240101.pdf | [O] |
| DAP (income tax return) instructions for 2025 | https://adisspr.mfcr.cz/dpr/adis/idpr_pub/dpf/dp7/doc/pokyny_dap_2025.pdf | [O] |
| EPO web forms | https://adisspr.mfcr.cz/pmd/epo/formulare | [O] |
| ČSSZ OSVČ e-filing definitions and XSDs | https://www.cssz.gov.cz/definice-e-podani-osvc | [O] |

Versioning: popis versions are bumped often. All VAT structures were re-dated 11. 8. 2026 [O]. **Store the XSD per tax period and re-check it before each filing season** [I]. A version string like `03.01.15` most likely maps to a `verzePis="03.01"` attribute on the document element [I]. That attribute did not appear in the fetched XSD excerpt [O], so confirm it from an XML exported by EPO. Root attributes `nazevSW` / `verzeSW` (software name and version) are what EPO exports [I] and may be optional.

General format rules from PodatelnaEPO.pdf [O]:
- Encoding: UTF-8 is preferred. WINDOWS-1250, UTF-16, US-ASCII and ISO-8859-x are also accepted, but a non-UTF-8 encoding must be declared.
- The decimal separator is a dot.
- Dates in XSD attributes use the `dateInMultiFormat` pattern, which accepts `D.M.RRRR` / `DD.MM.RRRR` [O XSD]. **Emit `DD.MM.YYYY`.**
- Attachments go base64-encoded in a `<Prilohy>` section [O].

### 1.2 DPHDP3 — VAT return

Skeleton [O for element names and order D, P, 1, 2, 3, 4…; the order of 5, 6, R comes from the popis list]:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Pisemnost nazevSW="OurApp" verzeSW="1.0.0">          <!-- root attrs: [I] -->
  <DPHDP3 verzePis="03.01">                            <!-- verzePis: [I] -->
    <VetaD dokument="DP3" k_uladis="DPH" dapdph_forma="B" typ_platce="P"
           rok="2026" mesic="9" trans="A" c_okec="620100" d_poddp="17.10.2026"/>
    <VetaP c_ufo="…" c_pracufo="…" dic="12345678" typ_ds="F"
           jmeno="Jan" prijmeni="Novák" ulice="…" c_pop="…" naz_obce="…" psc="…" stat="ČESKÁ REPUBLIKA" email="…"/>
    <Veta1 obrat23="100000" dan23="21000" p_sl23_e="5000" dan_psl23_e="1050"/>
    <Veta2 pln_sluzby="40000"/>
    <Veta4 pln23="20000" odp_tuz23_nar="4200" nar_zdp23="5000" od_zdp23="1050" odp_sum_nar="5250"/>
    <Veta6 dan_zocelk="22050" odp_zocelk="5250" dano_da="16800"/>
  </DPHDP3>
</Pisemnost>
```

**VetaD (1..1)** [O popis + XSD]:
- `dokument="DP3"` (fixed) and `k_uladis="DPH"` (fixed). Both required.
- `dapdph_forma` is required. Values: `B` = řádné (regular), `O` = řádné-opravné (regular corrective), `D` = dodatečné (supplementary), `E` = dodatečné-opravné (supplementary corrective).
- `typ_platce` is required. Values: `P` = payer (§ 6–6fa), `I` = identified person (§ 6g–6l), `S` = VAT group (§ 5a), `N` = non-payer under § 108, `R` = non-payer acquiring a new means of transport (§ 19c), `D` = non-payer supplying a new means of transport (§ 19b).
- `rok` is required. Fill `mesic` (1–12) for a monthly period or `ctvrt` (1–4) for a quarterly one. `zdobd_od` / `zdobd_do` give a partial period.
- `trans`: `A` if a tax liability arose, `N` if not.
- `c_okec`: 6-digit CZ-NACE code of the main activity.
- `d_poddp`: preparation date. `d_zjist`: date the grounds for a supplementary return were found (needed for D/E). `d_por_dod`: new means of transport.
- `kod_zo`: `Q` or `M`. Filled **only in the last regular return of the year** to switch period for next year.

**VetaP (1..1)** [O]: `c_ufo` (financial office, 3 digits, required), `c_pracufo` (territorial workplace, 4 digits), `dic` (numeric part only, `[0-9]{1,10}`, keep leading zeros), `typ_ds` (F/P), name and address fields, `email`, `c_telef`. Signatory/representative block: `zast_typ`, `zast_kod`, `zast_jmeno`, `zast_prijmeni`, `zast_dat_nar` or `zast_ev_cislo`, `zast_ic`, `zast_nazev`. Preparer: `sest_jmeno`, `sest_prijmeni`, `sest_telef`. Legal-entity signatory: `opr_jmeno`, `opr_prijmeni`, `opr_postaveni`.

Veta1–Veta6 attributes and the row they feed are in §2 (mapping table). Amounts in DPHDP3 are whole Kč (§ 37 rounding to whole crowns) [I]. KH, by contrast, allows haléře (2 decimals) [O].

### 1.3 DPHKH1 — control statement (kontrolní hlášení)

Structure [O popis + XSD]: `<Pisemnost><DPHKH1> VetaD (1) · VetaP (1) · VetaA1* · VetaA2* · VetaA3* · VetaA4* · VetaA5 (0..1) · VetaB1* · VetaB2* · VetaB3 (0..1) · VetaC (0..1)`

**VetaD** [O]:
- `dokument="KH1"` and `k_uladis="DPH"` (both fixed).
- `rok` is required. Plus `mesic` or `ctvrt`. Quarterly is allowed only for natural persons (FO) with a quarterly VAT period.
- `khdph_forma` is required. Values: `B` = řádné (regular), `O` = řádné-opravné (regular corrective), `N` = následné (subsequent), `E` = následné-opravné (subsequent corrective).
- `d_poddp`, `zdobd_od`, `zdobd_do` (FO only).
- `d_zjist` (date the errors were found) or `c_jed_vyzvy` (case number of the tax office request, format `99999999/99/9999-99999-999999`). One of them is needed for N/E.
- `vyzva_odp` (quick reply to a request): `B` = no obligation, nil return. `P` = confirm the last return.

**VetaP**: same fields as the DPHDP3 VetaP [O].

| Věta | Purpose | Attributes (required in **bold**) [O unless noted] |
|---|---|---|
| A1 | Outputs under domestic reverse charge (§ 92a), supplier side → ř. 25 | **dic_odb**, **c_evid_dd**, **duzp**, **zakl_dane1**, **kod_pred_pl**, c_radku |
| A2 | Received supplies where the recipient self-assesses (§ 108(2),(3)): EU goods, foreign services | c_radku, k_stat, vatid_dod (without country prefix), c_evid_dd, dppd, zakl_dane1, dan1, zakl_dane2, dan2, zakl_dane3, dan3 |
| A3 | Investment gold, exempt with deduction (§ 92/101c) | **dup**, **osv_plneni**, **c_evid_dd**, c_radku, k_stat, vatid_odb, jm_prijm_obch, d_narozeni, m_pobytu_sidlo |
| A4 | Domestic outputs **> 10 000 Kč incl. VAT** to a registered customer, plus every § 46 bad-debt correction | **dic_odb**, **c_evid_dd**, **dppd**, zakl_dane1, dan1, zakl_dane2, dan2, zakl_dane3, dan3, kod_rezim_pl (0 = normal, 1 = § 89 travel, 2 = § 90 used goods), zdph_44 (N = none, P = § 46 correction, A = old § 44), c_radku (9 digits) |
| A5 | All other outputs (≤ 10 000 Kč, B2C, no document): **one aggregate row** | zakl_dane1, dan1, zakl_dane2, dan2, zakl_dane3, dan3 |
| B1 | Received reverse-charge supplies (§ 92a), recipient side → ř. 10/11 | dic_dod, c_evid_dd, duzp, kod_pred_pl, zakl_dane1-3, dan1-3, c_radku (detail rows cut off in fetch: [I] that dic_dod, c_evid_dd, duzp, kod_pred_pl are required, mirroring A1) |
| B2 | Received domestic supplies **> 10 000 Kč incl. VAT** with deduction under § 73(1)(a) → ř. 40/41 | dic_dod, c_evid_dd, dppd, zakl_dane1-3, dan1-3, pomer (A/N, default N), zdph_44, c_radku |
| B3 | Received domestic supplies ≤ 10 000 Kč with deduction: **one aggregate row** | zakl_dane1-3, dan1-3 |
| C | Control totals vs. DPHDP3 | obrat23, obrat5, pln23, pln5, pln_rez_pren, rez_pren23, rez_pren5, celk_zd_a2 |

Rate suffixes: `1` = 21 % (základní, standard). `2` = 12 % (snížená, reduced). `3` = the second reduced rate, **only for DPPD/DUZP up to 31. 12. 2023** (the old 10 %) [O]. For 2026 periods, use 1 and 2 only.

Numbers: `Číslo 17 (14+2)`, so 2 decimals are allowed [O]. `dic_*` fields hold digits only (`[0-9]{1,10}`), without the `CZ` prefix [O XSD]. `c_evid_dd` (max 60 characters) must be exactly the supplier's document number. The KH matching engine pairs supplier rows with recipient rows on DIČ + c_evid_dd [O methodology].

**Věta C mapping to DPHDP3** [I. The attribute names are O, but descriptions were not in the fetched text]:

| Věta C attr | = sum of KH | must equal DPHDP3 |
|---|---|---|
| obrat23 | A4 + A5, zakl_dane1 | ř. 1 base (obrat23) |
| obrat5 | A4 + A5, zakl_dane2 (+3) | ř. 2 base (obrat5) |
| pln_rez_pren | A1 zakl_dane1 | ř. 25 (pln_rez_pren) |
| rez_pren23 | B1 zakl_dane1 | ř. 10 base |
| rez_pren5 | B1 zakl_dane2 | ř. 11 base |
| pln23 | B2 + B3, zakl_dane1 | ř. 40 base (pln23) |
| pln5 | B2 + B3, zakl_dane2 | ř. 41 base (pln5) |
| celk_zd_a2 | A2 all bases | ř. 3 + 4 + 5 + 6 + 9 + 12 + 13 bases |

Implement this as a validation step that reconciles the KH and DPHDP3 the app generates. The tax office runs the same cross-check.

#### 1.3.1 Routing rules: which KH section a document lands in

From the KH methodology from 1. 1. 2024 [O], https://financnisprava.gov.cz/assets/cs/prilohy/d-seznam-dani/Metodicka_informace_k_vyplneni_KH_20240101.pdf, plus the English version for B.2:

- **How the 10 000 Kč limit is tested**: per **tax document as a whole, including VAT**, whatever the VAT regime of its lines. Reverse-charge and exempt lines on the same document count toward the total.
  - Advances (zálohy) are tested on the advance document's amount.
  - Instalment or payment calendars (§ 31/31a) and summary documents (§ 31b) are tested on the sum of the document.
  - Corrective documents (§ 42 / § 74) are tested on the **absolute value** of the correction.
- **A.4**: the customer has a CZ DIČ (a payer, an identified person, or a non-payer legal person with a CZ DIČ) and the document is > 10 000 Kč incl. VAT. **Every § 46 bad-debt correction goes to A.4 regardless of amount** (flag `zdph_44="P"`, negative base and tax).
- **A.5**: everything else on the output side, aggregated.
  - Documents ≤ 10 000 Kč, simplified documents (§ 30) and own-use documents (§ 32).
  - **Customers without a CZ DIČ, regardless of amount** (B2C, foreigners without a CZ DIČ).
  - Margin schemes (§ 89, § 90) and § 89 advances.
  - Supplies with no document (e.g. retail to consumers).
  - Corrections ≤ the limit.
- **A.1**: domestic reverse charge where we are the supplier (§ 92a: construction work under CZ-CPA 41–43, scrap, etc.). One row per supply with `kod_pred_pl`. If one document covers several codes, split it into rows with the same c_evid_dd and different codes. Use DUZP, not the advance date.
- **A.2**: purchases where we self-assess (§ 108(2)/(3)):
  - EU goods acquisitions (ř. 3/4, 9).
  - **Services from foreign persons (ř. 5/6 from EU suppliers, e.g. Google Ireland or Meta Platforms Ireland ads; ř. 12/13 from non-EU suppliers)**.
  - Other § 108 items (ř. 12/13).
  - Identify the supplier by `k_stat` + `vatid_dod`, left blank if the supplier has none.
  - DPPD: for § 24 services, the date of supply, or the advance date if the service is sufficiently identified. For § 25 goods, the 15th of the next month, or the invoice date if earlier.
  - Later documents report only the difference.
- **B.1**: received domestic reverse-charge supplies (recipient side), rows by supplier DIČ + c_evid_dd + kod_pred_pl, using DUZP.
- **B.2**: received domestic supplies with deduction on ř. 40/41 where the document is > 10 000 Kč incl. VAT. All § 74a and § 46 corrections go here regardless of amount.
  - Use the supplier's document number. If the document has not arrived yet, an internal number may be used temporarily and corrected later.
  - `pomer = "A"` only if a § 75 pro-rata coefficient is used. In that case report only the proportional part. For § 76 reduced deduction, report the full amounts.
  - For passenger cars, report the full base even if the deduction is capped.
  - Deductions on ř. 42–44 (imports, self-assessed) **do not** go to B.2. They are already in A.2 or B.1.
- **B.3**: received supplies ≤ 10 000 Kč with deduction, aggregated in one row.
- **kod_pred_pl codes** (A1/B1) [O partial]: 1, 1a, 3, 3a, 4, 4a, 5, 6, 7, 11–21. Examples: 4 = construction and assembly work [I], 12 = grain and technical crops, 13 = metals, 19 = electricity to traders, 21 = specified electronic communication services. Load the full code list from EPO [?].
- **Who files KH**: VAT payers only (typ_platce P/S). **Identified persons (IO) do not file KH** [O Competitor C.cz/almanach/dane/identifikovana-osoba].

Code-ready rule (pseudo):
```
if role == SUPPLIER:
    if reverse_charge_92a: A1
    elif customer.cz_dic and abs(doc_total_incl_vat) > 10_000: A4
    elif bad_debt_46: A4 (zdph_44="P")
    else: A5 (aggregate)
if role == RECIPIENT and deduction_claimed:
    if reverse_charge_92a (domestic): B1
    elif self_assessed_foreign (EU goods, foreign services, §108): A2   # tax also on output side
    elif bad_debt_74a_or_46: B2
    elif abs(doc_total_incl_vat) > 10_000 and supplier.cz_dic: B2
    else: B3 (aggregate)
```

**KH deadlines and penalties** [O financnisprava.gov.cz/…/kontrolni-hlaseni-dph/kdy and /sankce]:
- Legal persons file KH monthly even when their VAT return is quarterly. FO file per their VAT period, with the return.
- Due by the 25th day after the period. A subsequent KH (N) is due within **5 working days of discovering** the error. The response to a tax office request (výzva) is due within 5 working days of delivery (§ 101g) [I].
- Fixed penalties (§ 101h):
  - 1 000 Kč: late without a request.
  - 10 000 Kč: filed in the substitute deadline after a request.
  - 30 000 Kč: no response to a request to change, supplement or confirm data.
  - 50 000 Kč: not filed at all.
  - Amounts in (b)–(d) are **halved for natural persons** and quarterly legal persons.
  - Discretionary penalties: up to 50 000 Kč, or 500 000 Kč for serious obstruction.

### 1.4 DPHSHV — recapitulative statement (souhrnné hlášení, VIES)

[O popis] Structure: `VetaD (1) · VetaP (1) · VetaR (0..109999) · VetaS (call-off stock, 0..99999)`

- **VetaD**: `dokument="SHV"`, `k_uladis="DPH"`, `shvies_forma` (`R` = regular, `N` = subsequent), `rok` plus `mesic` or `ctvrt`, `d_poddp`. The legacy fields `pln_poc_celk`, `poc_radku`, `poc_stran`, `suma_pln` are unused.
- **VetaP**: same pattern as above, plus `dodobchjm`.
- **VetaR**: `k_stat` (2-letter code of the country that issued the VAT ID), `c_vat` (acquirer's VAT number without the country prefix, max 12), `k_pln_eu`, `pln_hodnota` (CZK, rounded up to whole crowns, credit notes negative), `pln_pocet`, `c_rad`, `por_c_stran`, `k_storno` (`A` = storno row, not allowed in an R statement).
- **k_pln_eu**:
  - `0` = goods to a VAT-registered person in another member state (§ 13(1),(2)) → DPHDP3 ř. 20.
  - `1` = transfer of own business assets (§ 13(6)).
  - `2` = triangular trade, intermediary only (§ 17) → ř. 31.
  - `3` = **services with place of supply in another member state under § 9(1), where the recipient self-assesses** → ř. 21. This is the typical OSVČ case: invoicing an EU client for IT, design or consulting.
- Limit: 4 000 rows each for R and S before the statement goes to offline processing.

### 1.5 DPFDP7 — personal income tax return (tax years 2024+)

Current structure: `DPFDP7` v01.01.02 (23. 9. 2025). No DPF structure carries a 2026 date yet [O]. A successor for tax year 2026 (filed in 2027) may appear late 2026 or early 2027 [?].

Records [O]:
- D (header, 1)
- P (taxpayer, 0..1)
- **O** (oddíl II: tax base, 0..1)
- **S** (oddíl III: deductions and tax, 0..1)
- A (dependent children, 0..99)
- B (attachment list, 0..1)
- **T** (Příloha č. 1, 0..1)
- **c** (other § 7 activities, 0..99)
- **U** (table for taxpayers keeping daňová evidence, 0..1)
- C, E (§ 23 adjustments)
- F, G, H, I (partners, spouse who cooperates in the business, income-splitting persons, v.o.s./k.s. companies)
- V, J (Příloha č. 2: § 9 / § 10 income)
- W, L, d (Příloha č. 3: foreign income)
- M (§ 34 deductions)
- N (overpayment refund request)
- b (employers, § 6)
- Z (Příloha č. 4), UA–UE, X, Y (accounting statements), e (cadastral office decision number), T1–T6 (helper tables), R (attachments)

Order in XSD: VetaD, VetaP, VetaO, VetaS, VetaA, VetaB, … [O].

Key attributes [O names; row links O where quoted from the XSD]:
- **VetaD**:
  - `dokument`, `k_uladis` (likely `DP7`/`DPF`) [I].
  - `rok`. `dap_typ` is required: `B` = řádné, `O` = řádné-opravné, `D` = dodatečné, `E` = dodatečné-opravné.
  - `pln_moc` is required (tax advisor files under a power of attorney, A/N). `audit` (A/N).
  - `kc_op15_1a` = sleva na poplatníka (basic taxpayer credit). The XSD documentation says "Uveďte částku 30 840 Kč".
  - `kc_zalpred` = advances paid during the year (ř. 85).
  - `kc_zbyvpred` = amount left to pay (ř. 77 − 77a − 84 − 85 − 86 − 87 − 87a − 88 + 89 − 90).
  - Also `kc_pausal` (flat-tax advances, ř. 86 [I]), `kc_zalzavc`, `kc_dan_celk`, `kc_sleva_exe`, `zdobd_od` / `zdobd_do`.
- **VetaO**:
  - `kc_zd6` (ř. 34). `kc_zd7` = **ř. 37 ← ř. 113 of Příloha 1**. `kc_zd9` (ř. 39 ← Příloha 2 ř. 206). `kc_zd10` (ř. 40 ← Příloha 2 ř. 209).
  - `kc_uhrn` = ř. 37 + 38 + 39 + 40 (= ř. 41). `kc_zakldan23` (ř. 42). `kc_zakldan` = ř. 42 − ř. 44 (ř. 45). `kc_ztrata2`, `kc_dan_zah`.
  - Cross-check from the XSD: if `kc_zd7` is filled, VetaT must be filled and `priloha1 = 1`.
- **VetaS**: § 15 deductions and credits (`kc_op15_8`, `kc_op15_12`, `kc_op15_13`, `kc_op15_inpr`, `kc_op15_pece`, `kc_op28_5`, `kc_op34_4`, `kc_zdsniz`, `m_uroky`).
- **VetaT (Příloha č. 1, § 7 income)**: `c_nace`, `m_podnik`, `kc_prij7` (ř. 101 income), `kc_vyd7` (ř. 102 expenses), `pr_sazba` (flat-rate expense % for the main activity [I]), `vyd7proc` (flag that a flat-rate expense % is used [I]), `pr_prij7` / `pr_vyd7` (main-activity income and expenses for the flat-rate table [I]), `celk_pr_prij7` / `celk_pr_vyd7` (totals [I]), `kc_uhzvys` (ř. 103 increases [I]), `kc_uhsniz` (ř. 104 decreases [I]), `kc_pod_so` / `kc_vyd_so` (income/expenses split to a cooperating spouse/person [I]), `kc_pod_vaso` / `kc_vyd_vaso` / `kc_pod_komp` (partner share in a v.o.s./k.s. [I]), `kc_cisobr`, `kc_hosp_rozd`, `kc_odpcelk` / `kc_odpnem` (depreciation [I]), `kc_zd7p` (ř. 113, partial tax base § 7 [I]), `d_zahcin` / `d_precin` / `d_obnocin` / `d_ukoncin` (start, interruption, resumption, end of activity), `uc_soust`.
- **Věta c**: `c_nace_dal`, `prijmy7`, `vydaje7`, `sazba_dal` (flat-rate % per additional activity).
- **VetaU** (daňová evidence table: year-end and year-start values): `kc_dpfmz02…18` / `kc_z_dpfmz02…11`. These are hmotný majetek (tangible assets), peníze (cash), pohledávky (receivables), zásoby (inventory), dluhy (payables) and rezervy (reserves) [I mapping].

Main DAP rows for tax year 2025 [O pokyny_dap_2025.pdf]:
- ř. 31 / 34 / 36: § 6 employment.
- **ř. 37: § 7 partial base (← Příloha 1 ř. 113)**. ř. 38: § 8. ř. 39: § 9. ř. 40: § 10.
- ř. 41 = 37 + … + 40. ř. 42 = tax base. ř. 44 = prior-year loss. ř. 45 = base after loss.
- ř. 46–54: § 15 deductions. Gifts ≥ 2 % or ≥ 1 000 Kč, capped at 30 %. Mortgage interest capped at 300 000 Kč, or 150 000 Kč for housing acquired from 2021. ř. 48–51 together capped at 48 000 Kč.
- ř. 56 = base rounded down to whole hundreds.
- ř. 57: **15 % up to 36× the average wage, 23 % above**. The 2025 threshold is **1 676 052 Kč** [O]. For 2026: 36 × 48 967 = **1 762 812 Kč** [I computed].
- ř. 64: sleva na poplatníka 30 840. ř. 65a/b: spouse. ř. 66–68: disability, ZTP/P. ř. 70: total credits.
- ř. 72–77a: child benefit and bonus (bonus paid only if ≥ 100 Kč).
- ř. 84–91: advances and settlement. ř. 85: advances paid. **ř. 86: flat-tax advances (§ 2a)**. ř. 91 = balance to pay or refund.

**Příloha 1 rows 101–113** [I]: ř. 101 income (§ 7), ř. 102 expenses (actual under § 24, or flat-rate % under § 7(7)), ř. 103 / 104 increasing / decreasing items, ř. 105–112 split to a cooperating person and partner shares, **ř. 113 = partial tax base or loss** → ř. 37. The middle rows were not fetched [?]. Verify them in the form or XSD before implementing.

**Actual vs. flat-rate expenses (§ 7(7) ZDP)** [O rulecalc.com/cs/osvc/vydajove-pausaly + I for the law text]:

| % | Activities | Max expense (= income cap 2 000 000) |
|---|---|---|
| 80 % | agriculture, forestry, **craft trades** (živnosti řemeslné) | 1 600 000 Kč |
| 60 % | other trades (živnosti volné/vázané/koncesované, i.e. free, regulated and licensed trades) | 1 200 000 Kč |
| 40 % | other self-employment: liberal professions, copyright income, experts, interpreters, insolvency administrators | 800 000 Kč |
| 30 % | renting business property (§ 7(7)(d)); § 9 rent uses 30 % too | 600 000 Kč |

Rates are unchanged for 2026 [O rulecalc]. Two interactions with flat-rate expenses (§ 35ca) [I law]: if § 7 and § 9 partial bases with flat-rate expenses exceed **50 % of the total tax base**, the taxpayer **cannot claim the spouse credit (sleva na manžela) or the child benefit (daňové zvýhodnění na děti)**. With flat-rate expenses, social and health insurance and depreciation are already covered by the flat-rate amount and cannot be added on top. Daňová evidence is then limited to income records and receivables [I, § 7b(3)].

### 1.6 Submission methods

[O financnisprava.gov.cz/cs/dane/dane-elektronicky/strucny-prehled; PodatelnaEPO.pdf; Pokyn GFŘ-D-50]

1. **Datová schránka (DS)**: send the XML file (the published format, Pokyn GFŘ-D-50) as an attachment to the financial office's DS. **No electronic signature is needed.** Sending from the taxpayer's own DS authenticates the filing [O and I]. OSVČ have had a DS created automatically since 2023, so they are **obliged to file VAT returns, KH, SH and the DAP electronically** (§ 72(4) daňový řád) [I]. The app can produce the XML. Sending via DS needs the user's ISDS access (ISDS API with the user's credentials or certificate) or a manual upload by the user [I].
2. **EPO web forms / file upload on MOJE daně** (mojedane.gov.cz): load the XML ("načíst soubor"). Then:
   - (a) send with no qualified signature (EPO allows this),
   - (b) sign with the ePodpisFS app,
   - (c) send via DIS+ (Online finanční úřad),
   - (d) verify identity via NIA (Identita občana: eObčanka, bank identity), or
   - (e) save it for sending via DS. [O]
3. **Direct machine submission (EPO interface for software vendors)** [O PodatelnaEPO.pdf]:
   - `POST https://mojedane.gov.cz/dpr/epo_podani`. The raw body is PKCS#7 signedData (v1.5, DER) containing the XML. It must include the signed content and the signer's certificate, with exactly one signature.
   - The signature must be a **qualified electronic signature** from a qualified trust service provider (I.CA, PostSignum, eIdentity). Content-Type is `application/pkcs7-signature` or `application/octet-stream`.
   - Optional parameters: `email`, `test=1` (signature, structural and content checks without filing; a clean run returns a single informational error with code `TEST_REZIM`), `otevriFormular=1` (returns a URL to open the filing in an EPO form, valid 30 minutes).
   - Accepted: a PKCS#7 receipt with `Cislo` (podací číslo), `Datum` and `Heslo`. Large filings are processed offline and return `ID_predani` + `Heslo`; poll `POST https://mojedane.gov.cz/dpr/epo_prijeti` with `C` and `H`.
   - Rejected: XML `<Chyby>` with error types I, S, K, N, P, E.
   - Status: `POST https://mojedane.gov.cz/dpr/epo_stav` with `C` (podací číslo) and `H` (heslo).
   - **Product implication [I]**: true one-click filing needs the user's qualified certificate (or a tax advisor's under a power of attorney). The practical MVP is: generate the XML → validate with `test=1` (requires a qualified signature too) → hand off via `otevriFormular=1` or DS → the user confirms with NIA or DS.
4. **DIS+ (Online finanční úřad)**: login via Identita občana, DS credentials or FS credentials. It can pre-fill and submit EPO filings, and shows the tax account balance [O].

---

## 2. DPHDP3 line mapping (transaction type → row → XML attribute)

Row ↔ attribute links are [O] from popis DPHDP3 for Veta1, Veta2, Veta3 and parts of Veta4. The rest is [I] (standard form layout). "KH" names the matching control-statement section.

```yaml
# rate: 21 = základní (standard), 12 = snížená (reduced)
- {row: 1,  attrs: [obrat23, dan23],          side: out, kind: domestic_supply,                 rate: 21, kh: A4|A5, src: O}
- {row: 2,  attrs: [obrat5,  dan5],           side: out, kind: domestic_supply,                 rate: 12, kh: A4|A5, src: O}
- {row: 3,  attrs: [p_zb23,  dan_pzb23],      side: out, kind: eu_goods_acquisition_§16,        rate: 21, kh: A2, src: O}
- {row: 4,  attrs: [p_zb5,   dan_pzb5],       side: out, kind: eu_goods_acquisition_§16,        rate: 12, kh: A2, src: O}
- {row: 5,  attrs: [p_sl23_e,dan_psl23_e],    side: out, kind: service_from_EU_supplier_§9(1),  rate: 21, kh: A2, src: O,
   examples: [Google Ads (Google Ireland Ltd), Meta ads (Meta Platforms Ireland), EU SaaS without CZ VAT]}
- {row: 6,  attrs: [p_sl5_e, dan_psl5_e],     side: out, kind: service_from_EU_supplier,        rate: 12, kh: A2, src: O}
- {row: 7,  attrs: [dov_zb23,dan_dzb23],      side: out, kind: import_self_assessed_§23,        rate: 21, kh: none?, src: O}
- {row: 8,  attrs: [dov_zb5, dan_dzb5],       side: out, kind: import_self_assessed,            rate: 12, src: O}
- {row: 9,  attrs: [p_dop_nrg,dan_pdop_nrg],  side: out, kind: new_means_of_transport_acq,      kh: A2, src: O}
- {row: 10, attrs: [rez_pren23,dan_rpren23],  side: out, kind: domestic_reverse_charge_recipient_§92a, rate: 21, kh: B1, src: O}
- {row: 11, attrs: [rez_pren5, dan_rpren5],   side: out, kind: domestic_reverse_charge_recipient,     rate: 12, kh: B1, src: O}
- {row: 12, attrs: [p_sl23_z,dan_psl23_z],    side: out, kind: other_§108_from_non_established (e.g. NON-EU service provider: US SaaS/AI APIs; goods with installation), rate: 21, kh: A2, src: O}
- {row: 13, attrs: [p_sl5_z, dan_psl5_z],     side: out, kind: other_§108,                     rate: 12, kh: A2, src: O}
- {row: 14, attrs: [opr_dane_zd, opr_dane_dan], side: out, kind: correction_§42a/§46fa (all rates), src: O}
- {row: 20, attrs: [dod_zb],      kind: eu_goods_supply_§64 (exempt),      shv: k_pln_eu=0, src: O}
- {row: 21, attrs: [pln_sluzby],  kind: service_to_EU_taxable_person_§9(1) (place of supply abroad), shv: k_pln_eu=3, src: O}
- {row: 22, attrs: [pln_vyvoz],   kind: export_§66, src: O}
- {row: 23, attrs: [dod_dop_nrg], kind: new_transport_to_EU_nonregistered, src: O}
- {row: 24, attrs: [pln_zaslani], kind: certain_supplies_OSS_regime, src: O}
- {row: 25, attrs: [pln_rez_pren],kind: domestic_reverse_charge_supplier_§92a, kh: A1, src: O}
- {row: 26, attrs: [pln_ost],     kind: other_supplies_with_deduction_right (e.g. services to NON-EU clients with place of supply abroad, exempt-with-credit), src: O}
- {row: 30, attrs: [tri_pozb],    kind: triangular_acquisition, src: O}
- {row: 31, attrs: [tri_dozb],    kind: triangular_supply, shv: k_pln_eu=2, src: O}
- {row: 32, attrs: [dov_osv],     kind: exempt_import_onward_EU, src: O}
- {row: 33, attrs: [opr_verit],   kind: bad_debt_creditor_correction, src: O}
- {row: 34, attrs: [opr_dluz],    kind: bad_debt_debtor_correction, src: O}
- {row: 40, attrs: [pln23, odp_tuz23_nar, odp_tuz23], side: in, kind: domestic_purchase_from_payer, rate: 21, kh: B2|B3, src: I (attr names O)}
- {row: 41, attrs: [pln5,  odp_tuz5_nar,  odp_tuz5],  side: in, kind: domestic_purchase_from_payer, rate: 12, kh: B2|B3, src: I}
- {row: 42, attrs: [dov_cu, odp_cu_nar, odp_cu],      side: in, kind: import_via_customs (JSD/SAD), src: O(dov_cu)/I}
- {row: 43, attrs: [nar_zdp23, od_zdp23, odkr_zdp23], side: in, kind: deduction_of_self_assessed_rows_3_to_13, rate: 21, src: O}
- {row: 44, attrs: [nar_zdp5,  od_zdp5,  odkr_zdp5],  side: in, kind: deduction_of_self_assessed, rate: 12, src: O/I}
- {row: 45, attrs: [odp_rez_nar, odp_rezim],          kind: correction_§75/77/79+, src: I}
- {row: 46, attrs: [odp_sum_nar, odp_sum_kr],         kind: total_deduction (full / reduced), src: I}
- {row: 47, attrs: [nar_maj, od_maj, odkr_maj],       kind: value_of_acquired_long_term_assets (info), src: O}
- {row: 48, attrs: [kor_odp_zd, kor_odp_plne, kor_odp_krac], kind: §74a_correction_former_payer, src: O}
- {rows: 50-53, attrs: [plnosv_kf, pln_nkf, plnosv_nkf, koef_p20_nov, odp_uprav_kf, koef_p20_vypor, vypor_odp], kind: pro_rata_coefficient (krácení), src: I}
- {row: 60, attrs: [uprav_odp], kind: adjustment_§78, src: I}
- {row: 61, attrs: [dan_vrac],  kind: refund_§84, src: I}
- {row: 62, attrs: [dan_zocelk], kind: output_tax_total, src: I}
- {row: 63, attrs: [odp_zocelk], kind: deduction_total, src: I}
- {row: 64, attrs: [dano_da], kind: own_tax_liability (62-63 > 0), src: I}
- {row: 65, attrs: [dano_no], kind: excess_deduction (refund), src: I}
- {row: 66, attrs: [dano],    kind: difference_vs_last_known_tax (supplementary only), src: I}
```

Notes for code:
- "Self-assessed" purchases (ř. 3–13) are booked twice: the output tax on rows 3–13, and **for a payer** the matching deduction on ř. 43/44. The net effect is zero when there is a full deduction right. **An identified person (IO) books only the output side: no deduction, no ř. 40+** [O Competitor C].
- ř. 62 = sum of output tax on rows 1–13 (+ ř. 14) + ř. 61. ř. 63 = ř. 46 + ř. 52 + ř. 53 + ř. 60 (+ ř. 48). [I. Check against the form's formula notes.]
- Typical OSVČ cases:
  - (a) Invoicing a CZ client: ř. 1, with KH A4 above 10 000 Kč incl. VAT or A5 otherwise.
  - (b) Invoicing an EU business client for services: ř. 21 + SH code 3. The invoice must say "daň odvede zákazník" [I].
  - (c) Invoicing a non-EU client for services: ř. 26.
  - (d) Google or Meta ads from Ireland: ř. 5 + ř. 43, KH A2 (k_stat=IE).
  - (e) OpenAI or Anthropic API invoiced from the US: ř. 12 + ř. 43, KH A2 [I]. Check whether the supplier charges CZ VAT through its own registration; if so, it is a domestic purchase on ř. 40 [?].
  - (f) Domestic purchase with CZ VAT: ř. 40 + KH B2/B3.

---

## 3. Deadlines and frequency rules

### 3.1 VAT (DPH)
- **Registration**:
  - Turnover > **2 000 000 Kč** in a calendar year → payer from 1. 1. of the next year. The person can opt to become a payer from the day after exceeding, if the registration request is filed within 10 working days.
  - Turnover > **2 536 500 Kč** → payer **from the day after exceeding**. Registration request due within 10 working days.
  - Only domestic turnover counts. Rules in force since 1. 1. 2025. [O dauc.cz/predpisy/5839]
- **Period**: monthly by default. **Quarterly** allowed if prior-year turnover ≤ **15 000 000 Kč** (raised from 10 mil.), the payer is not unreliable and not in a VAT group. Choose by putting `kod_zo="Q"` in the last return of the year, filed in January [O businessinfo.cz, 15. 7. 2026]. New payers can switch only from the second calendar year after registration; example: registered November 2024 → quarterly from January 2027 [O businessinfo]. Verify the current § 99a wording [?].
- **VAT return + payment**: by the **25th day after the period**, moved to the next working day if it falls on a weekend or holiday. Quarterly deadlines for 2026: 27. 7., 26. 10. 2026 and 25. 1. 2027 [O businessinfo]. VAT is paid to the FÚ account with prefix 705 and VS = DIČ [I].
- **KH**: see §1.3. Legal persons monthly; FO with their return; due by the 25th.
- **Souhrnné hlášení (SH)**:
  - Due by the 25th after the month, electronic only.
  - Quarterly SH is allowed when the only supplies are services (§ 102) [I].
  - IOs that supply services to EU taxable persons must also file SH [O Competitor C].
  - Since 2025, receiving a prepayment for a sufficiently identified service supplied to another member state triggers IO status and SH [O dauc 5839].
- **Correction windows (since 2025)** [O dauc 5839]:
  - Supplier § 42 correction: up to 7 calendar years after the year of the supply.
  - Right to deduction: by the end of the 2nd calendar year after the year it arose.
  - Former payers (§ 42a / § 74a): via a supplementary return + KH by the end of the following month.

### 3.2 Identified person (identifikovaná osoba, IO): typical for a non-payer OSVČ buying Google or Meta ads
[O Competitor C.cz/almanach/dane/identifikovana-osoba unless noted]
- A non-payer becomes an IO on:
  - **Receiving a service with place of supply in CZ from a foreign person**: Facebook/Google ads, software, hosting, goods with installation. Covers EU and non-EU suppliers [I for non-EU via § 6h].
  - **Supplying a § 9(1) service to a taxable person in another member state** (e.g. marketing for a German company).
  - **Acquiring goods from the EU above 326 000 Kč per calendar year** (excl. VAT).
  - Paying or receiving a prepayment for such a service.
- Registration: electronic application (Přihláška k registraci k DPH) **within 15 days** of the obligation arising. Late registration is retroactive, and back filings come with penalties.
- Filings:
  - DPHDP3 with `typ_platce="I"`, **only for months in which a liability arose**, by the 25th of the following month. IOs are always monthly [I]. Pay the tax by the same date.
  - **No KH. No deduction.**
  - SH for services supplied to EU taxable persons.
- An IO **may still use paušální daň** (IO registration is the stated exception to the VAT-payer exclusion) [O podnikatel.cz/danovy-portal/pausalni-dan].
- App logic: on importing any foreign-supplier invoice without CZ VAT for a non-payer user, raise an IO alert (15-day registration clock), compute ř. 5/12 tax at 21 % from the CZK base, and generate a monthly DPHDP3 (I). Convert at the ČNB rate on the DPPD (or the last rate published before it) [I, § 38].

### 3.3 Income tax (DAP) and advances
- DAP deadlines for tax year 2025 [O finance.cz]:
  - Paper: 1. 4. 2026.
  - Electronic: 4. 5. 2026 (moved because of the holiday and weekend).
  - Tax advisor: 1. 7. 2026.
  - Overviews to ČSSZ: 1. 6. 2026; to health insurers (ZP): 4. 6. 2026. With an advisor, both 3. 8. 2026.
  - Any shortfall paid by 9. 6. 2026 (ČSSZ) and 12. 6. 2026 (ZP).
- Tax year 2026 (filed in 2027) [I computed]:
  - Paper: 1. 4. 2027 (Thu).
  - Electronic: 1. 5. 2027 is a Saturday, so 3. 5. 2027 (Mon).
  - Advisor: 1. 7. 2027 (Thu).
- Flat-tax regime: monthly advance **by the 20th of each month** to the FÚ account with prefix 2866 [O financnisprava + podnikatel.cz]. Entry notice by 10 January (12. 1. 2026 because of the weekend). Exit notice by 10 January of the following year. Changes in conditions reported within 15 days [O podnikatel.cz].
- Social insurance advance: **by the end of the month it is for**. Health insurance advance: **by the 8th of the following month** [O money.cz].

---

## 4. OSVČ specifics 2026

### 4.1 Flat-rate expenses (výdajové paušály)
See §1.5: 80 / 60 / 40 / 30 % with caps of 1.6 M / 1.2 M / 0.8 M / 0.6 M Kč (income cap 2 M Kč), unchanged for 2026 [O rulecalc + I].

### 4.2 Paušální daň (flat-tax regime) 2026
[O podnikatel.cz/danovy-portal/pausalni-dan, podnikatel.cz July-2026 article, Competitor C.cz, dauc.cz, money.cz]

| Band | Income limit (prior year) | Monthly 2026 | Tax | Social (pension) | Health |
|---|---|---|---|---|---|
| I | ≤ 1 M (any activity) · ≤ 1.5 M if ≥ 75 % of income is 60 %/80 % type · ≤ 2 M if ≥ 75 % is 80 % type | **9 162** (was 9 984 until the law change; Jan–Jun overpayment credited in July, so the July 2026 payment was 4 230) | 100 | 5 756 [I = 1.15 × 5 005, rounded up] (was 6 578) | 3 306 |
| II | ≤ 1.5 M any · ≤ 2 M if ≥ 75 % is 60 %/80 % type | **16 745** | 4 963 | 8 191 | 3 591 |
| III | ≤ 2 M | **27 139** | 9 320 | 12 527 | 5 292 |

- The band I cut comes from Act 90/2026 Sb. [O money.cz]. The minimum social assessment base stays at 35 % of the average wage instead of rising to 40 %. It applies retroactively to 1. 1. 2026 [O].
- Entry conditions [O podnikatel.cz]:
  - Not a VAT payer (an IO is OK).
  - Not in insolvency. Not a v.o.s. partner or k.s. general partner.
  - Employment income only from agreements: DPČ ≤ 4 500 Kč/month, DPP ≤ 12 000 Kč/month.
  - Other §§ 8/9/10 income ≤ 50 000 Kč.
- From 2027 (EET law): an optional **"přirážka" of 1 400 Kč/month** on paušální daň, under § 2b / § 38lk. It appears tied to exemption from EET registration [O epravo Sb_2026_180 PDF summary; exact mechanics [?]].

### 4.3 Minimum advances 2026 [O money.cz/novinky-a-tipy/dane/minimalni-zalohy-pro-osvc, Competitor C]
- Average wage for 2026: **48 967 Kč** (NV 365/2025 Sb.).
- **Social insurance (29.2 % of the assessment base; base = 55 % of profit)**:
  - Main activity: **5 005 Kč** (base 17 139 = 35 %). It was 5 720 until 30. 6. 2026; the reduction is retroactive with an offset.
  - Newly started main activity (first 3 years): 3 575 Kč (base 12 242).
  - Secondary activity: **1 574 Kč**, if profit exceeds the threshold (rozhodná částka) of **117 521 Kč**.
- **Health insurance (13.5 %; base = 50 % of profit)**: main activity minimum **3 306 Kč** (base 24 483.50). No minimum for secondary activity alongside employment. No ceiling.
- Maximum social assessment base for 2026: 48 × average wage = 2 350 416 Kč [I computed].
- Minimum wage 2026: 22 400 Kč [O Competitor C].

### 4.4 ČSSZ and health insurer overviews (přehledy): e-filing formats
- **ČSSZ Přehled o příjmech a výdajích OSVČ**: OSVČ with a mandatory DS must file it **in XML only**. Channels:
  - the ePortál ČSSZ form,
  - a DS message to the e-Podání DS (ID `5ffu6xk`) or to the OSSZ's DS,
  - VREP/APEP with a qualified signature.
  
  Software may export XML for import into ePortál ("Načíst tiskopis ze souboru"). [O cssz.gov.cz/zpusoby-elektronickeho-podani-pro-osvc]
- Schema for tax year 2025 [O cssz.gov.cz/definice-e-podani-osvc]:
  - XSD: https://www.cssz.gov.cz/documents/20143/3201321/OSVC25.xsd/5d467add-4c11-0e56-4d54-d455b56c15c9
  - Data record PDF: https://www.cssz.gov.cz/documents/20143/3201321/DV_OSVC25.pdf/cd3fe989-b5e3-1dcf-bfab-895d22f937ff
  - Programmer spec: https://www.cssz.gov.cz/documents/20143/3201321/OSVC25+Zad%C3%A1n%C3%AD+pro+program%C3%A1tory.pdf/6a916774-8f0a-31a0-c914-26d0e545c1ea
  - Sample: https://www.cssz.gov.cz/documents/20143/3201321/OSVC25+vzor.xml/e2a3c68f-e8f1-f701-ede0-30dabb8c4b35
  - Envelope structures: https://www.cssz.gov.cz/documents/20143/99665/web_strXML.htm/876c695a-f5ab-1581-5e02-1fd3c26cc5fa
  - Older years follow the same pattern (OSVC24, OSVC23…).
- Sample root [O]: `<OSVC version="1.0" xmlns="http://schemas.cssz.cz/OSVC2025">` with children `VENDOR` (productName, productVersion), `SENDER` (VerzeProtokolu="1") and `prehledosvc`. `prehledosvc` has attributes `rok`, `typ` (N), `dep` (OSSZ code) and children `client`, `pvv`, `prihldp`, `zal`, `pre`, `prizn`, `opr`, `spo`, `dat`, `prilo`. `client` holds `name`, `birth`, `adr`, `idds`, `email`, `tel`, `druc`, `hlavc`, `vedc`, `narok`, `sleva`.
- Expect an `OSVC26` schema for tax year 2026 around Dec 2026–Jan 2027 [I].
- **Health insurers**: no common XML. VZP takes **PDF via DS (ID `i48ae3q`) and explicitly not XML**; OZP takes PDF via DS or its VITAKARTA portal; insurers also have their own portals (Moje VZP) [O finance.cz, 19. 5. 2026]. → The app should generate a filled **PDF per insurer** (VZP, VoZP, ČPZP, OZP, ZPŠ, ZPMV, RBP) [I].

### 4.5 Tax credits (slevy) and child benefit 2026 [O portal.pohoda.cz 2026 article; XSD for 30 840]
- Basic taxpayer credit (sleva na poplatníka): **30 840 Kč**.
- Spouse credit: 24 840 Kč, if the spouse's income ≤ 68 000 Kč and they care for a child under 3. 49 680 Kč if the spouse holds ZTP/P.
- Disability credit: 2 520 Kč for 1st/2nd degree, 5 040 Kč for 3rd degree. ZTP/P holder: 16 140 Kč.
- Child benefit (daňové zvýhodnění): 15 204 / 22 320 / 27 840 Kč for the 1st / 2nd / 3rd and further child, doubled for a child with ZTP/P. Claiming the bonus requires income ≥ 6 × minimum wage = **134 400 Kč**.
- **Student credit and školkovné: not available in 2026.** They return in **2027** under Act 180/2026 Sb.: student 4 020 Kč (studying, up to age 26, or 28 for full-time PhD); školkovné up to the minimum wage per child [O epravo PDF summary + pohoda].
- **New one-off EET credit (§ 35be, from 2027)**: 5 000 Kč, or 15 % of the § 7 partial base minus the basic credit if that is lower; 0 if negative. Claimed in the first period in which the taxpayer records sales under EET [O epravo PDF summary].

---

## 5. Bookkeeping legal requirements (daňová evidence, VAT records)

### 5.1 Daňová evidence (§ 7b ZDP) [I law text, not re-fetched]
- Must contain: (a) **income and expenses**, split as needed to determine the tax base; (b) **assets and liabilities**: tangible assets, inventory, cash and bank, receivables, payables, reserves. The year-end summary of (b) feeds DAP VetaU [I].
- With flat-rate expenses: only **income records + receivables** arising from the activity (§ 7b(5)) [I]. Paušální daň users need no daňová evidence for tax purposes, but VAT and IO records remain [I].
- Retention: the law sets no fixed period for daňová evidence. Keep it for the **period for assessing tax** (§ 148 daňový řád: 3 years from the DAP deadline, extendable up to 10 years), and longer for tax losses carried forward (§ 38r ZDP) [I].
- Accounting entities (zákon o účetnictví § 31): accounting records 5 years, financial statements 10 years [I].
- Recommended app default: keep everything 10 years + the current year [I].

### 5.2 VAT documents and records (zákon 235/2004 Sb.) [I law text; zakonyprolidi.cz could not be fetched]
- Invoice due **within 15 days** of DUZP or of receiving a prepayment (§ 28(5)).
- **Full tax document (§ 29(1))** must contain:
  - supplier identification and **DIČ**, customer identification and **DIČ**;
  - evidenční číslo (document number);
  - scope and subject of the supply;
  - issue date;
  - DUZP or payment date, if it differs from the issue date;
  - unit price excl. VAT and any discount;
  - tax base, rate, and **VAT amount in CZK**.
- **Mandatory phrases (§ 29(2))**:
  - "osvobozeno od daně" (exempt) with the legal reason;
  - **"daň odvede zákazník"** (reverse charge and EU services);
  - "vlastní fakturace" (self-billing);
  - "zvláštní režim – cestovní služby" (travel margin scheme);
  - "zvláštní režim – použité zboží / umělecká díla / sběratelské předměty a starožitnosti" (margin scheme for used goods, art, collectibles and antiques).
  
  For a triangular-trade intermediary, "daň odvede zákazník" has been a substantive condition since 2025 [O dauc 5839].
- **Simplified tax document (zjednodušený daňový doklad, § 30)**: allowed when the total is **≤ 10 000 Kč incl. VAT**. It may omit the customer's identification, and the VAT amount may be replaced by the rate. Not allowed for supplies to other member states, reverse charge, or supplies where the recipient self-assesses [I]. In KH such documents go to A5/B3 [O methodology].
- Electronic documents (§ 26, § 34): need the customer's consent; authenticity of origin, integrity of content and legibility must be ensured for the whole retention period, e.g. by a qualified seal or signature, EDI, or reliable audit trail [I].
- **Retention (§ 35)**: tax documents and VAT records **10 years** from the end of the period in which the supply took place [I; matches the brief].
- VAT records (§ 100): payers and IOs keep records in the detail needed for the return, KH and SH [I].

### 5.3 Cash payment limits
- Czech limit: **270 000 Kč per day** per counterparty (Act 254/2004 Sb.) [O arecenze.cz headline + I].
- EU **AMLR, Regulation (EU) 2024/1624, Art. 80**: traders may not accept or make cash payments **above €10 000** for goods or services **from 10. 7. 2027**. Linked payments split to get under the cap count as one. Member states may keep lower limits. Customer due diligence for occasional cash transactions **≥ €3 000** applies to obliged entities. [O podnikajte.sk]
- [I] At ~25 Kč/€, €10 000 ≈ 250 000 Kč, which is below the Czech 270 000. The app should apply min(national, EU) from 10. 7. 2027 and warn on the cumulative daily total per counterparty.

---

## 6. 2026 reforms and upcoming changes

1. **VAT rates**: 21 % and 12 % since 1. 1. 2024. The structures still carry the 3rd rate only for pre-2024 DPPD [O].
2. **Minimum social insurance base frozen at 35 %** (Act 90/2026 Sb., effective July 2026, retroactive to 1. 1. 2026). Minimum advance 5 005 Kč, paušální daň band I 9 162 Kč [O money.cz, podnikatel.cz].
3. **EET 2.0: Act 180/2026 Sb.** "o evidenci tržeb a o změně některých dalších zákonů" (on sales records, amending certain other acts) [O pravniprostor.cz, businessinfo.cz, epravo PDF].
   - Timeline: published 7. 10. 2026. Mostly in force **1. 1. 2027**; parts from the day after publication; procedures under §§ 14, 15, 18 from **1. 11. 2026** at the earliest.
   - Scope: **contact payments only** (cash, card, QR or similar paid in person at a business unit). Bank transfers and paid invoices are out of scope.
   - Mechanics: data sent as XML authenticated with a certificate; response timeout 2 s, otherwise send within 48 h.
   - Free FS web or mobile app for the smallest businesses. No mandatory receipt printer.
   - Exemptions include flat-tax payers who opt for the 1 400 Kč přirážka, ZTP holders and others.
   - Same act, ZDP changes (from 2027):
     - student and školkovné credits return;
     - EET credit 5 000 Kč;
     - holiday/recreation benefit exemption 20 000 Kč;
     - tips exempt up to 7 % of revenue [O businessinfo];
     - **§ 38g DAP-filing thresholds raised to 100 000 / 40 000 Kč** [O epravo summary; verify exact meaning [?]].
   - Same act, VAT changes:
     - drinking water and selected non-alcoholic drinks move between annexes 2/3, so **non-alcoholic drinks in catering go to 12 %** [O businessinfo; the annex change is O, the rate effect is I];
     - **§ 46 bad debt: limit raised from 10 000 to 20 000 Kč, waiting period shortened from 6 to 3 months** [O epravo summary];
     - § 77a repealed.
   - Product impact: a cash/card-taking OSVČ needs EET integration from 2027. Track the FS technical spec (XML schema, certificates) expected around Nov 2026 [I].
4. **2025 VAT reform** (already in force): new registration thresholds, 15 M Kč quarterly limit, SME cross-border scheme (EU turnover cap €100 000, EX ID; EPO structures SMEREG/SMEZMR exist), longer correction windows, new triangular-trade wording [O dauc 5839, popis list].
5. **E-invoicing / ViDA**: Directive adopted in 2025. Mandatory structured e-invoicing + digital reporting for **intra-EU B2B from 1. 7. 2030** (EN 16931). Member states may mandate domestic e-invoicing earlier [O epravo 3/2025]. **Czechia has no domestic B2B mandate "on the agenda"** as of 22. 7. 2026 [O portal.pohoda.cz]. Expect the KH to be replaced or reshaped by ViDA-style DRR after 2030, but that is speculation [O epravo author's prediction]. Slovakia mandates e-invoicing (Peppol) from 1. 1. 2027 [O pohoda]. That matters for CZ OSVČ with SK clients [I]. Formats: ISDOC is Czech-specific and not used on Peppol; Peppol BIS Billing 3.0 / EN 16931 is the EU path; public contracting authorities have had to accept EN 16931 since 2019 [O pohoda]. → Store invoices internally in an EN 16931-compatible model and export ISDOC + UBL/Peppol [I].
6. **KH**: no structural change found for 2026. DPHKH1 popis was re-versioned (03.01.15, 11. 8. 2026), most likely code lists [O version / I reason]. **Re-download the XSD.**
7. **Income tax structures**: DPFDP7 is still current for tax year 2025. Watch the popis list for a tax-year-2026 update, which is likely because the EET act changes credits from 2027 [I/?].
8. **CESOP (DPHOC1), DAC7 (DA7*)**: not OSVČ filings, but DAC7 platform reporting (Airbnb, marketplaces) means FS receives sellers' platform income. Reconcile it in the app [I].

---

## 7. Implementation checklist (derived)

- [ ] Codegen models from the four XSDs (DPHDP3, DPHKH1, DPHSHV, DPFDP7) and the ČSSZ OSVC25 XSD. Pin versions per period.
- [ ] Transaction classifier → `{dphdp3_row, kh_section, shv_code}` using §2 + §1.3.1. Unit tests for the 10 000 Kč incl.-VAT boundary (> vs ≤), absolute value for corrections, B2C → A5, missing DIČ → A5.
- [ ] Reconciliation KH Věta C ↔ DPHDP3 (table in §1.3).
- [ ] Date serializer `DD.MM.YYYY`. DIČ serializer: digits only, no country prefix. Amounts: whole Kč in DPHDP3, 2 decimals in KH.
- [ ] IO detector for non-payers (foreign invoices) → registration alert + monthly DPHDP3 `typ_platce=I`, no KH.
- [ ] Deadline engine: 25th rule with weekend and holiday shift; KH N filing within 5 working days; paušál 20th; social end of month; health 8th; DAP 1. 4. / ~1. 5. / 1. 7.; přehledy +1 month.
- [ ] Submission: `test=1` dry-run (needs a qualified signature), `otevriFormular=1` handoff into EPO, export for DS. Store podací číslo + heslo and poll `epo_stav`.
- [ ] 2027 backlog: EET 2.0, new credits (student, školkovné, EET), § 46 thresholds, nealko 12 %, AMLR €10 000 cash limit from 10. 7. 2027.

---

## Sources

- KH XML: https://financnisprava.gov.cz/cs/dane/dane/dan-z-pridane-hodnoty/kontrolni-hlaseni-dph/struktura-pro-podani-kontrolniho-hlaseni-xml
- KH deadlines: https://financnisprava.gov.cz/cs/dane/dane/dan-z-pridane-hodnoty/kontrolni-hlaseni-dph/kdy
- KH penalties: https://financnisprava.gov.cz/cs/dane/dane/dan-z-pridane-hodnoty/kontrolni-hlaseni-dph/sankce
- KH files and methodology: https://financnisprava.gov.cz/cs/dane/dane/dan-z-pridane-hodnoty/kontrolni-hlaseni-dph/soubory-ke-stazeni
- EPO popis list and details: https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_seznam.faces (+ `…detail.faces?zkratka=DPHDP3|DPHKH1|DPHSHV|DPFDP7`)
- XSDs: https://adisspr.mfcr.cz/adis/jepo/schema/dphkh1_epo2.xsd, …/dphdp3_epo2.xsd, …/dpfdp7_epo2.xsd, …/dphshv_epo2.xsd
- EPO interface: https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/PodatelnaEPO.pdf
- Electronic filing overview: https://financnisprava.gov.cz/cs/dane/dane-elektronicky/strucny-prehled
- Pokyn GFŘ-D-50: https://www.dauc.cz/predpisy/971/gfr-d-50
- DAP instructions 2025: https://adisspr.mfcr.cz/dpr/adis/idpr_pub/dpf/dp7/doc/pokyny_dap_2025.pdf
- VAT changes 2025 (GFŘ information): https://www.dauc.cz/predpisy/5839/82973-24-7100-30116-051722
- Quarterly VAT: https://www.businessinfo.cz/clanky/ctvrtletni-nebo-mesicni-platce-dph-co-se-zmenilo-a-kde-hledat-vyhody/
- Identified person: https://www.Competitor C.cz/almanach/dane/identifikovana-osoba
- Paušální daň (flat-tax regime): https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/pausalni-dan/informace-k-institutu-pausalni-dane-pro-rok-2025 · https://www.podnikatel.cz/danovy-portal/pausalni-dan/ · https://www.podnikatel.cz/clanky/jste-v-prvnim-pasmu-pausalni-dane-osvc-nezapomente-v-cervenci-zaplatit-jen-4230-kc/ · https://www.dauc.cz/tabulky/104/platby-fyzicke-osoby-v-pausalnim-rezimu
- Rates and advances: https://www.Competitor C.cz/almanach/dane/sazby-zalohy-dane · https://money.cz/novinky-a-tipy/dane/minimalni-zalohy-pro-osvc/
- Flat-rate expenses: https://rulecalc.com/cs/osvc/vydajove-pausaly · https://www.Competitor D.cz/?p=20797
- Credits 2026: https://portal.pohoda.cz/dane-ucetnictvi-mzdy/mzdy-a-prace/danove-zvyhodneni-na-deti-a-slevy-na-dani-v-roce-2026/
- ČSSZ: https://www.cssz.gov.cz/zpusoby-elektronickeho-podani-pro-osvc · https://www.cssz.gov.cz/definice-e-podani-osvc
- Overviews to insurers: https://www.finance.cz/clanky/podavate-prehledy-datovou-schrankou-pojistovny-vyzaduji-pdf-cssz-chce-xml/
- EET 2.0: https://www.businessinfo.cz/clanky/snemovna-schvalila-eet-2-0-moderni-evidence-trzeb-miri-do-senatu/ · https://pravniprostor.cz/zmeny-v-legislative/z-legislativniho-procesu/schvaleni-eet-2-0-sluzebniho-zakona-a-novely-stavebniho-zakona · https://www.businessinfo.cz/clanky/pravni-predpisy-a-smlouvy-ve-sbirce-zakonu-cr-41-tyden-2026-predpisy-c-180-182/ · https://www.epravo.cz/_dataPublic/sbirky/2026/Sb_2026_180_PZZ.pdf
- AMLR cash limit: https://www.podnikajte.sk/europska-legislativa/obmedzenie-platieb-v-hotovosti-od-10-7-2027-limit-eu
- E-invoicing: https://www.epravo.cz/top/clanky/e-invoicing-ve-svetle-smernice-vida-a-narodnich-uprav-119279.html · https://portal.pohoda.cz/?p=43234
