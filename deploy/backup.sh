#!/usr/bin/env bash
# Backs up the BookCart database to deploy/backups/BookDB_<name>.bak and checks the file.
#
#   deploy/backup.sh [name]     name defaults to the current date and time (deploy.sh passes the release tag)
#
# deploy.sh runs this before every update; run it by hand any time the stack is up. If there is no database yet there is
# nothing to back up and the script says so and succeeds. The backup is taken with CHECKSUM and then verified with
# RESTORE VERIFYONLY, so a file that exists is a file that can be restored. The newest BACKUP_KEEP files (default 7) are
# kept. The backups hold your customers' data: copy them somewhere else, and protect them like deploy/.env.
#
# To RESTORE a backup (this REPLACES the current database, so back up first if there is anything worth keeping):
#   1. stop the app:   docker compose --env-file deploy/.env -f deploy/docker-compose.yml stop app
#   2. copy the file in, and restore it. In the second command put the sa password (SA_PASSWORD in deploy/.env) after
#      SQLCMDPASSWORD= :
#        docker cp deploy/backups/BookDB_<name>.bak bookcart-sql:/var/opt/mssql/backup/restore.bak
#        docker exec -e SQLCMDPASSWORD=<password> bookcart-sql /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -b -Q \
#          "ALTER DATABASE [BookDB] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; RESTORE DATABASE [BookDB] FROM DISK = N'/var/opt/mssql/backup/restore.bak' WITH REPLACE, CHECKSUM; ALTER DATABASE [BookDB] SET MULTI_USER;"
#   3. start the app again (run deploy/deploy.sh, or: docker compose ... start app). Restoring a backup from an older
#      release goes with deploying that release's code, so that the app and the schema match.
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [[ ${1:-} == -h || ${1:-} == --help ]]; then sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; fi

load_env
[[ -n ${SA_PASSWORD:-} ]] || die "SA_PASSWORD is empty in deploy/.env"
container_running "$SQL_CONTAINER" || die "The SQL Server container ($SQL_CONTAINER) is not running, so there is nothing to back up from. Start the stack first."

name="${1:-${BOOKCART_TAG:-$(date +%Y%m%d-%H%M%S)}}"
[[ $name =~ ^[A-Za-z0-9._-]+$ ]] || die "The backup name may contain only letters, digits, dots, dashes and underscores."
keep="${BACKUP_KEEP:-7}"
[[ $keep =~ ^[0-9]+$ && $keep -ge 1 ]] || die "BACKUP_KEEP must be a number of at least 1."

if ! database_exists; then
  say "No database yet: nothing to back up (the migrations will create it)."
  exit 0
fi

file="BookDB_${name}.bak"
inside="/var/opt/mssql/backup/$file"
say "Backing up $DATABASE to deploy/backups/$file ..."
docker exec "$SQL_CONTAINER" mkdir -p /var/opt/mssql/backup
if ! sql -b -Q "BACKUP DATABASE [$DATABASE] TO DISK = N'$inside' WITH INIT, CHECKSUM; RESTORE VERIFYONLY FROM DISK = N'$inside' WITH CHECKSUM;" > /dev/null; then
  docker exec "$SQL_CONTAINER" rm -f "$inside" || true
  die "The backup failed (or did not verify). Nothing was changed."
fi

mkdir -p "$DEPLOY_DIR/backups"
# A relative destination: on Windows, docker.exe does not understand the /d/... form Git Bash uses for absolute paths.
(cd "$DEPLOY_DIR" && docker cp "$SQL_CONTAINER:$inside" "backups/$file") || die "The backup exists inside the container ($inside) but could not be copied out."
docker exec "$SQL_CONTAINER" rm -f "$inside" || true
[[ -s $DEPLOY_DIR/backups/$file ]] || die "The copied backup is empty: deploy/backups/$file"

# Keep the newest $keep backups (the names are the ones this script generated, so plain ls is safe here).
# shellcheck disable=SC2012
(cd "$DEPLOY_DIR/backups" && ls -1t BookDB_*.bak 2>/dev/null | tail -n +$((keep + 1)) | while read -r old; do rm -f -- "$old"; say "Removed the old backup $old"; done)

size=$(wc -c < "$DEPLOY_DIR/backups/$file" | tr -d ' ')
say "Backup saved and verified: deploy/backups/$file ($((size / 1024)) KB)"
