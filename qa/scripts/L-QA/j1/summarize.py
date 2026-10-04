#!/usr/bin/env python3
"""J1: after run B, append a public-safe summary to qa/results/L-QA/j1-ring-pc.md and write the raw Lumen comparison
to private/j1/j1-compare.md. Tracked output holds only verdicts, counts, durations and difference sizes."""
import glob, json, os, re, sqlite3, sys
from datetime import datetime, timezone, timedelta

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
PRIV = os.path.join(REPO, 'qa/results/L-QA/private/j1')
OUT = os.path.join(REPO, 'qa/results/L-QA/j1-ring-pc.md')
IST = timezone(timedelta(hours=5, minutes=30))
FROM = datetime(2026, 10, 3, 20, 0, tzinfo=IST).timestamp() * 1000
TO = datetime(2026, 10, 4, 10, 0, tzinfo=IST).timestamp() * 1000
pub, prv = [], []

log = open(os.path.join(PRIV, 'runB.log'), errors='ignore').read() if os.path.exists(os.path.join(PRIV, 'runB.log')) else ''
m = re.search(r'^exit (\d+)', log, re.M)
pub.append(f'- Locked run B finished: {"yes, exit " + m.group(1) if m else "no (still queued or running at summary time)"}; '
           f'lock wait timed out: {"yes" if "rc=1" in log and "j1 run.sh" not in log else "no"}.')

ui = os.path.join(PRIV, 'j1-ui.json')
if os.path.exists(ui):
    u = json.load(open(ui))
    a = u.get('afterClick', {})
    pub.append(f'- UI journey: onboarding {u.get("onboard", {}).get("ok")}; /ring shows "{(u.get("ring-before") or {}).get("text", "?").splitlines()[-1] if u.get("ring-before") else "?"}"; '
               f'/signals shows "{(u.get("signals-before") or {}).get("text", "?").splitlines()[-1] if u.get("signals-before") else "?"}".')
    pub.append(f'- Settings › Devices "Connect" for the J-Style ring: device lists sent by the shell in {a.get("watchedS")} s = {a.get("lists")} '
               f'(largest {a.get("maxLen")} device(s), first after {a.get("firstDeviceListMs")} ms); chooser/dialog shown by the app: {len(a.get("dialogs", []))}; '
               f'password/passcode/key fields: {len(a.get("secretFields", []))}; live messages: {len(a.get("live", []))}.')
    p = u.get('pick')
    if isinstance(p, dict):
        live = ' | '.join(p.get('live', []))[:300]
        dev = p.get('devices', '')
        recs = re.findall(r'(\d[\d,]*) records?', dev)
        pub.append(f'- After the emulated pick (the shell bridge\'s choose(), what a chooser would do): {round(p.get("ms", 0) / 1000)} s watched; '
                   f'Devices section record counts shown: {recs or "none"}; live message: "{re.sub(r"[0-9]{1,2}:[0-9]{2}", "hh:mm", live)}".')
        prv.append(f'## UI after pick\n```\n{dev}\n{live}\n```')
    elif p:
        pub.append(f'- Emulated pick: {p}')
    if u.get('error'):
        pub.append(f'- UI journey error: `{u["error"]}`')
    pub.append(f'- Console errors/warnings in the UI run: {len(u.get("consoleErrors", []))} (text in private/j1/j1-ui.log); UI run {u.get("totalS")} s.')

proofs = sorted(glob.glob(os.path.join(PRIV, 'proof-j1-*.json')))
pr = json.load(open(proofs[-1]))['result'] if proofs else None
if pr:
    ln = pr.get('lastNight') or {}
    pub.append(f'- Transport proof (J1 proof page = L-DESKTOP Electron transport + chooser factory + J-Style 2301 family, inside the packaged app): '
               f'{"FAIL `" + pr["error"] + "`" if pr.get("error") else "OK"}; connect {pr.get("connectMs")} ms, handshake {pr.get("handshakeMs")} ms, '
               f'firmware {"read" if pr.get("firmware") else "none"}, battery {"read" if pr.get("battery") is not None else "none"}, history sync {pr.get("syncMs")} ms '
               f'({pr.get("progressSteps")} progress steps), events {json.dumps(pr.get("byType"))}, samples by stream {json.dumps(pr.get("samplesByStream"))}, '
               f'sleep blocks {pr.get("sleep", {}).get("blocks")}, nights {pr.get("sleep", {}).get("nights")}, ring errors {len(pr.get("errors", []))}, '
               f'reconnect without a list {pr.get("reconnectMs")} ms, wall {pr.get("wallS")} s. Nothing typed; no name/key entered.')
    prv.append(f'## Ring (PC proof) raw\n```json\n{json.dumps(pr, indent=1)}\n```')

# Lumen database (copied read-only from the phone)
dbs = sorted(glob.glob(os.path.join(PRIV, 'lumen-db-*')))
lum = {}
if dbs:
    d = dbs[-1]
    files = [f for f in os.listdir(d) if not f.endswith(('-wal', '-shm', '-journal'))]
    prv.append(f'## Lumen DB copy {os.path.basename(d)}: {sorted(os.listdir(d))}')
    for f in files:
        try:
            con = sqlite3.connect(f'file:{os.path.join(d, f)}?mode=ro', uri=True)
            tabs = [r[0] for r in con.execute("select name from sqlite_master where type='table'")]
        except Exception as e:
            prv.append(f'- {f}: {e}')
            continue
        prv.append(f'### {f}\n' + '\n'.join(f'- {t}: {[c[1] for c in con.execute(f"pragma table_info(`{t}`)")]} rows={con.execute(f"select count(*) from `{t}`").fetchone()[0]}' for t in tabs))
        for t in tabs:
            cols = [c[1] for c in con.execute(f'pragma table_info(`{t}`)')]
            low = {c.lower(): c for c in cols}
            tcol = next((low[k] for k in low if k in ('timestamp', 'timestampms', 'timestamp_ms', 'time', 'at', 'recordedat', 'recorded_at')), None)
            if re.search(r'measurement', t, re.I) and tcol:
                kcol = next((low[k] for k in low if k in ('kind', 'type', 'measurementkind')), None)
                vcol = next((low[k] for k in low if k in ('value', 'val', 'numericvalue')), None)
                if kcol and vcol:
                    rows = con.execute(f'select `{tcol}`,`{vcol}` from `{t}` where `{kcol}`=\'HEART_RATE\' and `{tcol}`>=? and `{tcol}`<? order by 1', (FROM, TO)).fetchall()
                    if not rows:  # seconds?
                        rows = con.execute(f'select `{tcol}`*1000,`{vcol}` from `{t}` where `{kcol}`=\'HEART_RATE\' and `{tcol}`>=? and `{tcol}`<? order by 1', (FROM / 1000, TO / 1000)).fetchall()
                    vs = [r[1] for r in rows if r[1] is not None]
                    lum['hr'] = {'n': len(vs), 'min': min(vs) if vs else None, 'max': max(vs) if vs else None, 'avg': round(sum(vs) / len(vs), 1) if vs else None}
                    last = con.execute(f'select max(`{tcol}`) from `{t}`').fetchone()[0]
                    lum['lastMeasurement'] = last
            if re.search(r'sleep.*session', t, re.I):
                s = next((low[k] for k in low if 'start' in k), None)
                e = next((low[k] for k in low if 'end' in k), None)
                if s and e:
                    rows = con.execute(f'select * from `{t}` where `{s}`>=? and `{s}`<? order by `{s}`', (FROM, TO)).fetchall()
                    lum['sleepSessions'] = [dict(zip(cols, r)) for r in rows]
            if re.search(r'sleep.*(stage|block)', t, re.I):
                s = next((low[k] for k in low if 'start' in k), None)
                e = next((low[k] for k in low if 'end' in k), None)
                st = next((low[k] for k in low if 'stage' in k and k not in (s.lower() if s else '',)), None)
                if s and e and st:
                    rows = con.execute(f'select `{st}`, sum((`{e}`-`{s}`)/60000.0), min(`{s}`), max(`{e}`) from `{t}` where `{s}`>=? and `{s}`<? group by 1', (FROM, TO)).fetchall()
                    lum['stageMinutes'] = {str(r[0]): round(r[1], 1) for r in rows}
            if re.search(r'battery', t, re.I) and tcol:
                r = con.execute(f'select * from `{t}` order by `{tcol}` desc limit 1').fetchone()
                lum['battery'] = dict(zip(cols, r)) if r else None
    prv.append(f'## Lumen aggregates for 2026-10-03 20:00 → 10-04 10:00 IST\n```json\n{json.dumps(lum, indent=1, default=str)}\n```')

# difference sizes (public) when both sides exist
if pr and lum:
    ln = pr.get('lastNight') or {}
    diffs = []
    if lum.get('stageMinutes') and ln.get('minutes'):
        for k in ('deep', 'light', 'rem', 'awake'):
            a = ln['minutes'].get(k, 0)
            b = next((v for kk, v in lum['stageMinutes'].items() if kk.lower().startswith(k[:3])), None)
            if b is not None:
                diffs.append(f'{k} {abs(round(a - b))} min')
    hrw = (pr.get('hr') or {}).get('window') or {}
    if lum.get('hr') and hrw.get('n') is not None:
        diffs.append(f'HR samples in the 20:00–10:00 window differ by {abs(hrw["n"] - lum["hr"]["n"])} (ring re-read vs Lumen store)')
    pub.append(f'- Lumen comparison (automatic, raw numbers in private/j1/j1-compare.md): {", ".join(diffs) if diffs else "Lumen tables not matched automatically; see private/j1/j1-compare.md"}.')
elif not dbs:
    pub.append('- Lumen comparison: no copy of Lumen\'s phone database was made (run B did not reach the lumen step).')

open(os.path.join(PRIV, 'j1-compare.md'), 'a').write(f'\n# J1 compare ({datetime.now(IST).isoformat(timespec="minutes")})\n' + '\n\n'.join(prv) + '\n')
with open(OUT, 'a') as f:
    f.write(f'\n## Run B results (appended automatically by qa/scripts/L-QA/j1/summarize.py at {datetime.now(IST).strftime("%H:%M")} IST)\n' + '\n'.join(pub) + '\n')
print('\n'.join(pub))
