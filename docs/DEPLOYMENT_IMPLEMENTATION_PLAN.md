# Deployment Implementation Plan: Docker server and Azure production release

Scope: how BookCart is deployed. **One application image, two deployment targets.**

- **Part D: a Docker server.** One host with Docker runs SQL Server, the app and Caddy (HTTPS), and one command deploys and updates it. Phases **D0 to D7**. **D0 to D5 are done and committed.**
- **Part A: Azure free tier, released by CI/CD.** A study deployment at zero cost: App Service Free F1 running the container, the Azure SQL Database free offer, the image on GitHub Container Registry, an approval before each release, an automatic rollback, a budget alert. Phases **A0 to A5, A7 and A8** (A6, A9 and A10 skipped). **A plan only: nothing in it is started** (an `infra/` draft exists for the earlier paid design).

This document merges two earlier ones: the Docker plan (written first, and mostly implemented) and a separate Azure plan. Section 4 lists the conflicts found between them and how each was resolved. Each phase ends with a check you can run. A finished phase keeps its results ("D3 results") directly under its plan text, as the record of what was built and where it differed from the plan, so this file can be picked up without the conversations that produced it.

## 1. Status

| Phase | What | Status |
|---|---|---|
| D0 | Spike: the EF migrations bundle, the in-image health check, Docker on the dev PC | **Done** 2026-10-24 |
| D1 | `Dockerfile`, `.dockerignore`, the `SkipClientBuild` switch | **Done** 2026-10-24 |
| D2 | Compose file (SQL Server, migrate, app, Caddy) | **Done** 2026-10-24 |
| D3 | `deploy.sh`, `backup.sh`, `make-admin.sh`, the `release.bat` wrapper | **Done** 2026-10-24 |
| D4 | The image really is the app (pages, fonts, uploads, guest cart, browser checks) | **Done** 2026-10-24 |
| D5 | A CI job that deploys the stack and checks it | **Done** 2026-10-25, **confirmed on GitHub** 2026-11-10 (the pull-request run #19 and the merge run #20 were green; the `stack` job took 2 min 54 s on a cold cache) |
| D6 | Documentation and tidy-up, **both targets** | **Docker half done** 2026-11-10 (README, `CLAUDE.md`, F7-5 closed, executable bits); follow-up 2026-11-15 (`ContainerRepository` removed, `ENFORCE_CSP`). The Azure half is **skipped** (2026-11-16: `docs/RUNBOOKS.md` from A7 and one README line replace it) |
| D7 | Optional: a limited SQL login for the Docker target | Not started, optional |
| A0 to A8 | Azure free tier: the by-hand first deployment, Bicep, GitHub trust, database access, image publishing, release and rollback, trimmed backups and runbook, trimmed monitoring | Not started. **Rescoped 2026-11-16 to zero cost** (A6, A9, A10 skipped; A7, A8 trimmed). The `infra/` draft of 2026-11-15 was written for the paid design and is rewritten in A1 |

## 2. Requirement and decisions

### Requirement, as understood

1. The application keeps running as **one Docker stack on any Docker host** (Part D), from the same image as everything else.
2. The same application also runs on **Azure App Service ("Azure websites")** as a production release (Part A).
3. **CI/CD** does the deployment and the release management: build once, test, publish the image, deploy to a safe place, verify, approve, release, and be able to go back.
4. The production-grade list: a container registry and automatic deploys, a managed cloud platform, a managed database, monitoring and log shipping, off-host backups.

### Decisions already taken

| Question | Decision | Part |
|---|---|---|
| Where it runs, how the image gets there | A Linux server (VPS or VM) with **only Docker** installed. The image is **built on the server** from the cloned repo. No registry. The same flow works on a Windows PC with Docker Desktop. | D |
| Database | **SQL Server 2022 in a container**, data in a Docker volume (as before). The edition is Express (D2: the image's default, Developer, is not licensed for production). | D |
| HTTPS | A **Caddy** container in the stack gets and renews a Let's Encrypt certificate for your domain. A blank domain means plain HTTP on the app port (demo or LAN). | D |
| Schema and first admin | A **one-shot `migrate` container** applies the EF Core migrations before the app starts (after a backup if a database exists). The first admin is created by **one documented command** after registering. Part D needs **no backend code change**, and no admin account is seeded. | D |
| Azure host | **App Service Free F1 (Linux), running the container** (rescoped 2026-11-16: zero cost, study project). | A |
| Release flow | **The CI stack job tests the exact image, you approve, the pipeline migrates and switches the image, checks, and rolls back by itself on failure.** No staging slot (F1 has none). | A |
| Instances | **One instance** (F1 allows no more). | A |
| Infrastructure as code | **Bicep**, in the repository. | A |
| This document | One file, `DEPLOYMENT_IMPLEMENTATION_PLAN.md`. Phase labels D0 to D7 and A0 to A8. Finished Docker results stay inline under their phases. The leftover Docker work (D6, optional D7) is folded in. | both |

Assumptions (rescoped 2026-11-16): CI/CD is **GitHub Actions**; the registry is **GitHub Container Registry** (free for a public repository); the database is the **Azure SQL Database free offer** (the app already speaks SQL Server); secrets are **App Service app settings** filled from GitHub environment secrets (Key Vault costs money per operation); monitoring is the **log stream, the built-in metrics and a scheduled uptime workflow**; GitHub authenticates to Azure with **OpenID Connect** (no stored passwords).

### Settled while building Part D (these were open in the Docker plan)

1. `scripts/release.bat`: kept as a thin Windows wrapper around `deploy/deploy.sh` (D3).
2. CI: the tar-only "Container image" job was replaced by the stack job (D5).
3. Backups kept: the newest 7 (`BACKUP_KEEP`, D3).
4. SQL login for the Docker target: still `sa`; a limited login is the optional D7.

### Azure decisions (answered 2026-11-13 and 2026-11-16)

1. **Purpose and cost:** a study project; Part A runs on **free resources only, at zero cost**, without over-engineering (2026-11-16). The phases are trimmed accordingly: A0 to A5 kept, A7 and A8 trimmed, **A6, A9 and A10 skipped**, as are SBOM and attestations, the registry purge and the Azure half of D6.
2. **Account:** an **Azure free account** (USD 200 credit and a spending limit for 30 days; no subscription exists yet). After day 30 it must be upgraded to pay-as-you-go to keep running; the design stays on free offers, and a USD 1 budget alert reports any mistake. When to upgrade is your decision.
3. **Region:** **Central India** (South India is the fallback if A0 finds a free offer unavailable there).
4. **App Service tier:** **Free F1 (Linux)**, which Microsoft documents as supporting Linux containers (checked 2026-11-16).
5. **Database:** the **Azure SQL Database free offer**, exhaustion behaviour **auto-pause** (it stops until next month instead of billing). Backups: what the free offer includes (point-in-time, 7 days) plus a manual BACPAC export to your PC (A7).
6. **Database login:** **Microsoft Entra only (no SQL password anywhere)**. The app uses a managed identity; the pipeline identity is the server's Entra administrator. Fallback if the tenant blocks it: SQL authentication with the password as an app setting.
7. **Who approves a release:** **you** (a required reviewer on the GitHub `production` environment).
8. **Domain:** **the `azurewebsites.net` address**, for good (A9 is skipped).
9. **Alerts and budget:** **your e-mail**; a budget of **USD 1 per month** (the expected cost is zero).
10. **`Security:EnforceCsp`:** report-only by default in both targets. The Docker target can enforce it with `ENFORCE_CSP=true` in `deploy/.env` (since 2026-11-15). **The Azure app enforces it** (`true`, A1): D4 found no violations.
11. **CI triggers:** unchanged (push to `master`, pull request, manual).

The step-by-step sign-up guide is `docs/AZURE_SIGNUP_AND_A0_RUNBOOK.md`; its spike commands were written for the earlier paid design and are rewritten for the free one together with A1.


## 3. One image, two targets

The **same image** (`Dockerfile`, targets `app` and `migrate`) runs in both parts. What differs is configuration only:

| Setting | Docker (Part D) | Azure free tier (Part A) |
|---|---|---|
| Database | SQL Server container, `sa` login | Azure SQL free offer, managed identity, no password |
| Uploads and keys | Docker volumes at `/data/uploads`, `/data/keys` | the web app's persistent `/home`, at `/home/data/uploads`, `/home/data/keys` |
| TLS | Caddy | App Service (`azurewebsites.net` certificate) |
| `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | `true` only behind Caddy | `true` |
| Secrets | `deploy/.env` (mode 600) | App Service app settings, filled from GitHub environment secrets |
| Logs | Console, `docker logs` | Console, the App Service log stream |
| Image | Built on the server by `deploy/deploy.sh` | Built once in CI, tested, pushed to `ghcr.io`, deployed by digest |
| Releases | `git pull && deploy/deploy.sh` | CI/CD: approval, migrate, switch the image, check, automatic rollback |

**Compatibility rule for every phase:** no code path may depend on Azure unless a setting turns it on. The CI `stack` job (the Docker target) stays a required check, and it is the proof that the single-container model still works. Part A needs **no application code change**.

Shared building blocks (built once in Part D, reused by Part A):

| Building block | Part D | Part A |
|---|---|---|
| `Dockerfile` (targets `app`, `migrate`) | built on the server (D1) | built once in CI, pushed to `ghcr.io` (A4) |
| The migration bundle (`migrate` image) | a Compose service and a standalone step (D2, D3) | copied out of the tested image and run against Azure SQL by the pipeline (A3) |
| `deploy/verify.sh` | server self-check and CI (D5) | checks the Azure site by URL (A5) |
| `scripts/smoke/smoke.js`, `pages.js` | D4 and D5 | `smoke.js` runs in the CI stack job only; `pages.js` (read-only) after each release (A5) |
| `/health` | the image's `HEALTHCHECK` | the release pipeline's wait step (A5); **not** the App Service Health check feature (it would keep the free database awake) |


## 4. Conflicts found when merging, and how they were resolved

| # | Conflict | Resolution |
|---|---|---|
| 1 | The Docker plan said "nothing in this document is implemented yet", but D0 to D5 are done and committed. | The status table (section 1). Results stay under each phase. |
| 2 | "Where things stand today" described the repository **before D0** (a `release.bat` that published binaries, no Dockerfile, `init-volumes`, a published SQL port). It read as current and is false. | Kept as "Starting point (before D0)", marked historical. |
| 3 | The Docker plan excluded a registry, CI deploys, managed cloud, a managed database, monitoring and off-host backups ("Not in this plan"). The Azure plan requires all of them. | Not a contradiction once scoped: Part D keeps *build on the server, no registry* as the decision for that target, and Part A adds the rest. One merged "Not in this plan" list (section 6). |
| 4 | The Docker plan's four open decisions had all been settled by the work (release.bat wrapper, the tar job replaced, the last 7 backups) or deferred (the SQL login). | Moved to "Settled". The SQL login stays as the optional D7. |
| 5 | D3 step 7 said a failed migration leaves the old app running. D3's own results proved the opposite (Compose replaces the app container first). | The step text is corrected and points to the results. |
| 6 | Some proposals differ from what was built: D3 planned a base64 `JWT_SECRET` (built as hex), the D2 Compose file and the D5 CI job were sketches. | Each is labelled "as first planned" with a pointer to its results. The files in the repository are the truth. |
| 7 | D6 listed cleanup already done by D2 and D5 (`init-volumes`, the published SQL port, the CI tar step, `artifacts/publish`) and a rollback command that is not the one D3 tested. | D6 is rewritten to what really remains (checked in the repository on 2026-11-10) and to the tested rollback. |
| 8 | The Docker risks said the EF bundle and the in-image health check were "not proven yet" (they were, in D0) and put off-host backups out of the plan (Azure needs them). | Rewritten: proven in D0. For Docker the off-host copy is a manual step documented in D6. For Azure it is built in (A7). |
| 9 | The Azure plan said the image CI tested is the image released, but D5's job builds inside the job and a separate release job would **rebuild**: a different image, however similar. | A4: the stack job pushes the very images it tested (no rebuild) and passes their digests to a reusable `release.yml`. |
| 10 | The Azure plan had no way to create the **first admin** (`deploy/make-admin.sh` needs `docker exec`, which does not exist there). | New A3 item: `deploy/azure/make-admin.sh` and a manual workflow behind the production approval. The staging smoke admin uses it too. |
| 11 | Both plans numbered their phases 0 to 7 and cross-referenced each other. | Labels D0 to D7 and A0 to A10. Every internal reference was rewritten and checked. |
| 12 | Two documentation tasks existed: the Docker plan's D6 (README, `CLAUDE.md`) and the Azure plan's README and runbook updates. | One phase, D6, covers both targets. The Docker half can go now, the Azure half after A7. It also corrects the Visual Studio prerequisite: both files say "Visual Studio 2022 17.13+", the projects target .NET 10 and Visual Studio 2022 could not load them for the owner. |
| 13 | "No backend code change" (a Docker decision) against the optional telemetry change in the Azure plan. | Scoped: Part D needs none; Part A has one optional change, off unless configured (A6). |
| 14 | `Security:EnforceCsp` was an open question in `CLAUDE.md`; D4 settled the evidence; the Azure plan mentioned it twice. | One open decision (section 2, item 10). |
| 15 | The two files tables overlapped, and the Docker one lacked files created later (`lib.sh`, `verify.sh`, `pages.js`, the `smoke.js` change, the `.gitignore` line). | One table with Part and Status columns (section 5). |
| 16 | 2026-11-16: the owner rescoped Part A to a zero-cost study deployment. Rows 9 and 10 above, and earlier text, speak of a registry in Azure, a staging slot and phases A6, A9 and A10 of the full design. | Part A was rewritten for the free tier (F1, the SQL free offer, `ghcr.io`, no staging slot). Rows 9 and 10 still hold in spirit: the stack job pushes the image it tested (A4), and the first admin has a command (A3). The full design is in git history (`21a90d6`). |

## 5. Files this plan creates or changes

| File | Part | Action | Status |
|---|---|---|---|
| `Dockerfile`, `.dockerignore` | D | new: node stage, build stage, `migrate` and `app` targets | done (D1) |
| `BookCart/BookCart.csproj` | D | `SkipClientBuild` switch on the two publish-time npm lines | done (D1) |
| `BookCart/BookCart.csproj` | D | remove `ContainerRepository` and its comment | done (D6 follow-up, 2026-11-15) |
| `deploy/docker-compose.yml`, `deploy/.env.example`, `deploy/deploy.sh` | D | pass `ENFORCE_CSP` through (default `false`) | done (D6 follow-up, 2026-11-15) |
| `.gitattributes` | D | `*.sh` and the Docker files at LF, `*.bat` at CRLF | done (D3) |
| `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/.env.example` | D | the stack: SQL Server, migrate, app, optional Caddy | done (D2) |
| `deploy/deploy.sh`, `backup.sh`, `make-admin.sh`, `lib.sh` | D | the one command, backups, the first admin, shared helpers | done (D3) |
| `scripts/release.bat` | D | a wrapper around `deploy/deploy.sh` for Windows | done (D3) |
| `scripts/smoke/smoke.js` (`PROMOTE_ADMIN_CMD`), `scripts/smoke/pages.js` | D | browser checks usable against any deployment | done (D4) |
| `deploy/verify.sh`, `.gitignore` (`deploy/.verify-tmp/`) | D | the post-deployment self-check | done (D5) |
| `.github/workflows/ci.yml` | D | the stack job replaced the tar job | done (D5) |
| `README.md`, `CLAUDE.md`, `docs/FRONTEND_CHANGES.md` | D | describe the real flow; close F7-5 | done (D6, Docker half) |
| `infra/main.bicep`, `infra/modules/*.bicep`, `infra/parameters/*.bicepparam`, `infra/README.md` | A | the free Azure environment (the 2026-11-15 draft for the paid design is rewritten) | A1 |
| `infra/bootstrap.sh` | A | the one-time resource group, pipeline identity and trust in GitHub | A2 |
| `.github/workflows/infra.yml` | A | what-if, then deploy after approval (manual) | A2 |
| `.github/workflows/ci.yml` | A | the stack job scans and pushes the images it tested on `master` and calls `release.yml` | A4 |
| `.github/workflows/release.yml` | A | reusable: approval, migrate, switch the image, check, roll back on failure | A5 |
| `.github/workflows/rollback.yml`, `make-admin.yml`, `uptime.yml` | A | manual rollback to a SHA; the first admin behind the approval; the 6-hourly uptime check | A5, A3, A8 |
| `deploy/azure/*.sh` | A | database user setup, migration step, `make-admin` | A3 |
| `deploy/verify.sh` | A | a mode that checks only a URL (no `docker` commands) | A5 |
| `docs/AZURE_SIGNUP_AND_A0_RUNBOOK.md` | A | sign-up guide and the by-hand first deployment (rewritten for the free design) | A0 |
| `docs/RUNBOOKS.md`, one line in `README.md` | A | release, roll back, restore, rotate the JWT key, free-tier limits | A7 |

The development scripts (`scripts/dev-*.bat`) are **not touched**.

---

## Part D: Docker server (D0 to D7)

Scope: running the whole application (SQL Server, the API with the Angular site, HTTPS) on one Docker host, a Linux server or a Windows PC with Docker Desktop, with **one command**, and updating it with the same command. D0 to D5 are implemented and verified; D6 and D7 remain.

### Starting point (as found on 2026-10-24, before D0)

*Historical: this is the state of the repository before D0, kept to explain why the phases exist. For the current state see the status table (section 1).*

- `deploy/docker-compose.yml`: `sqlserver` (2022, volume, healthcheck, published on `127.0.0.1:14331` for host-side migrations), `init-volumes` (chown), `app` (image `bookcart:<tag>`, port 8080, volumes `uploads` and `keys`). `deploy/.env.example` lists the settings; `deploy/.env` is git-ignored (so are `deploy/backups/` and `artifacts/`).
- `scripts/release.bat` (Windows only): generates `deploy/.env`, runs `dotnet publish` twice (binaries to `artifacts/publish`, then the image with `-t:PublishContainer`), starts SQL Server, backs up an existing database, runs `dotnet ef database update` **from the host**, starts the app, waits for `/health`.
- No `Dockerfile`; the image comes from the .NET SDK container support (`ContainerRepository` in `BookCart.csproj`). CI builds that image as a tar archive and never runs it.
- Consequences: the host needs the .NET 10 SDK, Node 24 and the `dotnet-ef` tool; `docker compose up` alone fails because the image does not exist yet; migrations are not run inside Docker; there is no TLS; the first admin is a manual SQL command; Angular is built twice per release.
- Facts the plan relies on: the app refuses to start without `ConnectionStrings__DefaultConnection` and `Jwt__SecretKey`; `/health` is unhealthy until the database is migrated; `BookDBContextFactory` reads `BOOKCART_EF_CONNECTION` (needed by the EF bundle); `PublishBuildClient` in `BookCart.csproj` always runs `npm ci` and the Angular build; `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` makes ASP.NET trust the proxy headers; the container user is `app` (uid 1654, from the base image); `global.json` pins SDK 10.0.201 with `rollForward: latestFeature`, so `sdk:10.0` images satisfy it; Angular 22 needs Node 24 (`^24.15`).


### Target architecture (Docker)

```
 Internet ──80/443──▶ caddy ──────▶ app (ASP.NET :8080) ──▶ sqlserver (volume sqldata)
          Let's Encrypt            API + built Angular site        ▲
          certificate              volumes: uploads, keys          │
                                                           migrate (runs once, exits)
```

- Only `caddy` is reachable from outside (80/443). The app port is published on `127.0.0.1` only (when Caddy is used), and **SQL Server is not published at all**.
- Start order, enforced by Compose: `sqlserver` healthy, then `migrate` completed successfully, then `app`, then `caddy`.
- HTTP-only mode (no domain): no Caddy, the app is published on `APP_PORT` (default 8080) on all interfaces.


### D0: Prove the three uncertain pieces (spike, nothing committed)

These are the only parts not yet proven in this repo. Settle them first; the rest is routine.

1. **Docker works here.** Start Docker Desktop on the development PC and run `docker run --rm hello-world`. Without a running daemon none of the later checks can run on this machine.
2. **The EF migrations bundle.** In an SDK container (or locally): `dotnet tool restore`, then
   `dotnet ef migrations bundle --project BookCart --configuration Release --self-contained -r linux-x64 -o efbundle --force`.
   Run the result against a throwaway SQL Server container: `./efbundle --connection "Server=...;Database=BookDB_Spike;User Id=sa;Password=...;TrustServerCertificate=True"`. Expected: the migrations apply and the database exists. **Fallback if the bundle fails:** `dotnet ef migrations script --idempotent` at build time into the image, run by a small container with `sqlcmd` (`mcr.microsoft.com/mssql-tools`).
3. **A health check inside the ASP.NET runtime image.** The image has no `curl` or `wget`. Check that `bash` exists (`docker run --rm mcr.microsoft.com/dotnet/aspnet:10.0 bash -c 'echo ok'`). If it does, the check is a `/dev/tcp` request (D1). If it does not, drop the image healthcheck and let `deploy.sh` and the CI job poll `/health` from outside.

**Check:** a one-paragraph note of the three outcomes at the top of the implementation branch's commit message.

#### D0 results (done 2026-10-24: all three pieces proven, nothing changed in the repo)

Run on this PC (Docker 29.8, Compose v5.5.1, 8 GB, 8 CPUs) in throwaway containers on a private network, with the repo mounted read-only. Every container, volume, network and image the spike created was removed afterwards; the four base images (sdk, aspnet, runtime-deps, node 24) stay cached.

| Question | Result |
|---|---|
| Docker works here | Yes. The daemon runs and Compose v5 is present. |
| EF migrations bundle | **Works.** `dotnet ef migrations bundle --self-contained -r linux-x64` builds inside `sdk:10.0` (10.0.402, which satisfies `global.json`) in about 46 s. Run from the slim `runtime-deps:10.0` image with `--connection`, it created the database and applied both migrations (10 tables, 5 categories, 2 user types); a second run reported "already up to date". A wrong password and an unreachable server both exit with code **1**, so `service_completed_successfully` will stop the stack. No ICU or other native library was missing. The fallback (idempotent script plus sqlcmd) is not needed. |
| Health check inside the ASP.NET image | **Works with bash** (5.2; the image is Ubuntu 24.04 and has `bash` and `grep` but no `curl` or `wget`). Docker's status went starting, then healthy in about 15 s. With the database stopped it turned unhealthy after about 50 s (`/health` answers 503) and healthy again about 40 s after SQL Server came back. |
| `SkipClientBuild` | **Works.** With the two `npm` `Exec` lines conditioned on `'$(SkipClientBuild)' != 'true'`, `dotnet publish` runs in the SDK image (no Node there) in 9 s and ships the Angular output from `ClientApp/dist`: fonts in `media/`, prerendered `login/` and `register/`, `index.csr.html`, and no XML doc file. |
| NuGet audit in the build | `dotnet restore` inside Docker ran the audit and passed (the `Transitive pins` group holds). |
| Client stage | `node:24-bookworm-slim` (Node 24.22): `npm ci` 26 s, production build 16 s, the same 85 files and 3 prerendered routes, and `verify-static.js` passes. npm 11 prints a warning that the install scripts of four packages (esbuild, @parcel/watcher, lmdb, msgpackr-extract) were not run: harmless, the build and the self-check pass. |

Also confirmed against the running container (non-root, HTTP-only, real database):
- The app runs as `app` (uid 1654). Folders created and chowned in the image (`/data/uploads`, `/data/keys`) are writable on **new named volumes**, so the `init-volumes` helper can go.
- `/`, `/login`, `/register` and `/wishlist` answer 200 (the last one is the client shell) and `/api/book` answers 200. Unknown `/api/...` paths and `/missing-chunk.js` are 404 problem+json. A font named by the CSS is 200 `font/woff2`, the security headers are present, and register, login and an authenticated `/api/order` work (anonymous is 401).
- A guest session (`POST /api/guest`) kept the same guest id across a container restart: the Data Protection keys on the `keys` volume work.

What this changes in the later phases:
1. **D1, health check:** use the version in the Dockerfile below. It reads the status line and checks for ` 200 `, which does not depend on the response body, and `--retries` is 3. The earlier draft used `grep -q Healthy`.
2. **D1, `.dockerignore`:** keep `BookCart/wwwroot/Upload/Default_image.jpg` (it is tracked, and the default cover falls through to it). Excluding the whole `Upload` folder, as the spike did, removes it from the image.
3. **D1, image sizes:** the bundle is a 183 MB self-contained file, so the `migrate` image is about 437 MB and the `app` image about 460 MB (measured in D1; the first estimate of 360 MB was too low). That is acceptable; trimming is not worth the risk.
4. **Logs:** the app logs the warning "Failed to determine the https port for redirect" in HTTP-only containers. It is harmless (TLS ends at Caddy); leave it unless you want it silenced.
5. **D3, waiting for health:** the image health check is usable, so `deploy.sh` can wait on `docker inspect` health (or `docker compose up --wait`) instead of polling `/health` from outside. Allow about 1 minute for a stopped database to be reported and about 40 s for SQL Server to come back.
6. `ASPNETCORE_HTTP_PORTS=8080` is already set in the base image; the `ENV` line in the Dockerfile is redundant but keeps the port visible.

### D1: Dockerfile and .dockerignore

Proposed `Dockerfile` (adjust versions to what D0 confirmed):

```dockerfile
# syntax=docker/dockerfile:1

# 1. The Angular site (production build, with the same self-check CI runs).
FROM node:24-bookworm-slim AS client
WORKDIR /src/BookCart/ClientApp
COPY BookCart/ClientApp/package.json BookCart/ClientApp/package-lock.json ./
RUN npm ci
COPY BookCart/ClientApp/ ./
RUN npm run build -- --configuration production && node verify-static.js

# 2. The .NET build: publish the app (using the Angular output from stage 1) and bundle the migrations.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY global.json Directory.Build.props Directory.Packages.props dotnet-tools.json ./
COPY BookCart/BookCart.csproj BookCart/
RUN dotnet restore BookCart/BookCart.csproj && dotnet tool restore
COPY BookCart/ BookCart/
COPY --from=client /src/BookCart/ClientApp/dist BookCart/ClientApp/dist
RUN dotnet publish BookCart/BookCart.csproj -c Release -o /out/app --no-restore -p:SkipClientBuild=true
RUN dotnet ef migrations bundle --project BookCart --configuration Release --self-contained -r linux-x64 -o /out/efbundle --force

# 3a. One-shot migration runner (no SDK, no source).
FROM mcr.microsoft.com/dotnet/runtime-deps:10.0 AS migrate
COPY --from=build /out/efbundle /app/efbundle
ENTRYPOINT ["/app/efbundle"]

# 3b. The application.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS app
WORKDIR /app
COPY --from=build /out/app ./
# Created and owned here, so new named volumes inherit the owner: no chown helper container is needed.
RUN mkdir -p /data/uploads /data/keys && chown -R app:app /data
USER app
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/8080; printf "GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n" >&3; read -r line <&3; [[ $line == *" 200 "* ]]' || exit 1
ENTRYPOINT ["dotnet", "BookCart.dll"]
```

`BookCart.csproj`: add `Condition="'$(SkipClientBuild)' != 'true'"` to the two `Exec` lines (`npm ci` and `npm run build`) in `PublishBuildClient`; the file copy that follows stays as it is. A normal `dotnet publish` is unchanged.

`.dockerignore` (keeps the build context small and never sends secrets): `**/node_modules`, `**/bin`, `**/obj`, `BookCart/ClientApp/dist`, `BookCart/ClientApp/.angular`, `.git`, `.github`, `artifacts`, `deploy/.env`, `deploy/backups`, `BookCart/wwwroot/Upload/*` except `Default_image.jpg` (uploaded covers are git-ignored but exist on a dev machine), `BookCart.Tests`, `docs`.

Notes: layers are ordered so the NuGet restore and `npm ci` are cached until the project files or lock files change. The NuGet audit runs inside `dotnet restore`: a newly published advisory can fail `docker build` exactly as it failed CI (fix: the `Transitive pins` group in `Directory.Packages.props`, see CLAUDE.md).

**Check:** `docker build --target app -t bookcart:test .` succeeds; `docker run --rm bookcart:test ls wwwroot/media | head` lists fonts, and `wwwroot/login/index.html` and `wwwroot/index.csr.html` exist; the build logs "verify-static: ... every reference resolves".

#### D1 results (done 2026-10-24)

Files: `Dockerfile` and `.dockerignore` at the repo root, and the `SkipClientBuild` condition on the two publish-time `npm` lines in `BookCart/BookCart.csproj` (the Debug-only `npm ci` in `DebugEnsureNodeEnv` is untouched). The Dockerfile is the one above, unchanged from D0 except for comments.

Checked:
- `docker build --target app` succeeds in 1 min 28 s on a cold cache (`npm ci` 23 s, Angular build 12 s plus `verify-static.js` passing with 85 files and 3 prerendered routes, restore 16 s, publish, bundle 26 s). `--target migrate` builds from the same cache in 12 s. The build context is 864 KB.
- Cache: a rebuild with nothing changed takes 3.7 s (all steps cached). After changing one C# file, `npm ci`, the Angular build and the restore stay cached; only the publish (13 s) and the migrations bundle (50 s) run again.
- The app image holds only `Default_image.jpg` in `wwwroot/Upload`, the fonts (56 files in `media/`), the prerendered `login/` and `register/` pages and `index.csr.html`; no source, database, `.env` or `node_modules`; empty secrets in `appsettings.json`; the user is `app` (1654), and `/data/uploads` and `/data/keys` are owned by it.
- End to end with the built images on a private network: the `migrate` image created the schema (exit 0, and a second run changes nothing), the `app` image became healthy in 10 s, and `/`, `/login`, `/register`, `/wishlist`, `/api/book`, `/api/book/GetCategoriesList` and `/Upload/Default_image.jpg` answer 200, an unknown `/api/...` path is a 404, a font named by the CSS is 200 `font/woff2`, the guest session survives a restart and the uploads volume is writable by the app user.
- A normal `dotnet publish -c Release` (no `SkipClientBuild`) still runs `npm ci` and the Angular build, and `verify-static.js` passes on its `wwwroot`.

Differences from the plan text:
- `.dockerignore` excludes the whole `deploy/` folder (compose file, scripts, `.env`, backups) instead of only `deploy/.env` and `deploy/backups`: the images never need anything from it, and this keeps secrets out of the build context by construction. It also excludes `scripts`, `DBScript`, `BookCart.slnx`, `*.md`, `**/*.bak`, `**/*.mdf`, `**/*.ldf` and `**/.env*`.
- `appsettings.Development.json` is published into the image (the SDK's default). It holds only logging levels and is read only when `ASPNETCORE_ENVIRONMENT=Development`, so it is left alone.
- Not done here, as planned: `.gitattributes` (`*.sh` with LF) comes with the scripts in D3, and the stale "no Dockerfile" sentences in `README.md` and `CLAUDE.md` are updated in D6.

### D2: Compose file and Caddy

`deploy/docker-compose.yml` (as first proposed; the file in the repository is the truth, see the D2 results for the differences):

```yaml
name: bookcart

services:
  sqlserver:
    image: mcr.microsoft.com/mssql/server:2022-latest
    container_name: bookcart-sql
    restart: unless-stopped
    environment:
      ACCEPT_EULA: "Y"
      MSSQL_SA_PASSWORD: ${SA_PASSWORD:?run deploy/deploy.sh once to create deploy/.env}
    volumes:
      - sqldata:/var/opt/mssql
    healthcheck:       # unchanged from today: sqlcmd SELECT 1
      test: ["CMD-SHELL", "/opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P \"$$MSSQL_SA_PASSWORD\" -Q 'SELECT 1' -b"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 20s

  migrate:
    build: { context: .., dockerfile: Dockerfile, target: migrate }
    image: bookcart-migrate:${BOOKCART_TAG:-latest}
    restart: "no"
    depends_on:
      sqlserver: { condition: service_healthy }
    command: ["--connection", "Server=sqlserver,1433;Database=BookDB;User Id=sa;Password=${SA_PASSWORD};TrustServerCertificate=True"]

  app:
    build: { context: .., dockerfile: Dockerfile, target: app }
    image: bookcart:${BOOKCART_TAG:-latest}
    container_name: bookcart-app
    restart: unless-stopped
    depends_on:
      migrate: { condition: service_completed_successfully }
    environment:
      ConnectionStrings__DefaultConnection: Server=sqlserver,1433;Database=BookDB;User Id=sa;Password=${SA_PASSWORD};TrustServerCertificate=True
      Jwt__SecretKey: ${JWT_SECRET:?JWT_SECRET is missing in deploy/.env}
      Jwt__Issuer: ${JWT_ISSUER}
      Jwt__Audience: ${JWT_AUDIENCE}
      Gemini__ApiKey: ${GEMINI_API_KEY:-}
      Storage__UploadFolder: /data/uploads
      Security__DataProtectionKeysPath: /data/keys
      ASPNETCORE_FORWARDEDHEADERS_ENABLED: ${FORWARDED_HEADERS:-false}
    ports:
      - "${APP_BIND:-0.0.0.0}:${APP_PORT:-8080}:8080"
    volumes:
      - uploads:/data/uploads
      - keys:/data/keys

  caddy:
    image: caddy:2
    container_name: bookcart-caddy
    profiles: ["https"]
    restart: unless-stopped
    depends_on: [app]
    environment:
      DOMAIN: ${DOMAIN:-localhost}
      ACME_EMAIL: ${ACME_EMAIL:-}
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data        # holds the certificates: keep it, or certificates are re-issued
      - caddy_config:/config

volumes:
  sqldata:
  uploads:
  keys:
  caddy_data:
  caddy_config:
```

`deploy/Caddyfile`:

```
{
	email {$ACME_EMAIL}
}

{$DOMAIN} {
	encode zstd gzip
	reverse_proxy app:8080
}
```

How the two modes are chosen (written into `deploy/.env` by `deploy.sh`):
- **HTTPS mode** (domain given): `COMPOSE_PROFILES=https`, `APP_BIND=127.0.0.1`, `FORWARDED_HEADERS=true`, `JWT_ISSUER`/`JWT_AUDIENCE=https://<domain>/`.
- **HTTP-only mode** (no domain): `COMPOSE_PROFILES=` (empty, no Caddy), `APP_BIND=0.0.0.0`, `FORWARDED_HEADERS=false`, issuer and audience `http://localhost:<port>/`.
- Why trusting forwarded headers is safe here: in HTTPS mode the app port is bound to `127.0.0.1`, so only Caddy (through the Docker network) can reach it.
- A local rehearsal of HTTPS needs no real domain: `DOMAIN=localhost` makes Caddy issue a certificate from its own local CA (the browser warns once).

**Check:** `docker compose -f deploy/docker-compose.yml --env-file <test env> config` is valid in both modes; `docker compose up -d --build` in HTTP-only mode brings up `sqlserver`, `migrate` (exits 0) and `app` (healthy).

#### D2 results (done 2026-10-24)

Files: `deploy/docker-compose.yml` (rewritten), `deploy/Caddyfile` (new) and `deploy/.env.example` (rewritten). The compose file above is the proposal; the file in the repo is the truth. All tests ran under a throwaway project name (`-p p2test`, its own volumes) and the stack, its volumes and its images were removed afterwards.

Differences from the proposal, and why:
- **SQL Server edition (needs your attention):** the image's default edition is **Developer, which is licensed for development and testing only**. The compose file now sets `MSSQL_PID: ${MSSQL_PID:-Express}`. Express is free for production (10 GB per database, about 1.4 GB of memory for data pages, 4 cores), which is plenty for this shop. Switching an existing volume from Developer to Express worked in place and kept the data (tested). Set `MSSQL_PID=Developer` (or a paid edition) in `deploy/.env` if you want something else.
- **Migration connection string:** the `migrate` service passes it as `BOOKCART_EF_CONNECTION` (the bundle reads it through `BookDBContextFactory`; tested) instead of `command: ["--connection", ...]`, so the SA password is not on a command line. One YAML anchor (`x-database`) holds the connection string for both `migrate` and `app`.
- **`caddy` waits for a healthy `app`** (`service_healthy`), now that the image has a health check.
- **ACME email is required in HTTPS mode:** Caddy rejects `email` with an empty value (tested), so `deploy.sh` must ask for it and refuse a blank one. In plain HTTP mode it is unused. (A `${ACME_EMAIL:?}` check in the compose file would also fire in HTTP mode, so it is documented instead.)
- The two required-secret messages are quoted in the YAML (an unquoted `: ` inside them is a YAML error), and they say "copy deploy/.env.example to deploy/.env" because `deploy.sh` does not exist before D3.
- `.env.example` has the new settings (`COMPOSE_PROFILES`, `APP_BIND`, `FORWARDED_HEADERS`, `DOMAIN`, `ACME_EMAIL`, `MSSQL_PID`, `BOOKCART_TAG`) and no longer has `SQL_PORT`: SQL Server is not published at all.

Checked:
- `docker compose config` is valid in both modes: plain HTTP gives `sqlserver`, `migrate` and `app` (app published on `0.0.0.0`); HTTPS gives those plus `caddy` on 80, 443 and 443/udp (app published on `127.0.0.1`). A missing `SA_PASSWORD` or `JWT_SECRET` stops with the clear message.
- Plain HTTP: `up -d --build --wait` finished in 23 s with `migrate` exited 0 (**`--wait` accepts the one-shot service**, so `deploy.sh` can use it), SQL Server reported `Express Edition` and had no published port, no process showed the password on its command line, and `/health`, the pages, `/api/book`, the default cover, register, login and an authenticated call all worked.
- A failing migration (a bad host injected through an override file) made `up` exit 1 with `service "migrate" didn't complete successfully: exit 1` while the **previous app stayed up and healthy**. (That test left the app's configuration unchanged. With a new image tag per release, which `deploy.sh` uses, Compose replaces the app container *before* it waits for `migrate`, so a failed migration did leave no app running. D3 therefore runs the migration on its own first; see the D3 results.)
- `down` without `-v` followed by `up` kept the data (the registered user could log in) and the second migrate said "already up to date".
- HTTPS with `DOMAIN=localhost` (Caddy's own local authority) and ports 80/443: the same stack switched from HTTP in place in 12 s; pages are 200 through Caddy, `http://` answers 308 to `https://`, responses are compressed (the home page 86.8 KB to 19.8 KB, zstd negotiated), the guest cookie is `secure` (so the forwarded headers work), HSTS is sent for a real host name (not for `localhost`, which ASP.NET always excludes), and **13 login attempts with a different spoofed `X-Forwarded-For` each still hit the rate limit after 10** (Caddy overwrites the header).
- Not tested here: a real Let's Encrypt certificate (needs your domain and a reachable server).

Notes for D3:
1. `deploy.sh` can wait with `docker compose up -d --wait`.
2. **Switching from HTTPS back to plain HTTP leaves the `caddy` container running** (Compose ignores services whose profile is off). `deploy.sh` must stop it (`docker compose --profile https stop caddy`, or `--profile "*"` for `down`) when the profile is not `https`.
3. Use `docker compose --profile "*" down` to stop everything regardless of mode.
4. `container_name` is fixed (`bookcart-sql`, `bookcart-app`, `bookcart-caddy`), so only one BookCart stack can run per host; tests under another project name must not run next to a real one.
5. **`scripts/release.bat` is broken until D3**: it applies migrations from the host through the SQL port that the old compose file published and this one deliberately does not. Do not use it between D2 and D3.

### D3: `deploy/deploy.sh`, the one command

Behaviour, in order (bash, `set -euo pipefail`, run from anywhere):

1. **Preflight:** `docker` and `docker compose` (v2) exist and the daemon answers; otherwise print what to install.
2. **First run only** (no `deploy/.env`): ask for the domain (blank = HTTP-only) and the email for the certificate; generate `SA_PASSWORD` (SQL Server rule: upper, lower, digit, at least 8) and `JWT_SECRET` (`openssl rand -base64 48` as first planned; built as 96 hex characters, see the D3 results; falling back to `/dev/urandom`); write `deploy/.env` with `chmod 600`; print a reminder to **keep a copy** (the SQL password cannot be recovered from the volume, and a changed `JWT_SECRET` logs everyone out).
3. **Tag:** `BOOKCART_TAG=$(date +%Y%m%d-%H%M)-$(git rev-parse --short HEAD)` (or `-local` outside git); exported for Compose and printed.
4. **Build:** `docker compose build` (images `bookcart:<tag>` and `bookcart-migrate:<tag>`; the unchanged layers come from cache).
5. **Database up:** `docker compose up -d --wait sqlserver`.
6. **Backup if a database exists:** same logic as `release.bat` today (`DB_ID('BookDB')`), via `deploy/backup.sh`: `BACKUP DATABASE ... WITH INIT, CHECKSUM`, `RESTORE VERIFYONLY`, copy to `deploy/backups/BookDB_<tag>.bak`, keep the newest 7. A failed backup stops the script before anything is changed.
7. **Migrate and start:** `docker compose up -d`. As first planned, the `migrate` service was to run first because `app` depends on it, and a failing migration was to leave the old app running. **That did not hold:** Compose replaces the app container before it waits for `migrate`, so a failed migration left no app running. The script runs the migration on its own first (`docker compose run --rm --no-deps migrate`) and only then `up -d`; see the D3 results.
8. **Wait for health:** poll `docker inspect` health of `bookcart-app` (or `/health` on `127.0.0.1:<port>` if D0 dropped the image healthcheck) for up to 2 minutes; on failure print `docker logs --tail 40` of `app` and `migrate`.
9. **Summary:** the URL, the tag, `docker compose logs -f app`, how to stop (`docker compose down`, data stays in volumes), and the first-admin command.

Flags: `-y` for no prompts (needs an existing `.env`, for automation). `deploy.sh` never prints secrets and never deletes volumes.

`deploy/make-admin.sh <username>`: validates the name against `^[A-Za-z0-9_.@-]{1,50}$`, runs `UPDATE UserMaster SET UserTypeID = 1 WHERE Username = '<name>'` through `sqlcmd` in the SQL container, reports "promoted" or "no such user" from the affected-row count.

`deploy/backup.sh`: step 6 as a stand-alone command; documents the restore in a comment (stop `app`, `RESTORE DATABASE [BookDB] FROM DISK = ... WITH REPLACE`, start `app`).

`scripts/release.bat` (if kept): checks Docker (existing `ensure-docker.bat`), then runs `bash deploy/deploy.sh %*` (Git for Windows ships bash); if bash is missing it prints that. `.gitattributes` keeps `*.sh` at LF.

**Check:** on a clean checkout with an empty Docker (no volumes): `./deploy/deploy.sh` (HTTP-only, `-y` after creating `.env`) ends healthy; running it a second time backs up, re-migrates (nothing to do) and ends healthy; register a user in the browser, then `./deploy/make-admin.sh <user>` and the admin menu appears.

#### D3 results (done 2026-10-24)

Files: `deploy/deploy.sh`, `deploy/backup.sh`, `deploy/make-admin.sh`, `deploy/lib.sh` (shared helpers, sourced by the other three), `.gitattributes` and `scripts/release.bat` (now a thin wrapper, as planned; the decision "keep it as a wrapper" is taken). All four scripts pass `bash -n` and `shellcheck -S style` (run from the `koalaman/shellcheck` image). All tests ran against a real stack under a throwaway project name (`p3test`) and everything was removed afterwards.

What the scripts do, beyond the plan text:
- `deploy.sh` flags: `-y` (never ask; needs an existing `deploy/.env`), `--pull` (fetch newer base images before building: off by default so a deploy is predictable and works offline), `-h`. It also tags the built images `latest`, so a later plain `docker compose up` uses the deployed release, and the old tags remain for a rollback.
- First run: asks for a domain (blank = plain HTTP) and, for a domain, an e-mail (both validated, with retry), generates `SA_PASSWORD` (24 hex characters plus `Az1`, which satisfies SQL Server's rules) and `JWT_SECRET` (96 hex characters; hex rather than base64 so that no character can break the connection string or Compose), writes `deploy/.env` with `chmod 600` and prints the keep-a-copy reminder. `check_env` refuses characters in the two secrets that would break a connection string or a Compose file, and refuses HTTPS mode without a domain and an e-mail.
- `backup.sh [name]`: `BACKUP ... WITH INIT, CHECKSUM`, then `RESTORE VERIFYONLY`, copy out, delete the copy inside the volume, keep the newest `BACKUP_KEEP` files (default 7). "No database yet" is a success. The restore procedure in its header comment was run exactly as written and works.
- `make-admin.sh <username>`: the name is checked against `^[A-Za-z0-9_.@-]{1,50}$` before it goes near SQL; says "no such user", "already an administrator" or "now an administrator", and reminds the user to log in again (the role is in the login token).
- `release.bat`: makes sure Docker runs (`ensure-docker.bat`), finds Git Bash (`BASH_EXE` overrides), maps `/y` to `-y`, runs `deploy/deploy.sh`, and pauses at the end unless `/y`.

**Important change from the plan (a bug found while testing):** `deploy.sh` runs the migration on its own first (`docker compose run --rm --no-deps migrate`) and only then `docker compose up -d --wait`. `up` replaces the app container (new image tag) before it waits for `migrate`, so with `up` alone a failed migration left the old app stopped and a new one stuck in `Created`. Now a failed migration stops the deploy at step 4 with the migration output, exit code 1, and the running app untouched (tested by deleting the `Baseline` row from `__EFMigrationsHistory`, which makes the bundle try to create existing tables). The `migrate` service still runs a second time inside `up` as a dependency; it finds nothing to do.

Checked:
- Guard rails: `-y` without `deploy/.env`, an unknown flag, `make-admin.sh` with no argument, with an injection attempt, and without `deploy/.env` all stop with a clear message and exit code 1 or 2.
- First deployment from nothing, plain HTTP: healthy in 50 s (cached build); no secret appears in the output; the second run said "No database yet", later runs took 40 to 50 s.
- Admin flow: a user who does not exist is refused; after registering and `make-admin.sh`, a new login returns `"userTypeName":"Admin"`, `DELETE /api/book/...` is 404 (allowed) for the admin and 403 for a normal user; a repeat is "already an administrator".
- Backups: a real backup (3.8 MB, verified); pruning with `BACKUP_KEEP=2` left only the two newest; the documented restore removed a user registered after the backup and kept the earlier users and their logins.
- First run in HTTPS mode with `localhost`: bad domains (`http://shop.example.com/`, `SHOP LOCAL`) and bad e-mails were rejected, `LocalHost` was lowercased and accepted, the stack came up with Caddy on 443 (app on `127.0.0.1:8080`, `http://` redirects with 308). Editing `deploy/.env` back to plain HTTP and deploying again **removed the Caddy container** and the site answered on 8080 only.
- Failures: a failed migration (above); a wrong `SA_PASSWORD` (the SQL container's health check keeps failing: after about 2.5 minutes the script prints SQL Server's log and a message pointing at `SA_PASSWORD`, exit 1, no password in the log); restoring the right password and deploying again recovered.
- `scripts\release.bat /y` run from `cmd` (as a double-click would) deployed and exited 0.

Bugs found and fixed while testing (all Windows or Compose behaviour, none of them visible on Linux): Git Bash rewrites Unix-looking paths, so `docker compose` and `git` are now run from inside `deploy/` with relative paths (this had also made the release tag end in `-local`); `shift` in `release.bat` changes `%0`, which broke `%~dp0` (the script folder is now captured first); and the failed-migration behaviour above.

Notes:
1. **The executable bit.** A Windows checkout cannot record it, so before committing the scripts run once: `git add deploy/*.sh && git update-index --chmod=+x deploy/deploy.sh deploy/backup.sh deploy/make-admin.sh`. Without it a Linux clone needs `bash deploy/deploy.sh`. (`lib.sh` is sourced, and `deploy.sh` calls `backup.sh` through `bash`, so only the three entry points matter.)
2. Not tested here: a real Let's Encrypt certificate and a Linux host (everything ran on Windows with Git Bash and Docker Desktop; the scripts use no Windows-only commands, and shellcheck is clean).
3. Rollback in practice: the previous images stay as `bookcart:<tag>`; to go back, deploy the previous code (`git checkout <old commit>`, then `deploy/deploy.sh`) and, if the schema changed, restore the backup taken before that update.

### D4: Make sure the image really is the app (the F6/F7 checks, in Docker)

Run against the stack from D3, in HTTP-only mode:
- `/` and `/login` and `/register` are the prerendered pages (the body contains the "Books", "Login" and "User Registration" headings without JavaScript); `/wishlist` returns the client shell (`index.csr.html`).
- A font file returns 200 (`/media/roboto-latin-400-normal-*.woff2`; take the file name from the CSS) and the page has no failed requests in a browser.
- `node BookCart/ClientApp/verify-static.js` on the files copied out of the container (`docker cp bookcart-app:/app/wwwroot ./x`) is clean.
- The smoke test passes against it: `API=http://localhost:8080 WEB=http://localhost:8080 node scripts/smoke/smoke.js --expect-f1` (it needs `sqlcmd` on the machine to promote its admin; if that is awkward, use `make-admin.sh` with the smoke admin name beforehand).
- Uploaded covers survive `docker compose up -d --build`: upload a cover as admin, redeploy, the cover is still served (volume `uploads`, written by the non-root user).
- Guest cart survives a restart (the Data Protection keys are in the `keys` volume).

#### D4 results (done 2026-10-24: all checks pass, no defect found in the image)

Run against a stack created by `deploy.sh` (plain HTTP, clean database, a fresh `deploy/.env`), under a throwaway project name; the stack, volumes, `.env`, backups and images were removed afterwards.

| Check | Result |
|---|---|
| Prerendered pages | `/`, `/login`, `/register` are served **byte for byte** as `index.html`, `login/index.html`, `register/index.html` from the image; their raw HTML (no JavaScript) holds the headings "Books", "Login" and "User Registration" and a filled `<app-root>`. `/wishlist`, `/checkout`, `/books/details/1` and `/admin/books` are byte for byte `index.csr.html` (an empty `<app-root></app-root>`). |
| `verify-static.js` on `docker cp bookcart-app:/app/wwwroot` | 88 files, every reference resolves, no inline script or handler. |
| Browser page check (new `scripts/smoke/pages.js`) | 9 page types (home, login, register, wishlist and checkout redirecting to login with a `returnUrl`, cart, a book's details, search, an unknown address): no failed request, no console error, **no Content-Security-Policy violation**, Roboto and Material Icons loaded on every page. The CSP header is the report-only one. So enforcing the policy (`Security:EnforceCsp=true`) would not break the site, which settles that open question for the Docker build. |
| Browser smoke test (`scripts/smoke/smoke.js --expect-f1` against `http://localhost:8080`) | **25 of 25 passed** in 38 s: guest cart, search, details, registration, login merging the cart, checkout and My Orders, wishlist, the guards, wrong password, off-site `returnUrl`, session expiry, admin list, hard refresh and edit page. The only console errors are the two expected 401s; no external request. |
| Uploaded covers survive redeploys | A real PNG uploaded as admin was served with the exact bytes uploaded (70 bytes, `image/png`); after `deploy.sh` (new image tag, new containers) and after `down` plus a new deploy it was still served; the file sits in the `uploads` volume owned by `app`; deleting the book returned 204 and the file was gone (404, no copy left in the volume). The default cover (`/Upload/Default_image.jpg`, from the image) is served too. |
| Guest cart survives | A guest's cart (2 copies of a book) was intact after `docker restart bookcart-app` and after a full redeploy; the key file sits in the `keys` volume; a forged `bc_guest` cookie is treated as no guest (an empty cart, HTTP 200). |

Changes made in this phase (small, outside the deployment files):
- `scripts/smoke/smoke.js`: the step that makes the smoke admin an administrator can be replaced with `PROMOTE_ADMIN_CMD` (it defaulted to `sqlcmd` on LocalDB and still does). For Docker: `API=http://localhost:8080 WEB=http://localhost:8080 PROMOTE_ADMIN_CMD="bash <repo>/deploy/make-admin.sh smokeadmin" node smoke.js --expect-f1`. On Windows `cmd`, give the full path of Git's `bash.exe` (a plain `bash` may be WSL's). `docs/FRONTEND_CHANGES.md` describes both scripts.
- `scripts/smoke/pages.js`: new, described above.

Notes:
1. The smoke test and `pages.js` need Chrome and `puppeteer-core` (`npm ci` in `scripts/smoke`). GitHub's `ubuntu-latest` runners have Chrome, so D5 can run both against the stack in CI (about 40 s); set `CHROME_PATH` to `google-chrome` there, because the built-in default is the Windows path.
2. `curl -o /dev/null -w %{size_download}` in Git Bash reports 0 bytes for a real response; compare against a saved file instead (this briefly looked like an empty cover).
3. Nothing in the image needed fixing in this phase.

### D5: CI proof that the stack starts

Replace the "Container image" job with a job like this (it runs on `ubuntu-latest`, which has Docker). This is the sketch **as first planned**; what was built, and how it differs, is in the D5 results:

```yaml
  stack:
    name: Docker stack
    needs: [backend, frontend]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Create a throwaway .env (HTTP-only mode)
        run: |
          cat > deploy/.env <<EOF
          APP_PORT=8080
          SA_PASSWORD=Ci$(openssl rand -hex 8)Az1
          JWT_SECRET=$(openssl rand -base64 48)
          JWT_ISSUER=http://localhost:8080/
          JWT_AUDIENCE=http://localhost:8080/
          COMPOSE_PROFILES=
          APP_BIND=127.0.0.1
          FORWARDED_HEADERS=false
          EOF
      - run: docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build --wait
      - name: Checks
        run: |
          curl -fsS http://localhost:8080/health | grep -q Healthy
          curl -fsS http://localhost:8080/ | grep -q "Books"
          curl -fsS http://localhost:8080/login | grep -q "Login"
          curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:8080/wishlist | grep -q 200
          # a font named by the CSS (this is the check that would have caught the flattened-publish bug)
          font=$(curl -fsS http://localhost:8080/ | grep -o 'styles-[A-Za-z0-9_-]*\.css' | head -1)
          curl -fsS "http://localhost:8080/$font" | grep -o 'media/[^")]*\.woff2' | head -1 | xargs -I{} curl -fsS -o /dev/null http://localhost:8080/{}
      - if: failure()
        run: docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs --no-color --tail 200
      - if: always()
        run: docker compose -f deploy/docker-compose.yml --env-file deploy/.env down -v
```

(The font check is a sketch: refine it while implementing so it fails loudly if the CSS or the font cannot be found.) CI still runs `verify:dist` in the frontend job. Optionally keep `docker save bookcart:... -o bookcart.tar` as an artifact if you want one.

**Check:** the job is green on the branch; temporarily break something (for example flatten `media/` again) and see it go red.

#### D5 results (done 2026-10-25)

Files: `.github/workflows/ci.yml` (the `container` job is replaced by a `stack` job; the `backend` and `frontend` jobs are untouched), `deploy/verify.sh` (new) and `.gitignore` (one line, `deploy/.verify-tmp/`).

What was verified, and what was not:
- `actionlint` (which also runs shellcheck on every `run:` block) passes on the workflow, and `shellcheck -S style` passes on `verify.sh`.
- **The job was simulated locally**: the same commands in the same order, from a state with no `deploy/.env` and no containers, under a throwaway project name. It passed: first deploy, `verify.sh` (all checks), second deploy with a verified 3.6 MB backup, `verify.sh` again, the browser smoke test (**25 of 25**) and the page checks (no failed request, console error or CSP violation, fonts loaded). 3 min 35 s with a warm Docker cache.
- **The checks were shown to fail**: deleting the prerendered `login/index.html` from the running container fails `verify.sh` (`/login is not login/index.html`); additionally deleting the font file named by the CSS fails it on `verify-static` and on the font request (404); stopping the app fails 22 checks. Every one exits 1.
- **Not verified: an actual GitHub Actions run.** That needs a push. Differences from this PC that could matter there: a cold Docker cache (the first build takes several minutes instead of seconds, which is why the job has `timeout-minutes: 30`), the Chrome path (the job finds `google-chrome` with `command -v` and exports `CHROME_PATH`; the scripts' built-in default is the Windows path), and the Compose version on the runner (the scripts use `up --wait`, `--wait-timeout` and `run --no-deps`, all available in any recent Compose v2). If the first run fails, the logs step prints the last 200 lines of every container.

How the job differs from the plan's sketch:
- It uses **`deploy.sh` itself** (`printf '\n' | bash deploy/deploy.sh`: the empty line answers the domain question, so the real first-run path creates `deploy/.env` with generated secrets), instead of writing a throwaway `.env` by hand. So CI exercises what a server runs: the build of both images, the backup step, the standalone migration, `up --wait`.
- It then runs **`deploy.sh -y` a second time**, which is the update path of a server (the database exists: a verified backup is taken, the migration finds nothing to do, the containers are replaced), and asserts that the backup file exists.
- The plan's curl checks became **`deploy/verify.sh`** (new): health and API answers, every page address serving the right file of the build (compared byte for byte with the files copied out of the container), the build's own `verify-static.js` on those files, a font named by the CSS (it fails loudly if no stylesheet or font is found: the "refine it" note in the sketch), the security headers, and that SQL Server has no published port (in HTTPS mode also that the app is bound to 127.0.0.1 and Caddy runs). It changes nothing, takes the base URL as an optional argument and works on a real server too (`deploy/verify.sh https://shop.example.com`), which is why it lives in `deploy/` and not in the workflow.
- The browser checks are included: `smoke.js --expect-f1` and `pages.js` (D4), with the smoke admin promoted by `deploy/make-admin.sh` through `PROMOTE_ADMIN_CMD`.
- The old `docker save`/tar artifact (the `bookcart-image` upload) is gone, as decided. Nothing is pushed anywhere. If you want an image as a build artifact later, add `docker save bookcart:latest -o bookcart.tar` and `upload-artifact` after the deploy step.
- No Docker layer cache is configured (a cache would need `docker/build-push-action` or `buildx bake` with a `gha` cache, which `docker compose build` does not use by default). Add it only if the job's duration becomes a problem.

Notes for D6: the README and `CLAUDE.md` still say CI "builds the image archive"; `docs/FRONTEND_CHANGES.md` follow-up F7-5 ("CI checks the publish layout") is now covered by `verify-static` running on the real container as well as on the build.

### D6: Documentation and tidy-up (both targets)

One documentation phase for the whole deployment story. **The Docker half can be done now**: the README and `CLAUDE.md` still describe the old flow. **The Azure half is finished after A7**, when the runbooks exist. Until then this phase is "partly done".

**Docker half.** What is still stale, checked in the repository on 2026-11-10:
- `README.md`:
  - the scripts-table row for `release.bat` (it says the script publishes binaries to `artifacts/publish`; it is now the wrapper around `deploy/deploy.sh`);
  - the release section that describes `deploy.env` and `dotnet publish -t:PublishContainer` ("no Dockerfile needed");
  - the CI sentence that says the workflow "builds the image archive".

  Replace them with the real flow: the requirements (a Linux server with Docker, a domain pointing at it, ports 80 and 443 open); the commands (clone, `./deploy/deploy.sh`, `./deploy/make-admin.sh <user>`, `./deploy/verify.sh`); update; backup and restore (the comment in `deploy/backup.sh`); rollback as tested in D3 (check out the previous code and run `deploy/deploy.sh`, restore the backup if the schema changed); where the data lives (volumes `sqldata`, `uploads`, `keys`, `caddy_data`); and what to keep a copy of (`deploy/.env`, and `deploy/backups` copied off the host, because the Docker target keeps its backups on the same machine).
- `CLAUDE.md`: the Commands lines that describe `release.bat` as publishing binaries and `-t:PublishContainer` as the way to build the image ("no Dockerfile"), and the CI sentence ("builds the image archive"). Say instead that the image is built from the `Dockerfile` (targets `app` and `migrate`), that `deploy/deploy.sh` is the deploy command, that CI runs the stack job, and that `docker build` runs the NuGet audit.
- **Visual Studio prerequisite**, in both files: they say "Visual Studio 2022 17.13+". The projects target .NET 10, which Visual Studio 2022 could not load for the owner. Say Visual Studio 2026 (or the CLI).
- `BookCart/BookCart.csproj`: `ContainerRepository` and its comment about `-t:PublishContainer` are dead now. Remove them only if the owner agrees (harmless to keep).
- `docs/FRONTEND_CHANGES.md`: one line pointing to this plan, and close follow-up F7-5 ("CI checks the publish layout"): the stack job now runs `verify-static` on the files inside the running container.
- The `Security:EnforceCsp` decision for the Docker target (section 2, item 10): either leave it report-only and say so, or pass the setting through the Compose file and `.env.example`.
- Already done by D2 and D5, so **not** left to do: removing `init-volumes`, the published SQL port, the CI tar step and `artifacts/publish`.
- Update the project notes (the assistant's memory file) with the new flow.

**Azure half: skipped (2026-11-16, Part A rescoped to the free tier; `docs/RUNBOOKS.md` from A7 plus one README line replace it).** As first planned: a "Deploying to Azure" section in the README that links `docs/RUNBOOKS.md`; the Azure facts, settings and commands in `CLAUDE.md`; the two targets compared in one table.

**Check:** a person who has never seen the repo can deploy with Docker from the README alone (try it on a fresh VM or a clean Docker Desktop). After A7, the same for an Azure release, using the runbooks.

#### D6 results (Docker half, done 2026-11-10)

Files: `README.md`, `CLAUDE.md`, `docs/FRONTEND_CHANGES.md`, and the file modes of four scripts. No code, workflow or Compose change.

What changed:
- `README.md`: the Visual Studio prerequisite (2026); the one-click scripts table (the `release.bat` row and its two stale paragraphs replaced); the old "Container" section replaced by **"Deploying with Docker"**: what you need, the three commands (`deploy/deploy.sh` or `scripts\release.bat`, `deploy/make-admin.sh <user>`, `deploy/verify.sh`), update, backup and restore, rollback as tested in D3, where the data lives, keeping a copy of `deploy/.env`, stop, HTTP versus HTTPS, the Content-Security-Policy statement, and a "Running the image yourself" subsection (the two Dockerfile targets, the environment variable table); the CI sentence now describes the stack job; a pointer to Part A for Azure.
- `CLAUDE.md`: the Visual Studio line, the stale `release.bat` and `-t:PublishContainer` lines (replaced by one Docker deployment bullet that names the Dockerfile targets, the scripts, the Compose services, and that `docker build` runs the NuGet audit), a line about `pages.js`, and the CI sentence (the stack job and the three triggers).
- `docs/FRONTEND_CHANGES.md`: follow-up **F7-5 closed**, with a pointer to this plan (D5).

Found while doing it:
- **None of the deploy scripts was executable in git** (all five were mode 100644, on `master` too), so `./deploy/deploy.sh` would have answered "Permission denied" on a Linux clone. Fixed with `git update-index --chmod=+x` on `deploy.sh`, `make-admin.sh`, `verify.sh` and `backup.sh` (`lib.sh` is only sourced). **This is a staged mode change that still has to be committed.** CI never noticed because it calls the scripts with `bash`. The README also tells readers to use `bash deploy/deploy.sh` if they see "Permission denied".
- **The README was damaged before D6**: the development-scripts table had lost its backslashes (`scriptsdev-start-all.bat`) and the `release.bat` row held a stray carriage-return character. The rows were rewritten, and all docs were scanned: no control characters remain in the README, `CLAUDE.md`, `FRONTEND_CHANGES.md`, this plan or the architecture guide.

Decided here:
- `Security:EnforceCsp` for the Docker target: **left report-only and documented** (the README says it is safe to enforce and how). Passing it through the Compose file was left undone here; **done 2026-11-15** (see "D6 follow-up" below).
- `ContainerRepository` and its comment in `BookCart/BookCart.csproj`: **left in place** (harmless; removing it needs the owner's agreement). **Removed 2026-11-15 with the owner's agreement** (see below).

**D6 follow-up (2026-11-15, at the owner's request):**
- `BookCart/BookCart.csproj`: the `ContainerRepository` property and its comment are removed (nothing reads them; the image is built from the `Dockerfile`).
- `deploy/docker-compose.yml`: the app now gets `Security__EnforceCsp: ${ENFORCE_CSP:-false}`; `deploy/.env.example` documents `ENFORCE_CSP` and `deploy/deploy.sh` writes `ENFORCE_CSP=false` into a new `.env`. **Behaviour does not change** (default `false`: report-only); an existing `.env` without the key also stays report-only. The README says how to enforce it.

Checked: every flag and command the README names exists (`deploy.sh -y`, `--pull`, `-h`; `verify.sh [url]`; `backup.sh [name]`), the backup count (7) and the standalone migration are in the scripts, every path it links exists, and the docs hold no stray control characters. **Not done:** the "stranger test" on a fresh VM or a clean Docker Desktop (the README was checked against the code and against D3 to D5, not followed by a person). The Azure half of D6 waits for A7.

### D7 (optional): limited SQL login

The `migrate` service keeps `sa` (it needs DDL rights). The `app` should run as a login that has only `db_datareader` and `db_datawriter` on `BookDB`: after the migrate step, `deploy.sh` runs one idempotent `CREATE LOGIN/USER ... ; ALTER ROLE ...` script with a generated `APP_DB_PASSWORD` in `.env`, and the app's connection string uses it. Do this only if the server is shared or exposed; for a single-purpose host it adds a moving part for little gain. (Part A gets the same least-privilege result by design: the app's identity there has only read and write rights, A3.)


### First deployment, as the owner will experience it

1. A Linux server with Docker, a domain whose DNS points at it, ports 80 and 443 open (plus 22 for you).
2. `git clone <repo> && cd BookCartApp && ./deploy/deploy.sh`, answer the domain and the email.
3. Open `https://<domain>`, register your account, run `./deploy/make-admin.sh <username>`.
4. Later: `git pull && ./deploy/deploy.sh` (it backs up first).


### Risks and limits (Docker)

- **Not tested here:** a real Let's Encrypt issuance (it needs your domain and a reachable server; locally Caddy's own CA proves everything except the certificate authority) and a Linux host (everything ran on Windows with Docker Desktop). The EF bundle and the in-image health check were proven in D0.
- **Let's Encrypt limits and DNS:** the domain must resolve to the server before the first start, or Caddy retries and can hit rate limits; check DNS first.
- **Server size:** SQL Server 2022 wants at least 2 GB of RAM; use 4 GB.
- **Single host:** one server, one database container, backups on the same host. Copy `deploy/backups` somewhere else on a schedule if the data matters: that is a manual step, documented in D6. (The Azure target has off-host backups built in, A7.)
- **The build happens on the server:** the first `deploy.sh` downloads about 1.5 GB of images and builds for several minutes; later runs are faster thanks to the layer cache.
- **Secrets:** `deploy/.env` holds the SQL password and the signing key; it is git-ignored, `chmod 600`, and must be copied by you if the server is rebuilt.

---

## Part A: Azure free tier, released by CI/CD (A0 to A8)

Scope (rescoped 2026-11-16 by the owner): BookCart is a **study project**. Part A must produce a **running application on Azure, at its `azurewebsites.net` address, deployed and released by CI/CD, at zero cost**, while still practising the skills a production release needs: infrastructure as code, passwordless access between GitHub, the app and the database, one tested image that ships, database migrations in the pipeline, an approval before release, an automatic rollback, backups and a runbook. Anything that only pays off with real traffic or a real team is left out, and listed under "Production upgrade path" so you know what it would add.

The earlier full design (Standard S1, staging slot and swap, Azure Container Registry, Key Vault, Azure Files, Application Insights, phases A6, A9, A10) is in this file's git history (commit `21a90d6`). The `infra/` draft of 2026-11-15 was written for that design and is rewritten in A1.

**Phases kept:** A0, A1, A2, A3, A4, A5, and trimmed A7 and A8. **Skipped (owner's decision, 2026-11-16):** A6 (telemetry), A9 (custom domain and hardening: the site stays on `azurewebsites.net`), A10 (scale-out), SBOM and attestations, the registry purge task, and the Azure half of D6 (`docs/RUNBOOKS.md` from A7 is the Azure documentation).

### The zero-cost rule

| Use (free) | Instead of (costs money) |
|---|---|
| **App Service Free F1** (Linux), one web app | Standard S1 with a staging slot |
| **Azure SQL Database free offer** (serverless, with "pause when the free amount is used up") | S0 production + Basic staging |
| **GitHub Container Registry** (`ghcr.io`), public package | Azure Container Registry (no free tier) |
| **App Service app settings** (encrypted at rest), values from GitHub environment secrets | Key Vault references (charged per operation: tiny, but not zero) |
| **The web app's persistent `/home` storage** for covers and keys | Azure Files shares (a storage account) |
| **Log stream and the built-in App Service metrics**; a scheduled GitHub workflow as the uptime check | Application Insights and Log Analytics |
| User-assigned **managed identities**, **GitHub OIDC**, a **Cost Management budget** | (these are free in both designs) |

GitHub side: the repository is public, so Actions minutes, environments with required reviewers and public packages cost nothing.

**The account.** The Azure free account has a spending limit for its first 30 days, so nothing can be charged then. After day 30 it must be upgraded to pay-as-you-go to keep running; the free offers above stay free, but the spending limit is gone, and from then on **the budget alert (USD 1) is the safety net** for a mistake (a paid SKU, a forgotten restore). Upgrading is your decision, taken when the 30 days run out.

**Checked against Microsoft Learn on 2026-11-16** ("Azure subscription and service limits: App Service", "Quickstart: run a custom container" (it selects F1), "Configure a custom container: use persistent shared storage", "Build and test apps with the Azure SQL Database free tier", the free-tier Q&A threads). Still unproven, so A0 checks them: the daily CPU-minute quota of F1, the non-root write to `/home`, and how fast the app's connection pool lets the database pause.

### Free-tier limits that shape the design (A0 confirms them)

| Limit | Consequence for BookCart |
|---|---|
| **F1 runs custom Linux containers** (verified: the limits table lists "Linux code-only and containers" for Free, and Microsoft's container quickstart picks F1) | The design works as planned. |
| **F1 limits** (verified): 1,024 MB memory per plan, **165 MB bandwidth** (outbound data quota), shared compute, no SLA, no managed certificates, no slots, one instance, no Always On. **Not in the excerpts read:** the daily CPU-minute quota (about 60 minutes is the commonly quoted figure) | The site sleeps when idle and the first request starts the container again (measured in A0). A release restarts the app: a short outage, accepted. The bandwidth quota is the tightest limit: the site's first page load is about 1 MB of scripts and styles, so on the order of 150 uncached visits use it up (A0 checks whether it is per day). When a quota is used up, the site is stopped until it resets. |
| **SQL free tier** (verified): 100,000 vCore-seconds of serverless General Purpose compute per month for the life of the subscription; no SLA ("development and proof-of-concept"); **auto-pauses after 15 minutes without activity, fixed**; exhaustion behaviour **auto-pause until next month** (no charge) or bill the overage, and **bill cannot be switched back** to auto-pause; the free tier applies only to a **new** database, **a backup cannot be restored into a free database**; with advanced configuration the first free database's region applies to all free databases of the subscription | **Anything that keeps a connection open or queries on a timer keeps the database awake and burns the monthly amount**: Microsoft's Q&A threads show users who used it all in two days with an idle app. So: the App Service Health check feature (a request every minute; `/health` queries the database) is **off**; the uptime check requests `/` (no database) a few times a day; query tools are closed after use; A0 watches the **"Free amount remaining"** metric. An awake hour at the minimum 0.5 vCore costs about 1,800 vCore-seconds, so roughly 50 awake hours a month (an estimate). Choose **auto-pause** at creation: the other choice is permanent. |
| **`/home` is persistent** when `WEBSITES_ENABLE_APP_SERVICE_STORAGE=true` (verified; Microsoft's pages disagree on the default for Linux containers, so the setting is always set explicitly). Data in `/home` counts against the plan's storage quota | Covers go to `/home/data/uploads`, the Data Protection keys to `/home/data/keys` (the existing settings `Storage:UploadFolder` and `Security:DataProtectionKeysPath`, no code change). A0 checks that the image's non-root user (uid 1654) can write there. |
| **A public `ghcr.io` package** can be pulled by anyone | Fine: the image holds no secret (everything secret comes from settings). The web app pulls it without credentials. |

### Target architecture (free)

```
 GitHub (public repository)                     Azure: one resource group, Central India
 ──────────────────────────                     ────────────────────────────────────────
 push to master
   │
   ▼
 CI: backend, frontend, stack job (builds the image and tests it end to end in Docker)
   │ green
   ▼
 push the tested images to ghcr.io  ── tag = git SHA, deployed by digest
   │
   ▼
 release: wait for YOUR approval (environment "production")
   │ approved
   ▼
 migrate the database  ───────────────────────▶  Azure SQL free database (Entra-only, auto-pause)
 point the web app at the new digest ────────▶  App Service F1 (Linux), one web app
 check it (health, verify.sh, pages.js)          user-assigned identity ──▶ database user
 failed? point it back at the previous digest    covers + keys in /home (persistent)
                                                 settings: JWT key etc. (encrypted at rest)
 every 6 hours: request "/" (uptime)             budget alert at USD 1 ──▶ your e-mail
```

### Release management (free version)

| Topic | Rule |
|---|---|
| Branching | Trunk-based: pull requests into `master`, required checks (backend, frontend, stack). |
| What ships | The image the CI `stack` job built and tested, by **digest** (A4). Nothing is rebuilt for a release. |
| Pre-production test | **The CI `stack` job is the staging environment**: it deploys the exact image with a real SQL Server and runs `verify.sh`, `smoke.js` and `pages.js` against it (D5). There is no Azure staging (no slots on F1). |
| Approval | The release job runs in the GitHub environment `production`, which has you as required reviewer. |
| Release | Migrate, switch the image, check. A short restart outage is accepted (no swap on F1). |
| Rollback | Automatic if the post-release checks fail (back to the previous digest); by hand with `rollback.yml` for any earlier SHA. |
| **Database changes** | A rollback runs old code on a migrated database, so every migration stays **backward compatible** (expand first, remove in a later release). The CI stack job runs every migration before release. |
| Infrastructure changes | Through `infra/` and the infra workflow, never by hand in the portal (after A0). |
| Secrets | GitHub environment secrets, passed to Bicep as secure parameters, stored as app settings. Rotating the JWT key: change the secret, run the infra workflow (everybody is signed out). |

### A0: The first deployment by hand (learn each piece, prove the free assumptions)

Because everything is free, there is **no throwaway spike**: you build the real environment once by hand with the Azure CLI, which is the best way to learn what each piece does. A1 then deletes it and recreates it from Bicep, which proves the infrastructure code. The commands are in `docs/AZURE_SIGNUP_AND_A0_RUNBOOK.md` (rewritten for this design together with A1).

1. **F1 takes a container:** an F1 Linux plan in Central India runs the BookCart image (fallback region South India).
2. **The image from `ghcr.io`:** push it once from your PC, make the package public, and point the web app at it.
3. **`/home` is writable by uid 1654:** upload a cover as an admin, restart the app, the cover and a guest cart from before the restart are still there.
4. **Free SQL with no password:** create the free-offer database (exhaustion behaviour "auto-pause") with Entra-only authentication; the app's user-assigned identity connects with `Authentication=Active Directory Managed Identity`; record whether `CREATE USER ... FROM EXTERNAL PROVIDER` works or `WITH OBJECT_ID` is needed.
5. **Migrations from outside:** run the migration bundle (copied out of the `migrate` image) from your PC with your own Entra login, through a temporary firewall rule for your address.
6. **Behind the platform's proxy:** no redirect loop (`ASPNETCORE_FORWARDEDHEADERS_ENABLED=true`), the guest cookie is `Secure`.
7. **Cold start:** time the first request after the app has slept and the database has paused; it must succeed (EF Core retries) or fail clearly. Record the numbers.
8. **Quotas and cost:** after a day of light use, the CPU minutes and bandwidth used (the plan's Quotas page, and whether they reset daily) and the database's **"Free amount remaining"** metric; check that the database pauses about 15 minutes after the last request (the connection pool must let go); *Cost analysis* shows 0.00.
9. **Region:** both free offers are available in Central India.

**Check:** each item has a recorded yes or no and the exact command or setting that worked.

### A1: Infrastructure as code (Bicep, free resources only)

`infra/main.bicep` (one resource group) creates:

1. **App identity:** a user-assigned managed identity (the database user is created for it in A3).
2. **App Service:** a Free F1 Linux plan; the web app with the container image (a parameter), `httpsOnly`, minimum TLS 1.2, FTPS off, basic publishing credentials off (FTP and SCM), `clientAffinityEnabled: false`; no Always On and no health check path (see the limits table).
3. **Azure SQL:** a logical server with **Entra-only authentication**, the **pipeline identity** as its Entra administrator, TLS 1.2, the "Allow Azure services" firewall rule (private networking is out of scope, section 6; Entra-only authentication is what keeps everyone else out); the database `BookDB` on the **free offer** with exhaustion behaviour **auto-pause**.
4. **Budget:** USD 1 per month on the resource group, e-mail at 50 % and 100 % of actual and forecast cost.

App settings (all set by Bicep, so a re-run never loses one):

| Setting | Value |
|---|---|
| `WEBSITES_PORT` | `8080` |
| `WEBSITES_ENABLE_APP_SERVICE_STORAGE` | `true` (persistent `/home`) |
| `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | `true` |
| `ConnectionStrings__DefaultConnection` | `Server=tcp:<server>.database.windows.net,1433;Initial Catalog=BookDB;Encrypt=True;Authentication=Active Directory Managed Identity;User Id=<app identity client id>` |
| `Jwt__SecretKey` | a **secure parameter**, from the GitHub environment secret `JWT_SECRET` (never in the repository, a parameter file or an output) |
| `Jwt__Issuer`, `Jwt__Audience` | `https://<the app's host name>/` |
| `Gemini__ApiKey` | only if the optional secret `GEMINI_API_KEY` exists (else the summary endpoint answers 503) |
| `Storage__UploadFolder`, `Security__DataProtectionKeysPath` | `/home/data/uploads`, `/home/data/keys` |
| `Security__EnforceCsp` | `true` (D4 found no violations; one setting to change if something breaks) |

The image is a parameter. The infra workflow (A2) reads the image the app currently runs and passes it, so an infrastructure run never rolls the app back.

**Check:** `what-if` is clean; a deployment into an empty resource group succeeds and the site works after A3 and A5; a second run changes nothing; no secret is in the repository or an output; *Cost analysis* still shows 0.00.

### A2: Trust between GitHub and Azure

1. **Bootstrap (once, by you):** `infra/bootstrap.sh` creates the resource group, the **pipeline identity** (a user-assigned managed identity), its federated credential for `repo:<owner>/BookCartApp:environment:production`, and **Contributor** on the resource group (nothing more is needed: the free design has no Azure role assignments of its own).
2. **GitHub:** the environment `production` with **you as required reviewer**, deployments only from `master`; environment secrets `JWT_SECRET` (and optionally `GEMINI_API_KEY`); variables for the client, tenant and subscription ids and the resource group (identifiers, not secrets); branch protection on `master` with the three checks.
3. **`infra.yml`** (manual): `what-if`, then, in the `production` environment (so after your approval), the deployment.

**Check:** a workflow run logs in with OIDC and lists the resource group; a run outside the `production` environment cannot log in; the deployment job waits for approval.

### A3: Database access and migrations

1. **App user:** `deploy/azure/grant-app-access.sh` (idempotent, run by the pipeline as the server's Entra administrator) creates the database user for the app identity with `db_datareader` and `db_datawriter` only.
2. **Migration step:** the pipeline copies the self-contained migration bundle **out of the tested `migrate` image** (`docker create` + `docker cp`) and runs it on the runner with `Authentication=Active Directory Default` (the runner's `az login` as the pipeline identity), through a **temporary firewall rule** for the runner's address that is always removed afterwards. The app identity never has schema rights.
3. **First admin:** `deploy/azure/make-admin.sh <username>` runs the same validated update as `deploy/make-admin.sh`, through `sqlcmd` with Entra authentication; `make-admin.yml` runs it behind the `production` approval.

**Check:** the app identity cannot create a table (a deliberate failing test); a migration run leaves no firewall rule behind, even when it fails; `make-admin` promotes a registered user and refuses a bad name.

### A4: One image, built once, tested, then published

On `master`, after its checks pass, the CI **`stack` job** pushes **the very images it tested** (`bookcart` and `bookcart-migrate`) to `ghcr.io/<owner>/...`, tagged with the git SHA (with `permissions: packages: write`), outputs their **digests**, and calls `release.yml` with them. One vulnerability scan step (Trivy, free) fails the job on critical findings that have a fix. Pull requests build and test but never push.

**Check:** the SHA tag exists on `ghcr.io`; the pushed digest is the one the stack job ran; a pull-request run pushes nothing.

### A5: The release and the rollback

```
 release.yml  (reusable; ci.yml calls it on master with the two digests)
 └─ release      environment: production   ◀── waits for your approval
      1  note the digest the app runs now               (the rollback target)
      2  migrate BookDB                                 (A3: temporary firewall rule, always removed)
      3  point the web app at ghcr.io/...bookcart@<digest>
      4  wait for /health = Healthy                     (retries for a few minutes: cold container, paused database)
      5  deploy/verify.sh <url>  +  scripts/smoke/pages.js   (read-only: production is not written to)
      6  FAILED?  point the app back at the digest from step 1, check again, fail the run loudly
      7  summary: SHA, digest, who approved, check results
 rollback.yml  (manual): deploy a chosen earlier SHA through steps 3 to 7
```

Work needed: a URL-only mode for `deploy/verify.sh` (it also uses `docker` today); `concurrency` so only one release runs at a time.

**Check:** a merge goes through approval to a running site; a deliberately failing post-release check brings the previous version back by itself; `rollback.yml` restores an earlier SHA; the summary names the SHA and the approver.

### A7 (trimmed): backups and the runbook

1. **Database:** the free database's automatic backups (point-in-time restore; A0 reads the retention in the portal). **A backup cannot be restored into a free database (Microsoft: the free tier applies only to a new database), so any restore creates a paid one.** The drill is a **BACPAC export to your PC** with `sqlpackage` (free) and an import into LocalDB, done once; repeat it before risky migrations. That export is also the off-Azure copy.
2. **Covers in `/home`:** download them through the app's Kudu file API with your Entra login (`az rest`; basic publishing credentials are off), or accept losing demo covers. A0 or A7 checks that the download works.
3. **`docs/RUNBOOKS.md`**, short: release and approve, roll back, restore from a BACPAC, promote the first admin, rotate the JWT key, "quota exceeded" (F1 CPU minutes), "database paused until next month" (free amount used), and how to check the cost. One line in `README.md` points to it.

**Check:** the BACPAC round trip was done once and timed; the runbook's rollback was followed once from the text alone.

### A8 (trimmed): monitoring and alerts

1. **Cost:** the USD 1 budget alert (A1).
2. **Uptime:** `uptime.yml`, a scheduled workflow every 6 hours that requests `/` (never `/health`, which would wake the database) and fails when the site does not answer; GitHub e-mails you about the failed run.
3. **Logs and metrics:** the log stream (`az webapp log tail`) and the web app's built-in metrics (requests, HTTP 5xx, CPU time) in the portal. No Log Analytics.

**Check:** stop the app, the next scheduled run fails and the e-mail arrives; start it again.

### Production upgrade path (what a paid production setup would add)

| Free (this plan) | Production | What it buys |
|---|---|---|
| F1, one instance, restart on release | S1 or P0v3, a staging slot, warm swap, two instances | no downtime on release, a real pre-production check on Azure, no cold start, an SLA |
| `ghcr.io` public image | Azure Container Registry, pulled with the app's identity | a private image, scanning in Azure |
| App settings from GitHub secrets | Key Vault references | central rotation, an audit log of secret reads |
| `/home` storage | Azure Files with snapshots, or Blob storage | backups of uploads, sharing between instances |
| SQL free offer | S0 or higher, 14 to 35 days point-in-time, long-term retention, geo-redundant backups | an SLA, no pausing, real recovery objectives |
| Log stream, a 6-hourly ping | Application Insights, Log Analytics, alert rules, availability tests (the skipped A6 and A8 items) | traces, error rates, alerts within minutes |
| `azurewebsites.net` | a custom domain with a managed certificate, a security review (A9) | your own address |

### Costs

**Zero by design.** The only ways to be charged are mistakes: a paid SKU, a restore into a paid database, a resource created outside the plan, or the free database set to "continue and bill" instead of "auto-pause". The budget alert reports any charge above USD 1, and *Cost analysis* is checked at the end of A0, A1 and A5.

### Risks and limits (Azure free tier)

- **The free quotas are small:** 165 MB of bandwidth and the CPU-minute quota on F1, 100,000 vCore-seconds on the database. A demo fits; a link shared widely does not. When a quota is used up the site or the database stops until it resets; nothing is charged.
- **Cold starts and the daily CPU quota** make the site slow after a quiet spell and unavailable for the rest of the day if the quota is exhausted. Acceptable for a demo; it is what the free tier is.
- **The free database pauses** when idle and **stops until next month** when its free amount is used up. Nothing may query it on a timer.
- **A release restarts the app** (a short outage); there is no Azure staging, so the CI stack job is the only pre-production test.
- **After the 30-day trial** the subscription must be upgraded to pay-as-you-go to keep running; from then on only the budget alert protects against a mistake.
- **No SLA** for anything in this design.
- **Database changes must be backward compatible**, or a rollback is not safe.

---

## 6. Not in this plan

Kubernetes; multi-region or zone-redundant hosting; a CDN or WAF (Azure Front Door); a shared cache; autoscaling; private networking (virtual network, private endpoints) and self-hosted runners; e-mail sending; a seeded admin account (the first admin is promoted by a command in both targets); changing the application's features.

Skipped from Part A on 2026-11-16 (a free study deployment does not need them; the "Production upgrade path" table in Part A says what each would add): an Azure staging slot and swap, Azure Container Registry, Key Vault, Azure Files, Application Insights and Log Analytics (A6 telemetry), a custom domain and the hardening review (A9), scale-out (A10), SBOM and provenance attestations, the registry purge task, the Azure half of D6.

Specific to Part D: a container registry (the server builds from source: that is the decision for the Docker target), managed cloud services, and automatic off-host backups (copying `deploy/backups` off the host is manual, D6).

## 7. Order and effort

**Done:** D0 to D5 and the Docker half of D6 (about two and a half working days), and the D6 follow-up of 2026-11-15 (`ContainerRepository` removed, `ENFORCE_CSP` passed through Compose).

**Next, in this order** (estimates, not measurements):

1. Rewrite the A1 Bicep draft and the A0 runbook for the free design (offline, about half a day), then compile the Bicep (needs the Bicep CLI installed).
2. Sign up for Azure (the 30-day clock starts here), then **A0** by hand (about 1 day).
3. **A1** (about 1 day), **A2** (1), **A3** (1), **A4** (0.5), **A5** (1.5).
4. **A7** and **A8**, trimmed (about half a day each).

That is about **7 working days** for a running, CI/CD-released application on Azure at zero cost. D7 only on request. Each phase is one commit or pull request, reviewed and stopped at; any phase can be reverted on its own.
