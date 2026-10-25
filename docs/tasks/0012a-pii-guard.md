# 0012a: Czech PII guard script

Status: done
Ticket: P0-PII-02 (part a of 2) | Depends on: none (P0-REPO-01, P0-CI-01, P0-PII-01 merged) | Base commit: head of phase/0 | Branch: task/0012a-pii-guard | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add `scripts/pii_guard.py`, a standard-library Python script that finds real-looking Czech personal identifiers (rodné číslo, bank account, IBAN, natural-person DIČ) in the added lines of a diff or under a path, with checksums so that only plausible values are reported, plus its tests and the allowlist file. Part b (0012b) wires it into CI and gitleaks. Shoebox must never commit a user's or supplier's personal data (hard rule 4); this script is the gate.

## 2. Context

AGENTS.md hard rule 4 (pasted): "Privacy: never commit real documents or personal data. Test data is anonymized (`testdata/golden-v1/`). No document content in logs or Sentry."

rules.md "Privacy and security" (pasted): "Never commit real documents, `.env`, keys or personal data. `testdata/` holds only anonymized material with a README saying so. The PII guard in CI (gitleaks + Czech rules: account numbers, rodná čísla, IBANs, DIČ from a birth number) blocks the PR; public company IDs are allowlisted."

M12 §4.6 RČ policy (pasted): "Never a stored field. … a validator strips any value matching `^\d{6}/?\d{3,4}$`". M06 §9 item 5 names the synthetic test RČ `7801011229`; it is the only allowlisted RČ.

Ticket P0-PII-02 (the spec; no module section defines these rules):

- `scripts/pii_guard.py` (stdlib only) scans added lines of the diff, or a path with `--all`; matches are validated by checksum (RČ mod 11 + plausible date, CZ account mod 11 with weights `6,3,7,9,10,5,8,4,2,1` and a known bank code, IBAN mod 97, `CZ` + 9–10 digits that pass the RČ check) to keep false positives low.
- `scripts/test/test_pii_guard.py`: each identifier type fails in `apps/`, `packages/*/src` and `testdata/`; an 8-digit company DIČ (`CZ` + IČO) passes; a checksum-invalid digit string passes.
- `testdata/pii-allowlist.txt` (`value;reason;source`) admits public company IDs and the synthetic test RČ of M06 §9 only under `testdata/` and `packages/*/test|fixtures/`.

Checksum rules (M03 §4.2 and M02 §4.4.4, pasted): CZ account: "weights from the right `1,2,4,8,5,10,9,7,3,6`; each part `Σ mod 11 == 0`; base part 2–10 digits with ≥ 2 non-zero". IBAN: "ISO 7064 mod 97-10 (move 4 chars to end, letters → 10..35, `mod 97 == 1`); CZ length 24". DIČ: "`CZ\d{8}` → IČO (company); `CZ\d{9,10}` → natural person (10 digits: number mod 11 == 0, or mod 11 == 10 with last digit 0)". RČ: 10 digits since 1954 (`YYMMDD` + 4, women `MM+50`, from 2004 also `+20`/`+70`), 9 digits before 1954 (no checksum, so only the date is checked).

Orchestrator decisions (already implemented and tested by the orchestrator; the files below pass their tests on Python 3.12/3.13):

- The script is given in full. Write it exactly; do not redesign it.
- Bare 10-digit numbers are checked as RČ (date + mod 11); bare 9-digit numbers are not (Czech phone numbers), only the `YYMMDD/XXX` slash form.
- File names are scanned too (a golden file is named after a filing number that passes the RČ check).
- `docs/tasks/`, `scripts/test/` and the allowlist file are never scanned: briefs and tests quote the synthetic vectors. Allowlisted values are accepted under `testdata/`, `packages/*/test/`, `packages/*/fixtures/`, `docs/` and in `.gitleaks.toml` (0012b quotes the M06 RČ in a gitleaks allowlist).
- Output is redacted (`CZ8…1`): a hit never prints the value, because CI logs are public to the team.
- The bank-code list inside the script is a guard-only copy of the ČNB list, not product data (product data lives in `reference.cz_bank_codes`, M02). `[verify]` is left for the owner; do not research it.
- Running `--all` on the current `testdata/golden-v1` reports **8 hits** (one file name and seven `labels.json` lines holding two natural-person DIČ values). That is a real finding for the owner, not a bug: do not allowlist those values and do not edit anything under `testdata/golden-v1/`. Paste the redacted list in the report.

## 3. Files

| Path | Action | What |
|---|---|---|
| `scripts/pii_guard.py` | new | the guard, full source below |
| `scripts/test/test_pii_guard.py` | new | unittest file, full source below, do not edit |
| `testdata/pii-allowlist.txt` | new | allowlist, full content below |
| `docs/context/test-map.md` | edit | one row for `scripts/` |
| `docs/tasks/0012a-report.md` | new | the report |
| `docs/tasks/0012a-pii-guard.md` | edit | Status line only |

No other file may change.

## 4. Steps

Setup: `git fetch origin phase/0 && git checkout -b task/0012a-pii-guard origin/phase/0 2>&1 | tail -3`. Write each new file with one Write call; do not re-read files you just wrote; do not explore the repo. Commit after each step as `0012a step k`.

### Step 1: `scripts/pii_guard.py` (new)

Full content:

```python
#!/usr/bin/env python3
"""Czech PII guard (P0-PII-02). Standard library only.

Finds real-looking Czech personal identifiers in added lines of a git diff
(``--diff <range>``) or in files under given paths (``--all <path>...``):

- rodné číslo (RČ): ``YYMMDD/XXX(X)`` or 10 bare digits; plausible date + mod 11
- Czech bank account: ``[prefix-]number/bank``; both parts mod 11 with weights
  6,3,7,9,10,5,8,4,2,1 (right-aligned) and a known bank code
- IBAN: country length table + ISO 7064 mod 97-10
- DIČ of a natural person: ``CZ`` + 9 or 10 digits that pass the RČ check.
  ``CZ`` + 8 digits is a company DIČ (IČO) and is never reported.

Values listed in ``testdata/pii-allowlist.txt`` (``value;reason;source``) are
accepted only under ``testdata/``, ``packages/*/test/``, ``packages/*/fixtures/``,
``docs/`` and in ``.gitleaks.toml`` (whose allowlists quote them). Matches are printed redacted; the full value never reaches a log.
Exit code 1 when at least one hit remains, 0 otherwise, 2 on usage errors.
"""

from __future__ import annotations

import argparse
import datetime
import fnmatch
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ALLOWLIST_PATH = ROOT / 'testdata' / 'pii-allowlist.txt'

# Files that hold the test vectors by design and are never scanned.
EXEMPT_FILES = {'scripts/test/test_pii_guard.py', 'testdata/pii-allowlist.txt'}
EXEMPT_DIRS = ('.git/', 'node_modules/', 'docs/tasks/', 'scripts/test/')
# Where an allowlisted value is accepted.
ALLOW_SCOPES = ('testdata/*', 'packages/*/test/*', 'packages/*/fixtures/*', 'docs/*', '.gitleaks.toml')

# Bank codes from the ČNB list of payment system codes (guard-only copy, includes
# codes closed in recent years so history scans still match). [verify] against
# https://www.cnb.cz/cs/platebni-styk/.../ucty_kody_bank/ when a code is missing.
BANK_CODES = frozenset(
    '''0100 0300 0600 0710 0800 2010 2020 2060 2070 2100 2200 2220 2250 2260 2275
    2600 2700 3030 3050 3060 3500 4000 4300 5500 5800 6000 6100 6200 6210 6300
    6363 6700 6800 7910 7950 7960 7970 7990 8030 8040 8060 8090 8150 8190 8198
    8199 8200 8215 8220 8230 8240 8250 8255 8265 8270 8280 8293 8299 8500'''.split()
)
ACCOUNT_WEIGHTS = (6, 3, 7, 9, 10, 5, 8, 4, 2, 1)
IBAN_LENGTHS = {
    'AT': 20, 'BE': 16, 'BG': 22, 'CH': 21, 'CY': 28, 'CZ': 24, 'DE': 22, 'DK': 18,
    'EE': 20, 'ES': 24, 'FI': 18, 'FR': 27, 'GB': 22, 'GR': 27, 'HR': 21, 'HU': 28,
    'IE': 22, 'IT': 27, 'LT': 20, 'LU': 20, 'LV': 21, 'MT': 31, 'NL': 18, 'NO': 15,
    'PL': 28, 'PT': 25, 'RO': 24, 'SE': 24, 'SI': 19, 'SK': 24,
}

RC_RE = re.compile(r'(?<![0-9A-Za-z])(\d{6})/(\d{3,4})(?![0-9A-Za-z])|(?<![0-9A-Za-z./-])(\d{10})(?![0-9A-Za-z/-])')
ACCOUNT_RE = re.compile(r'(?<![0-9A-Za-z-])(?:(\d{1,6})-)?(\d{2,10})/(\d{4})(?![0-9A-Za-z])')
IBAN_RE = re.compile(r'(?<![0-9A-Za-z])([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?)(?![0-9A-Za-z])')
DIC_RE = re.compile(r'(?<![0-9A-Za-z])CZ(\d{8,10})(?![0-9A-Za-z])')


def rc_valid(digits: str) -> bool:
    """RČ check: 9 digits (born before 1954, no checksum) or 10 digits (mod 11)."""
    if not digits.isdigit() or len(digits) not in (9, 10):
        return False
    yy, mm, dd = int(digits[:2]), int(digits[2:4]), int(digits[4:6])
    if len(digits) == 9:
        if yy > 53:
            return False
        year = 1900 + yy
    else:
        year = 2000 + yy if yy <= 53 else 1900 + yy
        whole = int(digits)
        if whole % 11 != 0 and not (int(digits[:9]) % 11 == 10 and digits[9] == '0'):
            return False
    month = mm
    if 51 <= month <= 62:
        month -= 50
    elif year >= 2004 and 21 <= month <= 32:
        month -= 20
    elif year >= 2004 and 71 <= month <= 82:
        month -= 70
    if not 1 <= month <= 12:
        return False
    try:
        datetime.date(year, month, dd)
    except ValueError:
        return False
    return True


def account_part_valid(part: str) -> bool:
    if not part.isdigit() or len(part) > 10:
        return False
    padded = part.zfill(10)
    return sum(int(c) * w for c, w in zip(padded, ACCOUNT_WEIGHTS)) % 11 == 0


def cz_account_valid(prefix: str | None, number: str, bank: str) -> bool:
    if bank not in BANK_CODES:
        return False
    if sum(1 for c in number if c != '0') < 2:
        return False
    if prefix and not account_part_valid(prefix):
        return False
    return account_part_valid(number)


def iban_valid(iban: str) -> bool:
    compact = re.sub(r'\s+', '', iban).upper()
    expected = IBAN_LENGTHS.get(compact[:2])
    if expected is None or len(compact) != expected:
        return False
    rearranged = compact[4:] + compact[:4]
    numeric = ''.join(str(int(c, 36)) for c in rearranged)
    return int(numeric) % 97 == 1


def find_hits(text: str) -> list[tuple[str, str]]:
    """Return (kind, value) pairs for every validated identifier in one line."""
    hits: list[tuple[str, str]] = []
    for m in RC_RE.finditer(text):
        digits = (m.group(1) or '') + (m.group(2) or '') if m.group(1) else m.group(3)
        if rc_valid(digits):
            hits.append(('rodne_cislo', m.group(0)))
    for m in ACCOUNT_RE.finditer(text):
        if cz_account_valid(m.group(1), m.group(2), m.group(3)):
            hits.append(('cz_account', m.group(0)))
    for m in IBAN_RE.finditer(text):
        if iban_valid(m.group(1)):
            hits.append(('iban', m.group(1)))
    for m in DIC_RE.finditer(text):
        if len(m.group(1)) in (9, 10) and rc_valid(m.group(1)):
            hits.append(('dic_natural_person', m.group(0)))
    return hits


def normalize(value: str) -> str:
    return re.sub(r'[^0-9A-Z]', '', value.upper())


def load_allowlist(path: Path = ALLOWLIST_PATH) -> set[str]:
    keys: set[str] = set()
    if not path.exists():
        return keys
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        keys.add(normalize(line.split(';', 1)[0]))
    return keys


def is_allowed(value: str, rel_path: str, allow: set[str]) -> bool:
    key = normalize(value)
    if key not in allow and not (key.startswith('CZ') and key[2:] in allow):
        return False
    return any(fnmatch.fnmatch(rel_path, scope) for scope in ALLOW_SCOPES)


def is_exempt(rel_path: str) -> bool:
    return rel_path in EXEMPT_FILES or any(rel_path.startswith(d) for d in EXEMPT_DIRS)


def redact(value: str) -> str:
    return value[:3] + '…' + value[-1:] if len(value) > 4 else '…'


def scan_lines(rel_path: str, lines: list[tuple[int, str]], allow: set[str]) -> list[str]:
    if is_exempt(rel_path):
        return []
    out: list[str] = []
    name_hits = find_hits(rel_path) + find_hits(re.sub(r'[/_.-]', ' ', rel_path))
    for kind, value in dict(((k, v), None) for k, v in name_hits):
        if not is_allowed(value, rel_path, allow):
            out.append(f'{rel_path}:0: {kind} in file name ({redact(value)})')
    for lineno, text in lines:
        for kind, value in find_hits(text):
            if not is_allowed(value, rel_path, allow):
                out.append(f'{rel_path}:{lineno}: {kind} ({redact(value)})')
    return out


def is_binary(path: Path) -> bool:
    try:
        return b'\0' in path.read_bytes()[:8192]
    except OSError:
        return True


def scan_paths(paths: list[str], allow: set[str], root: Path = ROOT) -> list[str]:
    out: list[str] = []
    for p in paths:
        base = Path(p) if Path(p).is_absolute() else root / p
        files = [base] if base.is_file() else sorted(f for f in base.rglob('*') if f.is_file())
        for f in files:
            rel = f.resolve().relative_to(root.resolve()).as_posix()
            if is_exempt(rel) or is_binary(f):
                continue
            text = f.read_text(encoding='utf-8', errors='replace')
            out.extend(scan_lines(rel, list(enumerate(text.splitlines(), 1)), allow))
    return out


def scan_diff(rev_range: str, allow: set[str], root: Path = ROOT) -> list[str]:
    diff = subprocess.run(
        ['git', 'diff', '--unified=0', '--no-color', '--diff-filter=AMR', rev_range],
        cwd=root, capture_output=True, text=True, check=True, encoding='utf-8', errors='replace',
    ).stdout
    added_names = subprocess.run(
        ['git', 'diff', '--name-only', '--diff-filter=AR', rev_range],
        cwd=root, capture_output=True, text=True, check=True, encoding='utf-8', errors='replace',
    ).stdout.split()
    out: list[str] = []
    seen: set[str] = set()
    rel = ''
    lines: list[tuple[int, str]] = []
    lineno = 0

    def flush() -> None:
        if rel:
            seen.add(rel)
            out.extend(scan_lines(rel, lines, allow))

    for line in diff.splitlines():
        if line.startswith('+++ '):
            flush()
            rel = line[4:].removeprefix('b/') if line != '+++ /dev/null' else ''
            lines = []
        elif line.startswith('@@'):
            m = re.search(r'\+(\d+)', line)
            lineno = int(m.group(1)) if m else 0
        elif line.startswith('+') and not line.startswith('+++'):
            lines.append((lineno, line[1:]))
            lineno += 1
    flush()
    for name in added_names:  # binary adds have no '+++' line; their names are still checked
        if name not in seen:
            out.extend(scan_lines(name, [], allow))
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Czech PII guard')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--diff', metavar='RANGE', help='git diff range, e.g. origin/main...HEAD')
    group.add_argument('--all', nargs='+', metavar='PATH', help='scan every text file under PATH')
    parser.add_argument('--allowlist', default=str(ALLOWLIST_PATH))
    args = parser.parse_args(argv)
    allow = load_allowlist(Path(args.allowlist))
    hits = scan_diff(args.diff, allow) if args.diff else scan_paths(args.all, allow)
    for hit in hits:
        print(hit)
    if hits:
        print(f'pii_guard: {len(hits)} hit(s). Anonymize the value, or allowlist a public or '
              f'synthetic one in {ALLOWLIST_PATH.relative_to(ROOT).as_posix()}.')
        return 1
    print('pii_guard: OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
```

Command: `python3 -c "import ast,sys; ast.parse(open('scripts/pii_guard.py').read()); print('syntax ok')" 2>&1 | tail -3` → `syntax ok`. Then `chmod +x scripts/pii_guard.py`.

### Step 2: `scripts/test/test_pii_guard.py` (new)

Full content (the tests are the spec; do not edit this file):

```python
"""Tests for scripts/pii_guard.py (P0-PII-02). Run: python3 scripts/test/test_pii_guard.py

Every identifier below is synthetic: built to pass the checksum, taken from public
documentation examples (ČNB, IBAN registry) or from M06 §9 (the project's test RČ).
None belongs to a real person as far as the project knows.
"""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pii_guard  # noqa: E402

RC_SLASH = '900101/0007'
RC_BARE = '9001010007'
RC_WOMAN = '995101/0003'
RC_OLD_STYLE = '7707070008'
RC_BAD_CHECK = '900101/0008'
RC_BAD_MONTH = '901301/0007'
RC_M06 = '7801011229'  # allowlisted synthetic test RČ (M06 §9)

ACCOUNT_CNB = '19-2000145399/0800'  # ČNB documentation example
ACCOUNT_PLAIN = '1234562/0100'
ACCOUNT_SHORT = '51/2010'
ACCOUNT_BAD_CHECK = '1234567/0100'
ACCOUNT_BAD_PREFIX = '7777777-1234562/0100'
ACCOUNT_BAD_BANK = '1234562/9999'
ACCOUNT_ONE_NONZERO = '0000000010/0100'

IBAN_CZ = 'CZ7301000000000000000019'
IBAN_CZ_CNB = 'CZ65 0800 0000 1920 0014 5399'
IBAN_DE = 'DE89370400440532013000'
IBAN_BAD_CHECK = 'CZ7401000000000000000019'
IBAN_BAD_LENGTH = 'CZ730100000000000000019'

DIC_NATURAL = 'CZ9001010007'
DIC_COMPANY = 'CZ27074358'
DIC_FS_ASSIGNED = 'CZ699001234'
DIC_NINE_DIGITS_NOT_RC = 'CZ682980583'
DIC_BAD_CHECK = 'CZ9001010008'

ALLOWLIST = f'# value;reason;source\n{RC_M06};synthetic test RČ;M06 §9\nCZ27074358;IČO test vector;M03 §4.2\n'


def kinds(text):
    return [kind for kind, _ in pii_guard.find_hits(text)]


class ChecksumTests(unittest.TestCase):
    def test_rc_valid(self):
        for value in (RC_BARE, RC_WOMAN.replace('/', ''), RC_OLD_STYLE, RC_M06, '530101001'):
            self.assertTrue(pii_guard.rc_valid(value), value)

    def test_rc_invalid(self):
        for value in ('9001010008', '9013010007', '9002300007', '540101001', '12345', 'abcdefghij'):
            self.assertFalse(pii_guard.rc_valid(value), value)

    def test_rc_historic_exception(self):
        # first nine digits mod 11 == 10 and the tenth digit 0 was issued until 1985
        self.assertEqual(540101011 % 11, 10)
        self.assertTrue(pii_guard.rc_valid('5401010110'))
        self.assertFalse(pii_guard.rc_valid('5401010111'))

    def test_account_parts(self):
        self.assertTrue(pii_guard.account_part_valid('19'))
        self.assertTrue(pii_guard.account_part_valid('2000145399'))
        self.assertFalse(pii_guard.account_part_valid('1234567'))
        self.assertFalse(pii_guard.account_part_valid('12345678901'))

    def test_account(self):
        self.assertTrue(pii_guard.cz_account_valid('19', '2000145399', '0800'))
        self.assertTrue(pii_guard.cz_account_valid(None, '1234562', '0100'))
        self.assertFalse(pii_guard.cz_account_valid(None, '1234562', '9999'))
        self.assertFalse(pii_guard.cz_account_valid('7777777', '1234562', '0100'))
        self.assertFalse(pii_guard.cz_account_valid(None, '0000000010', '0100'))

    def test_iban(self):
        for value in (IBAN_CZ, IBAN_CZ_CNB, IBAN_DE):
            self.assertTrue(pii_guard.iban_valid(value), value)
        for value in (IBAN_BAD_CHECK, IBAN_BAD_LENGTH, 'XX7301000000000000000019'):
            self.assertFalse(pii_guard.iban_valid(value), value)


class FindHitsTests(unittest.TestCase):
    def test_each_kind_is_found(self):
        self.assertEqual(kinds(f'rc: {RC_SLASH}'), ['rodne_cislo'])
        self.assertEqual(kinds(f'rc: {RC_BARE}'), ['rodne_cislo'])
        self.assertEqual(kinds(f'rc: {RC_WOMAN}'), ['rodne_cislo'])
        self.assertEqual(kinds(f'ucet: {ACCOUNT_CNB}'), ['cz_account'])
        self.assertEqual(kinds(f'ucet: {ACCOUNT_PLAIN}'), ['cz_account'])
        self.assertEqual(kinds(f'ucet: {ACCOUNT_SHORT}'), ['cz_account'])
        self.assertEqual(kinds(f'iban: {IBAN_CZ}'), ['iban'])
        self.assertEqual(kinds(f'iban: {IBAN_CZ_CNB}'), ['iban'])
        self.assertEqual(kinds(f'iban: {IBAN_DE}'), ['iban'])
        self.assertEqual(kinds(f'dic: {DIC_NATURAL}'), ['dic_natural_person'])

    def test_company_dic_and_fs_assigned_pass(self):
        for value in (DIC_COMPANY, DIC_FS_ASSIGNED, DIC_NINE_DIGITS_NOT_RC, DIC_BAD_CHECK):
            self.assertEqual(kinds(f'dic: {value}'), [], value)

    def test_checksum_invalid_passes(self):
        for value in (RC_BAD_CHECK, RC_BAD_MONTH, ACCOUNT_BAD_CHECK, ACCOUNT_BAD_PREFIX,
                      ACCOUNT_BAD_BANK, ACCOUNT_ONE_NONZERO, IBAN_BAD_CHECK, IBAN_BAD_LENGTH):
            self.assertEqual(kinds(f'x: {value}'), [], value)

    def test_everyday_numbers_pass(self):
        for text in ('tel. 601 234 567', 'faktura 2026091', 'dne 12/2024', 'id 1049528146',
                     '4021738955.pdf', 'ts 1760000000', 'uuid 5b2e41c7-8d03-4a9f-b7e6-1c40f93a52d8',
                     'ICO 27074358', 'DIC CZ27081052', 'hash 0xdeadbeefcafe', '19-2000145399'):
            self.assertEqual(kinds(text), [], text)

    def test_token_boundaries(self):
        self.assertEqual(kinds(f'x{RC_BARE}'), [])
        self.assertEqual(kinds(f'{RC_BARE}1'), [])
        self.assertEqual(kinds(f'"{RC_BARE}"'), ['rodne_cislo'])
        self.assertEqual(kinds(f'({ACCOUNT_PLAIN})'), ['cz_account'])

    def test_redact_hides_the_value(self):
        self.assertNotIn(RC_BARE[3:-1], pii_guard.redact(RC_BARE))


class RepoTests(unittest.TestCase):
    """Writes synthetic values into a temporary git repository and scans it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'testdata').mkdir()
        (self.root / 'testdata' / 'pii-allowlist.txt').write_text(ALLOWLIST, encoding='utf-8')
        self.allow = pii_guard.load_allowlist(self.root / 'testdata' / 'pii-allowlist.txt')
        self.git('init', '-q')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('config', 'user.name', 'test')
        self.git('add', '.')
        self.git('commit', '-q', '-m', 'base')

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        subprocess.run(['git', *args], cwd=self.root, check=True, capture_output=True)

    def write(self, rel, text):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')

    def hits_all(self, *paths):
        return pii_guard.scan_paths(list(paths), self.allow, root=self.root)

    def test_each_kind_fails_in_every_code_location(self):
        for rel in ('apps/web/src/page.ts', 'packages/domain/src/x.ts', 'testdata/golden-v1/labels.json'):
            for value, kind in ((RC_SLASH, 'rodne_cislo'), (ACCOUNT_CNB, 'cz_account'),
                                (IBAN_CZ, 'iban'), (DIC_NATURAL, 'dic_natural_person')):
                self.write(rel, f'const v = "{value}";\n')
                hits = self.hits_all(rel)
                self.assertEqual(len(hits), 1, (rel, value, hits))
                self.assertIn(f'{rel}:1: {kind} (', hits[0])
                self.assertNotIn(value, hits[0])

    def test_company_dic_and_invalid_checksum_pass(self):
        self.write('packages/domain/src/ok.ts',
                   f'{DIC_COMPANY} {RC_BAD_CHECK} {ACCOUNT_BAD_CHECK} {IBAN_BAD_CHECK}\n')
        self.assertEqual(self.hits_all('packages/domain/src/ok.ts'), [])

    def test_allowlist_scope(self):
        for rel in ('testdata/golden-v1/labels.json', 'packages/domain/test/fixture.ts',
                    'packages/tax-xml/fixtures/dpfdp7.xml'):
            self.write(rel, f'rc {RC_M06} dic CZ{RC_M06} slash 780101/1229\n')
            self.assertEqual(self.hits_all(rel), [], rel)
        for rel in ('packages/domain/src/x.ts', 'apps/web/src/y.ts'):
            self.write(rel, f'rc {RC_M06}\n')
            self.assertEqual(len(self.hits_all(rel)), 1, rel)
        self.write('.gitleaks.toml', f"regexes = ['''780101/1229''', '''{RC_M06}''']\n")
        self.assertEqual(self.hits_all('.gitleaks.toml'), [])

    def test_exempt_and_binary_files_are_skipped(self):
        self.write('scripts/test/test_pii_guard.py', f'X = "{RC_SLASH}"\n')
        (self.root / 'testdata' / 'bin.pdf').write_bytes(b'%PDF\0' + RC_BARE.encode())
        self.assertEqual(self.hits_all('scripts', 'testdata'), [])

    def test_file_name_is_scanned(self):
        self.write(f'testdata/golden-v1/docs/DPHDP3-{RC_BARE}-x.txt', 'nothing\n')
        hits = self.hits_all('testdata')
        self.assertEqual(len(hits), 1, hits)
        self.assertIn(':0: rodne_cislo in file name', hits[0])

    def test_diff_mode_scans_only_added_lines(self):
        self.write('packages/bank/src/a.ts', 'line one\nline two\n')
        self.git('add', '.')
        self.git('commit', '-q', '-m', 'clean')
        self.write('packages/bank/src/a.ts', f'line one\nline two\nconst i = "{IBAN_CZ}";\n')
        self.write('packages/bank/src/b.ts', f'// {RC_SLASH}\n')
        (self.root / 'testdata' / f'DPHDP3-{RC_BARE}.pdf').write_bytes(b'%PDF\0binary')
        self.git('add', '.')
        self.git('commit', '-q', '-m', 'dirty')
        hits = pii_guard.scan_diff('HEAD~1..HEAD', self.allow, root=self.root)
        self.assertEqual(sorted(h.split(' (')[0] for h in hits),
                         ['packages/bank/src/a.ts:3: iban', 'packages/bank/src/b.ts:1: rodne_cislo',
                          f'testdata/DPHDP3-{RC_BARE}.pdf:0: rodne_cislo in file name'])
        self.assertEqual(pii_guard.scan_diff('HEAD~2..HEAD~1', self.allow, root=self.root), [])


if __name__ == '__main__':
    unittest.main()
```

Command: `python3 scripts/test/test_pii_guard.py 2>&1 | tail -5` → `Ran 18 tests`, `OK`. (The allowlist file does not exist yet; the tests build their own.)

### Step 3: `testdata/pii-allowlist.txt` (new)

Full content (ASCII only; `RC`, `ICO` without diacritics, so the file is safe for every tool):

```text
# Czech PII guard allowlist (scripts/pii_guard.py). One value per line: value;reason;source
# Accepted only under testdata/, packages/*/test/, packages/*/fixtures/, docs/ and .gitleaks.toml. Never a real person.
7801011229;synthetic test RC for the DPFDP7 partial XML tests;docs/v3/modules/M06 section 9 item 5
27074358;ICO mod-11 test vector (company id, public);docs/v3/modules/M03 section 4.2 icoValid
```

Command: `python3 scripts/pii_guard.py --all apps packages scripts testdata 2>&1 | tail -12` → 8 redacted hits, all under `testdata/golden-v1/` (`…DPHDP3-…pdf:0: rodne_cislo in file name (780…9)` and seven `labels.json:<n>: dic_natural_person (CZ8…1)` / `(CZ8…5)` lines), then `pii_guard: 8 hit(s). …`. Exit code 1 is expected here. If the count differs, note it in the report and continue.

### Step 4: `docs/context/test-map.md` (edit)

Anchor (must be found verbatim):

```markdown
| Agent context (`AGENTS.md`, `docs/context/`, `docs/tasks/`) | `python3 scripts/context_lint.py` |
```

Insert directly after it:

```markdown
| `scripts/` (Python guards) | `python3 scripts/test/test_pii_guard.py` and `python3 scripts/pii_guard.py --all apps packages scripts testdata` |
```

Command: `python3 scripts/context_lint.py 2>&1 | tail -8` → no error naming `test-map.md` or `0012a`.

### Step 5: self-check in diff mode

Command: `python3 scripts/pii_guard.py --diff origin/phase/0...HEAD 2>&1 | tail -5` → `pii_guard: OK` (your own commits add no identifier outside the exempt files). If it reports a hit in a file you wrote, you mistyped a value: compare with this brief, fix, re-run.

## 5. Do not touch

`testdata/golden-v1/**` (the 8 hits are the owner's decision), `apps/`, `packages/`, `.gitleaks.toml`, `.github/workflows/ci.yml` (part b), `scripts/gitleaks_selftest.sh`, `docs/` other than the two files in §3. Hard rules: 4 (never write a real identifier anywhere, never print an unredacted value, never commit a real document), 7 (no dependency; the script is stdlib only), 8 (never push to `main`).

## 6. Commands

- `python3 scripts/test/test_pii_guard.py 2>&1 | tail -5` → `Ran 18 tests … OK`
- `python3 scripts/pii_guard.py --all apps packages scripts testdata 2>&1 | tail -12` → 8 hits under `testdata/golden-v1/`, exit 1 (expected; see Step 3)
- `python3 scripts/pii_guard.py --diff origin/phase/0...HEAD 2>&1 | tail -5` → `pii_guard: OK`
- `python3 scripts/context_lint.py 2>&1 | tail -8` → no error for your files
- `pnpm lint 2>&1 | tail -5` → unchanged (Biome ignores `.py` and `.txt`)

## 7. Acceptance

- [ ] `scripts/pii_guard.py` (stdlib only) scans added lines of a diff (`--diff <range>`) or paths (`--all`); RČ (mod 11 + date), CZ account (weights `6,3,7,9,10,5,8,4,2,1` + known bank code), IBAN (mod 97), `CZ` + 9–10 digits passing the RČ check.
- [ ] `scripts/test/test_pii_guard.py` passes: each identifier type fails in `apps/`, `packages/*/src` and `testdata/`; `CZ` + 8 digits passes; checksum-invalid strings pass.
- [ ] `testdata/pii-allowlist.txt` exists in `value;reason;source` form; its values are accepted only under `testdata/`, `packages/*/test/`, `packages/*/fixtures/` (plus `docs/` and `.gitleaks.toml`), proven by `test_allowlist_scope`.
- [ ] Not in this brief: the CI job `pii` and the gitleaks patterns (ticket items 4) come with 0012b.
- [ ] The report lists the 8 redacted golden-set hits for the owner.

## 8. Stop and ask

Stop, and write the report, if:

- an anchor is not found;
- a test fails twice (compare the file byte for byte with this brief first; a typo in a digit is the usual cause), or a test seems wrong;
- you reach 25 tool calls or about 50k tokens (write the report as `blocked`, see executor.md);
- a new dependency seems needed;
- a file outside §3 needs a change;
- §5 would be touched;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy (hand that to the owner with the exact command).

## 9. Report

Write `docs/tasks/0012a-report.md` (600 tokens at most) and set `Status: review` in this brief. The report has:

1. The files changed (`git diff --stat origin/phase/0 2>&1 | tail -10`).
2. Each command, with the last 5 lines of its output (redacted lines only, as the script prints them).
3. §7 ticked.
4. Deviations.
5. Questions.
6. Owner steps left (copy the Owner steps below).

Commit `0012a report`, then `git push -u origin task/0012a-pii-guard 2>&1 | tail -5`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `scripts/pii_guard.py`: `EXEMPT_DIRS` and `ALLOW_SCOPES` are the only holes; they must stay as listed (`docs/tasks/`, `scripts/test/`, the allowlist file). `redact()` must never expose more than three leading and one trailing character.
- `testdata/pii-allowlist.txt`: one synthetic RČ and one public IČO only. Any added line is a review question.
- The two natural-person DIČ values and the file name under `testdata/golden-v1/` are pre-existing, real-looking personal data in the repository (Owner step 1). The guard scans only added lines in CI (0012b), so they do not block other PRs until the owner decides.

## Owner steps

1. Read the 8 redacted hits in `docs/tasks/0012a-report.md`. They point at two 10-digit natural-person DIČ values in `testdata/golden-v1/labels.json` and one PDF whose file name carries the same kind of number. If they belong to real people (a supplier, or you), ask the orchestrator for a follow-up brief that replaces them with synthetic values (and renames the PDF). If they are already synthetic, add each to `testdata/pii-allowlist.txt` with a reason.
2. Optional, after 0012b: the `[verify]` bank-code list in `scripts/pii_guard.py` can be checked against the ČNB "Kódy platebního styku" CSV when you have 10 minutes; a missing code only means one more false negative in the guard.
