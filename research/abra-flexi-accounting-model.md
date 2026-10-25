# ABRA Flexi: how a Czech accounting system models the data

Researched 17 Oct 2026 for Digital Shoebox (OSVČ / small-business bookkeeping and tax). Only public sources were used: the ABRA Flexi REST API docs and help centre (podpora.flexibee.eu, which is also served as intercom.help/podpora-flexi), the public sample XML files on flexibee.eu, and a public open-source mirror of the `/properties` metadata. Nothing was logged into, and nothing was written to any server.

**Labels:** **[O]** observed in the source given, **[I]** our inference, **[?]** unknown or not confirmed.

## 0. Sources and how far to trust them

| Key | Source | Notes |
|---|---|---|
| `EL` | https://demo.flexibee.eu/c/demo/evidence-list | Read once. Later requests to `demo.flexibee.eu` (`/properties`, data `.json`) were refused by robots.txt, so no demo data was read. |
| `P:<evidence>` | `https://raw.githubusercontent.com/Spoje-NET/php-abraflexi/main/static/Properties.<evidence>.json` | Static copies of Flexi's `/properties` output, shipped with the public `php-abraflexi` library. They hold field key, title, type and enum values. The Flexi version of the snapshot is unknown **[?]**, but they include post-2024 fields such as `datSazbyDph` and `sumZklSniz2`. |
| `EV` | `.../static/EvidenceList.json` (same repo) | Full list of evidence paths and their names. |
| `X:<file>` | `https://www.flexibee.eu/api/doc/priklady-xml/<file>` | Official sample XML. It is from 2009 (19 % / 9 % VAT) but shows real values, e.g. `clenDph=code:40-41`. |
| `A:<id>` | `https://podpora.flexibee.eu/cs/articles/<id>` | REST API and help articles. |

Key articles used: 4725983 (VAT calculation), 4725798 (identifiers), 4729375 (payment pairing), 3422285 (automatic pairing), 3853613 (advanced pairing), 5487205 (VAT return API), 8730769 (KH API), 8650919 (SH API), 4953979 (saved VAT return rows), 4569603 (Řádky přiznání DPH), 4585915 (Kontrolní hlášení), 3421226 (reverse charge), 6707949 (ISDOC import), 7435407 (daňová evidence recalculation), 4585089 (accounting outputs), 3638530 (chart of accounts and accounting rules), 4722195 (filters), 4725908 (incremental update), 4725944 (create/update modes), 4726125 (transactions), 4720123 (dry-run), 4744362 (Changes API), 4729204 (exchange rates), 5792983 (rounding), 4744457 (credit notes), 4729399 (cash payment), 12698184 (unpaid > 6 months), 4719998 (formats), 4722190 (detail levels), 3422310 (pairing method via `vazby`), 4731153 (bank statements).

---

## 1. Architecture in one picture

```
              ┌─────────── číselníky (code lists) ───────────┐
 nastaveni    │ mena, kurz, sazba-dph, stat, stat-dph          │
 (company     │ cleneni-dph (VAT return rows)                  │
  settings,   │ cleneni-kontrolni-hlaseni (KH rows)            │
  typOrg.)    │ predpis-zauctovani (accounting rule / DE cat.) │
              │ ucet (chart of accounts, only in double-entry) │
              │ stredisko, zakazka, cinnost (analytic tags)    │
              │ rada + rocni-rada (number series per year)     │
              │ typ-faktury-*, typ-banka, typ-pokladni-pohyb … │
              └───────────────┬───────────────────────────────┘
                              │ defaults flow: type → header → line
   ┌──────────────────────────▼───────────────────────────────┐
   │ documents ("doklady"), one shared header shape:          │
   │ faktura-vydana, faktura-prijata, banka, pokladni-pohyb,  │
   │ interni-doklad, pohledavka, zavazek, uplatneni-dane-…    │
   │   └─ polozky* (lines: one VAT rate, accounts, tags)      │
   └──────────────┬──────────────────────────┬────────────────┘
                  │ vazba (typed links)      │ derived / read-only
                  ▼                          ▼
   pairing payment↔invoice,         podklady-dph, kontrolni-hlaseni-dph,
   credit note, advances, FX diffs   souhrnne-hlaseni-dph, ucetni-denik,
                                     saldo, danova-evidence → XML (EPO) / PDF
```

- **[O]** Every money document shares one header vocabulary: dates `datVyst/duzpPuv/duzpUcto/datUcto`, VAT sums `sum*`, partner snapshot `nazFirmy/ic/dic/ulice…`, and classification `typDokl/typUcOp/clenDph/clenKonVykDph/stredisko/zakazka/cinnost`. Compare `P:faktura-prijata`, `P:banka`, `P:pokladni-pohyb` and `P:interni-doklad`.
- **[O]** Lines (`*-polozka`) repeat the classification fields with `kop*` flags that say whether the line copies a value from the header: `kopClenDph`, `kopStred`, `kopZakazku`, `kopTypUcOp`, `kopClenKonVykDph`, `kopDatUcto` (`P:faktura-prijata-polozka`).
- **[O]** VAT outputs are generated from documents. They are not edited by hand: `podklady-dph` → `priznani-dph` / `kontrolni-hlaseni` / `souhrnne-hlaseni`, and generated returns can be saved to `ulozene-priznani-dph` and `radek-priznani-dph` (`EV`, `A:5487205`, `A:4953979`).

## 2. Core evidences and key fields

All the evidence names below are **[O]** in `EL`/`EV`. Two names in the brief are wrong: the VAT rows are **`cleneni-dph`** (not `clenen-dph`), and the chart of accounts is **`ucet`** (there is no `uctovy-rozvrh`) [O `EL`].

### 2.1 Common header fields on documents (`faktura-prijata`, 153+ fields) [O `P:faktura-prijata`]

| Field | Type | Meaning |
|---|---|---|
| `id`, `kod`, `uuid`, `external-ids`, `source` | int / str / rel | Internal ID, internal number (`kod`, e.g. `PF0004/2009`), UUID, external IDs, source system |
| `cisDosle` | str | Supplier's own invoice number ("číslo došlé"). It goes to KH as the evidenční číslo dokladu. |
| `varSym`, `specSym`, `konSym` (relation) | str | Payment symbols. `varSym` is pre-filled from `cisDosle` with the non-digits removed [O help 4611404]. |
| `datVyst` | date | For a received invoice this is the receipt date ("Přijato"); for an issued one, the issue date |
| `duzpPuv` | date | **DUZP as stated on the document** ("Datum zdaň. plnění") |
| `duzpUcto` | date | **Date the VAT is claimed** ("Uplatnit zdaň. plnění"). It drives the VAT period for received documents. |
| `datUcto` | date | Accounting date ("Datum zaúčtování"). It drives the accounting/DE period. |
| `datSazbyDph` | date | Date that decides which VAT rate table applies |
| `datSplat`, `datUhr` | date | Due date, payment date |
| `sumOsv`, `sumZklZakl`, `sumZklSniz`, `sumZklSniz2`, `sumZklCelkem` | num | Bases: exempt/0 %, standard, reduced, 2nd reduced, total (CZK) |
| `sumDphZakl`, `sumDphSniz`, `sumDphSniz2`, `sumDphCelkem` | num | VAT per rate and total (CZK) |
| `sumCelkZakl`, `sumCelkSniz`, `sumCelkSniz2`, `sumCelkem` | num | Gross per rate and grand total (CZK) |
| `…Men` variants (e.g. `sumZklZaklMen`) | num | The same amounts in document currency |
| `szbDphZakl`, `szbDphSniz`, `szbDphSniz2` | num | Rate percentages used (writable) |
| `sazbaDphZakl/Sniz/Sniz2/Osv` | rel | Links to `sazba-dph` rows (read-only) [O `A:4725983`] |
| `mena`, `kurz`, `kurzMnozstvi` | rel/num | Currency, rate, rate quantity |
| `bezPolozek` | bool | Document has no lines (header amounts only) |
| `ucetni` | bool | Document affects the books ("Doklad je účetní") |
| `zuctovano` | bool | Posting state |
| `typDokl` | rel | Document type (`typ-faktury-prijate`). It supplies the defaults. |
| `typUcOp` | rel | **Předpis zaúčtování** (accounting rule) |
| `primUcet`, `protiUcet` | rel | Main and counter account. On a received invoice `primUcet` = "Účet DAL" (e.g. `321001`) and `protiUcet` = "Účet MD" (e.g. `501001`) [O `X:faktura-prijata-full.xml`]. On an issued invoice the sides are reversed: `primUcet` = MD, `protiUcet` = DAL [O `P:faktura-vydana`]. |
| `dphZaklUcet`, `dphSnizUcet`, `dphSniz2Ucet` | rel | VAT accounts (e.g. `343019`, `343009`) |
| `clenDph` | rel | **VAT return row code** (`cleneni-dph`), e.g. `code:40-41` |
| `clenKonVykDph` | rel | **KH row** (`cleneni-kontrolni-hlaseni`) |
| `statDph`, `uzpTuzemsko` | rel/bool | VAT country; place of supply is domestic |
| `stredisko`, `zakazka`, `cinnost` | rel | Analytic dimensions |
| `firma` + snapshot `nazFirmy, ulice, mesto, psc, ic, dic` | rel+str | Partner link plus a frozen copy of the partner's details on the document |
| `buc`, `iban`, `bic`, `smerKod`, `banSpojDod`, `bankovniUcet` | str/rel | Supplier's account / our account |
| `rada` | rel | Number series |
| `juhSum`, `zbyvaUhradit`, `stavUhrK`, `sumZalohy`, `stavOdpocetK` | num/enum | Paid so far, remaining, payment state, advances |
| `zamekK` | enum | Lock state |
| `storno`, `dobropisovano`, `vyloucitSaldo` | bool | Cancelled, credited, excluded from saldo |

Enums [O `P:faktura-prijata`]:
- `stavUhrK`: `stavUhr.castUhr` (partially paid), `stavUhr.uhrazeno` (paid), `stavUhr.uhrazenoRucne` (paid, marked manually)
- `zamekK`: `zamek.otevreno`, `zamek.prohlednuto`, `zamek.polozamceno` (locked except for the accountant), `zamek.zamceno`
- `stavOdpocetK`: `stavOdp.cast`, `stavOdp.komplet`, `stavOdp.vytvZdd`
- `stavUzivK` (payment-order state): `stavUziv.bezPrikazu`, `obsaPrikaz`, `castPrikaz`, `celPrikaz`, `nactenoEl`, `nactenoElPosledni`, `genKasa`, `zauctovano`, `zaucZmena`

Extra fields on **issued invoices and cash documents** [O `P:faktura-vydana`, `P:pokladni-pohyb`]:
- Rounding: `zaokrJakSumK`/`zaokrJakDphK` ∈ `zaokrJak.nahoru|dolu|matem`; `zaokrNaSumK`/`zaokrNaDphK` ∈ `zaokrNa.zadne|tisiciny|setiny|5setiny|desetiny|5desetiny|jednotky|5jednotky|desitky|stovky|tisice`; `metodaZaokrDoklK` ∈ `metodaZaokr.zklDph` (into base and VAT), `metodaZaokr.0sazba` (as a 0 % line), `metodaZaokr.individ`; `vytvaretKorPol` (VAT correction line).
- Billing address: `faNazev`, `faUlice`, `faMesto`, `faPsc`, `faStat`; texts `uvodTxt`, `zavTxt`.

### 2.2 Lines: `faktura-prijata-polozka` (106 fields) [O `P:faktura-prijata-polozka`]

| Field | Meaning |
|---|---|
| `typPolozkyK` | `typPolozky.obecny` (price × qty), `katalog` (from price list), `ucetni` (amount-only posting line), `text`, `odpocetZdd`, `odpocetZalohy`, `dorovnaniTuz`, `korekceTuz` |
| `nazev`, `kod`, `eanKod`, `mnozMj`, `mj`, `cenaMj`, `slevaPol`, `cisRad` | Description, quantity, unit price, discount, order |
| `typCenyDphK` | `typCeny.bezDph` / `typCeny.sDph`: whether `cenaMj` is net or gross |
| `typSzbDphK` | `typSzbDph.dphZakl`, `dphSniz`, `dphSniz2`, `dphOsv` |
| `szbDph` | Rate % |
| `sumZkl`, `sumDph`, `sumCelkem` (+`Men`) | Line base, VAT, gross |
| `zklMdUcet`, `zklDalUcet`, `dphMdUcet`, `dphDalUcet` | Line postings (MD/DAL for base and VAT) |
| `typUcOp`, `clenDph`, `clenKonVykDph`, `stredisko`, `zakazka`, `cinnost`, `datUcto` | Classification that can differ per line (`kop*` = false) |
| `dphPren` | **Reverse-charge commodity code** ("Kód přenesení DPH"), links to `preneseni-dph` |
| `cenik`, `sklad` | Price-list item, warehouse |
| `doklFak` | Parent document |
| `zaokrJakK`, `zaokrNaK` | Line rounding |

**[O]** The 2009 sample is a single-line invoice: `typPolozky.ucetni`, `sumZkl=193269`, `sumDph=36731`, `clenDph=code:40-41`, `zklMdUcet=501001`, `zklDalUcet=321001`, `dphMdUcet=343019` (`X:faktura-prijata-full.xml`). Most received invoices are booked as one or a few `ucetni` lines per VAT rate, not with item detail [O help 4611404: "Received invoices typically have no line items"].

### 2.3 `banka` (bank movement) [O `P:banka`, `X:banka-full.xml`]

Same header as an invoice, plus:
- `typPohybuK` = `typPohybu.prijem` | `typPohybu.vydej` (incoming/outgoing)
- `banka`: our bank account (`bankovni-ucet`). `buc`, `smerKod`, `iban`, `bic`: the counterparty account.
- `cisSouhrnne`: statement number ("Čís. výpisu"). `vypisCisDokl`: the bank's transaction ID.
- `varSym`, `specSym`, `konSym`: symbols used for pairing
- `sparovano` (paired), `zapocet` (netting)
- `jakUhrK` (how the pairing was made): `jakUhrazeno.rucne1`, `rucneN`, `rucneCast`, `autoVs`, `autoVsRuzneMeny`, `autoBezVs` (by amount), `autoBuc` (by account), `autoZak` (by customer number), `autoKod` (by internal doc number)
- `primUcet` = bank account (e.g. `221001`), `protiUcet` = counter account (e.g. `311001`), `clenDph` (e.g. `code:01-02`), and line `clenDph=code:000U` (no VAT effect) in the sample
- `menaAlt`, `sumCelkemAlt` (alternative currency)

**[O]** A bank movement can carry VAT itself, for a direct expense with no invoice: it has the full `sum*` set.

### 2.4 `pokladni-pohyb` (cash) [O `P:pokladni-pohyb`]
This has the same shape as `banka`, with `pokladna` instead of `banka`, plus `typPohybuK`, `jakUhrK`, `sparovano`, rounding fields and `cisSouhrnne`. It has no due date or bank fields. **[O]** There is no EET field on the document (EET settings live in `nastaveni`: `eetTypK`, `eetModK`).

### 2.5 `interni-doklad` (internal document) [O `P:interni-doklad`]
A generic posting document (accruals, FX differences, corrections, VAT self-assessment). It has the same `sum*`, `clenDph` and `clenKonVykDph` fields, the accounts `primUcet` ("Účet základu MD"), `protiUcet` ("Účet základu Dal") and `dphZaklUcet` / `dphSnizUcet`, plus `precenenaBanPok` (revalued bank or cash account) and `sparovano`. It has no `duzpUcto` [O]: internal documents use `duzpPuv` and `datUcto` only.

### 2.6 `adresar` (partners) [O `P:adresar`]
`kod`, `nazev`, `ulice`, `mesto`, `psc`, `stat`, `ic`, `dic`, `vatId` ("IČ DPH", SK), `platceDph`, `nespolehlivyPlatce` (unreliable VAT payer flag), `email`, `tel`, `splatDny`, `limitFak`, `formaUhradyCis`, `skupFir`, `stredisko`, a separate billing address (`fa*`), `isdocPrilohaMailuK` (`isdocPrilohaMailu.podleTypDokl|ano|ne`), and `typVztahuK` (`typVztahu.odberDodav|odberatel|dodavatel|vyrobce|socialka|zdravotka|financniUrad|vyrobna|vsechno`). Note that the social security office, health insurer and tax office are partners too.
Bank accounts are in a separate evidence, `adresar-bankovni-ucet` [O `EV`]. ARES refresh is available via the API [O article list "Aktualizace firem z ARES přes API"].

### 2.7 `cenik` (price list) [O `P:cenik`]
`kod`, `nazev`, `eanKod`, `typZasobyK` (mandatory: `typZasoby.zbozi|material|nedvyroba|polotovar|vyrobek|zvire|sluzba|poplatek`), `typSzbDphK`, `typCenyDphK`, `cenaZakl`, `nakupCena`, `mj1`, `skupZboz`, `dphPren`, `skladove`. For an OSVČ this mostly matters as an item catalogue for issued invoices.

### 2.8 `predpis-zauctovani` (předkontace / accounting rule) [O `P:predpis-zauctovani`]

| Field | Meaning |
|---|---|
| `kod`, `nazev`, `popis` | Code and name (e.g. "Nákup služby") |
| `ucetObdobiOd`, `ucetObdobiDo` | Valid from/to accounting period |
| `modulFav`, `modulFap`, `modulPhl`, `modulZav`, `modulTxz`, `modulBanP`, `modulBanV`, `modulPokP`, `modulPokV`, `modulSklP`, `modulSklV`, `modulInt` | Flags for which modules and directions may use the rule |
| `kodPlneniK` | **VAT supply code**; Flexi derives `clenDph` from it (§2.9) |
| `protiUcetPrijem` (DAL), `protiUcetVydej` (MD) | Counter accounts for incoming/outgoing |
| `dphZaklUcet`, `dphSnizUcet`, `dphSniz2Ucet` | VAT accounts |

`kodPlneniK` values [O]: `kodPlneni.bezVlivu` (no VAT effect), `zbozi`, `doprProstr`, `majetek`, `tristran`, `sluzby`, `osv` (exempt), `prenDanPov` (reverse charge), `prenDanPovOprava`, `ostatni`, `nespec`, `sluzbyMOSS`, `sluzbyOSS`, `zboziOSS`, `mimoEuOSS`, `dovozOSS`, `oprava`, `knihy`, `neuhrazeneFak`.

**[O]** In **daňová evidence** mode (organization type "Podnikatelé – daňová evidence") the "accounts are replaced by předpisy zaúčtování" (`A:3638530`). The DE report "Výkaz daňové evidence" is "a summary report by předpis zaúčtování" and includes items that passed through the **Peníze** module (bank + cash) (`A:4585089`). So **a předpis is the DE income/expense category** [I strong].

### 2.9 `cleneni-dph` (VAT return rows) [O `P:cleneni-dph`, `A:4569603`]

| Field | Meaning |
|---|---|
| `kod` (≤20 chars) | **Encodes the DPHDP3 rows and columns** the amount goes to |
| `nazev` | Description |
| `typPlneniK` | `typPlneni.prijata`, `uskutecnena`, `prijataRCH`, `uskutecnenaRCH`, `obojiRCH` |
| `typObchoduK` | `typObchodu.tuzem`, `EUplatce`, `EUneplat`, `cizina` |
| `kodPlneniK` | `kodPlneni.zbozi`, `doprProstr`, `majetek`, `tristran`, `sluzby`, `osv`, `prenDanPov`, `prenDanPovOprava`, `sluzbyMOSS`, `sluzbyOSS`, `zboziOSS`, `mimoEuOSS`, `dovozOSS`, `oprava`, `knihy`, `neuhrazeneFak` |
| `kodPlneniSH` | Supply code used for souhrnné hlášení |
| `jeDph` | Counted in the return (yes/no) |
| `platiOd`, `platiDo`, `stat`, `poradi` | Validity, country, order |

The code grammar [O `A:4569603`]:
- `9`, `10`, `20`: a single row.
- `01-02`, `03-04`, `40-41`: the row is chosen by rate (standard/reduced pair).
- `09,44,48`: the amount goes to several rows.
- Suffixes: `PM` (asset transfer, Intrastat), `P`/`D` on row 30 (VAT only, "Pořízení" or "Dodání" column), `KR` (reduced-coefficient deduction column), `SN`/`BN` (with or without deduction right). No suffix means the "V plné výši" (full amount) column.
- `000P` (received) and `0004` (issued): no VAT effect, excluded from the return. The 2009 bank sample uses `000U` [O `X:banka-full.xml`]. The KH help also mentions `000P`/`000U` [O `A:4585915`].

Rows observed in the sources:

| Code | Use |
|---|---|
| `01-02` | Domestic issued supply, output VAT at standard/reduced rate (DPHDP3 rows 1/2) [O sample, I mapping] |
| `40-41` | Domestic received supply, deduction at standard/reduced rate [O sample + `A:3421226`] |
| `25` | Issued reverse charge (supplier side) [O `A:3421226`] |
| `10-11`, `43-44` | Received reverse charge: output VAT in rows 10/11 and deduction in 43/44 [O `A:3421226`] |

**[O]** The user does not pick `clenDph` on an invoice. They pick the předpis; Flexi fills `clenDph` from `kodPlneniK` plus partner VAT status plus domestic/foreign. It "cannot be preset directly on the invoice like KH rows" (`A:4569603`). **[?]** The full list of codes was not readable, because the demo data was blocked.

### 2.10 `cleneni-kontrolni-hlaseni` (KH rows) [O `P:cleneni-kontrolni-hlaseni`, `A:4585915`]
Fields: `kod`, `nazev`, `typPohybuK` (`typPohybu.prijem|vydej`), `vyplnCisKod`, `vyplnDruh` (whether the goods code/type must be filled in, for A.1/B.1 §92a), `kodTransakce` (XML sentence), `platiOd/Do`, `stat`.

KH row codes from the help [O `A:4585915`]:

| Code | Section | Rule |
|---|---|---|
| `A.1.` | A.1 | Issued, reverse charge §92a |
| `A.2.` | A.2 | Received where the recipient self-assesses: EU acquisitions, services from abroad (§108/1 b,c,d) |
| `A.3.` | A.3 | Investment gold §101c |
| `A.4.0`, `A.4.-0-44`, `A.4.-1`, `A.4.-1-44`, `A.4.-2`, `A.4.-2-44` | A.4 | Issued > 10 000 Kč incl. VAT. The `-1`/`-2` suffixes = §89 / §90 regimes; `-44` = §44 bad-debt corrections. |
| `A.5.` | A.5 | Issued ≤ 10 000 Kč, or no tax document required |
| `B.1.` | B.1 | Received, reverse charge §92a |
| `B.2.`, `B.2-44`, `B.2.-POM`, `B.2.-POM-44` | B.2 | Received > 10 000 Kč, deduction §73/1a. `POM` = proportional deduction. |
| `B.3.` | B.3 | Received ≤ 10 000 Kč |
| `A.4-5.AUTO` | auto | Picks A.4 or A.5 from the amount and whether the document has a Czech DIČ |
| `B.2-3.AUTO` | auto | Picks B.2 or B.3 from the amount only |
| `0.0.` | – | Excluded from KH. Advance deductions with no tax document are set to `0.0` automatically. |

KH row assignment works at three levels [O]: document type (`typ-faktury-*.clenKonVykDph`) → document header → **line**, and **the line is decisive**. Flexi does not pre-fill the row; the user chooses it. The exception: an empty row with `clenDph` = `000P`/`000U` becomes `0.0`.

### 2.11 `sazba-dph` [O `P:sazba-dph`]
`typSzbDphK` (`typSzbDph.dphOsv|dphSniz|dphSniz2|dphZakl`), `szbDph` (%), `platiOdData`, `platiDoData`, `stat`. **[O `A:3422350`]** Send only `typSzbDphK`; Flexi looks up the % valid on the document date. If both are sent and they conflict, the request fails ("Pro danou hodnotu sazby…"). **[I]** In CZ, `dphSniz2` has been unused since 1.1.2024 (only 21 % and 12 %), but the slot stays in the schema. Flexi has an article on the change, "Změny sazeb DPH od 1.1.2024" (8778604), which we did not read.

### 2.12 `mena`, `kurz` [O `P:mena`, `P:kurz`, `A:4729204`]
- `mena`: `kod` (e.g. `CZK`), `nazev`, `symbol`, `kurzMnozstvi`, `zpusobStahKurzK` (`zpusobStahKurz.nikdy|denne|mesicne|rocne`).
- `kurz`: `mena`, `platiOdData`, `kurz`, `kurzMnozstvi`. A document without a rate gets one automatically (ČNB/ECB).
- **[O]** Flexi **adjusts the stored rate to 6 decimals** so that foreign amount × rate equals the rounded CZK amount. Example: 1.4 EUR × 25.265 → 35.37 CZK, stored rate 25.264286. Integrators are told not to reconcile against the official rate list. `nastaveni` also has `rocniKurzK` (monthly or yearly rate) [O `P:nastaveni`].

### 2.13 `ucetni-obdobi`, `rada`, `rocni-rada`, `typ-faktury-*` [O]
- `ucetni-obdobi`: `kod` (e.g. `2024`), `platiOdData`, `platiDoData`, `rokProRadu`, `zmenaZaver`, `chybaPreceneni`. Documents must fall inside a period; the ISDOC import takes `ucetniObdobi=2025`.
- `rada`: `kod`, `nazev`, `modul`, `platiOd/Do`. The actual counter lives in **`rocni-rada`**: `rada`, `ucetObdobi`, `prefix`, `postfix`, `cisDelka`, `cisPoc`, `cisAkt`, `zobrazNuly`. There are per-module views such as `rada-faktury-prijate` and `rada-banka` [O `EV`]. Document field `polozkaRady` = the sequence number used [O sample]. **[O `A:4720123`]** A dry-run reserves a number and releases it again, so a real save may get a different number.
- `typ-faktury-prijate` / `typ-faktury-vydane`: `kod`, `nazev`, `typDoklK` (`typDokladu.faktura|dobropis|zalohFaktura|zdd|dodList|proforma`), `ucetni`, `splatDny`, `formaUhradyCis`, `radaVydej` (number series), `stredisko`, `cinnost`, `primUcet`, `typUcOp…` (default předpis), `mena`, `statDph`, `clenKonVykDph` (default KH row), `uhrAuto`, `zapAuto`, `sablonaMail`, `ucetObdobiOd/Do`.

### 2.14 `ucet` (chart of accounts, double-entry only) [O `P:ucet`]
`kod` (account number, e.g. `501001`), `nazev`, `danovy` (tax-deductible), `saldo` (open-item tracking), `typUctuK` (`typUctu.rozvahovy|vysledkovy|podrozvahovy|zaverkovy|vnitropodnikovy`), `druhUctuK` (`druhUctu.aktivni|aktpasvy|pasivni|pasivhvy|naklady|vynosy|otevknih|uzavknih|prhosvys`), `stdUcet` (synthetic account from `ucetni-osnova`), `mena`, `typOrganizace`, `ucetObdobiOd/Do`. **[O `A:3638530`]** The standard chart of accounts (Standardní účtová osnova) is binding; only off-balance and intra-company synthetic accounts can be added.

### 2.15 `stredisko`, `zakazka`, `cinnost` [O]
- `stredisko` (cost centre): `kod`, `nazev`, an address, `tisknout` (print on documents), `stitky`, `platiOd/Do`.
- `cinnost` (activity): `kod`, `nazev`, `stitky`, `platiOd/Do`.
- `zakazka` (job/project): `kod`, `nazev`, `firma`, `stredisko`, `typZakazky`, `stavZakazky`, `datZahaj`, `datKonec`, `rozsah`, `nakladyPredpoklad`, `ziskPredpoklad`, `varSym`, `cisObj`, `cisSml`, `mena`.

All three are optional tags on header and line. **[I]** For an OSVČ, `cinnost` maps well to the separate activities in DPFDP5 (§7 vs §9 income, several trades), `zakazka` to a client project, and `stredisko` can be ignored.

### 2.16 Other evidences worth knowing [O `EV`]
`vazba` (typed links), `podklady-dph`, `kontrolni-hlaseni-dph`, `souhrnne-hlaseni-dph`, `ulozene-priznani-dph`, `radek-priznani-dph`, `ulozene-priznani-kon-vyk-dph`, `preneseni-dph` (reverse-charge commodity list), `stat-dph`, `uplatneni-dane-zavazku` (separate VAT-claim document for a liability: it has `duzpPuv`, `duzpUcto` and `sum*`, used when the VAT is claimed apart from the invoice) [O `P:uplatneni-dane-zavazku`], `danovy-naklad`, `danovy-odpis`, `ucetni-denik`, `saldo`, `saldo-k-datu`, `doklad-k-uhrade`, `prikaz-k-uhrade`, `format-elektronickeho-bankovnictvi`, `bankovni-ucet`, `pokladna`, `typ-organizace`, `nastaveni` (`platceDph`, `typOrganizace`, `statLegislativa`, `finUrad`, `mena`, `ucetZaokrNaklad`/`ucetZaokrVynos`, `zaokrNulovaSazba`).

---

## 3. How a received invoice is booked

### 3.1 Flow [O fields, I sequence]
1. Choose a `typDokl` (`typ-faktury-prijate`). It supplies `rada`, `typUcOp` (předpis), `clenKonVykDph`, `splatDny`, `stredisko` and `mena`.
2. Header: `cisDosle` (supplier number) → `varSym` (digits only); `datVyst` (= received); `duzpPuv` (supplier's DUZP); `duzpUcto` (claim date); `datSplat`; `firma` (+ snapshot `ic`/`dic`).
3. Amounts: either **header-only** (`bezPolozek=true`, enter `sumZklZakl`/`sumDphZakl`/… and Flexi works as a "tax calculator") or **lines** (`polozkyFaktury`, one line per rate/category, `typPolozky.ucetni`) [O help 4611404].
4. `typUcOp` (předpis) → accounts `protiUcet` (MD, e.g. 501/518) and `primUcet` (DAL, 321), VAT accounts `dphZaklUcet` (343) → **`clenDph` derived** from `kodPlneniK` + partner + domestic/foreign (e.g. `40-41`).
5. KH row: `clenKonVykDph`, e.g. `B.2-3.AUTO`, which resolves to `B.2.` above 10 000 Kč incl. VAT and `B.3.` otherwise.
6. Save. The document is posted (`zuctovano`) if `ucetni=true` and the accounts/předpis are complete.

**[O `A:5487205` error list, `A:6707949`]** The `duzpUcto` of a received document is validated against `duzpPuv`. The ISDOC import fails with `dokladDuzpUctoPoDuzpPuvError2025` when the "taxable supply date exceeds the statutory limit". **[I]** This corresponds to the 2025 VAT amendment that limits how late a deduction can be claimed. Our schema needs both dates plus a validator.

### 3.2 The VAT breakdown fields [O `A:4725983`]
- Per-rate buckets: **`sumOsv`** (0 %/exempt), **`sumZklZakl` / `sumDphZakl` / `sumCelkZakl`** (standard), **`sumZklSniz` / `sumDphSniz` / `sumCelkSniz`** (reduced), **`sumZklSniz2` / `sumDphSniz2` / `sumCelkSniz2`** (2nd reduced).
- Totals: **`sumZklCelkem`**, **`sumDphCelkem`**, **`sumCelkem`**.
- The same set with the suffix `Men` holds foreign-currency amounts.
- Document VAT = the sum of line VAT, then rounded. The direction of the calculation (bottom-up or top-down) depends on what you send: "supplying only the bases is usually enough". Sums must reconcile. A mismatch gives the error `Zadaná hodnota [x] vlastnosti [sumCelkem] se liší od vypočtené hodnoty [y]`. Dry-run is recommended to see Flexi's computed values. "Don't forget the 2nd reduced rate."
- **[I]** Bucketed columns, not a VAT-recap child table, are a legacy design choice: the schema has to change whenever the law adds a rate. Our design should use a `vat_breakdown` child table keyed by `rate_type` and keep the bucketed columns only as an export view.

### 3.3 Rounding (matching the supplier's totals)
- **[O `A:5792983`]** The service `zaokrouhli` (on `faktura-prijata` and `pokladni-pohyb`): POST/PUT to the evidence with `<zaokrouhli><pozadovaneCeny><zklZakl/><dphZakl/><celkZakl/>…<zklSniz/>…<osv/></pozadovaneCeny></zaokrouhli>`. Flexi adds a `typPolozky.ucetni` line named "Zaokrouhleno" for the difference. Each rate's triple must be internally consistent, otherwise the error is `dokladKorekceCastekChybaSouctu`. It only works on documents with lines.
- **[O]** Rounding differences are posted to `nastaveni.ucetZaokrNaklad` / `ucetZaokrVynos`. `zaokrNulovaSazba` = "don't include automatic rounding lines in VAT", i.e. the rounding goes in as a 0 % line, matching `metodaZaokr.0sazba`.
- **[O]** Rounding on issued documents is set per document with `zaokrJakSumK`, `zaokrNaSumK`, `zaokrJakDphK`, `zaokrNaDphK` and `metodaZaokrDoklK` (§2.1).
- **[I] Lesson:** store the supplier's printed totals verbatim, compute ours, and book the difference as an explicit rounding line (non-VAT, 0 %). Never silently alter base or VAT. The ±0.50 Kč tolerance in our plan should produce exactly such a line.

### 3.4 Reverse charge (přenesená daňová povinnost) [O `A:3421226`]
- **Received invoice:** use a předpis "Nákup zboží/služby" with `kodPlneniK=kodPlneni.prenDanPov`. Flexi fills `clenDph` with rows **10-11 and 43-44** (output and deduction at once, so the net effect is zero). Set the KH row to **`B.1.`**. Enter lines at the real rate so that VAT is calculated, and fill **`dphPren`** (Kód přenesení DPH) on each line; it is required for received invoices. **The header shows base and VAT, but the total payable excludes VAT** (2 000 + 420 VAT → total 2 000).
- **Issued invoice:** předpis "Tržba" with `prenDanPov` → `clenDph` row **25**, KH row **`A.1.`**, lines at 0 %, `dphPren` on each line (it can come from `cenik.dphPren`). Some codes apply only above 100 000 Kč, and Flexi checks the threshold. The PDF prints "Daň odvede zákazník".
- **[O]** KH A.1/B.1 needs the goods code/type: `cleneni-kontrolni-hlaseni.vyplnCisKod`/`vyplnDruh`, and `kontrolni-hlaseni-dph` has the fields `dphPren`, `ciselnyKodZbozi`, `druhZbozi`, `sumMnozMj` and `mj`.
- **[I]** EU services and acquisitions (A.2, §108) use `typObchodu.EUplatce`, `kodPlneni.sluzby`/`zbozi` and the `*RCH` plnění types in the same way, with no separate "self-assessment document". The VAT is computed on the invoice itself.

### 3.5 Kontrolní hlášení mapping [O `A:4585915`, `P:kontrolni-hlaseni-dph`]
The `kontrolni-hlaseni-dph` row model (one row per document × rate) has these fields:
`kod` (= **evidenční číslo daňového dokladu**), `kodDokl` (internal number), `kodPuv` (original invoice number, for corrections), `duzpPuv`, `duzpUcto`, `dic`, `sumZkl`, `sumDph`, `sumZklPuv`, `sumDphPuv`, `sumOdpocDph` (deducted VAT, for POM), `szbDph`, `typSzbDphK`, `clenKonVykDph`, `clenKonVykDphVysledny` (the row after AUTO is resolved), `clenDph`, `dphPren`, `ciselnyKodZbozi`, `druhZbozi`, `sumMnozMj`, `modul`, `sumSkB3`, `nazev`, `ulice`, `psc`, `mesto`, `datNaroz` (for non-VAT-payer individuals, SK), `idDokl`.

Which number is used as the evidenční číslo, per source [O]:
- **Interní číslo** (`kod`): issued invoices, sales cash register, other receivables.
- **Číslo došlé** (`cisDosle`): received invoices, issued invoices, internal documents, cash, bank, other payables and receivables.
- **Doklad číslo**: internal documents, cash, bank, offsetting.

The DUZP fields (DUZP / DPPD / DUP) come from "Datum zdanitelného plnění". The period of a received invoice is set by **"Uplatnit zdaň. pl." (`duzpUcto`)**.

### 3.6 Cash basis vs accrual; DE vs double-entry
- **[O]** The organization type (`nastaveni.typOrganizace` → `typ-organizace`) switches modes. "Podnikatelé – daňová evidence" replaces accounts with předpisy (`A:3638530`).
- **[O]** The DE outputs are "Výkaz daňové evidence" (wizard plus a summary print by předpis) and "Peněžní deník". **They show items that passed through the Peníze module**, i.e. bank and cash: DE is **cash-basis** (`A:4585089`). The double-entry outputs are účetní deník, saldo, obratová předvaha, hlavní kniha, rozvaha and výsledovka.
- **[O]** `danova-evidence/prepocet` (`PUT/POST`, param `ucetniObdobi=code:2024`, `dry-run`) recomputes DE balances "per division of the DE". In a double-entry company it returns `400 akcePristupOdepren` (`A:7435407`).
- **[O]** The 2009 sample has `danEvidK` on the header and line plus `kopDanEvid`. These fields are **missing from the current `/properties` snapshot** [O `P:faktura-prijata-polozka`]. **[?]** How exactly DE classifies a payment today (probably the předpis on the bank/cash line, inherited from the paired invoice) is not confirmed publicly.
- **[I]** VAT stays accrual (by `duzpUcto`/`duzpPuv`) even in DE mode. Income tax DE is cash-basis (by payment date). So **one document carries two independent period keys**: the VAT period comes from DUZP/claim date, and the income-tax period from the payment date(s). Unpaid invoices hit VAT but not DE.

---

## 4. Payments and pairing (párování)

### 4.1 Manual or explicit pairing via import [O `A:4729375`]
```xml
<winstrom version="1.0">
  <banka>
    <id>ext:BANKFEED:tx-8842</id>
    ...
    <sparovani>
      <uhrazovanaFak type="faktura-prijata" castka="1210.00">code:PF0042/2026</uhrazovanaFak>
      <zbytek>castecnaUhradaNeboZauctovat</zbytek>
    </sparovani>
  </banka>
</winstrom>
```
- Several `uhrazovanaFak` elements are allowed, but they must all be the same type. `castka` sets a partial amount.
- `zbytek` (what to do with the difference): `ne` (must match exactly, else 400), `zauctovat` (book the difference to an internal document), `ignorovat` (settle, leave the payment unpaired), `castecnaUhrada`, `castecnaUhradaNeboZauctovat`, `castecnaUhradaNeboIgnorovat`.
- Optional elements: FX difference `krTypDokl`, `krTypDoklZisk`, `krTypDoklZtrata`, `krRada`; remainder `zbTypDokl`, `zbTypDoklZisk`, `zbTypDoklZtrata`, `zbRada`.
- Currency: a CZK payment against invoices in one foreign currency is converted at the ratio of the amounts. A foreign payment against foreign invoices is treated as 1:1, with the FX difference taken from CZK amounts.
- Unpairing: `<odparovani>` with optional `uhrazovanaFak` children. It is idempotent.
- JSON form: `"uhrazovanaFak": {"@type": "...", "@castka": "...", "@content": "code:..."}`.

### 4.2 Automatic pairing [O `A:3422285`, `A:4729375`]
`PUT /c/{firma}/banka/(datVyst>='2026-01-01')/automaticke-parovani`. The filter goes in the path; `?filter=` is ignored. It also works for `pokladni-pohyb`.

| Param | Values |
|---|---|
| `mod` | `varCas` (VS + amount, default), `varCasUcet` (VS + amount + account), `jenVar` (VS only), `jenCastka` (amount only, VS differs) |
| `obdobi` | `vsechna` (default), `aktualni`, `aktualni-predchozi` |
| `ignorovat-rozdil-castka` | Tolerated difference (default 0.0) |
| `zauctovat-rozdil` | `true` (default): book the difference to an internal document and pair fully |

Already-paired documents are skipped, so the call is idempotent.

### 4.3 Advanced automatic pairing (paid add-on) [O `A:3853613`]
Incoming CZK payments only. Rules are tried in this order: (1) VS = customer number (EAN in `adresar`) → pay that customer's oldest unpaid invoices; (2) VS = internal document number; (3) VS = invoice VS; (4) counterparty account = account in `adresar`; (5) no match → overpayment → automatic **zálohová faktura + ZDD**.
The payment is split into one row per invoice (`B+0001/2017#02`, separator `paramParovaniUhradRozdeleniPrefixDrgn`). Small differences are handled by `paramCastkaPreplatekDrgn` / `paramCastkaNedoplatekDrgn`. Endpoint: `.../banka/automaticke-parovani-pokrocile`.

### 4.4 What the result looks like [O `P:vazba`, `A:3422310`]
Pairing creates **`vazba`** rows: `typVazbyK`, `castka`, `storno`, and the two sides `a` (the paid document) and `b` (the paying document). Relevant `typVazbyK` values: `typVazbyDokl.uhrada`, `uhradaKR`, `KR`, `ZB` (remainder), `PP` (overpayment), `odpocetZALOHY`, `odpocetZDD`, `vazbaZDD`, `hlavaDobropis`, `polozkaDobropis`, `uhrazovanaFaktura`, `uhrazujicCompetitor D`, `splatVraceniDPH`, `splatObnovaDph`, `splatObnovaDphUhrada`.
Query: `GET /faktura-vydana.xml?relations=vazby&includes=/faktura-vydana/vazby/vazba/b/&detail=custom:kod,vazby(typVazbyK,b(jakUhrK))`. The pairing method is recorded on the payment in `jakUhrK` (e.g. `jakUhrazeno.autoVs`).

### 4.5 Related services [O]
- Cash payment of an invoice: `<hotovostni-uhrada>` nested in the invoice, with `pokladna`, `typDokl`, `castka`, `rezim` (`vychozi|uplnaUhrada|rozdilZauctovat`), `datumUhrady`, `kurzKDatuUhrady`, `rada`. It creates the cash document and the link (`A:4729399`).
- Credit note: `<vytvor-vazbu-dobropis><dobropisovanyDokl>` (link headers) or `<dobropisuj>` (item-level, creates a negative document) (`A:4744457`).
- Bank statements: `PUT /c/{firma}/bankovni-ucet/{id}/nacteni-vypisu` (file body, format configured on the account) and `PUT /banka/nacteni-vypisu-online` (FIO token or Finbricks). Re-imported transactions are reported as "Tento doklad byl již načten" (duplicate detection) (`A:4731153`).
- Unpaid > 6 months after due date (CZ; 100 days in SK): `GET /neuhrazene-po-splatnosti`, `POST .../vraceni-dph?idFaktury=&rok=&mesic=` creates a helper VAT-reversal document. `neuhrazene-po-splatnosti-2/uplatneni-dph` (with `idUhrady`) re-claims the VAT after payment (`A:12698184`). **[I]** This is the debtor's correction obligation for unpaid liabilities. It matters for an OSVČ VAT payer: we need a scheduled job that scans unpaid received invoices.

---

## 5. VAT outputs (DPHDP3, DPHKH1, DPHSHV)

| Output | Generate | Data rows | Saved copy | XML root |
|---|---|---|---|---|
| Přiznání DPH | `GET/POST /c/{f}/priznani-dph.{xml\|pdf}?rok=2026&mesic=9` (or `mesic=Q3`) | `podklady-dph` | `ulozene-priznani-dph`, `radek-priznani-dph` | `Pisemnost/DPHDP3` with `VetaD`, `VetaP`, `Veta1`…`Veta6` |
| Kontrolní hlášení | `GET /c/{f}/kontrolni-hlaseni.{xml\|pdf}?obdobi=2026Q3&druh=B` | `kontrolni-hlaseni-dph?rok=&ctvrtleti=` | `ulozene-priznani-kon-vyk-dph` | `Pisemnost/DPHKH1` with `VetaD`, `VetaP`, `VetaA5`, `VetaB3`, `VetaC`, … |
| Souhrnné hlášení | `GET /c/{f}/souhrnne-hlaseni.{xml\|pdf}?rok=&mesic=\|ctvrtleti=` | `souhrnne-hlaseni-dph` | – | `Pisemnost/DPHSHV` with `VetaD`, `VetaP`, `VetaR` |

All of the above is **[O]** (`A:5487205`, `A:8730769`, `A:8650919`). Details:
- **DPHDP3 params:** `rok`, `mesic` (1–12 or `Q1`–`Q4`), `druh` ∈ `radne|radneOpravne|dodatecne|dodatecneOpravne`, `dodatecneOproti` (ID of the summary `radek-priznani-dph` row of the return being amended, i.e. the row where `clenDph` and `typSzbDphK` are null), `duvodyProDodatecne`, `datumZjisteni`, `koeficient` (default 100), `vyporadaciKoeficient`, `zmenaOdpoctu`, `danKUhrade`, `kodZdanObd`, `ulozit`, `stat`. There is also `form-data.xml` (report IDs such as `priznaniDPH2026$$SUM`). Observed attributes include `dapdph_forma`, `typ_platce`, `dan23`, `obrat23`, `pln23`, `odp_zocelk`, `dan_zocelk`.
- **`radek-priznani-dph` rows:** `rok`, `mesic`, `ctvrtleti`, `datum`, `stavK` (`stavPriznaniDph.radne|opravne|dodatecne`), `zaklad`, `dph`, `typSzbDphK`, `clenDph`, `stat`, `uzivatel`. **[I]** The return is an aggregation of `podklady-dph` grouped by `clenDph` × `typSzbDphK`, then spread across DPHDP3 rows using the code grammar in §2.9.
- **`podklady-dph` rows (the VAT ledger):** `modulK` (`modulUcetni.FAP|FAV|BAN|POK|SKL|INT|PHL|ZAV|TXP|TXZ|MAJ|LEA`), `doklad`, `idDokl`, `duzpPuv`, `duzpUcto`, `datUcto`, `mesicDuzp`/`rokDuzp`, `mesicUcto`/`rokUcto`, `clenDph`, `clenKonVykDph`, `typSzbDphK`, `szbDph`, `sumZklTuz`/`sumDphTuz` (+`Men`), `typPlneniK`, `statDph`, `dic`, `cisDosle`, `varSym`, the accounts, `jeDph`, plus check columns `vypSumDphTuz`, `vypRozdilDphTuz`, `vypSzbDph`, `vypRozdilSzbDph` (computed VAT vs stored VAT). Flexi notes that Podklady DPH also serves as the payer's legally required VAT records (záznamní povinnost).
- **DPHKH1 params:** `obdobi` (`yyyyMM` or `yyyy'Q'M`; **not validated**, so `2124Q5` silently becomes 2125 Q1), `druh` ∈ `B` (řádné), `O` (opravné), `N` (následné), `E` (následné opravné). `N`/`E` need `datumZjisteni`. `vyzvaOdpoved` ∈ `B|P` with `cisloJednaciVyzvy` (`99999999/99/9999-99999-999999`). Prerequisites in company settings: KFÚ, DIČ, e-mail or data box, and the representative (missing ones → 400 with a list). Observed attributes: `VetaD`: `ctvrt`, `d_poddp`, `dokument=KH1`, `k_uladis=DPH`, `khdph_forma`, `rok`. `VetaA5`/`VetaB3`: `zakl_dane1..3`, `dan1..3`. `VetaC`: `celk_zd_a2`, `obrat23`, `obrat5`, `pln23`, `pln5`, `pln_rez_pren`, `rez_pren23`, `rez_pren5`. Check helpers: `kontrolni-hlaseni-dph?clenKonVykNull=true` lists items with no KH row.
- **[I]** The A.4/B.2 sentences (not shown in the article) follow the EPO schema: per document, `dic_odb`/`dic_dod`, `c_evid_dd`, `dppd`/`duzp`, `zakl_dane1..3`, `dan1..3`, `kod_rezim_pl`, `zdph_44`, `pomer`. Check against the EPO XSD.
- **DPHSHV:** `VetaR` has `c_rad`, `c_vat`, `k_pln_eu`, `k_stat`, `pln_hodnota`, `pln_pocet`, `por_c_stran` [O]. The rows evidence has `kodStatu`, `kodDphStatu`, `dic`, `kodPlneni`, `pocetPlneni`, `sumZkl` [O `P:souhrnne-hlaseni-dph`]. **[I]** `k_pln_eu` values are 0 = goods, 1 = transfer of goods, 2 = triangular trade, 3 = services (§102); in Flexi they come from `cleneni-dph.kodPlneniSH`.
- **[O]** The XML is the tax-portal *písemnost* format and is uploaded manually to EPO or sent via a data box. Flexi does not submit it itself (`A:4585915` recommends uploading to EPO to validate it).

---

## 6. Import/export format and API patterns (lessons for our API)

### 6.1 Format [O `A:4719998`, `A:4725798`, `X:*`]
- Envelope: `<winstrom version="1.0">` holding one or more `<evidence-name>` elements. JSON uses `{"winstrom": {"faktura-prijata": [ {...} ]}}`. Attributes are written as `"@attr"` (e.g. `"@removeExternalIds"`, `"polozkyFaktury@removeAll"`).
- Lines nest inside the document (`polozkyFaktury` / `polozkyDokladu`) and are never imported separately.
- Relations are references in identifier syntax: `<mena>code:CZK</mena>`, `<firma>in:12345678</firma>`, `<typUcOp>code:NAKUP-SLUZBY</typUcOp>`.
- Enum values are namespaced strings: `typSzbDph.dphZakl`, `stavUhr.uhrazeno`.
- Formats: XML, JSON, CSV, DBF, XLS, XLSX and **ISDOC (`.isdoc`, `.isdocx`, `.pdf` with an embedded ISDOC)** for import and export. EDI INHOUSE. Export only: PDF, vCard, iCal, HTML.

### 6.2 Identifiers and idempotency [O `A:4725798`]
- `123` (internal), `code:XYZ`, `key:<uuid>`, **`ext:SYSTEM:ID`**, `vatid:CZ…`, `in:<IČO>`, `iban:…`, `ean:`, `plu:`, `ws:<companyUUID>:<id>`.
- Upsert: a reference by any non-internal ID **creates the record if missing and updates it if found**. A missing internal ID → error.
- Several `<id>` elements are allowed. They must all resolve to the same record; non-existent ones are ignored, so you can send every ID you know. URL form: `[123][code:CZK][ext:SHOP:abc]`.
- External IDs are unique per evidence. Several can be attached; `removeExternalIds="ext:PREFIX"` clears them by prefix.
- Filtering by external ID: `/faktura-vydana/(id='ext:X').xml`. Direct GET → `301` redirect to the numeric URL.
- Create/update guards: `create="ok|ignore|fail"`, `update="ok|ignore|fail"` (errors `importXmlCreateNeniPovolen`, `importXmlUpdateNeniPovolen`). Missing relations: `if-not-found="null|nearest-invalid|create"` (`A:4725944`).

### 6.3 Updates, transactions, validation
- Partial update: send only the changed fields; an empty element clears the value. Line collections match lines by ID, else by position (dangerous). `removeAll="true"` replaces the whole collection. **Send external IDs on lines** (`A:4725908`).
- `atomic` (default true): the whole import runs as one transaction. `atomic="false"` gives one transaction per record (lines stay with their document) (`A:4726125`).
- `?dry-run=true` returns `<success>`, `<warnings><warning for="…">` and `<result><content>` (the record as it would be saved, `id=-1`) (`A:4720123`).
- Response codes 200/201/304/400/401/402/403/404/405/406/409/500/503; 409 means a conflicting job is running, so don't retry hot (`A:4720060`). The import result carries `stats` (`created`, `updated`, `deleted`, `skipped`, `failed`) and `results` (`id`, `code`, `ref`) [O `A:4731153`, `A:6707949`].

### 6.4 Reads [O `A:4722195`, `A:4722190`]
- Filter in the path: `/faktura-prijata/(duzpUcto >= '2026-07-01' and duzpUcto <= '2026-09-30' and firma.dic = 'CZ12345678').json`. Operators: `eq ne lt lte gt gte like 'like similar' begins ends between in 'in subtree' 'is null' 'is empty' 'is true'`, combined with `and`, `or`, `not`; functions `now()`, `currentYear()`, `me()`; dot paths through relations. Records with `platiOd`/`platiDo` are filtered by validity by default (`filtrovat-platnost=false` turns this off).
- `detail=id|summary|full|custom:f1,f2,coll(f3)`, `relations=vazby,prilohy,polozky`, `includes=/evidence/rel/`, plus paging (`limit`, `start`) and sum queries ("Sumace").
- Sync: **Changes API** `GET /changes.xml?start=<ver>&limit=1000&evidence=faktura-prijata` returns records with `@in-version`, `@operation` (`create|update|delete`), `@timestamp`, `id` and `external-ids`, and a `next` cursor. `?add-global-version=true` on any export returns `globalVersion`. Webhooks are built on top of this (`A:4744362`).

### 6.5 ISDOC import [O `A:6707949`]
`PUT/POST /c/{f}/faktura-prijata.isdoc` (`Content-Type: application/x-isdoc`, or a PDF with an embedded `invoice.isdoc`). Required: `typDokl`. Optional: `typUcOp`, `odpocetZaloh` (default `true`: auto-deduct advances matched by partner, currency, amount and number/VS), `ucetniObdobi`, `fileName`. Unknown parameters are silently ignored. Importing into issued invoices needs `paramImportIsdocFav=true`.
**[I]** For our "Accountant Bridge" export: **ISDOC 6.0.x is accepted natively by Flexi**, but only with a `typDokl` the accountant chooses, so the předpis and KH row still have to be set on the Flexi side. A Flexi-XML export (§6.1) can carry `typUcOp`, `clenKonVykDph`, `duzpUcto` and `ext:` IDs, which makes it richer and idempotent.

---

## 7. Lessons and a minimal subset for an OSVČ product

### 7.1 Design lessons
1. **One document table with a type discriminator**, not a separate table per agenda. Flexi's agendas all share one header shape, and so should ours [O §2.1, I].
2. **Keep three dates plus the payment date apart:** `issue_date`, `duzp` (`duzpPuv`), `vat_claim_date` (`duzpUcto`, received documents only), `booking_date` (`datUcto`). The DE period comes from `payments.paid_at`. Never collapse them [O §3, I].
3. **Classify through a rule, not raw codes.** The user or AI picks a category (= předpis). VAT row (`clenDph`) and DE category follow from it plus partner VAT status and domestic/EU/third country. The KH row is derived from the amount (AUTO rules) unless overridden. This is exactly the AI's job [O §2.8–2.10].
4. **Put classification on the line, defaulted from the header,** with a copy flag (`kop*`) so that one invoice can be split between, for example, business and private use or two rates [O].
5. **Store the supplier's printed totals verbatim** and book the difference as a rounding line (0 %, no VAT) [O §3.3].
6. **External IDs with a namespace on every entity, including lines,** with upsert semantics, `dry-run`, an atomic batch and a change feed. Copy Flexi's API contract [O §6].
7. **Pairing is a link table with an amount and a type,** not a `paid` flag. Support partial and multi-invoice payments and remainder policies (`zbytek`). Record the method (`jakUhrK`) for explainability [O §4].
8. **VAT outputs are derived views over a VAT ledger** (`podklady-dph`). Snapshot them when a filing is generated (`ulozene-*`) so that amendments (dodatečné / opravné / následné) can diff against what was filed [O §5].
9. **Validate inputs Flexi forgot:** Flexi accepts `2124Q5`, so validate periods ourselves. Also apply the duzpUcto-vs-duzpPuv statutory window check [O].
10. **Rate buckets are legacy.** Store VAT by `rate_type` (`zakl`/`sniz`/`sniz2`/`osv`) with the percentage resolved from a rate table by `datSazbyDph`, so that a law change needs no migration [I].

### 7.2 Proposed minimal schema (DE / paušál OSVČ) mapped to Flexi [I]

| Our table | Key columns | Flexi equivalent |
|---|---|---|
| `tenants` | ico, dic, `vat_status` (`neplatce`/`platce`/`identifikovana_osoba`), `vat_period` (`M`/`Q`), `tax_regime` (`danova_evidence`/`pausalni_vydaje`/`pausalni_dan`), fu_code, ufo_code, data_box_id, nace | `nastaveni` (`platceDph`, `typOrganizace`, `finUrad`) |
| `partners` | ico, dic, name, address, country, `is_vat_payer`, `unreliable_payer`, `relation` | `adresar` (`ic`, `dic`, `platceDph`, `nespolehlivyPlatce`, `typVztahuK`) |
| `partner_bank_accounts` | partner_id, account, bank_code, iban, `published_in_adis` | `adresar-bankovni-ucet` |
| `documents` | id, tenant_id, `kind` (`invoice_in`/`invoice_out`/`receipt`/`bank_tx`/`cash_tx`/`internal`), `doc_subtype` (`invoice`/`credit_note`/`advance`/`zdd`/`proforma`), number_series_id, `number` (`kod`), `supplier_number` (`cisDosle`), vs, ss, ks, issue_date, duzp, vat_claim_date, booking_date, due_date, partner_id + partner snapshot (name, ico, dic, address), currency, fx_rate, fx_qty, `prices_include_vat`, totals (net, vat, gross, gross_foreign), `printed_total`, `kh_row`, `category_id`, `activity_id`, `project_id`, status, lock_state, storno, `credited_document_id` | `faktura-prijata/vydana`, `banka`, `pokladni-pohyb`, `interni-doklad` |
| `document_lines` | document_id, ext_id, `line_type` (`item`/`posting`/`rounding`/`advance_deduction`/`text`), description, qty, unit, unit_price, `rate_type`, rate_pct, net, vat, gross, `category_id`, `vat_row`, `kh_row`, `rc_code` (dphPren), `business_share_pct`, activity_id, project_id | `*-polozka` (`typPolozkyK`, `typSzbDphK`, `sumZkl/sumDph`, `typUcOp`, `clenDph`, `clenKonVykDph`, `dphPren`) |
| `document_vat_summary` (view) | document_id, rate_type, rate_pct, base, vat, gross (+foreign) | the `sum*Zakl/Sniz/Sniz2/Osv` buckets |
| `categories` (předpis) | code, name, `direction` (`income`/`expense`), `de_effect` (`taxable`/`non_taxable`/`asset`/`private`), `vat_supply_code` (= `kodPlneniK` enum), `default_vat_row`, `dpfdp5_row`, valid_from/to | `predpis-zauctovani` (`kodPlneniK`, `modul*`) |
| `vat_rows` | code (`40-41`, `01-02`, `10-11,43-44`, `25`, `000P`…), supply_type, trade_type, supply_code, sh_code, is_vat, valid_from/to | `cleneni-dph` |
| `kh_rows` | code (`A.1.`…`B.3.`, `A.4-5.AUTO`, `B.2-3.AUTO`, `0.0.`), direction, needs_goods_code | `cleneni-kontrolni-hlaseni` |
| `vat_rates` | country, rate_type, pct, valid_from, valid_to | `sazba-dph` |
| `rc_commodity_codes` | code, description, threshold_100k | `preneseni-dph` |
| `currencies`, `fx_rates` | code; currency, date, rate, qty | `mena`, `kurz` |
| `fiscal_periods` | year, from, to, `closed` | `ucetni-obdobi` |
| `number_series` + `number_series_years` | code, kind; year, prefix, postfix, length, next | `rada` + `rocni-rada` |
| `activities`, `projects` | code, name, (dpf section §7/§9) | `cinnost`, `zakazka` |
| `bank_accounts` | our account, iban, `statement_format` | `bankovni-ucet` |
| `bank_transactions` | account_id, `statement_no` (`cisSouhrnne`), `bank_tx_id` (`vypisCisDokl`, unique → dedupe), direction (`typPohybuK`), date, amount, currency, vs, ss, ks, counter_account, counter_bank, message, `match_state`, `match_method` (= `jakUhrK` enum) | `banka` |
| `payment_links` | payer_doc_id (b), paid_doc_id (a), `link_type` (`uhrada`/`KR`/`ZB`/`PP`/`odpocetZDD`/`dobropis`/`splatVraceniDPH`…), amount, amount_foreign, `remainder_policy` | `vazba` (`typVazbyK`, `castka`) + `sparovani` |
| `vat_ledger` (materialized) | document_id, line_id, period_vat (by duzp/vat_claim_date), vat_row, kh_row_resolved, rate_type, base, vat, dic, evid_no, duzp | `podklady-dph`, `kontrolni-hlaseni-dph` |
| `filings` + `filing_rows` | type (`DPHDP3`/`DPHKH1`/`DPHSHV`/`DPFDP5`/ČSSZ/ZP), period, `kind` (`B`/`O`/`N`/`E`, `radne`/`dodatecne`…), amends_filing_id, xml_blob, generated_at, submitted_at | `ulozene-priznani-dph`, `radek-priznani-dph`, `ulozene-priznani-kon-vyk-dph` |
| `external_ids` | entity, entity_id, `namespace`, `value` (unique per entity+namespace+value) | `external-ids` / `ext:NS:ID` |
| `change_log` | global_version (bigserial), entity, entity_id, op, at | Changes API |

**Things to skip for OSVČ in DE / paušál:** `ucet` (chart of accounts), MD/DAL account fields, `stredisko`, warehouse/`cenik` stock, `zamekK` levels beyond open/locked, EET, Intrastat, MOSS, `ucetni-denik`, FX revaluation (`preceneni`). Keep `cinnost` (multiple activities) and a light `zakazka` [I].

**DE-specific additions Flexi does not expose publicly [I]:** a `de_ledger` (cash-basis) view = `payment_links` × `document_lines.category` pro-rated by the amount paid. Private-use share (`business_share_pct`), the asset register (`danovy-odpis` exists in Flexi), and DPFDP5 row mapping on `categories`. Paušál users only need income totals: the cash-basis sum of `invoice_out` payments, with the 2 000 000 Kč turnover tracker.

### 7.3 Open questions [?]
- The full `cleneni-dph` code list, with the exact DPHDP3 row and column per code. The demo data was blocked by robots; get it from a live trial instance or from the EPO DPHDP3 XSD.
- How current Flexi assigns a DE category to a paired payment (the old `danEvidK`/`kopDanEvid` fields are absent in the current snapshot).
- The exact XML of the KH `VetaA4`/`VetaB2` sentences and the DPHDP3 `Veta1`–`Veta6` attributes Flexi emits. Verify against the EPO XSD before claiming compatibility.
- Whether the `ext:` IDs survive ISDOC import (probably not; ISDOC has its own UUID → Flexi `uuid`?).
