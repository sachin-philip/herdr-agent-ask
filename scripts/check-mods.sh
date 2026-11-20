#!/bin/sh
# Loads each mod once in the Herdr app's checker (a hidden window) and fails on the first
# error. Needs the Herdr desktop app installed (`herdr-app` on PATH). Run before committing.
set -e
cd "$(dirname "$0")/.."
status=0
for m in asks tabs-asks spaces-asks; do
  if out=$(herdr-app check "mods/$m" 2>&1); then echo "check $m: ok"; else echo "check $m: FAILED"; echo "$out"; status=1; fi
done
exit $status
