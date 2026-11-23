#!/usr/bin/env bash
# Post-deploy smoke test for MARK-1. Usage: bash scripts/release/smoke.sh https://nelctro.shop
set -uo pipefail

BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "usage: bash scripts/release/smoke.sh <base-url>" >&2
  exit 2
fi
BASE="${BASE%/}"

fail=0

check() {
  local name="$1" expected="$2" url="$3"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo 000)"
  if [ "$code" = "$expected" ]; then
    echo "PASS  $name ($code)"
  else
    echo "FAIL  $name (expected $expected, got $code) -> $url"
    fail=1
  fi
}

# Web app and SPA fallback.
check "web root"                200 "$BASE/"
check "spa fallback"            200 "$BASE/some/deep/route"

# API readiness (proxied through nginx on the same origin).
check "api ready"               200 "$BASE/health/ready"

# Auth is enforced: unauthenticated access must be rejected.
check "links requires auth"     401 "$BASE/v1/links"

# Webhook must reject unsigned/bogus requests (not 200).
check "webhook rejects bogus"   400 "$BASE/v1/webhooks/razorpay"

if [ "$fail" -ne 0 ]; then
  echo "smoke test FAILED" >&2
  exit 1
fi
echo "smoke test PASSED for $BASE"
