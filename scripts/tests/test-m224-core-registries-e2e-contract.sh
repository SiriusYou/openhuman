#!/bin/bash -p
set -euo pipefail

SCRIPT_RELPATH="scripts/tests/test-m224-core-registries-e2e-contract.sh"
RUNNER_RELPATH="scripts/run-m224-core-registries-e2e.sh"
PROXY_RELPATH="scripts/fixtures/m224_registry_capture_proxy.mjs"
FIXTURE_RELPATH="app/test/e2e/fixtures/m224_registry_fixture.sql"
SPEC_RELPATH="app/test/e2e/specs/core-registries-flow.spec.ts"
HELPER_RELPATH="app/test/e2e/helpers/core-registries.ts"
EXPECTED_CORE_SHA="7515ba2796239311dab1381836184d188c498e5b"

SELF_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
ROOT="$SELF_PATH"
if [[ ! -f "$ROOT/$SCRIPT_RELPATH" ]]; then
  echo "ERROR: executing harness is not the canonical repository path" >&2
  exit 2
fi

require_file() {
  local relpath="$1"
  if [[ ! -f "$ROOT/$relpath" || -L "$ROOT/$relpath" ]]; then
    printf 'ERROR: missing required Task6 file: %s\n' "$relpath" >&2
    exit 1
  fi
}

assert_contains() {
  local path="$1"
  local needle="$2"
  if ! grep -Fq "$needle" "$path"; then
    printf 'ERROR: expected %s to contain: %s\n' "$path" "$needle" >&2
    return 1
  fi
}

assert_not_contains() {
  local path="$1"
  local needle="$2"
  if grep -Fq "$needle" "$path"; then
    printf 'ERROR: expected %s to reject: %s\n' "$path" "$needle" >&2
    return 1
  fi
}

mutate_copy() {
  local source="$1"
  local expected_count="$2"
  local needle="$3"
  local replacement="$4"
  local dest="$5"
  /usr/bin/python3 - "$source" "$expected_count" "$needle" "$replacement" "$dest" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text()
expected_count = int(sys.argv[2])
needle = sys.argv[3]
replacement = sys.argv[4]
dest = Path(sys.argv[5])
count = source.count(needle)
if count != expected_count:
    raise SystemExit(f"expected {expected_count} mutation target for {needle!r}, found {count}")
dest.write_text(source.replace(needle, replacement))
PY
}

validate_runner_source() {
  local runner_path="$1"
  assert_contains "$runner_path" "#!/bin/bash -p" || return 1
  assert_contains "$runner_path" "set -euo pipefail" || return 1
  assert_contains "$runner_path" "set -o pipefail" || return 1
  assert_contains "$runner_path" "$EXPECTED_CORE_SHA" || return 1
  assert_contains "$runner_path" "trap cleanup EXIT" || return 1
  assert_contains "$runner_path" "initdb" || return 1
  assert_contains "$runner_path" "pg_ctl" || return 1
  assert_contains "$runner_path" "psql" || return 1
  assert_contains "$runner_path" "$PROXY_RELPATH" || return 1
  assert_contains "$runner_path" "$FIXTURE_RELPATH" || return 1
  assert_contains "$runner_path" "0014_connector_registry.sql" || return 1
  assert_contains "$runner_path" "audit_logs" || return 1
  assert_contains "$runner_path" "status --short" || return 1
  assert_contains "$runner_path" "next_cursor" || return 1
  assert_contains "$runner_path" "cleanup_ok" || return 1
  assert_contains "$runner_path" "cmp_snapshots" || return 1
  assert_not_contains "$runner_path" "rm -rf /" || return 1
}

validate_proxy_source() {
  local proxy_path="$1"
  assert_contains "$proxy_path" "ALLOWED_GET_PATTERNS" || return 1
  assert_contains "$proxy_path" "authorization" || return 1
  assert_contains "$proxy_path" "cursor=" || return 1
  assert_contains "$proxy_path" "statusCode" || return 1
  assert_contains "$proxy_path" "method" || return 1
  assert_contains "$proxy_path" "path" || return 1
  assert_contains "$proxy_path" "GET" || return 1
  assert_not_contains "$proxy_path" "body:" || return 1
}

validate_fixture_source() {
  local fixture_path="$1"
  assert_contains "$fixture_path" "INSERT INTO kernel_tenants" || return 1
  assert_contains "$fixture_path" "INSERT INTO kernel_agents" || return 1
  assert_contains "$fixture_path" "INSERT INTO kernel_tool_definitions" || return 1
  assert_contains "$fixture_path" "INSERT INTO kernel_tool_enablements" || return 1
  assert_contains "$fixture_path" "INSERT INTO kernel_connector_types" || return 1
  assert_contains "$fixture_path" "INSERT INTO kernel_connector_bindings" || return 1
  assert_contains "$fixture_path" "generate_series(1, 52)" || return 1
  assert_contains "$fixture_path" "credential://registry/primary" || return 1
  assert_not_contains "$fixture_path" "sk-live" || return 1
  assert_not_contains "$fixture_path" "Bearer " || return 1
}

require_file "$HELPER_RELPATH"
require_file "$SPEC_RELPATH"
require_file "$RUNNER_RELPATH"
require_file "$PROXY_RELPATH"
require_file "$FIXTURE_RELPATH"

assert_contains "$ROOT/$HELPER_RELPATH" "openCoreRegistriesFromHome"
assert_contains "$ROOT/$SPEC_RELPATH" "walks the Core registries route through exact links"

validate_runner_source "$ROOT/$RUNNER_RELPATH"
validate_proxy_source "$ROOT/$PROXY_RELPATH" || exit 1
validate_fixture_source "$ROOT/$FIXTURE_RELPATH" || exit 1

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/m224-core-registries-contract.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mutate_copy \
  "$ROOT/$RUNNER_RELPATH" \
  1 \
  "$EXPECTED_CORE_SHA" \
  "0000000000000000000000000000000000000000" \
  "$TMP_DIR/runner-wrong-sha.sh"
if validate_runner_source "$TMP_DIR/runner-wrong-sha.sh" 2>/dev/null; then
  echo "ERROR: wrong Core SHA mutation did not fail closed" >&2
  exit 1
fi

mutate_copy \
  "$ROOT/$RUNNER_RELPATH" \
  1 \
  "trap cleanup EXIT" \
  "# cleanup trap removed" \
  "$TMP_DIR/runner-no-trap.sh"
if validate_runner_source "$TMP_DIR/runner-no-trap.sh" 2>/dev/null; then
  echo "ERROR: cleanup trap mutation did not fail closed" >&2
  exit 1
fi

mutate_copy \
  "$ROOT/$RUNNER_RELPATH" \
  2 \
  "cmp_snapshots" \
  "pretend_equal" \
  "$TMP_DIR/runner-no-equivalence.sh"
if validate_runner_source "$TMP_DIR/runner-no-equivalence.sh" 2>/dev/null; then
  echo "ERROR: snapshot equivalence mutation did not fail closed" >&2
  exit 1
fi

mutate_copy \
  "$ROOT/$PROXY_RELPATH" \
  2 \
  "ALLOWED_GET_PATTERNS" \
  "BLOCKED_GET_PATTERNS" \
  "$TMP_DIR/proxy-no-allowlist.mjs"
if validate_proxy_source "$TMP_DIR/proxy-no-allowlist.mjs" 2>/dev/null; then
  echo "ERROR: proxy allowlist mutation did not fail closed" >&2
  exit 1
fi

echo "M224 core registries contract probes passed"
