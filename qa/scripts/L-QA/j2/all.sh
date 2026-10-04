#!/usr/bin/env bash
# J2 whole phone run under one ring + phone hold (~28 min): phase 1, screen-off phase 2, reconnect phase 3.
D=/media/DEV/Hobby/vitals-wt/L-QA/qa/scripts/L-QA/j2
grep -E '^- 1[7-9]:' /media/DEV/Hobby/vitals-wt/.jobs/NOTICES.md | tail -3
$D/phase1.sh; echo "phase1 rc=$?"
$D/phase2.sh 15; echo "phase2 rc=$?"
$D/phase3.sh; echo "phase3 rc=$?"
# leave the ring free for the next worker: Vitals stopped (Lumen is NOT relaunched)
source $D/lib.sh; $A shell am force-stop desi.creative.vitals; $A forward --remove tcp:9334 2>/dev/null; echo "vitals stopped $(ts)"
