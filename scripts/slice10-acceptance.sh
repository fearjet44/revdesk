#!/usr/bin/env bash
# Slice 10 — page ledger paginate / overflow / LEP from ledger.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REVDESK=(node --experimental-strip-types "$ROOT/cli/revdesk.ts")
WORK="$(mktemp -d "${TMPDIR:-/tmp}/revdesk-slice10.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

pass=0
fail=0

expect_ok() {
  set +e
  out="$("${REVDESK[@]}" "$@" 2>&1)"
  code=$?
  set -e
  if [[ "$code" -eq 0 ]]; then
    pass=$((pass + 1))
    echo "OK  :: $*"
  else
    fail=$((fail + 1))
    echo "FAIL exit $code :: $*"
    echo "$out"
  fi
}

contains() {
  local hay="$1" needle="$2" label="$3"
  if [[ "$hay" == *"$needle"* ]]; then
    pass=$((pass + 1))
    echo "OK  contains [$needle] — $label"
  else
    fail=$((fail + 1))
    echo "FAIL missing [$needle] — $label"
    echo "$hay"
  fi
}

echo "WORK=$WORK"

echo "=== 1 unit checks ==="
set +e
unit="$(node --experimental-strip-types "$ROOT/scripts/ledger-check.ts" 2>&1)"
code=$?
set -e
if [[ "$code" -eq 0 ]]; then
  pass=$((pass + 1))
  echo "OK  ledger-check"
else
  fail=$((fail + 1))
  echo "FAIL ledger-check"
  echo "$unit"
fi

echo "=== 2 ingest seeds ledger ==="
export REVDESK_DATA="$WORK"
expect_ok ingest scaffold --catalog gom-lep --out "$WORK"
test -f "$WORK/manuals/gom-lep/ledger.yaml"
pass=$((pass + 1))
echo "OK  ledger.yaml exists"
contains "$(cat "$WORK/manuals/gom-lep/ledger.yaml")" "control_surface: lep" "ledger surface"
expect_ok ledger show gom-lep
contains "$out" "gomlep-1" "ledger lists section 1"
contains "$out" "1-1" "ledger lists slot 1-1"

echo "slice10 $pass passed, $fail failed"
if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
