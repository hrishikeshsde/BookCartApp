#!/usr/bin/env bash
# Installs Microsoft's go-sqlcmd (the `sqlcmd` with Entra sign-in) on a Linux x64 runner, pinned to one release and
# checked against its published SHA-256, so a changed download is refused. The GitHub Ubuntu runner has no sqlcmd.
#
#   deploy/azure/install-sqlcmd.sh [install-folder]     default: $HOME/.local/bin (added to GITHUB_PATH on a runner)
set -euo pipefail

version=v1.10.0
sha256=92516d98c63d99b0994de5b61350c91f6915f9b76f139a59039fbcb225c2e987   # sqlcmd-linux-amd64.tar.bz2 of $version
folder=${1:-$HOME/.local/bin}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl -sSL -m 300 -o "$work/sqlcmd.tar.bz2" \
  "https://github.com/microsoft/go-sqlcmd/releases/download/$version/sqlcmd-linux-amd64.tar.bz2"
echo "$sha256  $work/sqlcmd.tar.bz2" | sha256sum -c --quiet || { echo "::error::The go-sqlcmd download does not match its SHA-256."; exit 1; }
mkdir -p "$folder"
tar -xjf "$work/sqlcmd.tar.bz2" -C "$work" sqlcmd
install -m 755 "$work/sqlcmd" "$folder/sqlcmd"
[[ -n ${GITHUB_PATH:-} ]] && echo "$folder" >> "$GITHUB_PATH"
"$folder/sqlcmd" --version
