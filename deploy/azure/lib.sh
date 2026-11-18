#!/usr/bin/env bash
# Shared by the scripts in deploy/azure (plan A3/A5). It is sourced, not run.
#
# They all reach Azure SQL the same way: as whoever `az login` is (on a runner: the pipeline identity, the server's Entra
# administrator; no password anywhere), through a temporary firewall rule for this machine's public address that the
# caller removes in its EXIT trap (close_sql_firewall). Needs AZURE_RESOURCE_GROUP and AZURE_SQL_SERVER; DATABASE
# defaults to BookDB. Tools: az, curl, and for run_sql the go-sqlcmd `sqlcmd` (deploy/azure/install-sqlcmd.sh).

: "${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP is not set}"
: "${AZURE_SQL_SERVER:?AZURE_SQL_SERVER is not set}"
DATABASE=${DATABASE:-BookDB}
FIREWALL_RULE=""
SQL_FQDN=""

# The server's address, e.g. sql-bookcart-abc123.database.windows.net.
sql_fqdn() {
  [[ -n $SQL_FQDN ]] || SQL_FQDN=$(az sql server show -g "$AZURE_RESOURCE_GROUP" -n "$AZURE_SQL_SERVER" --query fullyQualifiedDomainName -o tsv)
  printf '%s\n' "$SQL_FQDN"
}

# Lets this machine's public IPv4 address through the server's firewall. Pair it with close_sql_firewall in an EXIT trap.
open_sql_firewall() {
  local ip rule
  ip=$(curl -s -m 30 https://api.ipify.org)
  if [[ ! $ip =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "::error::Could not find this machine's public IPv4 address (got '$ip')."
    return 1
  fi
  rule="github-${GITHUB_RUN_ID:-manual}-$$"
  echo "Opening the firewall of $AZURE_SQL_SERVER for $ip (rule $rule) ..."
  az sql server firewall-rule create -g "$AZURE_RESOURCE_GROUP" -s "$AZURE_SQL_SERVER" -n "$rule" \
    --start-ip-address "$ip" --end-ip-address "$ip" --output none
  FIREWALL_RULE=$rule
}

# Removes the rule open_sql_firewall made, if any. Safe to call twice. A failure is reported loudly, never hidden.
close_sql_firewall() {
  [[ -n $FIREWALL_RULE ]] || return 0
  if az sql server firewall-rule delete -g "$AZURE_RESOURCE_GROUP" -s "$AZURE_SQL_SERVER" -n "$FIREWALL_RULE" --output none; then
    echo "Removed the temporary firewall rule $FIREWALL_RULE."
  else
    echo "::error::Could not remove the firewall rule $FIREWALL_RULE on $AZURE_SQL_SERVER. Remove it by hand: az sql server firewall-rule delete -g $AZURE_RESOURCE_GROUP -s $AZURE_SQL_SERVER -n $FIREWALL_RULE"
  fi
  FIREWALL_RULE=""
}

# Runs one T-SQL batch in $DATABASE as the `az login` identity and prints the result rows (no headers, trimmed). Retried,
# because the free database may be paused and takes up to a minute to resume, and a new firewall rule takes a moment.
# Only for batches that are safe to run twice (every caller's batch checks before it changes anything).
run_sql() {
  local attempt out
  for attempt in 1 2 3; do
    if out=$(sqlcmd -S "tcp:$(sql_fqdn),1433" -d "$DATABASE" --authentication-method ActiveDirectoryDefault \
      -l 120 -b -h -1 -W -Q "SET NOCOUNT ON; $1" 2>&1); then
      printf '%s\n' "$out" | tr -d '\r' | sed '/^[[:space:]]*$/d'
      return 0
    fi
    echo "SQL attempt $attempt of 3 failed: $out" >&2
    (( attempt < 3 )) && sleep 20
  done
  return 1
}
