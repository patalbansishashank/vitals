#!/bin/sh
# POST stdin (a JS async-function body) to the running J4 driver.
exec curl -s --max-time "${T:-180}" --data-binary @- "http://127.0.0.1:${J4_PORT:-47304}/eval"
