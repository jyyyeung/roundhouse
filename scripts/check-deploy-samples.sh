#!/usr/bin/env bash
# Validate the TLS samples in docs/deploy without a real deployment (#47).
#
#   - Caddyfile   : caddy validate, in the official image
#   - nginx-tls   : nginx -t, in the official image, with a throwaway
#                   self-signed certificate mounted where the sample expects one
#
# Both run offline and touch nothing on the host: every mount is a temp dir or a
# read-only copy of the sample. Docker is required — the samples are container
# configurations, so validating them without it would only check the comments.
set -euo pipefail

cd "$(dirname "$0")/.."

deploy_dir="docs/deploy"
caddyfile="$PWD/$deploy_dir/Caddyfile"
nginx_sample="$PWD/$deploy_dir/nginx-tls.conf"

for file in "$caddyfile" "$nginx_sample"; do
	if [ ! -f "$file" ]; then
		printf 'check-deploy-samples: missing %s\n' "$file" >&2
		exit 1
	fi
done

if ! docker info >/dev/null 2>&1; then
	printf 'check-deploy-samples: docker is not available; the samples cannot be validated\n' >&2
	exit 1
fi

step() { printf '\n== %s\n' "$*"; }

step "caddy validate"
caddy_image="${CADDY_IMAGE:-caddy:2-alpine}"
docker run --rm \
	--volume "$caddyfile:/etc/caddy/Caddyfile:ro" \
	"$caddy_image" \
	caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

step "nginx -t"
work="$(mktemp -d)"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT

# The sample points at the usual certbot path; give it a certificate there so
# nginx parses TLS without a real domain. Two days is plenty for a parse check.
cert_dir="$work/letsencrypt/table.example.com"
mkdir -p "$cert_dir"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
	-keyout "$cert_dir/privkey.pem" \
	-out "$cert_dir/fullchain.pem" \
	-subj "/CN=table.example.com" >/dev/null 2>&1

nginx_image="${NGINX_IMAGE:-nginx:1.27-alpine}"
# --add-host stands in for the Compose network: the sample proxies to `web:80`
# and nginx resolves upstream names at parse time.
docker run --rm \
	--add-host web:127.0.0.1 \
	--volume "$nginx_sample:/etc/nginx/conf.d/default.conf:ro" \
	--volume "$cert_dir:/etc/letsencrypt/live/table.example.com:ro" \
	"$nginx_image" \
	nginx -t

printf '\ncheck-deploy-samples: ok (Caddyfile and nginx sample parse)\n'
