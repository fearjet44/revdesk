#!/usr/bin/env bash
# Slice 6 ingest scaffold — classify house style / control surface, lorem sample books.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REVDESK=(node --experimental-strip-types "$ROOT/cli/revdesk.ts")
WORK="$(mktemp -d "${TMPDIR:-/tmp}/revdesk-slice6.XXXXXX")"
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

json_field() {
  local path="$1" raw="$2"
  node -e '
    let s = process.argv[2]
    const j = JSON.parse(s)
    let v = j
    for (const k of process.argv[1].split(".")) v = v == null ? v : v[k]
    if (Array.isArray(v)) console.log(v.join(","))
    else if (v == null) console.log("")
    else console.log(String(v))
  ' "$path" "$raw"
}

assert_class() {
  local file="$1" surface="$2" style="$3" label="$4"
  set +e
  raw="$("${REVDESK[@]}" --json ingest classify "$file" 2>&1)"
  code=$?
  set -e
  if [[ "$code" -ne 0 ]]; then
    fail=$((fail + 1))
    echo "FAIL classify $label exit $code"
    echo "$raw"
    return
  fi
  got_surface="$(json_field control_surface "$raw")"
  got_style="$(json_field house_style "$raw")"
  if [[ "$got_surface" == "$surface" ]]; then
    pass=$((pass + 1))
    echo "OK  $label surface=$surface"
  else
    fail=$((fail + 1))
    echo "FAIL $label surface want $surface got $got_surface"
  fi
  if [[ "$got_style" == "$style" ]]; then
    pass=$((pass + 1))
    echo "OK  $label style=$style"
  else
    fail=$((fail + 1))
    echo "FAIL $label style want $style got $got_style"
  fi
}

echo "WORK=$WORK"

echo "=== 1 catalogs list ==="
expect_ok ingest catalogs
contains "$out" "gom-lep" "catalog gom-lep"
contains "$out" "tp" "catalog tp"

echo "=== 2 classify text fixtures (all three surfaces) ==="
assert_class "$ROOT/fixtures/ingest/samples/nimbl-lep.txt" "lep" "nimbl-word" "nimbl-lep.txt"
assert_class "$ROOT/fixtures/ingest/samples/les-handbook.txt" "les" "unknown" "les-handbook.txt"
assert_class "$ROOT/fixtures/ingest/samples/rev-only-handbook.txt" "rev-only" "unknown" "rev-only-handbook.txt"

echo "=== 3 scaffold lorem books ==="
expect_ok ingest scaffold --catalog gom-lep --out "$WORK"
expect_ok ingest scaffold --catalog tp --out "$WORK"
test -f "$WORK/manuals/gom-lep/manual.yaml"
test -f "$WORK/manuals/tp/manual.yaml"
test -f "$WORK/manuals/gom-lep/theme.yaml"
test -f "$WORK/manuals/tp/theme.yaml"
test -f "$WORK/control/issues/GOML-R11.yaml"
test -f "$WORK/control/issues/TP-R9.yaml"
pass=$((pass + 6))
echo "OK  scaffold wrote manuals + baseline issues + themes"
contains "$(cat "$WORK/manuals/gom-lep/theme.yaml")" "scheme: nimbl" "GOM nimbl theme"
contains "$(cat "$WORK/manuals/gom-lep/theme.yaml")" "body: Verdana" "GOM Verdana body"
contains "$(cat "$WORK/manuals/tp/theme.yaml")" "scheme: nimbl" "TP nimbl theme"
contains "$(cat "$WORK/manuals/tp/theme.yaml")" "paper: \"#ffffff\"" "TP white paper"

echo "=== 3b scaffold does not clobber theme ==="
printf 'heading:\n  scheme: decimal\n' > "$WORK/manuals/gom-lep/theme.yaml"
expect_ok ingest scaffold --catalog gom-lep --out "$WORK"
contains "$(cat "$WORK/manuals/gom-lep/theme.yaml")" "scheme: decimal" "scaffold leaves an edited theme"

echo "=== 4 lorem only — no operator prose ==="
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

echo "=== 5 structure preserved ==="
contains "$(cat "$WORK/manuals/gom-lep/sections/"*section-01*)" "Company Policy, Procedures, and Rules of Conduct" "GOM section 1 title"
contains "$(cat "$WORK/manuals/gom-lep/sections/"*section-05*)" "Weight and Balance" "GOM section 5 title"
contains "$(cat "$WORK/manuals/tp/sections/"*section-09*)" "Training Modules" "TP section 9 title"
contains "$(cat "$WORK/manuals/tp/sections/"*appendix-a*)" "Beechcraft King Air Supplement" "TP appendix A title"
contains "$(cat "$WORK/manuals/gom-lep/manual.yaml")" "control_surface: lep" "GOM LEP surface"
contains "$(cat "$WORK/manuals/gom-lep/manual.yaml")" "scheme: chapter-page" "GOM chapter-page"
contains "$(cat "$WORK/manuals/tp/manual.yaml")" "control_class: faa-approved" "TP approved class"

echo "=== 6 desk can list scaffolded manuals ==="
export REVDESK_DATA="$WORK"
expect_ok manual list
contains "$out" "GOML" "manual list GOML"
contains "$out" "TP" "manual list TP"
expect_ok launched gom-lep
contains "$out" "GOML-R11" "launched GOML-R11"
expect_ok launched tp
contains "$out" "TP-R9" "launched TP-R9"

echo "=== 7 corpus PDFs (skipped when gitignored copies are absent) ==="
gom_pdf="$ROOT/corpus/Premier Air Charter GOM Revision 11.pdf"
tp_pdf="$ROOT/corpus/far-part-135-training-program.pdf"
if [[ -f "$gom_pdf" && -f "$tp_pdf" ]]; then
  set +e
  node --experimental-strip-types "$ROOT/scripts/slice6-corpus-check.ts"
  corpus_code=$?
  set -e
  if [[ "$corpus_code" -eq 0 ]]; then
    pass=$((pass + 1))
    echo "OK  corpus PDF classification matches expected"
  else
    fail=$((fail + 1))
    echo "FAIL corpus PDF classification"
  fi
else
  echo "SKIP corpus PDFs not present (gitignored)"
fi

echo
echo "PASS=$pass FAIL=$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
