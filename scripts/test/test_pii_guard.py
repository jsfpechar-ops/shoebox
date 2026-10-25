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
