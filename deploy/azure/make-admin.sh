#!/usr/bin/env bash
# Makes a registered user an administrator in the Azure database (plan A3). The Azure twin of deploy/make-admin.sh,
# which needs `docker exec` and so cannot reach Azure SQL. Run by .github/workflows/make-admin.yml (behind the approval).
#
#   deploy/azure/make-admin.sh <username>
#
# Needs: AZURE_RESOURCE_GROUP, AZURE_SQL_SERVER (DATABASE defaults to BookDB); az, curl, sqlcmd; signed in with `az login`
# as the server's Entra administrator. Register in the site first. The user must log out and in again afterwards: the
# role is part of the login token.
set -euo pipefail

if [[ ${1:-} == -h || ${1:-} == --help ]]; then sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; fi
[[ $# -eq 1 ]] || { echo "usage: deploy/azure/make-admin.sh <username>" >&2; exit 2; }
username=$1
# The name goes into a SQL statement, so only characters that cannot change the statement are accepted (the same rule
# as deploy/make-admin.sh; registered names are letters, digits and a few symbols anyway).
[[ $username =~ ^[A-Za-z0-9_.@-]{1,50}$ ]] || { echo "::error::A username has only letters, digits and _ . @ - (at most 50 characters)."; exit 1; }

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
trap close_sql_firewall EXIT
open_sql_firewall

# One batch that looks before it changes anything, so a retry after a dropped connection cannot do harm.
result=$(run_sql "
DECLARE @type int = (SELECT TOP 1 UserTypeID FROM dbo.UserMaster WHERE Username = N'$username');
IF @type IS NULL SELECT 'missing'
ELSE IF @type = 1 SELECT 'already'
ELSE BEGIN
    UPDATE dbo.UserMaster SET UserTypeID = 1 WHERE Username = N'$username';
    SELECT CONCAT('changed:', @@ROWCOUNT);
END" | tail -1)

case $result in
  missing) echo "::error::There is no user named '$username'. Register it in the site first, then run this again."; exit 1 ;;
  already) echo "'$username' is already an administrator." ;;
  changed:1) echo "'$username' is now an administrator. They must log out and log in again to get the admin menu." ;;
  *) echo "::error::Unexpected result '$result'."; exit 1 ;;
esac
