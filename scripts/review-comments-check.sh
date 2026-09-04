#!/usr/bin/env bash
# Reviewer diff + git-notes comments. Isolated git repo (not the app checkout).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REVDESK=(node --experimental-strip-types "$ROOT/cli/revdesk.ts")
SRC="$ROOT/fixtures/tiny-gom"

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

echo "=== lineDiff unit ==="
DIFF_UNIT="$(cd "$ROOT" && node --experimental-strip-types -e '
import { lineDiff } from "./server/diff.ts"
const rows = lineDiff("alpha\nkeep\n", "beta\nkeep\ngamma\n")
const del = rows.find((r) => r.kind === "del" && r.text === "alpha")
const add = rows.find((r) => r.kind === "add" && r.text === "beta")
const keep = rows.find((r) => r.kind === "equal" && r.text === "keep")
const incoming = rows.find((r) => r.kind === "add" && r.text === "gamma")
if (!del || !add || !keep || !incoming) {
  console.error(JSON.stringify(rows, null, 2))
  process.exit(1)
}
console.log("ok")
')"
if [[ "$DIFF_UNIT" == "ok" ]]; then
  pass=$((pass + 1))
  echo "OK  lineDiff outgoing/incoming"
else
  fail=$((fail + 1))
  echo "FAIL lineDiff"
  echo "$DIFF_UNIT"
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/revdesk-review.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK"
cp -R "$SRC/." "$WORK/"
git -C "$WORK" init -b main >/dev/null
git -C "$WORK" config user.email revdesk@local
git -C "$WORK" config user.name Revdesk
git -C "$WORK" add -A
git -C "$WORK" commit -m "baseline tiny-gom" >/dev/null
git -C "$WORK" tag -a issued/GOM/13 -m "Launch GOM-R13"
export REVDESK_DATA="$WORK"

echo "WORK=$WORK"
expect_ok change start --manual gom --title "Review smoke" --reason "notes" --section gom.ident
NEW="$("${REVDESK[@]}" change list --json | node -e "
  let s=''; process.stdin.on('data', d => s += d)
  process.stdin.on('end', () => {
    const rows = JSON.parse(s)
    console.log(rows.find(c => c.title === 'Review smoke').id)
  })
")"
FILE="$(ls "$WORK/control/working/$NEW/"*.md | head -1)"
printf '\nincoming smoke line\n' >> "$FILE"
expect_ok change submit "$NEW"

DIFF_JSON="$("${REVDESK[@]}" --json change diff "$NEW" --section gom.ident)"
contains "$DIFF_JSON" '"kind": "add"' "diff has incoming line"
LINE="$(printf '%s' "$DIFF_JSON" | node -e "
  let s=''; process.stdin.on('data', d => s += d)
  process.stdin.on('end', () => {
    const review = JSON.parse(s)
    const row = review.rows.find(r => r.kind === 'add' && r.text === 'incoming smoke line')
    if (!row || row.new_line == null) process.exit(1)
    console.log(row.new_line)
  })
")"
expect_ok change comment "$NEW" --section gom.ident --line "$LINE" --side new --body "Please tighten this paragraph."

NOTES="$(git -C "$WORK" notes --ref=revdesk/review show "change/$NEW")"
contains "$NOTES" "Please tighten this paragraph." "git notes hold the comment"
contains "$NOTES" '"side": "new"' "comment side is new"

SHOW="$(git -C "$WORK" show "change/$NEW:manuals/gom/sections/000-identification.md")"
contains "$SHOW" "incoming smoke line" "change branch has working text at issued path"

COMMENTS="$("${REVDESK[@]}" change comments "$NEW")"
contains "$COMMENTS" "Please tighten this paragraph." "CLI lists the git note"

echo
echo "pass=$pass fail=$fail"
if [[ "$fail" -ne 0 ]]; then exit 1; fi
