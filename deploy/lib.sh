#!/usr/bin/env bash
# Shared by deploy.sh, backup.sh and make-admin.sh. It is sourced, not run.
# shellcheck disable=SC2034  # the variables are used by the scripts that source this file

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$DEPLOY_DIR")"
ENV_FILE="$DEPLOY_DIR/.env"
SQL_CONTAINER="bookcart-sql"
APP_CONTAINER="bookcart-app"
DATABASE="BookDB"

# Git Bash on Windows rewrites arguments that look like Unix paths (/opt/mssql-tools18/...) before docker.exe sees them.
export MSYS_NO_PATHCONV=1

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Reads deploy/.env into the environment. The file is read as plain KEY=VALUE lines, never executed. A variable that is
# already set in the environment wins, as it does for Docker Compose.
load_env() {
  [[ -f $ENV_FILE ]] || die "deploy/.env does not exist yet. Run deploy/deploy.sh first: it asks a few questions and creates it."
  local line key value
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    [[ -z $line || $line == \#* || $line != *=* ]] && continue
    key=${line%%=*}
    value=${line#*=}
    [[ $key =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    [[ -v $key ]] || export "$key=$value"
  done < "$ENV_FILE"
}

# Runs from the deploy folder with relative paths: on Windows, docker.exe and git.exe are native programs that do not
# understand the /d/... form Git Bash uses for absolute paths.
compose() {
  (cd "$DEPLOY_DIR" && docker compose --env-file .env -f docker-compose.yml "$@")
}

container_running() {
  [[ $(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null) == true ]]
}

# Runs sqlcmd inside the SQL Server container as sa. The password goes through the environment, not the command line.
sql() {
  SQLCMDPASSWORD="$SA_PASSWORD" docker exec -e SQLCMDPASSWORD "$SQL_CONTAINER" \
    /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa "$@"
}

# The last line of a one-value query result, without spaces or carriage returns. If the query fails, sqlcmd's own
# message goes to stderr and the return code is 1 (callers add || die ...).
sql_value() {
  local out
  out=$(sql -h -1 -W -b -Q "SET NOCOUNT ON; $1") || { printf '%s\n' "$out" >&2; return 1; }
  printf '%s\n' "$out" | tr -d '\r' | awk 'NF { last = $0 } END { gsub(/[[:space:]]/, "", last); print last }'
}

database_exists() {
  local exists
  exists=$(sql_value "SELECT CASE WHEN DB_ID('$DATABASE') IS NULL THEN 0 ELSE 1 END") || die "Could not ask SQL Server whether the database exists."
  [[ $exists == 1 ]]
}

# True when deploy/.env turns Caddy (HTTPS) on.
https_enabled() {
  [[ ",${COMPOSE_PROFILES:-}," == *,https,* ]]
}
