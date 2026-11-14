#!/bin/bash
# Runs oc-workspace.sh against a stand-in for docker and a throwaway config; nothing real is touched.
# Usage: bash test-oc-workspace.sh   (needs node)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/fake-tmp" "$T/tasks/inbox" "$T/tasks/processing" "$T/src"
cp "$HERE/openclaw-tool-policy.js" "$HERE/test-openclaw-tool-policy.js" "$T/src/"
BASE='{"meta":{"v":1},"agents":{"defaults":{"model":{"primary":"m"}},"entries":{"main":{}}},"tools":{"profile":"minimal"}}'

cat > "$T/bin/docker" <<'STUB'
#!/bin/bash
fix() { sed -E "s#^/tmp/((test-)?openclaw-tool-policy.js)\$#$FAKE_TMP/\\1#" <<<"$1"; }
case "$1" in
  exec)
    shift 2
    case "$1" in
      openclaw)
        case "$2" in
          config)
            if [ -e "$FAKE_STATE/refuse" ] && grep -q skipBootstrap "$CFG"; then echo "Config needs correction"; exit 1; fi
            echo "Config valid";;
          agent)
            if [ -e "$FAKE_STATE/agent-fail" ] && grep -q skipBootstrap "$CFG"; then echo "create staged child: EROFS"; exit 1; fi
            cat "$FAKE_STATE/agent-out";;
        esac;;
      sha256sum) sha256sum "$(fix "$2")";;
      node) shift; args=(); for a in "$@"; do args+=("$(fix "$a")"); done; node "${args[@]}";;
      sh) sh -c "$3";;
    esac;;
  cp) cp "$2" "$FAKE_TMP/";;
  inspect) echo healthy;;
  restart) echo r >> "$FAKE_STATE/restarts";;
esac
STUB
chmod +x "$T/bin/docker"
export PATH="$T/bin:$PATH" FAKE_TMP="$T/fake-tmp" FAKE_STATE="$T/state" CFG="$T/openclaw.json" HOSTCFG="$T/openclaw.json" BK="$T/bk" TASKS="$T/tasks" GW=gw

fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1"; echo "  want: $3"; echo "  got:  $2"; fail=1; fi; }
reset() {
  printf '%s' "$BASE" > "$CFG"
  rm -rf "$FAKE_STATE" "$BK" "$CFG.new"
  mkdir -p "$FAKE_STATE"
  echo "# Tasks bridge - test" > "$FAKE_STATE/agent-out"
  rm -f "$T/tasks/inbox/"* "$T/tasks/processing/"*
  cp "$HERE/openclaw-tool-policy.js" "$T/src/openclaw-tool-policy.js"
}
run() { bash "$HERE/oc-workspace.sh" "$T/src" > "$T/out.txt" 2>&1; rc=$?; [ -n "${DEBUG:-}" ] && cat "$T/out.txt" >&2; echo $rc; }
has() { grep -c "$1" "$CFG"; }

reset; check "success exits 0" "$(run)" 0
check "the config names the workspace" "$(has "\"workspace\": \"$T/tasks\"")" 1
check "the config skips bootstrap" "$(has skipBootstrap)" 1
check "the backup is the old config" "$(cat "$BK/openclaw.json.before-wsrun")" "$BASE"
check "the gateway restarted once" "$(wc -l < "$FAKE_STATE/restarts" | tr -d ' ')" 1

reset; touch "$FAKE_STATE/refuse"; check "a refused config rolls back" "$(run)" 1
check "the old config is back" "$(cat "$CFG")" "$BASE"

reset; touch "$FAKE_STATE/agent-fail"; check "an agent that cannot start rolls back" "$(run)" 1
check "rolled back to the old config" "$(cat "$CFG")" "$BASE"
check "it says so" "$(grep -c 'rolled back' "$T/out.txt")" 1

reset; echo x > "$T/tasks/processing/a.md"; check "a busy processing folder stops it" "$(run)" 1
check "and changes nothing" "$(cat "$CFG")" "$BASE"

reset; echo x > "$CFG.new"; check "a leftover .new stops it" "$(run)" 1
check "and keeps the config" "$(cat "$CFG")" "$BASE"

reset; echo '// changed' >> "$T/src/openclaw-tool-policy.js"; check "a changed script stops it" "$(run)" 1
check "with the config untouched" "$(cat "$CFG")" "$BASE"

reset; printf '%s' '{"agents":{"defaults":{"workspace":"/x"}},"tools":{}}' > "$CFG"
check "a config that already names a workspace stops it" "$(run)" 1
check "and is left alone" "$(grep -c '/x' "$CFG")" 1

[ "$fail" = 0 ] && echo "ALL OK" || { echo "FAILED"; exit 1; }
