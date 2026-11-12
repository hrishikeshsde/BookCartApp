#!/usr/bin/env bash
# Checks that a running deployment is what it should be. Run it after deploy/deploy.sh (CI runs it too).
#
#   deploy/verify.sh [base-url]     default: https://<DOMAIN> in HTTPS mode, otherwise http://localhost:<APP_PORT>
#
# It checks that the app is healthy and answers; that every page address serves the right file of the build (the drawn
# pages for /, /login and /register, the empty client shell for every other page); that the build's own self-check
# (BookCart/ClientApp/verify-static.js: every file the pages and the CSS refer to exists, no inline script) passes on the
# files inside the running container; that a font named by the CSS is served; that the security headers are present; and
# that SQL Server is not published. Exit code 0 when everything passes, 1 otherwise. It changes nothing.
set -uo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [[ ${1:-} == -h || ${1:-} == --help ]]; then sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; fi
[[ -f $ENV_FILE ]] && load_env
base="${1:-}"
if [[ -z $base ]]; then
  if https_enabled; then base="https://${DOMAIN:?DOMAIN is empty in deploy/.env}"; else base="http://localhost:${APP_PORT:-8080}"; fi
fi
base="${base%/}"
curl_opts=(-s -m 30)
[[ $base == https://localhost* ]] && curl_opts+=(-k)   # Caddy's own certificate authority is not trusted by curl

failures=0
ok() { say "  ok    $*"; }
bad() { say "  FAIL  $*"; failures=$((failures + 1)); }

# Runs from a work folder inside deploy/, with relative paths: on Windows, docker.exe and node.exe do not understand the
# /d/... form Git Bash uses for absolute paths.
work="$DEPLOY_DIR/.verify-tmp"
rm -rf "$work"; mkdir -p "$work"
trap 'rm -rf "$work"' EXIT
cd "$work" || exit 1

expect_status() { # <path> <status> [content type]
  local got
  got=$(curl "${curl_opts[@]}" -o /dev/null -w '%{http_code} %{content_type}' "$base$1")
  if [[ $got == "$2 ${3:-}"* ]]; then ok "$1 -> $got"; else bad "$1 -> $got (expected $2 ${3:-})"; fi
}

say "Checking $base"
say "The application"
if [[ $(docker inspect -f '{{.State.Health.Status}}' "$APP_CONTAINER" 2> /dev/null) == healthy ]]; then ok "container $APP_CONTAINER is healthy"; else bad "container $APP_CONTAINER is not healthy"; fi
expect_status /health 200 text/plain
expect_status /api/book 200 application/json
expect_status /api/book/GetCategoriesList 200 application/json
expect_status /Upload/Default_image.jpg 200 image/jpeg
expect_status /api/nope 404 application/problem+json
expect_status /missing-chunk.js 404

say "Every page address serves the right file of the build"
docker cp "$APP_CONTAINER:/app/wwwroot" wwwroot > /dev/null 2>&1 || bad "could not copy /app/wwwroot out of $APP_CONTAINER"
served_is() { # <path> <file in the image's wwwroot>
  curl "${curl_opts[@]}" -o served.tmp "$base$1"
  if [[ -f wwwroot/$2 ]] && cmp -s served.tmp "wwwroot/$2"; then ok "$1 is $2"; else bad "$1 is not $2 (or the file is missing from the image)"; fi
}
served_is / index.html
served_is /login login/index.html
served_is /register register/index.html
for page in /wishlist /checkout /shopping-cart /books/details/1 /admin/books; do served_is "$page" index.csr.html; done

say "The build's self-check on the files inside the container"
if command -v node > /dev/null 2>&1 && [[ -f ../../BookCart/ClientApp/verify-static.js ]]; then
  if out=$(node ../../BookCart/ClientApp/verify-static.js wwwroot 2>&1); then ok "$(printf '%s' "$out" | tail -1 | sed 's|verify-static: [0-9]* files in .*wwwroot, |verify-static: |')"; else bad "verify-static: $out"; fi
else
  say "  skip  node or BookCart/ClientApp/verify-static.js is not available here"
fi

say "Fonts"
font=""
for css in $(curl "${curl_opts[@]}" "$base/" | grep -o 'href="[^"]*\.css"' | sed 's/^href="//; s/"$//'); do
  css="${css#/}"
  font=$(curl "${curl_opts[@]}" "$base/$css" | grep -o 'media/[A-Za-z0-9_.-]*\.woff2' | head -1)
  [[ -n $font ]] && break
done
if [[ -z $font ]]; then bad "no font file is named by the stylesheets linked from /"; else expect_status "/$font" 200 font/woff2; fi

say "Security"
headers=$(curl "${curl_opts[@]}" -I "$base/")
for header in x-content-type-options x-frame-options referrer-policy content-security-policy; do
  if grep -qi "^$header" <<< "$headers"; then ok "header $header"; else bad "header $header is missing"; fi
done
if [[ -z $(docker port "$SQL_CONTAINER" 2> /dev/null) ]]; then ok "SQL Server has no published port"; else bad "SQL Server is published: $(docker port "$SQL_CONTAINER" | tr '\n' ' ')"; fi
if https_enabled; then
  if docker port "$APP_CONTAINER" 8080 2> /dev/null | grep -q '^127\.0\.0\.1:'; then ok "the app's own port is bound to 127.0.0.1 (only Caddy reaches it)"; else bad "the app's port is not bound to 127.0.0.1 in HTTPS mode"; fi
  if container_running bookcart-caddy; then ok "Caddy is running"; else bad "Caddy is not running"; fi
fi

say
if (( failures == 0 )); then say "All checks passed."; else say "$failures check(s) FAILED."; fi
(( failures == 0 ))
