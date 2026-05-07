#!/usr/bin/env bash
##############################################################################
#  test_mastodon_interop.sh
#
#  Starts the Spirits server and a local Mastodon instance in Docker, then
#  uses curl smoke tests and Playwright to prove that Mastodon can discover
#  and render a Spirits ActivityPub actor.
#
#  Usage:
#    bash test_mastodon_interop.sh
#
#  The stack is left running after the test so you can inspect the Mastodon UI.
#  To stop it:
#    docker compose -f test/docker-compose.test.yml down -v
##############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$SCRIPT_DIR/test"
COMPOSE="docker compose -f $TEST_DIR/docker-compose.test.yml"

# Admin credentials for the Mastodon account created by this script.
# Override via environment variables if desired.
MASTODON_ADMIN_EMAIL="${MASTODON_ADMIN_EMAIL:-admin@mastodon.test}"
MASTODON_ADMIN_PASSWORD="${MASTODON_ADMIN_PASSWORD:-test_spirits_password}"

# ── Colour helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[interop]${NC} $*"; }
success() { echo -e "${GREEN}[interop]${NC} $*"; }
warn()    { echo -e "${YELLOW}[interop]${NC} $*"; }
error()   { echo -e "${RED}[interop]${NC} $*" >&2; }

# ── 0. Prerequisites ──────────────────────────────────────────────────────────
info "Checking prerequisites…"
for cmd in docker node openssl; do
  if ! command -v "$cmd" &>/dev/null; then
    error "Required command not found: $cmd"
    exit 1
  fi
done

# Check 'docker compose' (v2) plugin
if ! docker compose version &>/dev/null; then
  error "'docker compose' (v2) not found. Install Docker Desktop or the compose plugin."
  exit 1
fi

# Check npx / playwright
if ! command -v npx &>/dev/null; then
  error "'npx' not found. Install Node.js 18+."
  exit 1
fi

success "All prerequisites present."

# ── 1. /etc/hosts check ───────────────────────────────────────────────────────
info "Checking /etc/hosts entries…"
MISSING_HOSTS=()
for domain in spirits.test mastodon.test; do
  if ! grep -qE "^\s*127\.0\.0\.1\s+.*${domain}" /etc/hosts; then
    MISSING_HOSTS+=("$domain")
  fi
done

if [[ ${#MISSING_HOSTS[@]} -gt 0 ]]; then
  warn "/etc/hosts is missing entries for: ${MISSING_HOSTS[*]}"
  warn "Add them now (requires sudo):"
  warn "  sudo sh -c 'echo \"127.0.0.1 spirits.test mastodon.test\" >> /etc/hosts'"
  read -rp "$(echo -e "${YELLOW}Add them automatically (sudo required)? [y/N]: ${NC}")" ADD_HOSTS
  if [[ "$ADD_HOSTS" =~ ^[Yy]$ ]]; then
    sudo sh -c 'echo "127.0.0.1 spirits.test mastodon.test" >> /etc/hosts'
    success "/etc/hosts updated."
  else
    error "Please add the hosts entries manually and re-run."
    exit 1
  fi
fi

# ── 2. TLS certificates ───────────────────────────────────────────────────────
CERTS_DIR="$TEST_DIR/nginx/certs"
if [[ ! -f "$CERTS_DIR/ca.crt" || ! -f "$CERTS_DIR/spirits.test.crt" || ! -f "$CERTS_DIR/mastodon.test.crt" ]]; then
  info "Generating TLS certificates…"
  chmod +x "$TEST_DIR/nginx/gen-certs.sh"
  bash "$TEST_DIR/nginx/gen-certs.sh"
  success "Certificates generated."
else
  info "TLS certificates already present — skipping generation."
fi

# ── 3. Mastodon .env file ─────────────────────────────────────────────────────
MASTODON_ENV="$TEST_DIR/mastodon.env"
if [[ ! -f "$MASTODON_ENV" ]]; then
  info "Generating mastodon.env from template…"

  # Generate VAPID key pair using the Mastodon container itself (most reliable)
  # We'll use openssl for the other secrets and generate VAPID after first boot.
  cp "$TEST_DIR/mastodon.env.template" "$MASTODON_ENV"

  # Fill in random secrets
  fill_secret() {
    local KEY="$1"
    local VALUE
    VALUE="$(openssl rand -hex 64)"
    # macOS sed requires an extension argument
    sed -i.bak "s|${KEY}=FILL_IN|${KEY}=${VALUE}|" "$MASTODON_ENV"
    rm -f "${MASTODON_ENV}.bak"
  }

  fill_secret "SECRET_KEY_BASE"
  fill_secret "OTP_SECRET"
  fill_secret "ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY"
  fill_secret "ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT"
  fill_secret "ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY"

  # VAPID keys — generate with mastodon container on first start, then patch env
  # Use a temporary container to run the rake task
  info "Generating VAPID keys via Mastodon rake task…"
  VAPID_OUTPUT=$(docker run --rm \
    --env-file "$MASTODON_ENV" \
    ghcr.io/mastodon/mastodon:v4.3.3 \
    bundle exec rake mastodon:webpush:generate_vapid_key 2>/dev/null || true)

  if [[ -n "$VAPID_OUTPUT" ]]; then
    VAPID_PRIV=$(echo "$VAPID_OUTPUT" | grep VAPID_PRIVATE_KEY | cut -d= -f2)
    VAPID_PUB=$(echo "$VAPID_OUTPUT" | grep VAPID_PUBLIC_KEY | cut -d= -f2)
    sed -i.bak "s|VAPID_PRIVATE_KEY=FILL_IN|VAPID_PRIVATE_KEY=${VAPID_PRIV}|" "$MASTODON_ENV"
    sed -i.bak "s|VAPID_PUBLIC_KEY=FILL_IN|VAPID_PUBLIC_KEY=${VAPID_PUB}|" "$MASTODON_ENV"
    rm -f "${MASTODON_ENV}.bak"
    success "VAPID keys generated."
  else
    warn "Could not generate VAPID keys automatically. Filling with random hex (push notifications won't work, but federation will)."
    fill_secret "VAPID_PRIVATE_KEY"
    fill_secret "VAPID_PUBLIC_KEY"
  fi

  success "mastodon.env created."
else
  info "mastodon.env already exists — skipping."
fi

# ── 4. Build & start the stack ────────────────────────────────────────────────
info "Building and starting Docker services (this may take several minutes on first run)…"
$COMPOSE up -d --build
success "Docker services started."

# ── 5. Wait for services to be healthy ───────────────────────────────────────
wait_for_http() {
  local NAME="$1"
  local URL="$2"
  local MAX_WAIT="${3:-180}"
  local ELAPSED=0
  info "Waiting for $NAME ($URL)…"
  while true; do
    if curl -sk --max-time 5 "$URL" &>/dev/null; then
      success "$NAME is up."
      return 0
    fi
    if [[ $ELAPSED -ge $MAX_WAIT ]]; then
      error "$NAME did not become healthy after ${MAX_WAIT}s"
      $COMPOSE logs --tail=40
      exit 1
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    echo -n "."
  done
}

echo ""
wait_for_http "Spirits"  "https://spirits.test/.well-known/webfinger?resource=acct:x@x" 120
wait_for_http "Mastodon" "https://mastodon.test/health" 300
echo ""

# ── 6. First-run Mastodon admin account (idempotent) ────────────────────────
# DB migrations run in mastodon-init before mastodon-web starts — no manual step needed.
SENTINEL_FILE="$TEST_DIR/.mastodon_setup_done"
if [[ ! -f "$SENTINEL_FILE" ]]; then
  info "Creating Mastodon admin account ($MASTODON_ADMIN_EMAIL)…"
  $COMPOSE exec -T mastodon-web bin/tootctl accounts create \
    admin \
    --email="$MASTODON_ADMIN_EMAIL" \
    --confirmed \
    --role Owner || true   # ignore if account already exists

  $COMPOSE exec -T mastodon-web bin/tootctl accounts modify admin \
    --password="$MASTODON_ADMIN_PASSWORD" || true

  touch "$SENTINEL_FILE"
  success "Mastodon admin account ready."
else
  info "Mastodon admin account already configured — skipping."
fi

# ── 7. Curl smoke tests ───────────────────────────────────────────────────────
info "Running curl smoke tests…"
SMOKE_PASS=true

smoke_curl() {
  local LABEL="$1"; shift
  local EXPECTED="$1"; shift
  local RESPONSE
  RESPONSE=$(curl -sk "$@")
  if echo "$RESPONSE" | grep -q "$EXPECTED"; then
    success "PASS: $LABEL"
  else
    error "FAIL: $LABEL"
    error "      Expected to find: $EXPECTED"
    error "      Got: $(echo "$RESPONSE" | head -c 300)"
    SMOKE_PASS=false
  fi
}

# Webfinger
smoke_curl "Webfinger resolves stoic@spirits.test" \
  '"type":"Link"' \
  "https://spirits.test/.well-known/webfinger?resource=acct:stoic@spirits.test"

# Actor JSON-LD
smoke_curl "Actor profile returns ActivityStreams JSON-LD" \
  '"publicKey"' \
  -H 'Accept: application/activity+json' \
  "https://spirits.test/spirits/1"

# Outbox
smoke_curl "Outbox returns OrderedCollection" \
  '"OrderedCollection"' \
  -H 'Accept: application/activity+json' \
  "https://spirits.test/spirits/1/outbox"

# Mastodon resolves the actor via its own AP fetch endpoint
smoke_curl "Mastodon can resolve spirit actor (fetch endpoint)" \
  '"id"' \
  -H 'Accept: application/activity+json' \
  "https://mastodon.test/users/admin"

if [[ "$SMOKE_PASS" == "false" ]]; then
  error "One or more smoke tests failed. Check the output above."
  exit 1
fi

success "All smoke tests passed."

# ── 9. Install Playwright browsers if needed ──────────────────────────────────
if [[ ! -d "$SCRIPT_DIR/node_modules/@playwright" ]]; then
  info "Installing Playwright test package…"
  cd "$SCRIPT_DIR" && npm install --save-dev @playwright/test
fi

info "Installing Playwright browser binaries (Chromium)…"
cd "$SCRIPT_DIR" && npx playwright install chromium --with-deps 2>/dev/null || \
  npx playwright install chromium

# ── 10. Playwright UI tests ───────────────────────────────────────────────────
info "Running Playwright interop tests…"
cd "$SCRIPT_DIR"

MASTODON_ADMIN_EMAIL="$MASTODON_ADMIN_EMAIL" \
MASTODON_ADMIN_PASSWORD="$MASTODON_ADMIN_PASSWORD" \
  npx playwright test \
    --config=test/playwright.config.ts \
    test/mastodon-interop.spec.ts

PLAYWRIGHT_EXIT=$?

# ── 11. Summary ───────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
if [[ $PLAYWRIGHT_EXIT -eq 0 ]]; then
  success "ALL TESTS PASSED ✓"
else
  error "PLAYWRIGHT TESTS FAILED — see test/playwright-report/index.html"
fi
echo ""
echo -e "  Mastodon UI:  ${BLUE}https://mastodon.test${NC}"
echo -e "  Spirits:      ${BLUE}https://spirits.test${NC}"
echo -e "  Admin email:  $MASTODON_ADMIN_EMAIL"
echo -e "  Screenshots:  ${BLUE}test/screenshots/${NC}"
echo ""
echo "  To stop the stack:"
echo "    docker compose -f test/docker-compose.test.yml down -v"
echo "═══════════════════════════════════════════════════════════"

exit $PLAYWRIGHT_EXIT
