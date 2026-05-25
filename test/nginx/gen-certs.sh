#!/usr/bin/env bash
# Generates a local CA and domain certificates for spirits.test and mastodon.test.
# Output: test/nginx/certs/{ca,spirits.test,mastodon.test}.{key,crt}
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="$SCRIPT_DIR/certs"
mkdir -p "$CERTS_DIR"

echo "[gen-certs] Generating certificates in $CERTS_DIR"

# ── 1. Local Certificate Authority ───────────────────────────────────────────
openssl genrsa -out "$CERTS_DIR/ca.key" 4096 2>/dev/null

openssl req -new -x509 \
  -key "$CERTS_DIR/ca.key" \
  -out "$CERTS_DIR/ca.crt" \
  -days 3650 \
  -subj "/CN=SpiritsMastodonTestCA" \
  -extensions v3_ca \
  -addext "basicConstraints=critical,CA:TRUE" \
  2>/dev/null

echo "[gen-certs] CA created: ca.crt"

# ── 2. Helper: issue a domain cert signed by the local CA ─────────────────────
issue_cert() {
  local DOMAIN="$1"

  # Private key
  openssl genrsa -out "$CERTS_DIR/${DOMAIN}.key" 2048 2>/dev/null

  # CSR with SAN
  openssl req -new \
    -key "$CERTS_DIR/${DOMAIN}.key" \
    -out "$CERTS_DIR/${DOMAIN}.csr" \
    -subj "/CN=${DOMAIN}" \
    2>/dev/null

  # Sign with local CA, adding SAN extension
  openssl x509 -req \
    -in "$CERTS_DIR/${DOMAIN}.csr" \
    -CA "$CERTS_DIR/ca.crt" \
    -CAkey "$CERTS_DIR/ca.key" \
    -CAcreateserial \
    -out "$CERTS_DIR/${DOMAIN}.crt" \
    -days 825 \
    -extfile <(printf "subjectAltName=DNS:%s,DNS:www.%s\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth" "$DOMAIN" "$DOMAIN") \
    2>/dev/null

  rm -f "$CERTS_DIR/${DOMAIN}.csr"
  echo "[gen-certs] Certificate issued: ${DOMAIN}.crt"
}

issue_cert "spirits.test"
issue_cert "mastodon.test"

echo "[gen-certs] Done. Files in $CERTS_DIR:"
ls -1 "$CERTS_DIR"
