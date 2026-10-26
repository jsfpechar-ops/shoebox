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
accepted only under ``testdata/``, ``packages/*/test/``, ``apps/*/test/``, ``packages/*/fixtures/``,
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
ALLOW_SCOPES = ('testdata/*', 'packages/*/test/*', 'apps/*/test/*', 'packages/*/fixtures/*', 'docs/*', 'research/*', '.gitleaks.toml')

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
