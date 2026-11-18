#!/usr/bin/env bash
# Gives the app's managed identity its database user (plan A3): it may read and write data, nothing more. Idempotent:
# run it as often as you like (the release runs it every time, so a newly created database is never left without it).
#
#   deploy/azure/grant-app-access.sh [identity-name]       default: id-bookcart-app (from infra/main.bicep)
#
# Needs: AZURE_RESOURCE_GROUP, AZURE_SQL_SERVER (DATABASE defaults to BookDB); az, curl, sqlcmd; signed in with `az login`
# as the server's Entra administrator (the pipeline identity).
#
# The user is created WITH SID = <the identity's CLIENT id>, TYPE = E: Microsoft's documented way to create a user for a
# managed identity WITHOUT validating it in Microsoft Entra (CREATE USER, example K). The usual FROM EXTERNAL PROVIDER
# form (with or without WITH OBJECT_ID) makes the SQL server look the name up, which needs the "Directory Readers" role
# for the server's identity when a service principal (our pipeline) runs it. Afterwards the script prints the user's roles and fails if it has any role that can
# change the schema or the permissions (db_owner, db_ddladmin, db_securityadmin, db_accessadmin): schema changes are the
# pipeline's job (migrate.sh), never the app's.
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

identity=${1:-id-bookcart-app}
# The name goes into SQL as a quoted identifier, so only characters an Azure identity name can have are accepted.
[[ $identity =~ ^[A-Za-z0-9_-]{3,128}$ ]] || { echo "::error::'$identity' is not a managed identity name."; exit 1; }

# The CLIENT id (not the object id): Microsoft's CREATE USER reference says so for a user-assigned managed identity.
client_id=$(az identity show -g "$AZURE_RESOURCE_GROUP" -n "$identity" --query clientId -o tsv)
[[ $client_id =~ ^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$ ]] || { echo "::error::Could not read the client id of $identity (got '$client_id')."; exit 1; }

trap close_sql_firewall EXIT
open_sql_firewall

echo "Giving $identity read and write access to $DATABASE ..."
run_sql "
-- Built as text and run with EXEC: SID takes a binary literal, and the statement is then only parsed when it runs.
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$identity')
BEGIN
    DECLARE @sid nvarchar(40) = CONVERT(nvarchar(40), CONVERT(varbinary(16), CAST(N'$client_id' AS uniqueidentifier)), 1);
    EXEC (N'CREATE USER [$identity] WITH SID = ' + @sid + N', TYPE = E;');
END
IF NOT EXISTS (SELECT 1 FROM sys.database_role_members m
               JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
               JOIN sys.database_principals u ON u.principal_id = m.member_principal_id
               WHERE r.name = N'db_datareader' AND u.name = N'$identity')
    ALTER ROLE db_datareader ADD MEMBER [$identity];
IF NOT EXISTS (SELECT 1 FROM sys.database_role_members m
               JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
               JOIN sys.database_principals u ON u.principal_id = m.member_principal_id
               WHERE r.name = N'db_datawriter' AND u.name = N'$identity')
    ALTER ROLE db_datawriter ADD MEMBER [$identity];" > /dev/null

roles=$(run_sql "
SELECT r.name FROM sys.database_role_members m
JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
JOIN sys.database_principals u ON u.principal_id = m.member_principal_id
WHERE u.name = N'$identity' ORDER BY r.name;" | tr '\n' ' ')
echo "Roles of $identity in $DATABASE: $roles"
for needed in db_datareader db_datawriter; do
  [[ " $roles" == *" $needed "* ]] || { echo "::error::$identity is not in $needed."; exit 1; }
done
for forbidden in db_owner db_ddladmin db_securityadmin db_accessadmin; do
  [[ " $roles" != *" $forbidden "* ]] || { echo "::error::$identity is in $forbidden: it must not be able to change the schema or permissions."; exit 1; }
done
echo "$identity can read and write data, and cannot change the schema."
