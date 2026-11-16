# Azure sign-up guide and A0 spike runbook

> **Superseded in part (2026-11-16).** Part A was rescoped to the free tier (see the plan). Sections 1 to 4 (the free account, sign-up, cost safety, tools) still apply. **Sections 5 and 6 were written for the paid design (S1, a container registry, Azure Files) and must not be run**: they are rewritten for the free design (F1, the SQL free tier, `ghcr.io`, a by-hand first deployment) together with A1.

This is the hands-on companion to phase **A0** of `DEPLOYMENT_IMPLEMENTATION_PLAN.md`. It covers creating the Azure free account safely and then running the nine A0 checks on a throwaway resource group, with the exact commands. Nothing here has been run yet: **no Azure account exists**, and the commands are written from Microsoft's documentation, so each one is marked "verify" where A0 is supposed to prove it. If a command fails, that is a finding: record it in the plan, do not force it.

Decisions this runbook follows (answered 2026-11-13):

| Decision | Answer |
|---|---|
| Account | Azure free account |
| Region | Central India (`centralindia`) |
| Spike spending | Free credit only, nothing more |
| Budget for the real deployment | Decided after A0, from the measured cost |
| Domain | `azurewebsites.net` for now |

## 1. What the free account really is (Microsoft Learn, checked 2026-11-13)

- You get **USD 200 of credit that expires 30 days after sign-up**. Unused credit is lost.
- A free account has a **spending limit equal to the credit**. When the credit is used up, or after 30 days, Azure **disables** the subscription instead of charging you. Storage data stays readable. This is the hard cap you asked for; it holds as long as you never click "remove the spending limit" or "upgrade".
- To keep using Azure after that you must upgrade to pay-as-you-go. If you upgrade before day 30, the remaining credit stays usable until day 30.
- **Free trial subscriptions cannot request quota increases.** A new subscription can have a default App Service limit of 0 for some SKUs and regions (error `SubscriptionIsOverQuotaForSku`). Standard S1 is the SKU the plan needs, so this is the one real risk to the spike (section 5, step 1).
- The "12 months of free services" are small allowances (some VM sizes, small storage, an old SQL offer). The spike uses paid SKUs that are charged against the credit.

### When to sign up: late, not early

The 30-day clock starts at sign-up. The offline drafts (A1 Bicep, A2/A4/A5 workflows) need no Azure account. Sign up **after the drafts are reviewed**, and only when you have a free day or two for the spike. The spike itself should take 4 to 8 hours of work; then delete everything.

### Expected cost of the spike (indicative only; check the Azure pricing calculator for Central India)

| Resource | Roughly | For a 2-day spike |
|---|---|---|
| App Service plan S1 (Linux) | about USD 0.10 per hour | about USD 5 |
| SQL database Basic | about USD 5 per month | under USD 1 |
| Container registry Basic | about USD 0.17 per day | under USD 1 |
| Storage account (Files) | cents | under USD 1 |
| Application Insights / Log Analytics | free allowance is generous | about 0 |

Even if you forget it for a week, the total stays far below the USD 200 credit, and the spending limit stops anything beyond it. The real danger is not money, it is **forgetting the resource group**: the credit would drain and the 30 days would expire.

## 2. Sign-up steps

1. Go to https://azure.microsoft.com/free and choose **Start free**.
2. Sign in with a Microsoft account (create one if needed). Use an account you will keep: this account becomes the **Owner** of the subscription and administrator of its directory (tenant). Phases A2 and A3 need Owner.
3. Give a phone number and a credit or debit card. This is identity verification; with the spending limit on, you are not charged. (A card can show a small temporary authorization hold. Check your bank's wording if it appears.)
4. When the portal opens, check **Subscriptions** in the portal: the subscription should be named **Azure subscription 1** (or similar), offer type **Free Trial**. Open it and look for **Spending limit: On**. If it says anything else, stop and ask before creating resources.

## 3. First thing after sign-up: cost safety (before any resource)

1. **Budget alerts:** portal, *Cost Management + Billing*, *Budgets*, *Add*. Scope: the subscription. Amount: USD 50 (a quarter of the credit). Alerts at 50, 80 and 100 percent to your e-mail. (A budget only warns; the spending limit is what stops spending.)
2. **Tag rule for the spike:** every resource group you create for A0 gets tags `purpose=a0-spike` and `delete-after=<date>`; this is in the commands below.
3. **Calendar reminder** for the day you finish: "delete rg-bookcart-spike". The cleanup commands are in section 6.
4. Write down the **sign-up date + 30 days**. After that date the subscription is disabled unless upgraded; whatever is not proven by then waits for a decision.

## 4. Tools to install on your Windows machine

| Tool | Why | Check |
|---|---|---|
| Azure CLI (`az`) 2.60 or newer | all spike commands | `az version` |
| Docker Desktop (already running for D0 to D5) | build and push the image | `docker version` |
| `sqlcmd` (the Go-based "go-sqlcmd" or the classic one) | create the database user with Entra sign-in (`-G`) | `sqlcmd -?` |
| Bicep (comes with `az`; `az bicep install`) | compile the A1 drafts | `az bicep version` |
| GitHub CLI `gh` (optional) | A0 item 8 | `gh --version` |
| Git Bash (already in use) | the commands below are bash | |

**Git Bash gotcha:** Git Bash rewrites arguments that look like Unix paths (`/data/uploads` becomes `C:/Program Files/Git/data/uploads`). Put `export MSYS_NO_PATHCONV=1` at the top of the session, or run the commands in PowerShell with the variable syntax changed.

## 5. The A0 spike, step by step

Conventions: run in Git Bash from the repository root. Names must be globally unique in some cases, so a short random suffix is used. Keep a text file with the outputs; they go into the plan's "A0 results".

### Step 0: sign in and prepare

```bash
export MSYS_NO_PATHCONV=1
az login
az account show --query "{name:name, id:id, tenant:tenantId}" -o table

# One-time provider registration (a new subscription has most of them off). Wait for each.
for ns in Microsoft.Web Microsoft.Sql Microsoft.ContainerRegistry Microsoft.Storage \
          Microsoft.ManagedIdentity Microsoft.OperationalInsights Microsoft.Insights Microsoft.KeyVault; do
  az provider register --namespace "$ns" --wait
done

export RG=rg-bookcart-spike LOC=centralindia SUF=$RANDOM
az group create -n $RG -l $LOC --tags purpose=a0-spike delete-after=$(date -d '+3 days' +%F)
```

### Step 1 (A0 item 1): region and SKU, and the quota risk

```bash
az appservice list-locations --linux-workers-enabled --sku S1 --query "[?name=='Central India']" -o table
az appservice plan create -g $RG -n plan-spike --is-linux --sku S1 -l $LOC
```

- If the plan is created: item 1 passes. Go on.
- If it fails with **`SubscriptionIsOverQuotaForSku`** or a "quota is 0" message: **stop and decide.** A free trial cannot request a quota increase. Options, in this order:
  1. Try the other Indian region: repeat with `LOC=southindia` (and the same SKU). Record the result.
  2. Try `--sku B1`: this proves everything except slots and the swap (item 5), which need Standard.
  3. Upgrading to pay-as-you-go would lift the quota block, **but it also removes your spending limit**, which breaks the "free credit only" rule. That is **your** decision, not mine: do it only after you have set the budget alert, and keep the spike to a few hours.

### Step 2: identities, registry, storage, database (the shared parts)

```bash
# Two user-assigned identities: one for the app, one for the pipeline (item 8)
az identity create -g $RG -n id-app-spike
az identity create -g $RG -n id-pipeline-spike
APP_ID_CLIENT=$(az identity show -g $RG -n id-app-spike --query clientId -o tsv)
APP_ID_PRINCIPAL=$(az identity show -g $RG -n id-app-spike --query principalId -o tsv)
APP_ID_RES=$(az identity show -g $RG -n id-app-spike --query id -o tsv)

# Registry, admin user off
ACR=acrbookcart$SUF
az acr create -g $RG -n $ACR --sku Basic --admin-enabled false
az role assignment create --assignee-object-id $APP_ID_PRINCIPAL --assignee-principal-type ServicePrincipal \
  --role AcrPull --scope $(az acr show -n $ACR --query id -o tsv)

# Storage with two shares per slot (slot-specific mounts, item 2 and 5)
ST=stbookcart$SUF
az storage account create -g $RG -n $ST -l $LOC --sku Standard_LRS --min-tls-version TLS1_2
ST_KEY=$(az storage account keys list -g $RG -n $ST --query "[0].value" -o tsv)
for s in uploads keys uploads-staging keys-staging; do
  az storage share-rm create --storage-account $ST -g $RG --name $s --quota 5
done

# SQL: Entra-only. You are the Entra admin for the spike.
SQLSRV=sql-bookcart-$SUF
ME_UPN=$(az account show --query user.name -o tsv)
ME_OID=$(az ad signed-in-user show --query id -o tsv)
az sql server create -g $RG -n $SQLSRV -l $LOC \
  --enable-ad-only-auth --external-admin-principal-type User \
  --external-admin-name "$ME_UPN" --external-admin-sid "$ME_OID" --minimal-tls-version 1.2
az sql db create -g $RG -s $SQLSRV -n BookDB --edition Basic
az sql db create -g $RG -s $SQLSRV -n BookDB_Staging --edition Basic

# Let your own machine in for the spike (removed in section 6)
MYIP=$(curl -s https://api.ipify.org)
az sql server firewall-rule create -g $RG -s $SQLSRV -n spike-me --start-ip-address $MYIP --end-ip-address $MYIP
```

(Verify: the exact flag names of `az sql server create` for Entra-only create vary a little by CLI version; `az sql server create -h` shows them. If `az ad signed-in-user show` is blocked, take your object id from the portal, *Microsoft Entra ID*, *Users*.)

### Step 3 (A0 item 7): push the image, pull it by identity

```bash
az acr login -n $ACR
docker build --target app     -t $ACR.azurecr.io/bookcart:spike         .
docker build --target migrate -t $ACR.azurecr.io/bookcart-migrate:spike .
docker push $ACR.azurecr.io/bookcart:spike
docker push $ACR.azurecr.io/bookcart-migrate:spike

APP=app-bookcart-$SUF
az webapp create -g $RG -p plan-spike -n $APP --deployment-container-image-name $ACR.azurecr.io/bookcart:spike
az webapp identity assign -g $RG -n $APP --identities $APP_ID_RES
az webapp config set -g $RG -n $APP \
  --generic-configurations "{\"acrUseManagedIdentityCreds\": true, \"acrUserManagedIdentityID\": \"$APP_ID_CLIENT\"}"
az webapp deployment slot create -g $RG -n $APP --slot staging
az webapp identity assign -g $RG -n $APP --slot staging --identities $APP_ID_RES
az webapp config set -g $RG -n $APP --slot staging \
  --generic-configurations "{\"acrUseManagedIdentityCreds\": true, \"acrUserManagedIdentityID\": \"$APP_ID_CLIENT\"}"
```

First check how the registry grants access: `az acr show -n $ACR --query roleAssignmentMode -o tsv`. If it says an ABAC mode, `AcrPull` is ignored: use the role `Container Registry Repository Reader` instead (and `Container Registry Repository Writer` for pushing), and tell me, because `infra/modules/registry.bicep` assumes plain RBAC.

**Pass:** `az webapp log tail -g $RG -n $APP` shows the container pulled and started (it will fail to be healthy until step 4 sets its settings: that is fine). Do the same for the staging slot with `--slot staging`. Record both. (If the pull is refused with an authentication error, check ARM-audience tokens on the registry: `az acr config authentication-as-arm show -r $ACR`, and enable it if it is off; verify.)

### Step 4 (A0 items 2, 3, 5, 6): settings, mounts, database user

```bash
az webapp config appsettings set -g $RG -n $APP --settings \
  WEBSITES_PORT=8080 WEBSITES_ENABLE_APP_SERVICE_STORAGE=false \
  ASPNETCORE_FORWARDEDHEADERS_ENABLED=true WEBSITE_WARMUP_PATH=/health \
  Storage__UploadFolder=/data/uploads Security__DataProtectionKeysPath=/data/keys \
  "ConnectionStrings__DefaultConnection=Server=tcp:$SQLSRV.database.windows.net,1433;Initial Catalog=BookDB;Encrypt=True;Authentication=Active Directory Managed Identity;User Id=$APP_ID_CLIENT" \
  "Jwt__SecretKey=$(openssl rand -base64 48)" \
  "Jwt__Issuer=https://$APP.azurewebsites.net/" "Jwt__Audience=https://$APP.azurewebsites.net/"
# (A throwaway key for the spike only; the real one lives in Key Vault, A1.)
az webapp config appsettings set -g $RG -n $APP --slot-settings \
  Storage__UploadFolder=/data/uploads Security__DataProtectionKeysPath=/data/keys   # verify: marks them slot-specific

az webapp config storage-account add -g $RG -n $APP --custom-id uploads --storage-type AzureFiles \
  --account-name $ST --share-name uploads --access-key "$ST_KEY" --mount-path /data/uploads
az webapp config storage-account add -g $RG -n $APP --custom-id keys --storage-type AzureFiles \
  --account-name $ST --share-name keys --access-key "$ST_KEY" --mount-path /data/keys
```

Item 4, the database user (run once per database; the first form is the one the plan expects):

```bash
sqlcmd -S "$SQLSRV.database.windows.net" -d BookDB -G -Q \
  "CREATE USER [id-app-spike] FROM EXTERNAL PROVIDER; ALTER ROLE db_datareader ADD MEMBER [id-app-spike]; ALTER ROLE db_datawriter ADD MEMBER [id-app-spike];"
# If that fails because the server cannot read the directory, the fallback (record which one worked):
sqlcmd -S "$SQLSRV.database.windows.net" -d BookDB -G -Q \
  "CREATE USER [id-app-spike] FROM EXTERNAL PROVIDER WITH OBJECT_ID = '$APP_ID_PRINCIPAL'; ALTER ROLE db_datareader ADD MEMBER [id-app-spike]; ALTER ROLE db_datawriter ADD MEMBER [id-app-spike];"
```

Migrations are applied by the pipeline's identity in the real design, but for the spike your own Entra login does it: build the bundle the way D1 does (the `migrate` image from step 3 contains it; run it with a connection string using `Authentication=Active Directory Default`, or run `dotnet ef database update` locally with `BOOKCART_EF_CONNECTION` set to the same string). Then check:

| Item | How to check | Pass when |
|---|---|---|
| 2: non-root writes to the mount | `az webapp ssh -g $RG -n $APP` then `id; touch /data/uploads/x && rm /data/uploads/x; touch /data/keys/x && rm /data/keys/x` (SSH works only if the image has SSH; if not, use the app: upload a cover as an admin and restart, see below) | files can be created and deleted as uid 1654; after a restart a guest cookie from before still works (key ring persisted); an uploaded cover is still there |
| 3: passwordless SQL | `curl -s https://$APP.azurewebsites.net/health` | `Healthy`; add a book, restart, the book is still there; check again after several hours (token refresh) |
| 6: forwarded headers | `curl -sI https://$APP.azurewebsites.net/` and the browser | no redirect loop; a guest cart's cookie has `Secure`; the log of a rate-limit hit shows your real address, not `169.254.x.x` |

If the container has no shell or SSH (it is a minimal runtime image), use the app instead: sign in as an admin (register, then promote with `sqlcmd ... "UPDATE UserMaster SET UserTypeID = 1 WHERE Username = '...'"`), add a book with a cover, restart the app (`az webapp restart`), and check the cover still loads. If writing fails, the log says `UnauthorizedAccessException`: the fix to try is a startup option that sets the mount's ownership or the mount's `uid`/`gid` option (the plan's A0 item 2 lists it); record what worked.

**Item 5, slots (needs S1):**

1. Deploy a different tag to the staging slot: `docker tag ... :spike2`, push, then `az webapp config container set -g $RG -n $APP --slot staging --container-image-name $ACR.azurecr.io/bookcart:spike2`. Give the slot its own slot-specific settings (its `BookDB_Staging` connection string, `Jwt__Issuer`, mounts `uploads-staging`/`keys-staging`).
2. `az webapp deployment slot swap -g $RG -n $APP --slot staging --target-slot production`.
3. **Pass:** production now runs `spike2`; the settings marked slot-specific **stayed** with their slot (production still talks to `BookDB`; check by reading the app settings of each slot and by adding a book); the swap warmed the instance via `/health`; swapping again returns to `spike`.

### Step 5 (A0 item 8): the pipeline's access to the database (from a GitHub runner)

This is the only item that needs GitHub. Use a **scratch branch** that is never merged (for example `a0-spike`) with one throwaway workflow, so nothing reaches `master`.

```bash
PIPE_CLIENT=$(az identity show -g $RG -n id-pipeline-spike --query clientId -o tsv)
az identity federated-credential create -g $RG --identity-name id-pipeline-spike -n gh-a0 \
  --issuer https://token.actions.githubusercontent.com \
  --subject repo:hrishikeshsde/BookCartApp:ref:refs/heads/a0-spike --audiences api://AzureADTokenExchange
```

The throwaway workflow does: `azure/login@v2` (client id, tenant id, subscription id as repository variables), find the runner's address (`curl -s https://api.ipify.org`), `az sql server firewall-rule create` for it, run the migration bundle with Entra authentication, `az sql server firewall-rule delete`, and print the elapsed time. For this to work the **pipeline identity must be allowed into the database**: for the spike, make it the Entra administrator (`az sql server ad-admin create ... --display-name id-pipeline-spike --object-id <its principalId>`), which also proves the plan's "pipeline identity is the server's Entra administrator" design. Give it the **Contributor** role on the resource group so it can manage the firewall rule.

**Pass:** the run is green, the rule is gone afterwards, and the duration is recorded.

### Step 6 (A0 item 9): telemetry package

On a scratch branch of the repository (not committed to `master`), create `az monitor log-analytics workspace create` and `az monitor app-insights component create ... --workspace`, put the connection string in the app setting `APPLICATIONINSIGHTS_CONNECTION_STRING`, add **one** of `Microsoft.OpenTelemetry` or `Azure.Monitor.OpenTelemetry.AspNetCore` to `BookCart.csproj` (with a one-line `Program` call), rebuild the image as `:spike3`, deploy it to staging, click around, and look in Application Insights for requests, SQL dependency calls and log lines. Then try the other package. **Pass:** you can name the package that shows all three signals on .NET 10, with the exact lines that were needed. Never keep both in the same build.

## 6. Clean up (the same day) and record the results

```bash
az group delete -n $RG --yes --no-wait
# confirm it is really gone (takes a few minutes):
az group exists -n $RG        # expect: false
az resource list --query "length(@)"   # expect: 0 once everything is gone
```

Also remove anything created outside the group: the repository variables from step 5 and the `a0-spike` branch (delete it on GitHub). Nothing from the spike should remain.

Then write the results at the top of phase A0 in `DEPLOYMENT_IMPLEMENTATION_PLAN.md`, as D0 did: for each of the nine items, yes or no, the command or setting that worked, and the measured cost in the portal's *Cost analysis*. **Only then** decide the budget (open decision 8) and adjust the A1 to A5 drafts to what A0 found.

## 7. Stop conditions

Stop the spike and ask before going on if:

- the portal shows **Spending limit: Off** or any message about adding a payment method;
- a quota error blocks S1 (see step 1);
- a command would create something outside the spike resource group;
- the credit shown in *Cost Management* has fallen below USD 100 (twice what this spike should use).
