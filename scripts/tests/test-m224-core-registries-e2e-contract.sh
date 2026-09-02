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
    exit 1
  fi
}

assert_not_contains() {
  local path="$1"
  local needle="$2"
  if grep -Fq "$needle" "$path"; then
    printf 'ERROR: expected %s to reject: %s\n' "$path" "$needle" >&2
    exit 1
  fi
}

mutate_copy() {
  local source="$1"
  local needle="$2"
  local replacement="$3"
  local dest="$4"
  /usr/bin/python3 - "$source" "$needle" "$replacement" "$dest" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text()
needle = sys.argv[2]
replacement = sys.argv[3]
dest = Path(sys.argv[4])
count = source.count(needle)
if count != 1:
    raise SystemExit(f"expected one mutation target for {needle!r}, found {count}")
dest.write_text(source.replace(needle, replacement))
PY
}

validate_runner_source() {
  local runner_path="$1"
  assert_contains "$runner_path" "#!/bin/bash -p"
  assert_contains "$runner_path" "set -euo pipefail"
  assert_contains "$runner_path" "set -o pipefail"
  assert_contains "$runner_path" "$EXPECTED_CORE_SHA"
  assert_contains "$runner_path" "trap cleanup EXIT"
  assert_contains "$runner_path" "initdb"
  assert_contains "$runner_path" "pg_ctl"
  assert_contains "$runner_path" "psql"
  assert_contains "$runner_path" "$PROXY_RELPATH"
  assert_contains "$runner_path" "$FIXTURE_RELPATH"
  assert_contains "$runner_path" "0014_connector_registry.sql"
  assert_contains "$runner_path" "audit_logs"
  assert_contains "$runner_path" "status --short"
  assert_contains "$runner_path" "next_cursor"
  assert_contains "$runner_path" "cleanup_ok"
  assert_not_contains "$runner_path" "rm -rf /"
}

validate_proxy_source() {
  local proxy_path="$1"
  assert_contains "$proxy_path" "ALLOWED_GET_PATTERNS"
  assert_contains "$proxy_path" "authorization"
  assert_contains "$proxy_path" "cursor="
  assert_contains "$proxy_path" "statusCode"
  assert_contains "$proxy_path" "method"
  assert_contains "$proxy_path" "path"
  assert_contains "$proxy_path" "GET"
  assert_not_contains "$proxy_path" "body:"
}

validate_fixture_source() {
  local fixture_path="$1"
  assert_contains "$fixture_path" "INSERT INTO kernel_tenants"
  assert_contains "$fixture_path" "INSERT INTO kernel_agents"
  assert_contains "$fixture_path" "INSERT INTO kernel_tool_definitions"
  assert_contains "$fixture_path" "INSERT INTO kernel_tool_enablements"
  assert_contains "$fixture_path" "INSERT INTO kernel_connector_types"
  assert_contains "$fixture_path" "INSERT INTO kernel_connector_bindings"
  assert_contains "$fixture_path" "generate_series(1, 52)"
  assert_contains "$fixture_path" "credential://registry/primary"
  assert_not_contains "$fixture_path" "sk-live"
  assert_not_contains "$fixture_path" "Bearer "
}

require_file "$HELPER_RELPATH"
require_file "$SPEC_RELPATH"
require_file "$RUNNER_RELPATH"
require_file "$PROXY_RELPATH"
require_file "$FIXTURE_RELPATH"

assert_contains "$ROOT/$HELPER_RELPATH" "openCoreRegistriesFromHome"
assert_contains "$ROOT/$SPEC_RELPATH" "walks the Core registries route through exact links"

validate_runner_source "$ROOT/$RUNNER_RELPATH"
validate_proxy_source "$ROOT/$PROXY_RELPATH"
validate_fixture_source "$ROOT/$FIXTURE_RELPATH"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/m224-core-registries-contract.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mutate_copy \
  "$ROOT/$RUNNER_RELPATH" \
  "$EXPECTED_CORE_SHA" \
  "0000000000000000000000000000000000000000" \
  "$TMP_DIR/runner-wrong-sha.sh"
if validate_runner_source "$TMP_DIR/runner-wrong-sha.sh" 2>/dev/null; then
  echo "ERROR: wrong Core SHA mutation did not fail closed" >&2
  exit 1
fi

mutate_copy \
  "$ROOT/$RUNNER_RELPATH" \
  "trap cleanup EXIT" \
  "# trap cleanup EXIT" \
  "$TMP_DIR/runner-no-trap.sh"
if validate_runner_source "$TMP_DIR/runner-no-trap.sh" 2>/dev/null; then
  echo "ERROR: cleanup trap mutation did not fail closed" >&2
  exit 1
fi

mutate_copy \
  "$ROOT/$RUNNER_RELPATH" \
  "cmp_snapshots" \
  "echo pretend_equal" \
  "$TMP_DIR/runner-no-equivalence.sh"
if validate_runner_source "$TMP_DIR/runner-no-equivalence.sh" 2>/dev/null; then
  echo "ERROR: snapshot equivalence mutation did not fail closed" >&2
  exit 1
fi

mutate_copy \
  "$ROOT/$PROXY_RELPATH" \
  "ALLOWED_GET_PATTERNS" \
  "BLOCKED_GET_PATTERNS" \
  "$TMP_DIR/proxy-no-allowlist.mjs"
if validate_proxy_source "$TMP_DIR/proxy-no-allowlist.mjs" 2>/dev/null; then
  echo "ERROR: proxy allowlist mutation did not fail closed" >&2
  exit 1
fi

echo "M224 core registries contract probes passed"
