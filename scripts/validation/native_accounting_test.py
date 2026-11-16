import tempfile
import unittest
from pathlib import Path
from native_accounting import account, reports_for, BROKER_CLASS, BROKER_TESTS


class NativeAccountingTests(unittest.TestCase):
    def report(self, xml):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'TEST-fixture.xml'
            path.write_text(xml)
            return account([path])

    def test_only_explicit_real_broker_skips_are_allowed(self):
        cases = ''.join(f'<testcase classname="{BROKER_CLASS}" name="{name}"><skipped/></testcase>' for name in BROKER_TESTS)
        result = self.report('<testsuite>' + cases + '<testcase classname="safety" name="finite"/></testsuite>')
        self.assertEqual(result['counts'], {'passed': 1, 'skipped': 3, 'failed': 0})
        self.assertEqual(result['problems'], [])

    def test_missing_tests_unknown_skips_failures_and_errors_are_not_green(self):
        self.assertTrue(account([])['problems'])
        for content in ('<skipped/>', '<failure message="bad"/>', '<error message="bad"/>'):
            result = self.report(f'<testsuite><testcase classname="safety" name="finite">{content}</testcase></testsuite>')
            self.assertTrue(result['problems'])

    def test_isolated_companion_reports_are_counted_once_and_others_ignored(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for task, name in (('testDebugUnitTest', 'A'), ('testDebugUnitTestNativeGraphics', 'B'), ('testReleaseUnitTest', 'C')):
                folder = root / 'gauge/build/test-results' / task
                folder.mkdir(parents=True)
                (folder / f'TEST-{name}.xml').write_text('<testsuite/>')
            self.assertEqual([p.name for p in reports_for(root, 'gauge')], ['TEST-A.xml', 'TEST-B.xml'])


if __name__ == '__main__':
    unittest.main()
