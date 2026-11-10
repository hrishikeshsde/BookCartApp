#!/usr/bin/env bash
# Deploys BookCart on this machine with Docker: builds the images from the source in this repository, backs up an existing
# database, applies the migrations, starts everything and waits until the app is healthy.
#
#   deploy/deploy.sh          first run: asks a few questions and creates deploy/.env. Later runs: updates the deployment.
#   deploy/deploy.sh -y       never asks (needs an existing deploy/.env): for automation
#   deploy/deploy.sh --pull   also fetches newer base images (.NET, Node, SQL Server, Caddy) before building
#
# Update = git pull, then run this again. It is safe to run any time: it never deletes a volume and never prints a secret.
# The only thing you need on the machine is Docker (Engine or Desktop) with the Compose plugin, and git if you clone.
set -Eeuo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ASSUME_YES=0
PULL=()
usage() { sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
for arg in "$@"; do
  case $arg in
    -y|--yes) ASSUME_YES=1 ;;
    --pull) PULL=(--pull) ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

on_error() { printf '\nERROR: stopped unexpectedly (%s line %s, exit code %s). Nothing was deleted.\n' "$1" "$2" "$3" >&2; }
trap 'on_error "${BASH_SOURCE[0]##*/}" "$LINENO" "$?"' ERR

# ---- 1. Docker --------------------------------------------------------------------------------------------------
preflight() {
  command -v docker > /dev/null 2>&1 || die "Docker is not installed. Install Docker Engine (https://docs.docker.com/engine/install/) or Docker Desktop, then run this again."
  docker compose version > /dev/null 2>&1 || die "The Docker Compose plugin (the 'docker compose' command, version 2) is missing. Install it (https://docs.docker.com/compose/install/) and run this again."
  docker info > /dev/null 2>&1 || die "Docker is installed but does not answer. Start it (Docker Desktop: open it and wait for the whale), or on Linux check that your user may use Docker (the docker group, or run this with sudo)."
}

# ---- 2. deploy/.env ---------------------------------------------------------------------------------------------
random_hex() { # $1 = number of random bytes; prints twice as many hex characters
  if command -v openssl > /dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

ask() { # $1 = question; the answer is left in $REPLY
  printf '%s' "$1"
  read -r REPLY || REPLY=""
  REPLY=${REPLY//$'\r'/}
}

create_env() {
  [[ $ASSUME_YES == 0 ]] || die "deploy/.env does not exist, and -y means no questions. Run deploy/deploy.sh once without -y (it creates the file), or copy deploy/.env.example to deploy/.env and fill it in."

  say "First run: deploy/.env does not exist yet. Two questions, then the secrets are generated for you."
  say
  say "The address the site will have. Give a domain name (for example shop.example.com) to get HTTPS with a free"
  say "certificate: its DNS must already point at this server, and ports 80 and 443 must be open. Leave it blank for"
  say "plain HTTP on port 8080 (a demo, a test machine, a private network)."
  local domain="" email=""
  while true; do
    ask "Domain (blank = plain HTTP): "
    domain=$(printf '%s' "$REPLY" | tr '[:upper:]' '[:lower:]')
    if [[ -z $domain ]]; then break; fi
    if [[ $domain =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$ && ${#domain} -le 253 ]]; then break; fi
    say "That does not look like a domain name (letters, digits, dots and dashes only, no http:// and no slashes). Try again."
  done
  if [[ -n $domain ]]; then
    say
    say "An e-mail address for the certificate: Let's Encrypt writes to it before a certificate expires."
    while true; do
      ask "E-mail: "
      email=$REPLY
      if [[ $email =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then break; fi
      say "That does not look like an e-mail address. Try again."
    done
  fi

  # SQL Server wants upper case, lower case and digits: hex gives lower case and digits, the suffix adds an upper case letter.
  local sa_password jwt_secret profiles bind forwarded issuer
  sa_password="$(random_hex 12)Az1"
  jwt_secret="$(random_hex 48)"
  if [[ -n $domain ]]; then
    profiles=https; bind=127.0.0.1; forwarded=true; issuer="https://$domain/"
  else
    profiles=""; bind=0.0.0.0; forwarded=false; issuer="http://localhost:8080/"
  fi

  (
    umask 077
    cat > "$ENV_FILE" <<EOF
# Created by deploy/deploy.sh on $(date '+%Y-%m-%d %H:%M'). It holds secrets: it is git-ignored, never commit it.
# Keep a copy somewhere safe. The SQL Server password cannot be recovered from the database volume, and a different
# JWT_SECRET signs every user out. See deploy/.env.example for what each setting does.
COMPOSE_PROFILES=$profiles
APP_BIND=$bind
FORWARDED_HEADERS=$forwarded
DOMAIN=$domain
ACME_EMAIL=$email
APP_PORT=8080
JWT_ISSUER=$issuer
JWT_AUDIENCE=$issuer
SA_PASSWORD=$sa_password
JWT_SECRET=$jwt_secret
GEMINI_API_KEY=
MSSQL_PID=Express
EOF
  )
  chmod 600 "$ENV_FILE" 2> /dev/null || true
  say
  say "Created deploy/.env with generated secrets."
  say ">> KEEP A COPY of deploy/.env somewhere safe (a password manager, an encrypted backup). <<"
  say
}

check_env() {
  [[ -n ${SA_PASSWORD:-} ]] || die "SA_PASSWORD is empty in deploy/.env"
  [[ -n ${JWT_SECRET:-} ]] || die "JWT_SECRET is empty in deploy/.env"
  (( ${#SA_PASSWORD} >= 8 )) || die "SA_PASSWORD must have at least 8 characters (SQL Server also wants upper case, lower case and digits)."
  (( ${#JWT_SECRET} >= 32 )) || die "JWT_SECRET must have at least 32 characters."
  # Both end up in a connection string and in a Compose file: these characters would break one or the other.
  local name
  for name in SA_PASSWORD JWT_SECRET; do
    if [[ ${!name} =~ [[:space:]\;=\$\"\'#\\] ]]; then
      die "$name in deploy/.env contains a space, quote, semicolon, equals sign, dollar sign, hash or backslash. Use only letters and digits."
    fi
  done
  if https_enabled; then
    [[ -n ${DOMAIN:-} ]] || die "COMPOSE_PROFILES=https needs DOMAIN in deploy/.env"
    [[ -n ${ACME_EMAIL:-} ]] || die "COMPOSE_PROFILES=https needs ACME_EMAIL in deploy/.env (Caddy refuses to start without it)"
  fi
}

# ---- 3. tag -----------------------------------------------------------------------------------------------------
release_tag() {
  local tag sha
  tag="$(date +%Y%m%d-%H%M)"
  if sha=$(cd "$ROOT_DIR" && git rev-parse --short HEAD 2> /dev/null); then tag="$tag-$sha"; else tag="$tag-local"; fi
  printf '%s' "$tag"
}

# ---- main -------------------------------------------------------------------------------------------------------
preflight
if [[ ! -f $ENV_FILE ]]; then create_env; fi
load_env
check_env

BOOKCART_TAG="$(release_tag)"
export BOOKCART_TAG
if https_enabled; then mode="HTTPS for $DOMAIN (Caddy)"; else mode="plain HTTP on port ${APP_PORT:-8080}"; fi
say "===== BookCart deployment: release $BOOKCART_TAG, $mode ====="

say
say "[1/5] Building the images (the first build takes a few minutes, later ones reuse what has not changed) ..."
compose build "${PULL[@]}"
# Also tag them "latest", so that a plain "docker compose up" later uses the release that was just deployed.
docker tag "bookcart:$BOOKCART_TAG" bookcart:latest
docker tag "bookcart-migrate:$BOOKCART_TAG" bookcart-migrate:latest

say
say "[2/5] Starting SQL Server ..."
compose up -d --wait --wait-timeout 180 sqlserver || {
  compose logs --no-color --tail 30 sqlserver >&2 || true
  die "SQL Server did not become healthy. If the log above says the login failed, SA_PASSWORD in deploy/.env is not the one the database volume was created with."
}

say
say "[3/5] Backup"
bash "$DEPLOY_DIR/backup.sh" "$BOOKCART_TAG"

say
say "[4/5] Applying the database migrations, then starting the application ..."
# The migration runs on its own first. "docker compose up" would replace the running application with the new one
# before it starts the migration (it recreates a container, then waits for its dependencies), so a failed migration
# would leave no application running at all. This way a failure stops here, before the running version is touched.
if ! compose run --rm --no-deps -T migrate; then
  say >&2
  say "The database migration failed (its output is above). The version that was running before keeps running, and nothing was changed or deleted." >&2
  say "The backup taken just before is in deploy/backups. Fix the cause, then run deploy/deploy.sh again." >&2
  exit 1
fi
if ! https_enabled; then
  # Switching from HTTPS to plain HTTP: Compose ignores a service whose profile is off, so stop Caddy by hand.
  compose --profile https rm -sf caddy > /dev/null 2>&1 || true
fi
if ! compose up -d --remove-orphans --wait --wait-timeout 180; then
  say >&2
  say "----- application log -----" >&2
  compose logs --no-color --tail 40 app >&2 || true
  say >&2
  say "The database was migrated, but the new version did not start properly (its log is above)." >&2
  say "To go back: restore the backup from deploy/backups (see the comment in deploy/backup.sh) and deploy the previous code again." >&2
  say "The images of earlier releases are still there, as bookcart:<tag>: $(docker images bookcart --format '{{.Tag}}' | grep -v '^latest$' | tr '\n' ' ')" >&2
  exit 1
fi

say
say "[5/5] Checking the result ..."
[[ $(docker inspect -f '{{.State.Health.Status}}' "$APP_CONTAINER" 2> /dev/null) == healthy ]] || die "The application container is not healthy. See: docker logs $APP_CONTAINER"
if https_enabled; then
  container_running bookcart-caddy || die "Caddy is not running. See: docker logs bookcart-caddy"
  url="https://$DOMAIN/"
else
  url="http://localhost:${APP_PORT:-8080}/"
fi

say
say "===== Release $BOOKCART_TAG is running ====="
say "Site:        $url"
if ! https_enabled; then say "             (from another machine, use this server's address instead of localhost)"; fi
say "Logs:        docker logs -f $APP_CONTAINER"
say "Stop:        docker compose --env-file deploy/.env -f deploy/docker-compose.yml --profile '*' down    (the data stays in Docker volumes)"
say "Update:      git pull, then deploy/deploy.sh again (it backs up the database first)"
say "First admin: register in the site, then run:  deploy/make-admin.sh <username>"
