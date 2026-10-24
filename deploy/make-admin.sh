#!/usr/bin/env bash
# Makes a registered user an administrator.
#
#   deploy/make-admin.sh <username>
#
# No admin account exists on a new installation. Register in the site first, then run this with that username. The user
# must log out and in again afterwards: the role is part of the login token, which is issued at login.
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() { sed -n '2,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

if [[ ${1:-} == -h || ${1:-} == --help ]]; then usage; exit 0; fi
if [[ $# -ne 1 ]]; then usage >&2; exit 2; fi

username="$1"
# The name goes into a SQL statement, so only characters that cannot change the statement are accepted. This is the
# whole defence against injection here (registered names are letters, digits and a few symbols anyway).
[[ $username =~ ^[A-Za-z0-9_.@-]{1,50}$ ]] || die "A username has only letters, digits and _ . @ - (at most 50 characters)."

load_env
[[ -n ${SA_PASSWORD:-} ]] || die "SA_PASSWORD is empty in deploy/.env"
container_running "$SQL_CONTAINER" || die "The SQL Server container ($SQL_CONTAINER) is not running. Start the stack first (deploy/deploy.sh)."
database_exists || die "There is no $DATABASE database yet. Deploy first (deploy/deploy.sh) and register the user in the site."

current=$(sql_value "SELECT TOP 1 UserTypeID FROM [$DATABASE].dbo.UserMaster WHERE Username = '$username'") || die "Could not read the user."
if [[ -z $current ]]; then
  die "There is no user named '$username'. Register it in the site first, then run this again."
fi
if [[ $current == 1 ]]; then
  say "'$username' is already an administrator."
  exit 0
fi

changed=$(sql_value "UPDATE [$DATABASE].dbo.UserMaster SET UserTypeID = 1 WHERE Username = '$username'; SELECT @@ROWCOUNT") || die "Could not update the user."
[[ $changed == 1 ]] || die "Expected to change one user but changed '$changed'."
say "'$username' is now an administrator. They must log out and log in again to get the admin menu."
