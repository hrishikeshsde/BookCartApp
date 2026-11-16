# Azure sign-up guide and A0 runbook (free tier)

This is the hands-on companion to phase **A0** of `DEPLOYMENT_IMPLEMENTATION_PLAN.md` (Part A, free tier). It covers creating the Azure free account safely, then **deploying BookCart by hand once, at zero cost**, which teaches what each piece does and proves the free-tier assumptions the rest of the plan builds on. A1 later deletes this environment and recreates it from Bicep.

Nothing here has been run yet (**no Azure account exists**). The commands follow Microsoft Learn (checked 2026-11-16); where a flag may differ by CLI version it says "verify". If a command fails, that is a finding: write it down, do not force it, and **never fix a failure by choosing a paid option** (another SKU, "bill overage").

Rewritten on 2026-11-16 for the free-tier design; the earlier version (a paid spike with S1, a registry and Azure Files) is in git history.

## 1. The free account, and how this stays at zero cost

- The Azure free account gives **USD 200 of credit for 30 days**, with a **spending limit**: nothing can be charged in that time. After 30 days the subscription is **disabled** unless you upgrade it to pay-as-you-go. Upgrading removes the spending limit; then only the budget alert reports a mistake. When to upgrade is your decision.
- This plan uses **only free offers**, which stay free after an upgrade: **App Service Free F1** (Linux, runs containers), the **Azure SQL Database free tier** (100,000 vCore-seconds a month, set to **pause** when used up, one free database per subscription), **managed identities**, and a **budget**. The image lives on **GitHub Container Registry** (free for a public repository).
- **Sign up late:** the 30-day clock starts at sign-up. Do it when the prep step is reviewed and you have a day for A0.

### The rules that keep it free

1. Create **only** what this runbook names. If the portal offers a "recommended" paid tier, refuse it.
2. The database is created with **`--use-free-limit true --free-limit-exhaustion-behavior AutoPause`**. Without `--use-free-limit` it is a billable database; "bill overage" can never be switched back.
3. **Close query tools** (sqlcmd, SSMS, VS Code) after use: an open connection keeps the database awake and spends its free amount.
4. Never turn on the App Service **Health check** feature (it would keep the database awake).
5. Check **Cost analysis** at the end of every session: it must say 0.00.

## 2. Sign-up steps

1. Go to https://azure.microsoft.com/free and choose **Start free**.
2. Sign in with a Microsoft account you will keep: it becomes the **Owner** of the subscription and administrator of its directory (A1 and A2 need Owner).
3. Give a phone number and a card (identity verification; with the spending limit on you are not charged; a small temporary authorization hold can appear).
4. In the portal, **Subscriptions**: the offer should be **Free Trial** with **Spending limit: On**. If not, stop and ask before creating anything.
5. Write down the **sign-up date + 30 days**.

## 3. Cost safety, before any resource

1. **Budget:** portal, *Cost Management + Billing*, *Budgets*, *Add*. Scope: the subscription. Amount: **USD 1** per month. Alerts at 50 % and 100 % (actual) and 100 % (forecasted) to your e-mail. (A1 adds the same budget on the resource group, from Bicep.)
2. **Reminder** in your calendar for day 25 after sign-up: decide whether to upgrade.

## 4. Tools on your Windows PC

| Tool | Why | Install / check |
|---|---|---|
| Azure CLI 2.60+ | every command below; also brings Bicep | `winget install Microsoft.AzureCLI`, then `az version` |
| Bicep | compile and deploy `infra/` (A1) | `az bicep install`, then `az bicep version` |
| Docker Desktop | build and push the images (already used for Part D) | `docker version` |
| go-sqlcmd | create the database user, promote the admin | `winget install sqlcmd`, then `sqlcmd --version` |
| .NET 10 SDK and the repo's tools | run the migrations from your PC | `dotnet tool restore` in the repository |
| A GitHub personal access token (classic) with `write:packages` | push the image to `ghcr.io` | GitHub, *Settings*, *Developer settings* |
| Git Bash | the commands are bash | already in use |

**Git Bash gotcha:** it rewrites arguments that look like Unix paths (`/home/data` becomes `C:/Program Files/Git/home/data`). Start every session with `export MSYS_NO_PATHCONV=1`.

## 5. A0: the first deployment by hand

Run from the repository root in Git Bash. Keep a text file with what each step printed: it becomes "A0 results" in the plan.

### Step 0: sign in and name things

```bash
export MSYS_NO_PATHCONV=1
az login
az account show --query "{name:name, id:id, tenant:tenantId}" -o table
for ns in Microsoft.Web Microsoft.Sql Microsoft.ManagedIdentity Microsoft.Consumption; do
  az provider register --namespace "$ns" --wait
done

export RG=rg-bookcart-a0 LOC=centralindia SUF=$RANDOM
export APP=app-bookcart-$SUF SQLSRV=sql-bookcart-$SUF
export OWNER=<your GitHub user, lower case>
export IMAGE=ghcr.io/$OWNER/bookcart:a0 MIGRATE_IMAGE=ghcr.io/$OWNER/bookcart-migrate:a0
az group create -n $RG -l $LOC --tags purpose=a0
```

### Step 1 (item 2): the image on ghcr.io

```bash
echo "<token>" | docker login ghcr.io -u $OWNER --password-stdin
docker build --target app     -t $IMAGE         .
docker build --target migrate -t $MIGRATE_IMAGE .
docker push $IMAGE
docker push $MIGRATE_IMAGE
```

Then on GitHub: your profile, *Packages*, `bookcart`, *Package settings*, **Change visibility: Public** (and the same for `bookcart-migrate`). Check from a logged-out shell: `docker logout ghcr.io && docker pull $IMAGE` must work.

### Step 2 (items 4, 5): the free database, Entra only

```bash
ME_UPN=$(az account show --query user.name -o tsv)
ME_OID=$(az ad signed-in-user show --query id -o tsv)
az sql server create -g $RG -n $SQLSRV -l $LOC --enable-ad-only-auth \
  --external-admin-principal-type User --external-admin-name "$ME_UPN" --external-admin-sid "$ME_OID"   # verify flag names: az sql server create -h
az sql db create --name BookDB --server $SQLSRV --resource-group $RG --edition GeneralPurpose --family Gen5 --capacity 2 --compute-model Serverless --use-free-limit true --free-limit-exhaustion-behavior AutoPause --backup-storage-redundancy Local
az sql db show -g $RG -s $SQLSRV -n BookDB --query "{free:useFreeLimit, whenUsedUp:freeLimitExhaustionBehavior, status:status}"
#   must print free=true, whenUsedUp=AutoPause

az sql server firewall-rule create -g $RG -s $SQLSRV -n AllowAllWindowsAzureIps --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
MYIP=$(curl -s https://api.ipify.org)
az sql server firewall-rule create -g $RG -s $SQLSRV -n a0-my-pc --start-ip-address $MYIP --end-ip-address $MYIP
```

Apply the migrations from your PC with your own Entra login (the factory reads `BOOKCART_EF_CONNECTION`; `Active Directory Default` uses your `az login`):

```bash
export BOOKCART_EF_CONNECTION="Server=tcp:$SQLSRV.database.windows.net,1433;Initial Catalog=BookDB;Encrypt=True;Connection Timeout=60;Authentication=Active Directory Default"
dotnet tool restore
dotnet ef database update --project BookCart --configuration Release
```

(A3 runs the bundle from the tested `migrate` image on a Linux runner instead; on Windows the Linux bundle cannot run, so A0 uses `dotnet ef`.)

### Step 3 (item 4): the app identity and its database user

```bash
az identity create -g $RG -n id-bookcart-app
APP_ID_RES=$(az identity show -g $RG -n id-bookcart-app --query id -o tsv)
APP_ID_CLIENT=$(az identity show -g $RG -n id-bookcart-app --query clientId -o tsv)
APP_ID_OBJECT=$(az identity show -g $RG -n id-bookcart-app --query principalId -o tsv)

sqlcmd -S $SQLSRV.database.windows.net -d BookDB --authentication-method ActiveDirectoryDefault -Q \
  "CREATE USER [id-bookcart-app] FROM EXTERNAL PROVIDER; ALTER ROLE db_datareader ADD MEMBER [id-bookcart-app]; ALTER ROLE db_datawriter ADD MEMBER [id-bookcart-app];"
# If that fails because the server cannot read the directory, record it and use the fallback:
#   CREATE USER [id-bookcart-app] FROM EXTERNAL PROVIDER WITH OBJECT_ID = '<APP_ID_OBJECT>'; (then the two ALTER ROLE lines)
```

### Step 4 (items 1, 3, 6): the F1 web app

```bash
az appservice plan create -g $RG -n plan-bookcart --is-linux --sku F1
az webapp create -g $RG -p plan-bookcart -n $APP --container-image-name $IMAGE   # older CLI: --deployment-container-image-name
az webapp identity assign -g $RG -n $APP --identities $APP_ID_RES
az webapp update -g $RG -n $APP --https-only true
az webapp config set -g $RG -n $APP --ftps-state Disabled --min-tls-version 1.2 --http20-enabled true
for p in ftp scm; do
  az resource update -g $RG --namespace Microsoft.Web --resource-type basicPublishingCredentialsPolicies \
    --parent sites/$APP --name $p --set properties.allow=false
done

HOST=$(az webapp show -g $RG -n $APP --query defaultHostName -o tsv)
az webapp config appsettings set -g $RG -n $APP --settings \
  WEBSITES_PORT=8080 WEBSITES_ENABLE_APP_SERVICE_STORAGE=true ASPNETCORE_FORWARDEDHEADERS_ENABLED=true \
  "ConnectionStrings__DefaultConnection=Server=tcp:$SQLSRV.database.windows.net,1433;Initial Catalog=BookDB;Encrypt=True;Connection Timeout=60;Authentication=Active Directory Managed Identity;User Id=$APP_ID_CLIENT" \
  "Jwt__SecretKey=$(openssl rand -hex 32)" "Jwt__Issuer=https://$HOST/" "Jwt__Audience=https://$HOST/" \
  Storage__UploadFolder=/home/data/uploads Security__DataProtectionKeysPath=/home/data/keys Security__EnforceCsp=true
az webapp log config -g $RG -n $APP --docker-container-logging filesystem
az webapp log tail -g $RG -n $APP      # watch the container start; Ctrl+C to stop
```

### Step 5: the checks (write a yes or no and the numbers for each)

| Item | How | Pass when |
|---|---|---|
| 1. F1 runs the container | `curl -s https://$HOST/health` | `Healthy` (the first request can take a minute: the container starts and the database resumes) |
| 3. `/home` is writable by uid 1654 | register a user in the site; promote it: `sqlcmd -S $SQLSRV.database.windows.net -d BookDB --authentication-method ActiveDirectoryDefault -Q "UPDATE UserMaster SET UserTypeID = 1 WHERE Username = '<you>'"`; sign in again, add a book **with a cover**; put a book in a guest cart in a private window; `az webapp restart -g $RG -n $APP` | after the restart the cover still shows and the guest cart is still there (the key ring survived). If the upload fails, the log shows `UnauthorizedAccessException`: record it |
| 4. Passwordless SQL | the site lists books and the admin change sticks | no login error in the log stream |
| 6. Behind the proxy | `curl -sI https://$HOST/` and the browser's cookie view | no redirect loop; the `bc_guest` cookie is `Secure`; the CSP header is `Content-Security-Policy` (enforced) |
| 7. Cold start | leave the site alone for 30 minutes, then `time curl -s -o /dev/null -w "%{http_code}\n" https://$HOST/` and the same for `/api/book` | both answer (record the seconds); the second may be slower (the database resumes) |
| 8. Quotas and pause | the plan's *Quotas* page (CPU minutes, bandwidth, and whether they reset daily); the database's metric **Free amount remaining**; 30 minutes after the last request `az sql db show -g $RG -s $SQLSRV -n BookDB --query status` | the database says `Paused` (the connection pool let go); the free amount is falling only while you use the site |
| 9. Region | the commands above succeeded in `centralindia` | otherwise retry with `LOC=southindia` and record it |
| Cost | *Cost Management*, *Cost analysis*, the resource group | 0.00 |

Then remove your PC's firewall rule: `az sql server firewall-rule delete -g $RG -s $SQLSRV -n a0-my-pc`.

## 6. After A0

1. Write the results into the plan under A0 (each item yes or no, the commands that worked, the measured times and quotas).
2. **Leave the A0 environment running until A1 is ready**, then delete it: `az group delete -n rg-bookcart-a0 --yes`. It must go before A1 because **only one free database is allowed per subscription**.
3. A1 then creates `rg-bookcart` from `infra/` (see `infra/README.md`).

## 7. Stop conditions

Stop and ask before going on if:

- *Cost analysis* shows anything above 0.00;
- a command offers or needs a paid SKU, or the database shows `useFreeLimit: false` or `BillOverUsage`;
- the portal says the spending limit is off, or asks for an upgrade;
- a command would create something outside `rg-bookcart-a0`.
