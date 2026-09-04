#!/usr/bin/env bash
# First TLS certificate for the production host. Run once, before the first
# `docker compose -f docker-compose.prod.yml up -d`.
#
#   DIXORA_DOMAIN=dixoratech.com LETSENCRYPT_EMAIL=ops@dixoratech.com \
#     ./ops/init-letsencrypt.sh
#   STAGING=1 ./ops/init-letsencrypt.sh      # rehearse without burning quota
#
# Chicken and egg: nginx will not start without a certificate file, and certbot
# cannot answer the ACME challenge without nginx serving it. So a throwaway
# self-signed pair goes in first, nginx comes up, the real certificate replaces
# it, and nginx reloads. Renewals afterwards are handled by the certbot service
# in the Compose file and need nothing from this script.
#
# Let's Encrypt allows 5 failures per account per hostname per hour. Rehearse
# with STAGING=1 until the whole run is clean, then run it for real once.

set -euo pipefail

export MSYS_NO_PATHCONV=1

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
STAGING="${STAGING:-0}"
RSA_KEY_SIZE=4096

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

if [ ! -f "$ENV_FILE" ]; then
  echo "missing $ENV_FILE - copy .env.production.example and fill it in first" >&2
  exit 1
fi

# Values may come from the environment or from the env file; the environment
# wins so a one-off run can override without editing the file.
set -a
# shellcheck disable=SC1090
. "./$ENV_FILE"
set +a

: "${DIXORA_DOMAIN:?DIXORA_DOMAIN must be set (e.g. dixoratech.com)}"
: "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL must be set - expiry warnings go there}"

domains=("$DIXORA_DOMAIN" "www.$DIXORA_DOMAIN")
cert_path="/etc/letsencrypt/live/$DIXORA_DOMAIN"

echo "==> certificate for: ${domains[*]}"

if compose run --rm --entrypoint "sh -c 'test -s $cert_path/fullchain.pem'" certbot 2>/dev/null; then
  echo "a certificate already exists for $DIXORA_DOMAIN"
  echo "delete it inside the letsencrypt volume first if you really want to reissue"
  exit 0
fi

echo "==> placing a temporary self-signed certificate so nginx can start"
compose run --rm --entrypoint "sh -c '
  mkdir -p $cert_path &&
  openssl req -x509 -nodes -newkey rsa:$RSA_KEY_SIZE -days 1 \
    -keyout $cert_path/privkey.pem \
    -out $cert_path/fullchain.pem \
    -subj \"/CN=$DIXORA_DOMAIN\"
'" certbot

echo "==> starting the proxy"
compose up -d proxy

echo "==> asking Let's Encrypt for the real certificate"
staging_flag=""
if [ "$STAGING" != "0" ]; then
  staging_flag="--staging"
  echo "    (staging: the result will NOT be trusted by browsers)"
fi

domain_args=""
for domain in "${domains[@]}"; do
  domain_args="$domain_args -d $domain"
done

# The self-signed placeholder has to go, or certbot treats this as a renewal of
# a certificate it did not issue and declines to replace it.
compose run --rm --entrypoint "sh -c 'rm -rf /etc/letsencrypt/live/$DIXORA_DOMAIN /etc/letsencrypt/archive/$DIXORA_DOMAIN /etc/letsencrypt/renewal/$DIXORA_DOMAIN.conf'" certbot

# shellcheck disable=SC2086
compose run --rm --entrypoint "certbot certonly --webroot -w /var/www/certbot \
  $staging_flag \
  $domain_args \
  --email $LETSENCRYPT_EMAIL \
  --rsa-key-size $RSA_KEY_SIZE \
  --agree-tos \
  --no-eff-email \
  --non-interactive" certbot

echo "==> reloading nginx with the issued certificate"
compose exec proxy nginx -s reload

echo
echo "done. https://$DIXORA_DOMAIN should now present a valid certificate."
echo "renewals are automatic - the certbot service checks twice a day."
