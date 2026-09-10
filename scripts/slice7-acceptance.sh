#!/usr/bin/env bash
# Slice 7 — dummy remote bind + ingest from file (structure, lorem bodies).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REVDESK=(node --experimental-strip-types "$ROOT/cli/revdesk.ts")
WORK="$(mktemp -d "${TMPDIR:-/tmp}/revdesk-slice7.XXXXXX")"
XDG="$(mktemp -d "${TMPDIR:-/tmp}/revdesk-slice7-xdg.XXXXXX")"
trap 'rm -rf "$WORK" "$XDG"' EXIT
export XDG_CONFIG_HOME="$XDG/config"
export XDG_DATA_HOME="$XDG/share"

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

echo "=== 1 config solo default ==="
expect_ok --json config show
contains "$out" '"bound": false' "unbound"
contains "$out" '"solo": true' "solo"

echo "=== 2 ingest apply nimbl fixture uses gold gom-lep ==="
export REVDESK_DATA="$WORK"
expect_ok --json ingest apply "$ROOT/fixtures/ingest/samples/nimbl-lep.txt"
contains "$out" '"matched_gold": true' "gold map"
contains "$out" '"id": "gom-lep"' "gom-lep id"
test -f "$WORK/manuals/gom-lep/manual.yaml"
test -f "$WORK/control/issues/GOML-R11.yaml"
pass=$((pass + 2))
echo "OK  gold ingest wrote manuals + baseline"

echo "=== 3 lorem only — no operator prose ==="
set +e
hits="$(rg -n -i "Premier Air Charter|Palomar Airport|Carlsbad, CA|Operations@Premier" "$WORK/manuals" || true)"
set -e
if [[ -z "$hits" ]]; then
  pass=$((pass + 1))
  echo "OK  sample bodies have no corpus operator prose"
else
  fail=$((fail + 1))
  echo "FAIL operator prose leaked into sample manuals"
  echo "$hits"
fi
contains "$(cat "$WORK/manuals/gom-lep/sections/"*section-01*)" "Company Policy, Procedures, and Rules of Conduct" "GOM section 1 title"

echo "=== 4 ingest file verb (no apply) + unknown LES book ==="
expect_ok ingest "$ROOT/fixtures/ingest/samples/les-handbook.txt"
test -d "$WORK/manuals"
pass=$((pass + 1))
echo "OK  ingest <file> wrote a book from the LES map"

echo "=== 5 library snapshot when the tree is its own repo ==="
GITLIB="$(mktemp -d "${TMPDIR:-/tmp}/revdesk-slice7-git.XXXXXX")"
trap 'rm -rf "$WORK" "$XDG" "$GITLIB"' EXIT
git init -q "$GITLIB"
git -C "$GITLIB" checkout -q -b main
export REVDESK_DATA="$GITLIB"
expect_ok --json ingest apply "$ROOT/fixtures/ingest/samples/nimbl-lep.txt"
contains "$out" '"skipped": false' "snapshot not skipped"
contains "$out" '"pushed": false' "no origin, no push"
if git -C "$GITLIB" log -1 --pretty=%s | grep -q "Ingest gom-lep"; then
  pass=$((pass + 1))
  echo "OK  ingest committed on the library tree"
else
  fail=$((fail + 1))
  echo "FAIL missing ingest commit"
  git -C "$GITLIB" log --oneline || true
fi

echo "=== 6 bind a local origin (not GitHub) ==="
unset REVDESK_DATA
BARE="$(mktemp -d "${TMPDIR:-/tmp}/revdesk-slice7-bare.XXXXXX")"
trap 'rm -rf "$WORK" "$XDG" "$GITLIB" "$BARE"' EXIT
git init -q --bare "$BARE/lib.git"
expect_ok config set remote "$BARE/lib.git"
contains "$out" "bound:    true" "bound after set"
CLONE="$XDG/share/revdesk/libraries"
if find "$CLONE" -name .git -prune | grep -q .; then
  pass=$((pass + 1))
  echo "OK  bind cloned the manuals library"
else
  fail=$((fail + 1))
  echo "FAIL bind did not clone"
  find "$XDG" -maxdepth 5 -type d || true
fi
expect_ok config set remote ""
contains "$out" "bound:    false" "unbind"

echo "=== 7 bytes ingest + config yaml ==="
set +e
node --experimental-strip-types "$ROOT/scripts/slice7-ingest-check.ts"
code=$?
set -e
if [[ "$code" -eq 0 ]]; then
  pass=$((pass + 1))
  echo "OK  ingest-check"
else
  fail=$((fail + 1))
  echo "FAIL ingest-check"
fi

echo
echo "PASS=$pass FAIL=$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
