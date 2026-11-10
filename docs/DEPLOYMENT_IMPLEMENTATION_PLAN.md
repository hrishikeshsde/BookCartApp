# Deployment Implementation Plan: Docker server and Azure production release

Scope: how BookCart is deployed. **One application image, two deployment targets.**

- **Part D: a Docker server.** One host with Docker runs SQL Server, the app and Caddy (HTTPS), and one command deploys and updates it. Phases **D0 to D7**. **D0 to D5 are done and committed.**
- **Part A: Azure App Service for Containers, released by CI/CD.** A container registry, a staging slot, an approval before production, a managed database, a key vault, monitoring with alerts, and backups that live off the host. Phases **A0 to A10**. **A plan only: nothing in it is started.**

This document merges two earlier ones: the Docker plan (written first, and mostly implemented) and a separate Azure plan. Section 4 lists the conflicts found between them and how each was resolved. Each phase ends with a check you can run. A finished phase keeps its results ("D3 results") directly under its plan text, as the record of what was built and where it differed from the plan, so this file can be picked up without the conversations that produced it.

## 1. Status

| Phase | What | Status |
|---|---|---|
| D0 | Spike: the EF migrations bundle, the in-image health check, Docker on the dev PC | **Done** 2026-10-24 |
| D1 | `Dockerfile`, `.dockerignore`, the `SkipClientBuild` switch | **Done** 2026-10-24 |
| D2 | Compose file (SQL Server, migrate, app, Caddy) | **Done** 2026-10-24 |
| D3 | `deploy.sh`, `backup.sh`, `make-admin.sh`, the `release.bat` wrapper | **Done** 2026-10-24 |
| D4 | The image really is the app (pages, fonts, uploads, guest cart, browser checks) | **Done** 2026-10-24 |
| D5 | A CI job that deploys the stack and checks it | **Done** 2026-10-25 (committed; its first run on GitHub is still to be confirmed) |
| D6 | Documentation and tidy-up, **both targets** | Not started. The Docker half can start now; the Azure half is finished after A7 |
| D7 | Optional: a limited SQL login for the Docker target | Not started, optional |
| A0 to A10 | Azure: spike, Bicep, GitHub trust, database access, image publishing, release pipeline, app changes, backups and runbooks, monitoring, domain and hardening, optional scale-out | Not started |

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
| Azure host | **App Service for Containers** (Linux). | A |
| Release flow | **Staging slot, automatic tests, manual approval, swap into production.** Swapping back is the rollback. | A |
| Instances | **One instance now, ready to scale later.** | A |
| Infrastructure as code | **Bicep**, in the repository. | A |
| This document | One file, `DEPLOYMENT_IMPLEMENTATION_PLAN.md`. Phase labels D0 to D7 and A0 to A10. Finished Docker results stay inline under their phases. The leftover Docker work (D6, optional D7) is folded in. | both |

Assumptions made without asking (change them if wrong): CI/CD is **GitHub Actions** (the repo already uses it); the registry is **Azure Container Registry**; the database is **Azure SQL Database** (the app already speaks SQL Server); secrets live in **Azure Key Vault**; monitoring is **Application Insights on a Log Analytics workspace**; GitHub authenticates to Azure with **OpenID Connect** (no stored passwords).

### Settled while building Part D (these were open in the Docker plan)

1. `scripts/release.bat`: kept as a thin Windows wrapper around `deploy/deploy.sh` (D3).
2. CI: the tar-only "Container image" job was replaced by the stack job (D5).
3. Backups kept: the newest 7 (`BACKUP_KEEP`, D3).
4. SQL login for the Docker target: still `sa`; a limited login is the optional D7.

### Still open (defaults in bold; none of them blocks A0)

1. **Region:** **the Azure region closest to your customers** (for customers in India, Central India or South India). It also decides which App Service tiers are offered; A0 checks the chosen SKU is available there.
2. **App Service tier:** **Standard S1 (Linux)**. Slots need Standard or higher; Basic cannot do the approved-swap flow. Premium v3 (P0v3 and up) if you later need more memory or zone redundancy.
3. **Production database tier:** **Standard S0**, scaled up when needed. **Staging database: Basic.** (The free tier is for development only: no SLA, and it auto-pauses, which makes test runs flaky.)
4. **Database backups:** point-in-time restore kept **14 days** (7 is the default, up to 35), backup storage **geo-redundant**, long-term retention **weekly for 4 weeks, monthly for 12 months**.
5. **Database login:** **Microsoft Entra only (no SQL password anywhere)**. The app uses a managed identity. Fallback if the tenant blocks it: SQL authentication with the password in Key Vault.
6. **Who approves a production release:** **you** (a required reviewer on the GitHub `production` environment). Add people later.
7. **Domain:** **a custom domain with an App Service managed certificate** (free). Until then the `azurewebsites.net` address works.
8. **Alert recipient and monthly budget:** **your e-mail**; a budget alert at an amount you choose.
9. **Scale-out phase (A10):** **later, only when you need a second instance.**
10. **`Security:EnforceCsp`:** the policy is report-only today. D4 showed the built site produces no violations, so enforcing it is safe. Default: **enforce it in Azure staging first (A1), decide for Azure production in A9, and for the Docker target in D6** (the Compose file does not pass the setting through yet; that is one line).

## 3. One image, two targets

The **same image** (`Dockerfile`, targets `app` and `migrate`) runs in both parts. What differs is configuration only:

| Setting | Docker (Part D) | Azure (Part A) |
|---|---|---|
| Database | SQL Server container, `sa` login | Azure SQL, managed identity, no password |
| Uploads and keys | Docker volumes at `/data/uploads`, `/data/keys` | Azure Files shares mounted at the same paths |
| TLS | Caddy | App Service, managed certificate |
| `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | `true` only behind Caddy | `true` |
| Secrets | `deploy/.env` (mode 600) | Key Vault references |
| Logs | Console, `docker logs` | Console plus OpenTelemetry to Application Insights (only when its connection string is set) |
| Image | Built on the server by `deploy/deploy.sh` | Built once in CI, tested, pushed to the registry, deployed by digest |
| Releases | `git pull && deploy/deploy.sh` | CI/CD: staging slot, approval, swap |

**Compatibility rule for every phase:** no code path may depend on Azure unless a setting turns it on. The CI `stack` job (the Docker target) stays a required check, and it is the proof that the single-container model still works.

Shared building blocks (built once in Part D, reused by Part A):

| Building block | Part D | Part A |
|---|---|---|
| `Dockerfile` (targets `app`, `migrate`) | built on the server (D1) | built once in CI, pushed to the registry (A4) |
| The migration bundle (`migrate` image) | a Compose service and a standalone step (D2, D3) | a pipeline step against Azure SQL (A3) |
| `deploy/verify.sh` | server self-check and CI (D5) | checks staging and production by URL (A5) |
| `scripts/smoke/smoke.js`, `pages.js` | D4 and D5 | staging, before the approval (A5) |
| `/health` | the image's `HEALTHCHECK` | App Service health check and swap warm-up (A1, A5) |

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

## 5. Files this plan creates or changes

| File | Part | Action | Status |
|---|---|---|---|
| `Dockerfile`, `.dockerignore` | D | new: node stage, build stage, `migrate` and `app` targets | done (D1) |
| `BookCart/BookCart.csproj` | D | `SkipClientBuild` switch on the two publish-time npm lines | done (D1) |
| `BookCart/BookCart.csproj` | D | remove `ContainerRepository` and its comment | D6, only if the owner agrees |
| `.gitattributes` | D | `*.sh` and the Docker files at LF, `*.bat` at CRLF | done (D3) |
| `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/.env.example` | D | the stack: SQL Server, migrate, app, optional Caddy | done (D2) |
| `deploy/deploy.sh`, `backup.sh`, `make-admin.sh`, `lib.sh` | D | the one command, backups, the first admin, shared helpers | done (D3) |
| `scripts/release.bat` | D | a wrapper around `deploy/deploy.sh` for Windows | done (D3) |
| `scripts/smoke/smoke.js` (`PROMOTE_ADMIN_CMD`), `scripts/smoke/pages.js` | D | browser checks usable against any deployment | done (D4) |
| `deploy/verify.sh`, `.gitignore` (`deploy/.verify-tmp/`) | D | the post-deployment self-check | done (D5) |
| `.github/workflows/ci.yml` | D | the stack job replaced the tar job | done (D5) |
| `README.md`, `CLAUDE.md`, `docs/FRONTEND_CHANGES.md` | D | describe the real flow; close F7-5 | D6 |
| `infra/main.bicep`, `infra/modules/*.bicep`, `infra/parameters/*.bicepparam` | A | the whole Azure environment | A1 |
| `infra/bootstrap.sh` (or `.ps1`) | A | the one-time resource group, deployment identity and trust in GitHub | A2 |
| `.github/workflows/infra.yml` | A | what-if on pull requests, deploy on demand | A2 |
| `.github/workflows/ci.yml` | A | the stack job scans and pushes the image it tested on `master` and calls `release.yml` | A4 |
| `.github/workflows/release.yml` | A | reusable: staging, approval, production, summary | A5 |
| `.github/workflows/rollback.yml`, `make-admin.yml` | A | manual: roll back or redeploy a SHA; promote the first admin behind the approval | A5, A3 |
| `deploy/azure/*.sh` | A | database user setup, migration step, `make-admin`, swap and rollback helpers | A3, A5 |
| `deploy/verify.sh` | A | a mode that checks only a URL (no `docker` commands) | A5 |
| `BookCart/Extensions/*.cs`, `BookCart.csproj`, `Directory.Packages.props` | A | optional telemetry, off unless configured | A6 |
| `docs/RUNBOOKS.md`; the Azure half of `README.md` and `CLAUDE.md` | A | deploy, roll back, restore, rotate secrets | A7, D6 |

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

**Azure half (after A7):** a "Deploying to Azure" section in the README that links `docs/RUNBOOKS.md`; the Azure facts, settings and commands in `CLAUDE.md`; the two targets compared in one table.

**Check:** a person who has never seen the repo can deploy with Docker from the README alone (try it on a fresh VM or a clean Docker Desktop). After A7, the same for an Azure release, using the runbooks.

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

## Part A: Azure App Service with CI/CD (A0 to A10)

Scope: hosting BookCart on Azure the way a production application is hosted: a container registry, automatic deployment from CI with a staging slot and an approval before production, a managed database, secrets in a vault, monitoring with alerts, and backups that live off the host. **This part is a plan. Nothing in it is implemented.** It reuses what Part D built: the same image and the migrate image (D1), the stack job (D5), `deploy/verify.sh` (D5) and the browser checks (D4).

### Starting point (verified 2026-11-10)

- One image (`Dockerfile`, targets `app` and `migrate`), built from source, non-root user (uid 1654), health check on `/health`, listens on port 8080.
- CI (`.github/workflows/ci.yml`): backend, frontend, and a `stack` job that deploys the real stack with Compose, verifies it and runs the browser checks. **There is no deploy workflow, no registry, no `infra/` folder.**
- State kept inside one instance: uploaded covers (a folder, `Storage:UploadFolder`), the keys that encrypt the guest cookie (a folder, `Security:DataProtectionKeysPath`), the catalogue output cache, the rate limiters and the AI-summary cache (all in memory).
- Logging is console only; there are no telemetry packages.
- Secrets are read from configuration (`Jwt:SecretKey`, `ConnectionStrings:DefaultConnection`, `Gemini:ApiKey`), so environment variables and Key Vault references work without code changes. `Azure.Identity` is already in the dependency graph (through `Microsoft.Data.SqlClient`).


### What Microsoft's documentation says that shapes Part A (checked 2026-11-10)

| Fact | Consequence |
|---|---|
| Deployment slots exist in **Standard, Premium and Isolated** tiers (Standard: 5 slots), at no extra charge. A swap warms the instances first, so there is no downtime, and swapping again is a rollback. | S1 is the minimum tier. Production is never deployed to directly. |
| For containers: tag the image with the commit id, never `latest`; push it to the registry; point the **staging slot** at the tag; swap. | Image tag = git SHA. The pipeline updates the slot's image, not production's. |
| TLS ends at App Service's front ends; the container receives plain HTTP. Custom containers must say which port to forward to (`WEBSITES_PORT`); only one port is supported. **`UseHttpsRedirection`/`UseHsts` loop forever behind it unless `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true`** (this flag trusts every proxy, which is fine because the app is only reachable through the platform). | The app sets `WEBSITES_PORT=8080` and `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true`. The Docker setup already supports this setting. |
| App Service can pull from Azure Container Registry with a **managed identity** (role `AcrPull`, setting `acrUseManagedIdentityCreds`; the registry must accept ARM-audience tokens). | No registry password anywhere. |
| **Azure Files** can be mounted into a Linux custom container (up to 5 mounts, SMB or NFS). All instances share the mount. The storage account **key** is the only supported authentication (not Entra). The mount directory must be empty and cannot be `/`, `/home` or under `/tmp`. Adding or changing a mount restarts the app. **Mounts are not covered by App Service backups.** Mounts can be marked slot-specific. | Covers and keys go on Azure Files mounts at `/data/uploads` and `/data/keys` (the existing settings, no code change). The share needs its own backup. Because all instances share it, this also keeps covers and keys correct when a second instance is added later. |
| **Azure SQL Database** supports passwordless connections: `Authentication="Active Directory Default"` (or a user-assigned identity with `User Id=<client-id>`) through `Microsoft.Data.SqlClient`; the database user is created with `CREATE USER [name] FROM EXTERNAL PROVIDER` and roles. Microsoft warns that one all-powerful identity is not production practice: use separate identities per task. | The app identity gets `db_datareader` and `db_datawriter` only. A separate identity (the pipeline's) applies migrations. |
| Azure SQL Database automatically takes full, differential and log backups: restore to any point in time within **7 days by default (1 to 35, Basic: 1 to 7)**; long-term retention up to 10 years; geo-restore needs geo-redundant backup storage. The **free tier has no SLA, is for development, and cannot hold an existing database**. | "Off-host backups" are built in and live in separate Azure storage. Production uses a paid tier. |
| **Health check** pings a path each minute. With **one** instance it never removes the instance from the load balancer (that would be an outage), but it replaces it after an hour of failures; it does not follow redirects; its configuration is **not slot-specific** (it moves with a swap). | The path is `/health`, identical in both slots. It is monitoring plus self-healing, not high availability, until there are two instances. |
| **Key Vault references** in app settings use the app's identity (role `Key Vault Secrets User`); a user-assigned identity needs `keyVaultReferenceIdentity`. | Secrets are references, never values. |
| GitHub Actions authenticates with **OpenID Connect** (`azure/login@v2`): a federated credential on a Microsoft Entra app **or a user-assigned managed identity**. Environment secrets are not released until the environment's reviewers approve. | No client secrets in GitHub. The `production` environment's approval is the release gate. |
| Application Insights for ASP.NET Core uses OpenTelemetry (`UseAzureMonitor()` with `APPLICATIONINSIGHTS_CONNECTION_STRING`); Microsoft's current guidance for a **new** app is its Microsoft OpenTelemetry Distro (`Microsoft.OpenTelemetry`); never both. | Telemetry is enabled only when the connection string is set, so the plain Docker setup is unchanged. The distro is chosen in A6. |

Sources: Microsoft Learn, App Service "Set up staging environments", "Deployment best practices", "Configure a custom container (Linux)", "Mount Azure Storage as a local share", "Monitor instances by using Health check", "Key Vault references", "Deploy a custom container with GitHub Actions"; Azure SQL "Automated backups", "Free tier", "Passwordless connections"; ASP.NET Core "Proxy servers and load balancers"; Azure Monitor "OpenTelemetry".

**Not yet verified, so A0 proves them on a throwaway resource group** (a wrong guess here would cost days later): the exact list is in A0.


### Target architecture (Azure)

```
 GitHub                                   Azure (one resource group per environment)
 ──────                                   ───────────────────────────────────────────
 push to master                                  Users ──▶ custom domain + free managed certificate
   │                                                │  (TLS ends at App Service)
   ▼                                                ▼
 CI: backend, frontend, stack job (builds + tests the image)
   │ green                          ┌──────── App Service plan S1 (Linux) ────────┐
   ▼                                │  production slot ◀── swap ──▶ staging slot │
 push the tested image──push──▶ ACR │  one instance, Always On, health check /health
   tag = git SHA   (scan first)     │  user-assigned managed identity on both slots
   │                                └─────┬─────────────┬────────────┬────────────┘
   ▼                                      │             │            │
 deploy to STAGING slot                   ▼             ▼            ▼
 migrate STAGING database          Azure SQL DB    Azure Files    Key Vault
 verify.sh + smoke + pages         BookDB (prod)   uploads, keys  JWT key, Gemini key
   │ green                         BookDB_Staging  (+ staging share)
   ▼                                      │
 wait for approval (GitHub environment)   └── automatic backups (point-in-time, long-term, geo-redundant)
   ▼
 migrate PRODUCTION database
 swap staging ⇄ production            Application Insights + Log Analytics: logs, metrics, traces
 post-swap checks (read-only)         Alerts ▶ e-mail          Budget alert
 failed? swap back
```


### Release management

| Topic | Rule |
|---|---|
| Branching | Trunk-based: short-lived branches, pull requests into `master`, required checks (backend, frontend, stack). No direct pushes. |
| Versions | The image tag is the git SHA (traceable). A release is marked with a git tag `vMAJOR.MINOR.PATCH` and a GitHub Release with notes; the deployment records SHA and tag. |
| Promotion | Merge to `master` goes to **staging** automatically. **Production** needs the approval on the `production` environment, so only an image that passed staging can be released, and it is the *same image digest* that the stack job tested (A4). |
| One at a time | A concurrency group stops two releases running at once; a newer merge waits or replaces a pending staging deploy. |
| Rollback | Swap the slots back (the previous image is still in the other slot) and re-run the checks. A manual workflow redeploys any earlier SHA. |
| **Database changes** | Staging and production run different code against a database for a short time, and a rollback runs old code on a migrated database. So every migration must be **backward compatible** (expand, then contract in a later release): add columns and tables first, remove or rename in a later release once nothing uses them. The migration is rehearsed on the staging database before it touches production. A release that cannot follow this rule is released in a maintenance window, by hand. |
| Hotfix | The same pipeline; branch from `master`, fast review, approval. No shortcut around staging. |
| Infrastructure changes | Pull request on `infra/`; the pipeline shows `what-if` on the PR and deploys after merge. Nobody edits resources in the portal. |
| Secrets | Rotated by changing the Key Vault secret; the app reads the new value after a restart (versionless references). A rotation runbook is part of A7. |
| Audit | GitHub shows who approved which release; Azure's activity log shows what changed. |


### A0: Prove the parts that cannot be read from documentation (spike, on a throwaway resource group)

Create a temporary resource group (S1 plan, a Basic SQL database, a registry, a storage account) and prove each item below; delete the group afterwards. Record outcomes at the top of this phase, as was done in D0.

1. **Region and SKU:** the chosen region offers S1 for Linux containers (`az appservice list-locations --linux-workers-enabled --sku S1`).
2. **Non-root writes to an Azure Files mount:** the image runs as uid 1654; confirm that user can create and delete files in `/data/uploads` and `/data/keys` on the mount, and that the app's Data Protection key ring and an uploaded cover work. (If not: run a startup command that adjusts ownership, or mount with options.)
3. **Passwordless SQL from the container:** `Authentication=Active Directory Managed Identity` with `User Id=<client id>` of a user-assigned identity, through EF Core with the pooled `DbContext` and `EnableRetryOnFailure`; the `/health` check passes; token refresh works over several hours.
4. **Creating the database user without Graph permissions:** `CREATE USER [identity] FROM EXTERNAL PROVIDER` may need the SQL server to read the directory; the fallback is `... WITH OBJECT_ID = '<id>'`. Decide which.
5. **Slots:** the user-assigned identity assigned to **both** slots; **slot-specific** settings stay put on a swap (database, mounts, issuer); the container image and the `/health` warm-up move with the swap; `WEBSITE_WARMUP_PATH` and the swap warm-up behave; a swap back restores the previous version.
6. **Forwarded headers:** no redirect loop with `UseHttpsRedirection`; the guest cookie is `Secure`; the rate limit sees the caller's address.
7. **Registry pull by identity:** `AcrPull` plus `acrUseManagedIdentityCreds` (and ARM-audience tokens enabled) pulls a tagged image into both slots.
8. **Pipeline access to the database:** from a GitHub-hosted runner, a **temporary firewall rule** for the runner's address, Entra authentication of the pipeline identity (as the server's Entra administrator), `dotnet ef` bundle against Azure SQL, then the rule is removed. Measure how long it takes.
9. **Telemetry package choice:** `Microsoft.OpenTelemetry` versus `Azure.Monitor.OpenTelemetry.AspNetCore` with this app (.NET 10); pick one and show requests, SQL calls and logs arriving in Application Insights.

**Check:** each item has a recorded yes/no and the exact command or setting that worked.

### A1: Infrastructure as code (Bicep)

An `infra/` folder deploys, per environment (a `production` resource group and the `staging` slot/database inside it):

1. **Identities:** one user-assigned identity for the app (both slots), one for the pipeline (federated with GitHub, A2).
2. **Monitoring:** Log Analytics workspace, workspace-based Application Insights, diagnostic settings for the web app (console logs, HTTP logs) and the SQL database.
3. **Registry:** ACR Basic, admin user disabled, ARM-audience tokens on; role `AcrPull` for the app identity, `AcrPush` for the pipeline identity; a scheduled purge of old untagged images.
4. **Key Vault:** RBAC mode, soft delete and purge protection on; `Key Vault Secrets User` for the app identity; secrets for the JWT key and the Gemini key (values set outside the repository).
5. **Storage:** one account (Standard, zone-redundant if the region allows), file shares `uploads`, `keys`, `uploads-staging`, `keys-staging`; share soft delete on; secure transfer only.
6. **Azure SQL:** logical server with **Entra-only authentication**, the pipeline identity as its Entra administrator; database `BookDB` (S0) and `BookDB_Staging` (Basic); retention and redundancy from the decisions above; firewall closed except "no public access" rules managed by the pipeline (A3); TLS 1.2.
7. **App Service:** plan S1 Linux; web app with the container image setting, `httpsOnly`, minimum TLS 1.2, FTPS and basic publishing credentials **off**, `alwaysOn`, `clientAffinityEnabled: false` (the app is stateless: JWT and the guest cookie), `healthCheckPath: /health`; the `staging` slot; identities on both; settings (below); Azure Files mounts **marked slot-specific**.
8. **Alerts and budget** (A8 fills them in; the resources are declared here).

App settings (S = slot-specific, so it stays with the slot on a swap):

| Setting | Value | S |
|---|---|---|
| `WEBSITES_PORT` | `8080` | |
| `WEBSITES_ENABLE_APP_SERVICE_STORAGE` | `false` | |
| `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | `true` | |
| `ConnectionStrings__DefaultConnection` | `Server=tcp:<server>.database.windows.net,1433;Initial Catalog=BookDB(_Staging);Encrypt=True;Authentication=Active Directory Managed Identity;User Id=<app identity client id>` | yes |
| `Jwt__SecretKey` | `@Microsoft.KeyVault(SecretUri=...)` (a different secret per slot) | yes |
| `Jwt__Issuer`, `Jwt__Audience` | `https://<the slot's host name>/` | yes |
| `Gemini__ApiKey` | Key Vault reference | |
| `Storage__UploadFolder`, `Security__DataProtectionKeysPath` | `/data/uploads`, `/data/keys` (the mounts differ per slot) | yes |
| `Security__EnforceCsp` | `true` in staging first (D4 found no violations) | |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | from the Application Insights resource | |
| `WEBSITE_WARMUP_PATH` | `/health` | |

**Check:** `az deployment ... what-if` is clean; a deployment into an empty resource group succeeds; a second run changes nothing (idempotent); the web app serves the placeholder image; no secret is in the repository or in a Bicep output.

### A2: Trust between GitHub and Azure, and the environments

1. **Bootstrap (once, by you):** `infra/bootstrap.*` creates the resource group, the pipeline's user-assigned identity, its federated credentials for the repository (`environment:staging`, `environment:production`, and pull requests for `what-if` only), and the minimum role assignments (Contributor on the resource group, plus the ability to assign the roles A1 needs). It needs an account with Owner (or Contributor plus User Access Administrator) on the subscription.
2. **GitHub:** environments `staging` (no approval) and `production` (**required reviewers**, a wait timer if you want one, restricted to the `master` branch); variables for the client, tenant and subscription ids (they are identifiers, not secrets); branch protection on `master` with the three required checks.
3. **`infra.yml`:** `what-if` as a pull-request comment for changes under `infra/`; deploy on manual dispatch and on merge.

**Check:** a workflow run logs in to Azure with OIDC and lists the resource group; a run from a branch that is not allowed fails; a production-environment job waits for approval.

### A3: Database access and migrations

1. **App user:** an idempotent script (`deploy/azure/grant-app-access.sh`) run by the pipeline creates the database user for the app identity with `db_datareader` and `db_datawriter` only, in both databases. (The health check reads `__EFMigrationsHistory`; that needs only read access.)
2. **Migration step:** the pipeline pulls the `migrate` image from the registry and runs the EF bundle against the target database with the **pipeline identity** (which can change the schema), opening a **temporary firewall rule** for the runner's address and always removing it (a `finally` step). The app identity never has schema rights.
3. **Backup settings:** point-in-time retention, geo-redundant backup storage and the long-term policy are set in Bicep (A1) and **verified here** by reading them back.
4. **Order:** staging database migrated first (the rehearsal), production database migrated only after the approval.
5. **First admin on Azure.** `deploy/make-admin.sh` works through `docker exec`, which does not exist here. `deploy/azure/make-admin.sh <username>` runs the same validated update against a database as the pipeline identity (or with your own `az login`), and a manual workflow, `make-admin.yml`, runs it for the production database behind the `production` environment's approval. The staging smoke admin (A5) uses the same script against the staging database.

**Check:** the app identity cannot create a table (a deliberate failing test); the pipeline can; both databases end up with the same schema; the firewall rule list is empty after a run, even after a failed one; `make-admin` promotes a registered user in staging and refuses a bad name.

### A4: One image, built once, tested, then published to the registry

1. **The image the stack job tested is the image that ships.** The `stack` job of `ci.yml` already builds both targets (through `deploy/deploy.sh`) and tests them (D5). On `master`, after its checks pass, **the same job** scans the two images (a vulnerability scanner; fail on high or critical findings that have a fix), logs in to Azure with OIDC, and **pushes those very images** to ACR tagged with the git SHA. It outputs the pushed **digests**. Nothing is rebuilt for the release: a separate release job that built again would produce a different image, however similar, and "tested" would no longer mean "shipped". Pull requests build and test but never push.
2. Later jobs (A5) use the **digest**, not the tag. `release.yml` is a **reusable workflow** that `ci.yml` calls on `master` with the two digests; `rollback.yml` and `make-admin.yml` are manual workflows.
3. A `v*` git tag adds the version tag to the same digest.
4. Optional: an SBOM and a provenance attestation. A GitHub Actions layer cache if the job gets slow (the stack job has none: D5 results).

**Check:** the SHA tag exists in ACR; the digest that was pushed is the one of the image the stack job ran (compare the image ids in the log); the scan result is visible; no password and no `latest` deploys are used; a pull request run pushes nothing.

### A5: The release pipeline (staging, approval, production, rollback)

```
 release.yml  (reusable; ci.yml calls it on master with the image digests)
 ├─ the image             built, tested and pushed in A4; its digests come in
 ├─ deploy-staging        environment: staging
 │    1  set the staging slot's image to <acr>/bookcart@<digest>
 │    2  migrate BookDB_Staging
 │    3  wait for the slot's /health            (the swap warm-up path)
 │    4  deploy/verify.sh <staging url>         (URL-only mode)
 │    5  scripts/smoke: smoke.js + pages.js     (writes only to the staging database)
 ├─ approve-and-release   environment: production   ◀── waits for you
 │    6  migrate BookDB (production)             (point-in-time restore point noted in the log)
 │    7  swap staging ⇄ production
 │    8  post-swap checks on the production URL  (read-only: verify.sh, pages.js)
 │    9  FAILED?  swap back, re-check, fail the run loudly
 └─ summary               SHA, version, who approved, swap time, check results
 rollback.yml  (manual): swap back, or redeploy a chosen SHA through the same steps
```

Work needed: `verify.sh` gets a URL-only mode (it today also uses `docker`); the smoke test's admin is promoted by `deploy/azure/make-admin.sh` (A3) against the staging database as the pipeline identity, through `PROMOTE_ADMIN_CMD`; helper scripts for swap and rollback; `concurrency` so only one release runs.

**Check:** a release goes staging → approval → production with no failed request during the swap (a loop of requests runs through it); a deliberately broken build fails at step 4 or 5 and never reaches production; a deliberately failing post-swap check triggers the swap back; the rollback workflow restores the previous version; the run summary names the SHA and the approver.

### A6: Changes to the application (all off unless configured)

1. **Telemetry:** add the OpenTelemetry package chosen in A0 and enable it only when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set; keep console logging. Tag telemetry with the slot and the SHA (`OTEL_RESOURCE_ATTRIBUTES`).
2. **Everything else is configuration** (A1's table). Expected code changes beyond telemetry: none. If A0 shows otherwise (the Azure Files mount permissions, for example), the change goes here and is covered by the same tests.
3. **Tests:** the existing unit and integration tests unchanged; a test that the application starts and serves with telemetry off (the Docker case).

**Check:** CI (including the Docker `stack` job) stays green; with the connection string set, requests, SQL calls, exceptions and logs appear in Application Insights from staging.

### A7: Backups, recovery and runbooks

1. **Database:** automatic point-in-time restore and long-term retention (set in A1). **Restore drill, done once for real:** restore the production database to a new database at a chosen time, point a test slot at it, confirm the data.
2. **Uploads and keys (Azure Files):** share snapshots on a schedule or Azure Backup for file shares, soft delete on, and a restore drill (delete a cover, restore it from a snapshot). App Service's own backup does not include the mounts.
3. **Optional belt and braces:** a scheduled workflow exports a BACPAC of production to a separate storage account with a lifecycle rule (it protects against a bad migration found after the point-in-time window, and against losing the Azure account's data tier).
4. **`docs/RUNBOOKS.md`:** deploy, approve, roll back, restore the database, restore a file, rotate the JWT key (everybody is signed out) and the Gemini key, rotate the storage key (two-step, as Microsoft describes), what to do when the health check fails, who to call.

**Check:** both restore drills were performed and timed, and the runbooks were followed by someone other than the author at least once.

### A8: Monitoring and alerts

1. **Dashboards/workbook:** request rate, failures, latency, health check status, SQL CPU/DTU and storage, instance memory.
2. **Alerts to e-mail (an action group):** HTTP 5xx rate, response time, the health check status metric, an availability (ping) test from outside, SQL DTU/CPU and low storage, failed releases (a GitHub notification), certificate and secret expiry, a budget alert on cost.
3. **Log retention** set deliberately (cost versus need); no personal data or secrets in logs (the app already logs none; checked by a query).

**Check:** each alert fires once on purpose (stop the staging app, hit it with errors, lower a threshold) and arrives.

### A9: Custom domain, TLS and hardening

1. Add the custom domain, DNS records and the free managed certificate; set `Jwt` issuer/audience to the final address; HSTS appears (it is sent for non-localhost hosts).
2. Staging stays reachable at its `azurewebsites.net` address with **test data only** (it cannot be locked to GitHub's changing addresses without extra services); mark it non-indexable. Restrict the SCM (Kudu) site.
3. Decide `Security__EnforceCsp` for production (the Docker work already showed no violations).
4. A security review: the pipeline identity's rights, the app identity's rights, the storage account network rules, Key Vault access, who can approve.

**Check:** `verify.sh` against the production domain passes; an SSL test gives an A-grade result; the default `azurewebsites.net` address redirects or is restricted as decided.

### A10 (optional, when a second instance is needed): scale-out readiness

The shared Azure Files mounts already make covers and keys correct across instances. What remains is **per-instance memory**:

| Item | Today | With 2+ instances | Options |
|---|---|---|---|
| Catalogue output cache (5 min) | per instance | an admin's change shows on the other instance after up to 5 minutes | accept; shorten the lifetime; or a shared (Redis) output cache |
| Rate limits (per client address) | per instance | the real limit becomes N times larger | accept and document; shared limiter; or put limits in front (Front Door/WAF) |
| AI summary cache | per instance | duplicate paid calls, a little | `IDistributedCache`/HybridCache |

Also: autoscale rules, a minimum of two instances for the Health check to remove a bad one from rotation, and (if you need it) zone redundancy (Premium v3), Azure Front Door with WAF, or a second region. Each is its own small plan; none is started by this one.


### First production release, as you will experience it

1. One-time: run the bootstrap, merge the infrastructure pull request, set the secrets in Key Vault.
2. Merge a change to `master`. CI runs; the image is built, scanned and pushed; staging is deployed, migrated and tested automatically.
3. GitHub asks you to approve the production release. You approve.
4. The pipeline migrates production, swaps, checks, and prints the summary. If a check fails, it swaps back by itself.
5. First time only: register your account on the site, then run the `make-admin` workflow for your username (it waits for your approval too).
6. Rollback later: run the rollback workflow (or swap back in the portal).


### Costs (rough monthly figures, **indicative only: check the Azure pricing calculator for your region and date**)

| Item | Approximate | Notes |
|---|---|---|
| App Service plan S1 (Linux) | about 70 USD | slots included; P0v3 is comparable and has more memory |
| Azure SQL: S0 production + Basic staging | about 20 USD | scale up when needed; backups included up to the database size, more with long-term retention |
| Container Registry (Basic) | about 5 USD | |
| Storage (Azure Files, a few GB) | a few USD | |
| Key Vault | under 1 USD | |
| Log Analytics and Application Insights | usage-based, often a few USD at this size | the first GB per month are free; set a daily cap |
| **Total** | **about 100 to 120 USD per month** | without a CDN/WAF, Redis or a second instance |

Part D (the Docker server) costs whatever the server costs: SQL Server 2022 wants at least 2 GB of RAM, so use 4 GB.


### Risks and limits (Azure)

- **A0 items may change the design** (the Azure Files permissions, the identity on slots, how the pipeline reaches the database). That is why they come first and why the rest of the plan is written to survive a different answer.
- **One instance is one instance:** a platform maintenance restart causes a short interruption (the slot swap protects deployments, not platform restarts). Two instances (A10) remove that.
- **Staging shares the plan's compute** with production, so a heavy test run can slow production a little. Keep the staging tests light or use a second plan.
- **Staging is publicly reachable** (test data only).
- **Database changes must be backward compatible**, or a rollback is not safe. This is a rule, not something the tooling can enforce fully; a review checklist and the staging rehearsal are the controls.
- **Storage keys for the Azure Files mounts** are the only credential type App Service supports; they are stored in the site configuration, not in the repository, and rotated by the documented two-step procedure.
- **The free SQL tier is not used for production** (no SLA, auto-pause).
- **Cost:** the figures above are estimates; set the budget alert in A1.

---

## 6. Not in this plan

Kubernetes or Container Apps; multi-region or zone-redundant hosting; a CDN or WAF (Azure Front Door); a shared cache; autoscaling beyond a note; private networking (virtual network, private endpoints) and self-hosted runners; a staging environment in a separate subscription; e-mail sending; a seeded admin account (the first admin is promoted by a command in both targets); changing the application's features (the one optional code change is telemetry, A6).

Specific to Part D: a container registry (the server builds from source: that is the decision for the Docker target), managed cloud services, and automatic off-host backups (copying `deploy/backups` off the host is manual, D6).

## 7. Order and effort

**Done:** D0 to D5 (about two working days).

**Next, in this order:**
1. **D6, the Docker half** (about half a day): the documentation is stale today.
2. **A0**, the Azure spike (about 1 day; it can change later A phases).
3. **A1 to A5** (about 1.5, 1, 1, 1 and 2 days; A4 is now a day because it also changes the stack job), then **A6** (about 1 day), then **A7 to A9** (about 1, 1 and 0.5 days), and the **Azure half of D6** together with A7 (about half a day).

That is about **11 working days** for a first Azure production release (estimates, not measurements), plus A10 (2 to 4 days) only if a second instance is needed. D7 only on request. Each phase is one commit or pull request, reviewed and stopped at; any phase can be reverted on its own.
