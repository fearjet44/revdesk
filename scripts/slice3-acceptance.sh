#!/usr/bin/env bash
# Slice 3 acceptance — local Git adapter.
#
# Tag mapping (locked for this script):
#   YAML / display issue ids keep the Slice 2 shape: GOM-R13, GOM-R14, GOM-R13-TR1.
#   Git refs use issued/{abbrev}/{revision} with the fixture revision numbers
#   (not remapped to 1):
#     GOM-R13     → issued/GOM/13
#     GOM-R14     → issued/GOM/14
#     GOM-R13-TR1 → issued/GOM/13-TR/1
#   Git cannot nest issued/GOM/13/TR/1 under issued/GOM/13, so TR tags
#   use the hyphen form from git.yaml. GOM-R14 / GOM-R13-TR1 are never
#   used as git tag names.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REVDESK=(node --experimental-strip-types "$ROOT/cli/revdesk.ts")
SRC="$ROOT/fixtures/tiny-gom"

pass=0
fail=0

json_get() {
  node -e "
    let s='';
    process.stdin.on('data', d => s += d);
    process.stdin.on('end', () => {
      const j = JSON.parse(s);
      const path = process.argv[1].split('.');
      let v = j;
      for (const k of path) {
        if (v == null) break;
        v = v[k];
      }
      if (v === true || v === false) console.log(v ? 'true' : 'false');
      else if (v == null) console.log('');
      else console.log(v);
    });
  " "$1"
}

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

file_present() {
  if [[ -e "$1" ]]; then
    pass=$((pass + 1))
    echo "OK  present $1"
  else
    fail=$((fail + 1))
    echo "FAIL missing: $1"
  fi
}

tag_exists() {
  local repo="$1" tag="$2"
  if git -C "$repo" show-ref --verify --quiet "refs/tags/$tag"; then
    pass=$((pass + 1))
    echo "OK  tag exists $tag"
  else
    fail=$((fail + 1))
    echo "FAIL tag missing $tag"
  fi
}

tag_absent() {
  local repo="$1" tag="$2"
  if git -C "$repo" show-ref --verify --quiet "refs/tags/$tag"; then
    fail=$((fail + 1))
    echo "FAIL tag should not exist: $tag"
  else
    pass=$((pass + 1))
    echo "OK  tag absent $tag"
  fi
}

setup_git_lib() {
  local dest="$1"
  mkdir -p "$dest"
  cp -R "$SRC/." "$dest/"
  git -C "$dest" init -b main >/dev/null
  git -C "$dest" config user.email revdesk@local
  git -C "$dest" config user.name Revdesk
  git -C "$dest" add -A
  git -C "$dest" commit -m "baseline tiny-gom" >/dev/null
  git -C "$dest" tag -a issued/GOM/13 -m "Launch GOM-R13"
}

advance_to_ready() {
  local title="$1"
  expect_ok change start --manual gom --title "$title" --reason-type opspec --ref A099
  NEW="$("${REVDESK[@]}" change list --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const a=JSON.parse(s);console.log(a.find(c=>c.status==='draft').id)})")"
  expect_ok change touch "$NEW" --section gom.ident --action amend
  expect_ok change submit "$NEW"
  expect_ok change approve "$NEW" --role chief-pilot
  expect_ok instrument attach "$NEW" --file "$LETTERS/poi-acceptance.txt" --type acceptance-letter --authority poi --dated 2026-09-12
}

WORK="$(mktemp -d "${TMPDIR:-/tmp}/revdesk-slice3.XXXXXX")"
WORK7=""
WORK8=""
WORK9=""
trap 'rm -rf "$WORK" "$WORK7" "$WORK8" "$WORK9"' EXIT
setup_git_lib "$WORK"
export REVDESK_DATA="$WORK"
LETTERS="$WORK/letters"

echo "WORK=$WORK"

echo "=== 1 git status + baseline tag issued/GOM/13 ==="
expect_ok git status
gst="$("${REVDESK[@]}" git status --json)"
contains "$gst" '"enabled": true' "git status enabled"
rootj="$(printf '%s' "$gst" | json_get root)"
if [[ -n "$rootj" && -d "$rootj" ]]; then
  pass=$((pass + 1))
  echo "OK  git status root $rootj"
else
  fail=$((fail + 1))
  echo "FAIL git status root=$rootj"
  echo "$gst"
fi
tag_exists "$WORK" "issued/GOM/13"
expect_exit 2 git tag
expect_exit 2 git push

echo "=== 2 issue with no instrument → exit 2, no new tag ==="
before_tags="$(git -C "$WORK" tag | grep '^issued/' | sort | tr '\n' ' ')"
set +e
out="$("${REVDESK[@]}" issue CHG-014 --effective 2026-09-15 2>&1)"
code=$?
set -e
if [[ "$code" -eq 2 ]] && [[ "$out" == *"instrument"* || "$out" == *"tr issue"* ]]; then
  pass=$((pass + 1))
  echo "OK  issue blocked without instrument"
else
  fail=$((fail + 1))
  echo "FAIL step 2 code=$code"
  echo "$out"
fi
after_tags="$(git -C "$WORK" tag | grep '^issued/' | sort | tr '\n' ' ')"
if [[ "$before_tags" == "$after_tags" ]]; then
  pass=$((pass + 1))
  echo "OK  no new issued/ tag"
else
  fail=$((fail + 1))
  echo "FAIL tags changed: [$before_tags] → [$after_tags]"
fi
tag_absent "$WORK" "issued/GOM/14"
tag_absent "$WORK" "GOM-R14"

echo "=== 3 tr issue with CP letter → yaml + tag; withdraw dies ==="
expect_ok tr issue CHG-014 --parent GOM-R13 --authority chief-pilot --file "$LETTERS/cp-tr-letter.txt" --expires 2026-12-15
file_present "$WORK/control/trs/GOM-R13-TR1.yaml"
tag_exists "$WORK" "issued/GOM/13-TR/1"
tag_absent "$WORK" "GOM-R13-TR1"
trjson="$("${REVDESK[@]}" tr show GOM-R13-TR1 --json)"
contains "$trjson" '"git_tag": "issued/GOM/13-TR/1"' "TR git_tag"
tr_sha="$(printf '%s' "$trjson" | json_get source_commit)"
tag_sha="$(git -C "$WORK" rev-parse "issued/GOM/13-TR/1^{commit}")"
if [[ -n "$tr_sha" && "$tr_sha" == "$tag_sha" ]]; then
  pass=$((pass + 1))
  echo "OK  TR source_commit matches tag"
else
  fail=$((fail + 1))
  echo "FAIL TR source_commit=$tr_sha tag=$tag_sha"
fi
expect_exit 2 change withdraw CHG-014 --why "should die"

echo "=== 4 full issue with POI letter → issued/GOM/14 annotated ==="
advance_to_ready "Incorporate and advance"
expect_ok issue "$NEW" --effective 2026-09-15
file_present "$WORK/control/issues/GOM-R14.yaml"
tag_exists "$WORK" "issued/GOM/14"
tag_absent "$WORK" "GOM-R14"
objtype="$(git -C "$WORK" cat-file -t issued/GOM/14)"
if [[ "$objtype" == "tag" ]]; then
  pass=$((pass + 1))
  echo "OK  issued/GOM/14 is annotated"
else
  fail=$((fail + 1))
  echo "FAIL issued/GOM/14 type=$objtype want tag"
fi
ijson="$("${REVDESK[@]}" issue show GOM-R14 --json)"
contains "$ijson" '"git_tag": "issued/GOM/14"' "issue git_tag"
iss_sha="$(printf '%s' "$ijson" | json_get source_commit)"
iss_skip="$(printf '%s' "$ijson" | json_get git_skipped)"
tag14="$(git -C "$WORK" rev-parse "issued/GOM/14^{commit}")"
if [[ -n "$iss_sha" && "$iss_sha" == "$tag14" ]]; then
  pass=$((pass + 1))
  echo "OK  R14 source_commit matches tag"
else
  fail=$((fail + 1))
  echo "FAIL R14 source_commit=$iss_sha tag=$tag14"
fi
if [[ "$iss_skip" == "false" ]]; then
  pass=$((pass + 1))
  echo "OK  git_skipped false"
else
  fail=$((fail + 1))
  echo "FAIL git_skipped=$iss_skip"
fi
ljson="$("${REVDESK[@]}" launched gom --json)"
contains "$ljson" '"tag": "issued/GOM/14"' "launched tag"
tok="$(printf '%s' "$ljson" | json_get tag_ok)"
if [[ "$tok" == "true" ]]; then
  pass=$((pass + 1))
  echo "OK  tag_ok true"
else
  fail=$((fail + 1))
  echo "FAIL tag_ok=$tok"
  echo "$ljson"
fi

echo "=== 5 second tag of the same name → exit 2, first SHA unchanged ==="
advance_to_ready "Would be R15"
SHA15_BEFORE="$(git -C "$WORK" rev-parse HEAD)"
git -C "$WORK" tag -a issued/GOM/15 -m "preexisting"
SHA15="$(git -C "$WORK" rev-parse issued/GOM/15)"
SHA14_BEFORE="$(git -C "$WORK" rev-parse issued/GOM/14)"
expect_exit 2 issue "$NEW" --effective 2026-10-01
file_absent "$WORK/control/issues/GOM-R15.yaml"
SHA15_AFTER="$(git -C "$WORK" rev-parse issued/GOM/15)"
SHA14_AFTER="$(git -C "$WORK" rev-parse issued/GOM/14)"
if [[ "$SHA15" == "$SHA15_AFTER" ]]; then
  pass=$((pass + 1))
  echo "OK  issued/GOM/15 SHA unchanged"
else
  fail=$((fail + 1))
  echo "FAIL issued/GOM/15 moved $SHA15 → $SHA15_AFTER"
fi
if [[ "$SHA14_BEFORE" == "$SHA14_AFTER" ]]; then
  pass=$((pass + 1))
  echo "OK  issued/GOM/14 SHA unchanged"
else
  fail=$((fail + 1))
  echo "FAIL issued/GOM/14 moved"
fi
# unused but documents that the pre-tag was not HEAD-rewritten by -f
if [[ -n "$SHA15_BEFORE" ]]; then
  true
fi

echo "=== 6 git tag -f then launched --json → tag_ok false ==="
OTHER="$(git -C "$WORK" rev-parse "issued/GOM/13^{commit}")"
git -C "$WORK" tag -f issued/GOM/14 "$OTHER"
tok2="$("${REVDESK[@]}" launched gom --json | json_get tag_ok)"
if [[ "$tok2" == "false" ]]; then
  pass=$((pass + 1))
  echo "OK  tag_ok false after force-move"
else
  fail=$((fail + 1))
  echo "FAIL tag_ok=$tok2 after git tag -f"
fi

echo "=== 7 enabled: false → YAML launch, no tags, git_skipped ==="
WORK7="$(mktemp -d "${TMPDIR:-/tmp}/revdesk-slice3-off.XXXXXX")"
setup_git_lib "$WORK7"
cat > "$WORK7/.revdesk/git.yaml" <<'YAML'
enabled: false

change_branch: "change/{change_id}"
full_tag: "issued/{abbrev}/{revision}"
tr_tag: "issued/{abbrev}/{parent_revision}-TR/{seq}"
annotated: true
update_ref_on_full_issue: ""
push_on_launch: false
author_name: "Revdesk"
author_email: "revdesk@local"
issue_id: "{abbrev}-{revision}"
YAML
export REVDESK_DATA="$WORK7"
LETTERS="$WORK7/letters"
expect_ok instrument attach CHG-014 --file "$LETTERS/poi-acceptance.txt" --type acceptance-letter --authority poi --dated 2026-09-12
expect_ok issue CHG-014 --effective 2026-09-15
file_present "$WORK7/control/issues/GOM-R14.yaml"
tag_absent "$WORK7" "issued/GOM/14"
tag_exists "$WORK7" "issued/GOM/13"
skip7="$("${REVDESK[@]}" issue show GOM-R14 --json | json_get git_skipped)"
sc7="$("${REVDESK[@]}" issue show GOM-R14 --json | json_get source_commit)"
if [[ "$skip7" == "true" ]]; then
  pass=$((pass + 1))
  echo "OK  git_skipped true when disabled"
else
  fail=$((fail + 1))
  echo "FAIL git_skipped=$skip7"
fi
if [[ -z "$sc7" ]]; then
  pass=$((pass + 1))
  echo "OK  source_commit null when disabled"
else
  fail=$((fail + 1))
  echo "FAIL source_commit=$sc7 want empty"
fi

echo "=== 8 dirty scratch.tmp at repo root → launch exit 2 ==="
WORK8="$(mktemp -d "${TMPDIR:-/tmp}/revdesk-slice3-dirty.XXXXXX")"
setup_git_lib "$WORK8"
export REVDESK_DATA="$WORK8"
LETTERS="$WORK8/letters"
expect_ok instrument attach CHG-014 --file "$LETTERS/poi-acceptance.txt" --type acceptance-letter --authority poi --dated 2026-09-12
echo "scratch" > "$WORK8/scratch.tmp"
set +e
out="$("${REVDESK[@]}" issue CHG-014 --effective 2026-09-15 2>&1)"
code=$?
set -e
if [[ "$code" -eq 2 ]] && [[ "$out" == *"scratch.tmp"* ]]; then
  pass=$((pass + 1))
  echo "OK  dirty scratch.tmp blocked"
else
  fail=$((fail + 1))
  echo "FAIL step 8 code=$code"
  echo "$out"
fi
file_absent "$WORK8/control/issues/GOM-R14.yaml"
tag_absent "$WORK8" "issued/GOM/14"

echo "=== 9 third-party .eml attach, issue succeeds, tag exists ==="
WORK9="$(mktemp -d "${TMPDIR:-/tmp}/revdesk-slice3-eml.XXXXXX")"
setup_git_lib "$WORK9"
export REVDESK_DATA="$WORK9"
EML_TMP="$(mktemp "${TMPDIR:-/tmp}/revdesk-vendor.XXXXXX")"
EML="$EML_TMP.eml"
mv "$EML_TMP" "$EML"
cat > "$EML" <<'EML'
From: vendor@example.com
To: chiefpilot@operator.example
Subject: Third-party manual revision
Date: 2 Sep 2026

Please place revision 14 of this third-party manual in crew libraries.
EML
expect_ok instrument attach CHG-014 --file "$EML" --type third-party-letter --authority third-party --dated 2026-09-02
expect_ok issue CHG-014 --effective 2026-09-02
file_present "$WORK9/control/issues/GOM-R14.yaml"
tag_exists "$WORK9" "issued/GOM/14"
tag_absent "$WORK9" "GOM-R14"
eml_type="$(git -C "$WORK9" cat-file -t issued/GOM/14 2>/dev/null || true)"
if [[ "$eml_type" == "tag" ]]; then
  pass=$((pass + 1))
  echo "OK  third-party launch tag annotated"
else
  fail=$((fail + 1))
  echo "FAIL third-party tag type=$eml_type"
fi
rm -f "$EML"

echo ""
echo "PASS=$pass FAIL=$fail"
if [[ "$fail" -gt 0 ]]; then
  exit 1
fi
echo "Slice 3 acceptance passed."
