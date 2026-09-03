#!/usr/bin/env bash
# Slice 2 acceptance path — copies fixtures/tiny-gom to a temp workspace and runs checks.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REVDESK=(node --experimental-strip-types "$ROOT/cli/revdesk.ts")
SRC="$ROOT/fixtures/tiny-gom"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/revdesk-slice2.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

cp -R "$SRC/." "$WORK/"
export REVDESK_DATA="$WORK"
LETTERS="$WORK/letters"

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

file_absent() {
  if [[ ! -e "$1" ]]; then
    pass=$((pass + 1))
    echo "OK  absent $1"
  else
    fail=$((fail + 1))
    echo "FAIL should be absent: $1"
  fi
}

echo "WORK=$WORK"
echo "=== 1 issue without instrument → exit 2 ==="
set +e
out="$("${REVDESK[@]}" issue CHG-014 --effective 2026-09-15 2>&1)"
code=$?
set -e
if [[ "$code" -eq 2 ]] && [[ "$out" == *"tr issue"* || "$out" == *"instrument"* ]]; then
  pass=$((pass + 1))
  echo "OK  issue blocked with TR/instrument hint"
else
  fail=$((fail + 1))
  echo "FAIL step 1 code=$code"
  echo "$out"
fi

echo "=== 2 tr issue → GOM-R13-TR1 ==="
expect_ok tr issue CHG-014 --parent GOM-R13 --authority chief-pilot --file "$LETTERS/cp-tr-letter.txt" --expires 2026-12-15
contains "$("${REVDESK[@]}" tr show GOM-R13-TR1 2>&1)" "GOM-R13-TR1" "tr show"
expect_exit 2 change withdraw CHG-014 --why "should die"

echo "=== 3 launched gom ==="
launch="$("${REVDESK[@]}" launched gom)"
contains "$launch" "GOM-R13" "full R13"
contains "$launch" "GOM-R13-TR1" "active TR1"
contains "$launch" "14 (not launched)" "next full 14"

echo "=== 4 full issue with POI letter → GOM-R14, TR incorporated ==="
expect_ok change start --manual gom --title "Incorporate and advance" --reason-type opspec --ref A099 --section gom.ident
NEW="$("${REVDESK[@]}" change list --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const a=JSON.parse(s);console.log(a.find(c=>c.status==='draft').id)})")"
kind="$("${REVDESK[@]}" change show "$NEW" --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(s).kind)))")"
if [[ "$kind" == "null" ]]; then
  pass=$((pass + 1))
  echo "OK  start leaves kind unclassified"
else
  fail=$((fail + 1))
  echo "FAIL kind=$kind want null"
fi
expect_ok change submit "$NEW"
expect_ok change approve "$NEW" --role chief-pilot
expect_exit 2 issue "$NEW" --effective 2026-09-15
expect_ok change classify "$NEW" --kind rev
expect_ok instrument attach "$NEW" --file "$LETTERS/poi-acceptance.txt" --type acceptance-letter --authority poi --dated 2026-09-12 --reference "POI 2026-0912"
expect_ok issue "$NEW" --effective 2026-09-15
contains "$("${REVDESK[@]}" issue show GOM-R14 2>&1)" "GOM-R14" "issue show R14"
contains "$("${REVDESK[@]}" tr show GOM-R13-TR1 2>&1)" "incorporated_by GOM-R14" "TR incorporated"
contains "$("${REVDESK[@]}" launched gom 2>&1)" "GOM-R14" "launched R14"

echo "=== 5 withdraw after launch → exit 2 ==="
expect_exit 2 change withdraw "$NEW" --why "nope"

echo "=== 6 supersedes — new CHG, no R15 issue ==="
before_next="$("${REVDESK[@]}" launched gom --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).next_full))")"
expect_ok change start --manual gom --supersedes GOM-R14 --reason-type regulator --title "Regulator kickback fix" --section gom.ident
file_absent "$WORK/control/issues/GOM-R15.yaml"
after_next="$("${REVDESK[@]}" launched gom --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).next_full))")"
if [[ "$before_next" == "$after_next" ]]; then
  pass=$((pass + 1))
  echo "OK  next_revision unchanged after supersedes start ($after_next)"
else
  fail=$((fail + 1))
  echo "FAIL next_revision changed $before_next → $after_next"
fi
SUP="$("${REVDESK[@]}" change list --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const a=JSON.parse(s);console.log(a.find(c=>c.status==='draft'&&c.supersedes==='GOM-R14').id)})")"

echo "=== 7 issue supersedes CHG without letter → exit 2 ==="
expect_ok change submit "$SUP"
expect_ok change approve "$SUP" --role chief-pilot
expect_ok change classify "$SUP" --kind rev
expect_exit 2 issue "$SUP" --effective 2026-10-01
file_absent "$WORK/control/issues/GOM-R15.yaml"

echo "=== 8 return-to-edit from ready-to-launch ==="
expect_ok instrument attach "$SUP" --file "$LETTERS/poi-acceptance.txt" --type acceptance-letter --authority poi --dated 2026-09-20
next_before="$("${REVDESK[@]}" launched gom --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).next_full))")"
expect_ok change return-to-edit "$SUP"
st="$("${REVDESK[@]}" change show "$SUP" --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).status))")"
if [[ "$st" == "edit" ]]; then
  pass=$((pass + 1))
  echo "OK  status edit"
else
  fail=$((fail + 1))
  echo "FAIL status=$st want edit"
fi
next_after="$("${REVDESK[@]}" launched gom --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).next_full))")"
if [[ "$next_before" == "$next_after" ]]; then
  pass=$((pass + 1))
  echo "OK  next full unchanged ($next_after)"
else
  fail=$((fail + 1))
  echo "FAIL next full $next_before → $next_after"
fi

echo "=== 9–10 greenfield ==="
GF_WORK="$(mktemp -d "${TMPDIR:-/tmp}/revdesk-green.XXXXXX")"
mkdir -p "$GF_WORK/manuals/gom/sections" "$GF_WORK/control/changes" "$GF_WORK/control/issues" \
  "$GF_WORK/control/instruments" "$GF_WORK/control/trs" "$GF_WORK/artifacts" "$GF_WORK/letters"
cp "$LETTERS/internal-r1.txt" "$GF_WORK/letters/"
cat > "$GF_WORK/manuals/gom/manual.yaml" <<'YAML'
id: gom
title: Greenfield GOM
abbrev: GOM
control_class: internal
owner: Chief Pilot
authority: chief-pilot
instrument_required: true
current_issued: null
next_revision: 1
effective: null
YAML
cat > "$GF_WORK/manuals/gom/sections/001-intro.md" <<'MD'
---
id: gom.intro
title: Introduction
rev_last_changed: R0
---

# Introduction

Greenfield content.
MD
export REVDESK_DATA="$GF_WORK"
expect_ok change start --manual gom --title "Initial issue" --reason-type company --ref START --section gom.intro
GF="$("${REVDESK[@]}" change list --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const a=JSON.parse(s);console.log(a[0].id)})")"
expect_ok change submit "$GF"
expect_ok change approve "$GF" --role chief-pilot
expect_exit 2 tr issue "$GF" --parent GOM-R1 --authority chief-pilot --file "$GF_WORK/letters/internal-r1.txt"
expect_ok change classify "$GF" --kind rev
expect_ok instrument attach "$GF" --file "$GF_WORK/letters/internal-r1.txt" --type internal-letter --authority chief-pilot --dated 2026-09-02
expect_ok issue "$GF" --effective 2026-09-02
contains "$("${REVDESK[@]}" issue show GOM-R1 2>&1)" "GOM-R1" "greenfield R1"
contains "$("${REVDESK[@]}" launched gom 2>&1)" "GOM-R1" "launched greenfield"
rm -rf "$GF_WORK"
export REVDESK_DATA="$WORK"

echo ""
echo "PASS=$pass FAIL=$fail"
if [[ "$fail" -gt 0 ]]; then
  exit 1
fi
echo "Slice 2 acceptance passed."
