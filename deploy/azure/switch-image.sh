#!/usr/bin/env bash
# Points the Azure web app at an image and waits until that image answers (plan A5). Used by the release, by its
# automatic rollback and by the manual rollback, so all three do the same thing.
#
#   deploy/azure/switch-image.sh <image>        e.g. ghcr.io/<owner>/bookcart@sha256:<digest>
#   deploy/azure/switch-image.sh --current      prints the image the app is set to now (for a later rollback)
#
# Needs: AZURE_RESOURCE_GROUP, AZURE_WEBAPP_NAME; az and curl, signed in with `az login`.
#
# App Service keeps serving the old container while a new one starts, so a /health answer alone would not prove the new
# image is running. The script therefore RESTARTS the app after the switch (on the free F1 tier there is no slot to swap;
# the short outage is accepted, plan A5): any healthy answer after that comes from the new image. It waits up to
# WAIT_SECONDS (default 900: the first start pulls the image, and the free database may be paused).
set -euo pipefail

rg=${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP is not set}
app=${AZURE_WEBAPP_NAME:?AZURE_WEBAPP_NAME is not set}

current_image() {
  local fx
  fx=$(az webapp config show -g "$rg" -n "$app" --query linuxFxVersion -o tsv)
  printf '%s\n' "${fx#DOCKER|}"
}

if [[ ${1:-} == --current ]]; then current_image; exit 0; fi
image=${1:?usage: deploy/azure/switch-image.sh <image> | --current}
[[ $image == */* ]] || { echo "::error::'$image' does not look like an image reference."; exit 1; }

echo "Setting $app to $image ..."
az webapp config container set -g "$rg" -n "$app" --container-image-name "$image" --output none
now=$(current_image)
[[ $now == "$image" ]] || { echo "::error::The app is set to '$now', not '$image'."; exit 1; }

echo "Restarting $app, so that only the new image can answer ..."
az webapp restart -g "$rg" -n "$app" --output none

host=$(az webapp show -g "$rg" -n "$app" --query defaultHostName -o tsv)
deadline=$((SECONDS + ${WAIT_SECONDS:-900}))
until [[ $(curl -s -m 120 -o /dev/null -w '%{http_code}' "https://$host/health") == 200 ]]; do
  if (( SECONDS > deadline )); then
    echo "::error::https://$host/health did not answer 200 within ${WAIT_SECONDS:-900} s."
    exit 1
  fi
  echo "  not healthy yet, waiting 15 s ..."
  sleep 15
done
echo "https://$host/ is healthy and runs $image."
