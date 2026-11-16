# infra: BookCart on the Azure free tier (plan phase A1)

**Status (2026-11-16): written offline for the free-tier design, not yet compiled or deployed.** Property names for the free SQL database and the budget were checked against Microsoft Learn; the rest is compiled for the first time once the Bicep CLI is installed (`az bicep install`, then `az bicep build --file infra/main.bicep`). A0 (the by-hand first deployment) comes before any of this runs.

## What it creates (resource group `rg-bookcart`, Central India), all free

| File | Creates |
|---|---|
| `bootstrap.bicep` (run once, by you) | the pipeline identity `id-bookcart-pipeline`, its federated credential for the GitHub environment `production`, Contributor on the resource group |
| `main.bicep` | the app identity `id-bookcart-app`; wires the modules |
| `modules/webapp.bicep` | App Service plan **F1** (Linux) and the web app: the container from `ghcr.io`, HTTPS only, TLS 1.2, no FTP/SCM passwords, every app setting, the log stream. **No Always On, no health check path** (see below) |
| `modules/sql.bicep` | SQL server, **Entra-only**, the pipeline identity as administrator, "Allow Azure services"; database `BookDB` on the **free tier** with **auto-pause** when the free amount is used up |
| `modules/budget.bicep` | a USD 1 monthly budget with e-mail alerts at 50 % and 100 % (actual) and 100 % (forecast) |
| `parameters/production.bicepparam` | the values; the image, the secrets and the e-mail are read from environment variables |

Nothing costs money: F1, the SQL free tier, managed identities, federated credentials, role assignments and budgets are free. There is no registry, Key Vault, storage account or Application Insights (the plan's "zero-cost rule").

## How it is used

```bash
az group create -n rg-bookcart -l centralindia
az deployment group create -g rg-bookcart -f infra/bootstrap.bicep -p githubRepository=<owner>/BookCartApp   # once

export CONTAINER_IMAGE=ghcr.io/<owner>/bookcart:<tag>   JWT_SECRET=<48+ random characters>   BUDGET_EMAIL=<you>
az deployment group what-if -g rg-bookcart -f infra/main.bicep -p infra/parameters/production.bicepparam
az deployment group create  -g rg-bookcart -f infra/main.bicep -p infra/parameters/production.bicepparam
```

After that: give the app identity its database user and apply the migrations (A3), then the first release (A5). Later runs go through `infra.yml` (A2), which passes the image that is running now.

## Choices worth knowing

- **No App Service health check.** It requests the path every minute; `/health` queries the database, which would then never pause, and the free monthly amount would be used up in days. The release pipeline checks `/health` itself, once per release.
- **Secrets are app settings**, from secure parameters (never logged, never an output). A paid setup would use Key Vault references instead.
- **The settings resource owns the whole list** of app settings: a setting added by hand in the portal disappears on the next run. Change them here.
- **The pipeline identity is the SQL administrator**, so after A1 the database is reached through the workflows (`make-admin.yml`, the migration step). During A0 you are the administrator.
- **One free database per subscription** (Microsoft). Delete the A0 resource group before deploying this one, or the free database cannot be created.
- **`budgetStartDate`** must be the first day of the current or a later month when the budget is created, and must not change afterwards. Set it in the parameter file when A1 is deployed for the first time.
- **Not yet proven** (A0): the non-root user (uid 1654) writing to `/home`, how long the database takes to pause with the app's connection pool, and F1's CPU-minute quota.
