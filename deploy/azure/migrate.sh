#!/usr/bin/env bash
# Applies the EF Core migrations to the Azure SQL database (plan A3/A5), from a GitHub runner or any Linux x64 machine
# that is signed in with `az login` as an Entra identity allowed to change the schema (the pipeline identity, the
# server's Entra administrator).
#
#   deploy/azure/migrate.sh <migrate-image>       e.g. ghcr.io/<owner>/bookcart-migrate@sha256:<digest>
#
# Needs: AZURE_RESOURCE_GROUP, AZURE_SQL_SERVER (the server's name), optionally DATABASE (default BookDB); docker, az, curl.
#
# It runs the migration bundle that is INSIDE the tested image (copied out, never rebuilt), so the migrations applied are
# exactly the ones the CI stack job ran. The runner's address gets a temporary firewall rule, which is always removed,
# even when the migration fails. The database may be paused (free tier) and takes up to a minute to resume, so the run
# is retried. Exit code 0 when the database is up to date.
set -euo pipefail

image=${1:?usage: deploy/azure/migrate.sh <migrate-image>}
rg=${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP is not set}
server=${AZURE_SQL_SERVER:?AZURE_SQL_SERVER is not set}
database=${DATABASE:-BookDB}
rule="github-${GITHUB_RUN_ID:-manual}-$$"

work=$(mktemp -d)
probe=""
rule_created=false
# shellcheck disable=SC2317  # called by the EXIT trap, which ShellCheck cannot see
cleanup() {
  if $rule_created; then
    if az sql server firewall-rule delete -g "$rg" -s "$server" -n "$rule" --output none; then
      echo "Removed the temporary firewall rule $rule."
    else
      echo "::error::Could not remove the firewall rule $rule on $server. Remove it by hand: az sql server firewall-rule delete -g $rg -s $server -n $rule"
    fi
  fi
  [[ -n $probe ]] && docker rm -f "$probe" > /dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT

echo "Copying the migration bundle out of $image ..."
docker pull --quiet "$image" > /dev/null
probe=$(docker create "$image")
docker cp "$probe:/app/efbundle" "$work/efbundle"
chmod +x "$work/efbundle"

fqdn=$(az sql server show -g "$rg" -n "$server" --query fullyQualifiedDomainName -o tsv)
ip=$(curl -s -m 30 https://api.ipify.org)
[[ $ip =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "::error::Could not find this runner's public IPv4 address (got '$ip')."; exit 1; }
echo "Opening the firewall for $ip (rule $rule) ..."
az sql server firewall-rule create -g "$rg" -s "$server" -n "$rule" --start-ip-address "$ip" --end-ip-address "$ip" --output none
rule_created=true

# "Active Directory Default" signs in as whoever `az login` is (the pipeline identity on the runner). No password.
connection="Server=tcp:$fqdn,1433;Initial Catalog=$database;Encrypt=True;Connection Timeout=120;Authentication=Active Directory Default"
for attempt in 1 2 3; do
  echo "Applying the migrations to $database on $fqdn (attempt $attempt of 3) ..."
  if "$work/efbundle" --connection "$connection"; then
    echo "The database is up to date."
    exit 0
  fi
  (( attempt < 3 )) && { echo "Failed; the database may still be resuming or the firewall rule propagating. Waiting 30 s ..."; sleep 30; }
done
echo "::error::The migrations failed three times. The application was NOT changed."
exit 1
