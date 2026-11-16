#!/bin/bash
# Runs deploy-backend.sh against a stand-in for docker and a throwaway compose folder.
# Usage: bash test-deploy-backend.sh   (nothing real is touched)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/state" "$T/pkg/Dockerfile.d"
echo "FROM scratch" > "$T/pkg/Dockerfile"
echo "hello" > "$T/pkg/app.txt"
mkdir -p "$T/tar/mf-123" && cp "$T/pkg/Dockerfile" "$T/pkg/app.txt" "$T/tar/mf-123/"
tar czf "$T/src.tar.gz" -C "$T/tar" mf-123
( cd "$T/tar/mf-123" && sha256sum Dockerfile app.txt | sed 's#  #  src-ap/#' ) > "$T/expected.txt"

cat > "$T/bin/docker" <<'STUB'
#!/bin/bash
echo "docker $*" >> "$FAKE_STATE/calls"
case "$1 $2" in
  "compose ps") echo "backend running";;
  "compose config") [ -e "$FAKE_STATE/badconfig" ] && exit 1; exit 0;;
  "compose build") [ -e "$FAKE_STATE/badbuild" ] && { echo "build error"; exit 1; }; echo "built";;
  "compose up") echo up >> "$FAKE_STATE/ups"; exit 0;;
  "compose logs") echo "nothing";;
  "image ls") echo "mindferry-backend images";;
  "inspect -f") if [ -e "$FAKE_STATE/unhealthy" ] && grep -q 'ap-' compose.yaml; then echo starting; else echo healthy; fi;;
  "ps --format") echo "mindferry-backend  Up";;
  "exec mindferry-backend") echo "outbox write rc=1";;
esac
STUB
cat > "$T/bin/curl" <<'STUB'
#!/bin/bash
last="${@: -1}"
case "$last" in
  */health) echo ok;;
  */api/bridge/approvals) echo "${FAKE_APPROVALS_CODE:-401}";;
  *) exec /usr/bin/curl "$@";;
esac
STUB
chmod +x "$T/bin/docker" "$T/bin/curl"
export PATH="$T/bin:$PATH" FAKE_STATE="$T/state"

COMPOSE_ORIG='services:
  backend:
    build:
      context: ./src-vi
    image: mindferry-backend:vi-20f4139
    ports:
      - "3080:3080"
'
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1"; echo "  want: $3"; echo "  got:  $2"; fail=1; fi; }
reset() {
  rm -rf "$T/work" "$T/state" "$T/bk"; mkdir -p "$T/work" "$T/state"
  printf '%s' "$COMPOSE_ORIG" > "$T/work/compose.yaml"
}
run() {
  ( cd "$T" && COMPOSE_DIR="$T/work" BK="$T/bk" ALLOW_ANY_USER=1 EXPECTED_FILE="$T/expected.txt" \
    TARBALL_URL="file://$T/src.tar.gz" HEALTH_URL="https://example.test/health" \
    bash "$HERE/deploy-backend.sh" > "$T/out.txt" 2>&1; echo $? )
}

reset; check "a clean deploy exits 0" "$(run)" 0
check "the build folder changed" "$(grep -c 'context: ./src-ap' "$T/work/compose.yaml")" 1
check "the image tag changed" "$(grep -c 'image: mindferry-backend:ap-733b52c' "$T/work/compose.yaml")" 1
check "nothing else in compose.yaml changed" "$(diff "$T/bk/compose.yaml.before" "$T/work/compose.yaml" | grep -c '^[<>]')" 4
check "the old compose.yaml is kept" "$(cat "$T/bk/compose.yaml.before")" "$(printf '%s' "$COMPOSE_ORIG")"
check "the source was unpacked" "$(cat "$T/work/src-ap/app.txt")" hello
check "it says what is running" "$(grep -c 'ap-733b52c is running' "$T/out.txt")" 1

reset; echo 'tampered' > "$T/tar/mf-123/app.txt"; tar czf "$T/bad.tar.gz" -C "$T/tar" mf-123; echo hello > "$T/tar/mf-123/app.txt"
( cd "$T" && COMPOSE_DIR="$T/work" BK="$T/bk" ALLOW_ANY_USER=1 EXPECTED_FILE="$T/expected.txt" TARBALL_URL="file://$T/bad.tar.gz" HEALTH_URL="https://e.test/health" bash "$HERE/deploy-backend.sh" > "$T/out.txt" 2>&1 ); rc=$?
check "a source that does not match its hashes stops it" "$rc" 1
check "and compose.yaml is untouched" "$(cat "$T/work/compose.yaml")" "$(printf '%s' "$COMPOSE_ORIG")"
check "and nothing was switched" "$(grep -c 'compose up' "$T/state/calls")" 0

reset; touch "$T/state/badbuild"; check "a failed build stops it" "$(run)" 1
check "and puts the old compose.yaml back" "$(cat "$T/work/compose.yaml")" "$(printf '%s' "$COMPOSE_ORIG")"
check "and never switches the backend" "$(grep -c 'compose up' "$T/state/calls")" 0

reset; touch "$T/state/unhealthy"; check "an unhealthy new backend rolls back" "$(run)" 1
check "with the old compose.yaml" "$(cat "$T/work/compose.yaml")" "$(printf '%s' "$COMPOSE_ORIG")"
check "and starts the old backend again" "$(wc -l < "$T/state/ups" | tr -d ' ')" 2
check "and says so" "$(grep -c 'rolled back' "$T/out.txt")" 1

reset; ( cd "$T" && FAKE_APPROVALS_CODE=200 COMPOSE_DIR="$T/work" BK="$T/bk" ALLOW_ANY_USER=1 EXPECTED_FILE="$T/expected.txt" TARBALL_URL="file://$T/src.tar.gz" HEALTH_URL="https://e.test/health" bash "$HERE/deploy-backend.sh" > "$T/out.txt" 2>&1 ); rc=$?
check "a new route that does not answer 401 rolls back" "$rc" 1

reset; printf '%s' "services:\n  backend:\n    image: other\n" > "$T/work/compose.yaml"
check "a compose.yaml it does not recognise stops it" "$(run)" 1
check "and is left alone" "$(cat "$T/work/compose.yaml")" 'services:\n  backend:\n    image: other\n'

reset; mkdir -p "$T/work/src-ap" && echo x > "$T/work/src-ap/old"; check "a source folder that already holds files stops it" "$(run)" 1
check "and keeps them" "$(cat "$T/work/src-ap/old")" x
[ "$fail" = 0 ] && echo "ALL OK" || { echo "FAILED"; exit 1; }
