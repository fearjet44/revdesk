#!/usr/bin/env bash
# Slice 9 — managed ROR / LOEP / LOES / TOC.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REVDESK=(node --experimental-strip-types "$ROOT/cli/revdesk.ts")
WORK="$(mktemp -d "${TMPDIR:-/tmp}/revdesk-slice9.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

pass=0
fail=0

expect_exit() {
  local want="$1"
  shift
  set +e
  out="$("${REVDESK[@]}" "$@" 2>&1)"
  code=$?
  set -e
  if [[ "$code" -eq "$want" ]]; then
    pass=$((pass + 1))
    echo "OK  exit $want :: $*"
  else
    fail=$((fail + 1))
    echo "FAIL want exit $want got $code :: $*"
    echo "$out"
  fi
}

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
unit="$(node --experimental-strip-types "$ROOT/scripts/managed-leaves-check.ts" 2>&1)"
code=$?
set -e
if [[ "$code" -eq 0 ]]; then
  pass=$((pass + 1))
  echo "OK  managed-leaves-check"
else
  fail=$((fail + 1))
  echo "FAIL managed-leaves-check"
  echo "$unit"
fi

echo "=== 2 CLI refuses managed Open ==="
export REVDESK_DATA="$WORK"
expect_ok ingest scaffold --catalog gom-lep --out "$WORK"
expect_exit 2 change start --manual gom-lep --title "no" --reason "no" --section gomlep-ror
contains "$out" "automatically managed" "ror refuse message"
expect_ok --json change start --manual gom-lep --title "working" --reason "working" --section gomlep-1
contains "$out" "gomlep-1" "procedure still opens"

echo "slice9 $pass passed, $fail failed"
if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
