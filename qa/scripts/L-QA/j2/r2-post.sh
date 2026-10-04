#!/usr/bin/env bash
# J2 round 2 clean-up/evidence (under hw-run.sh ring hw-run.sh phone): remove the QA read-interval key (and let the
# WebView flush it), list the times of ring samples taken after the screen went off, card state, Connect if needed.
source /media/DEV/Hobby/vitals-wt/L-QA/qa/scripts/L-QA/j2/lib.sh
P=/media/DEV/Hobby/vitals-wt/L-QA/qa/results/L-QA/round2/private/j2
R() { node $J2/r2.mjs "$@"; }
echo "== post $(ts)"; $A shell input keyevent KEYCODE_WAKEUP; sleep 1
need_front; fwd
R qatick off; sleep 15; R eval "return localStorage.getItem('vitals.ring.backgroundReadMinutes')" | sed 's/^/key after 15 s: /'
R eval "const V=window.__vitals; if(!V) return 'no hook'; const o={}; for (const m of ['hr','spo2','hrv','skin_temp']) { const s=await V.read('bio.series',{metric:m,from:new Date(Date.now()-864e5).toISOString().slice(0,10),to:new Date().toISOString().slice(0,10),resolution:'raw'}); o[m]=(s.output?.points??[]).map(p=>p.t<1e12?p.t*1000:p.t).filter(t=>t>=Date.parse('$1')).map(t=>new Date(t).toISOString().slice(11,19)); } return o;" > "$P/r2j2-18-sample-times.txt"; cat "$P/r2j2-18-sample-times.txt" | tr -d '\n ' | cut -c1-900; echo
R ringcard | tail -1 | sed -E 's/Heart rate now [0-9]+ bpm/live HR/' | cut -c1-250
R shell
echo "== post end $(ts)"
