"""Account for Android JVM results; absence of a broker never counts as transport verification."""
import json
import os
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

BROKER_CLASS = 'com.pulseloop.broadcasting.MqttTransportSmokeTest'
BROKER_TESTS = {
    'Paho invalid credentials make one MQTT 3_1_1 attempt',
    'Paho publisher reaches a real subscriber',
    'Paho publisher preserves one topic order across one hundred inflight messages',
}


def account(paths):
    counts = {'passed': 0, 'skipped': 0, 'failed': 0}
    exceptions = []
    problems = []
    for path in paths:
        suite = ET.parse(path).getroot()
        for case in suite.iter('testcase'):
            identity = {'class': case.get('classname'), 'name': case.get('name')}
            if case.find('failure') is not None or case.find('error') is not None:
                counts['failed'] += 1
                problems.append(f'Failed native test: {identity}')
            elif case.find('skipped') is not None:
                counts['skipped'] += 1
                allowed = identity['class'] == BROKER_CLASS and identity['name'] in BROKER_TESTS
                exceptions.append({**identity, 'reason': 'Opt-in real MQTT broker not configured' if allowed else 'Unaccounted skip'})
                if not allowed:
                    problems.append(f'Unaccounted native skip: {identity}')
            else:
                counts['passed'] += 1
    if not sum(counts.values()):
        problems.append('No native test cases found')
    return {'counts': counts, 'exceptions': exceptions, 'problems': problems}


def main():
    root = Path('apps/android/android')
    paths = []
    missing = []
    for module in ('gauge', 'app'):
        reports = list((root / module / 'build/test-results/testDebugUnitTest').glob('TEST-*.xml'))
        paths.extend(reports)
        if not reports:
            missing.append(f'Missing {module} unit-test XML reports')
    result = account(paths)
    result['runId'] = os.environ.get('VITALS_NATIVE_RUN_ID')
    result['problems'].extend(missing)
    result['status'] = 'failed' if result['problems'] else 'passed'
    destination = Path('.vitest/release/native.json')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    return 1 if result['problems'] else 0


if __name__ == '__main__':
    sys.exit(main())
