# Deployment Implementation Plan: one-command Docker deployment

Scope: running the whole application (SQL Server, the API with the Angular site, HTTPS) on a Linux server with **one command**, and updating it with the same command. Nothing in this document is implemented yet: it is the plan to implement later, written so that it can be picked up without the conversation that produced it. Each phase ends with a check you can run.

## Decisions already taken

| Question | Decision |
|---|---|
| Where does it run, how does the image get there | A Linux server (VPS or VM) with **only Docker** installed. The image is **built on the server** from the cloned repo. No registry. The same flow works on a Windows PC with Docker Desktop. |
| Database | **SQL Server 2022 in a container**, data in a Docker volume (as today). |
| HTTPS | A **Caddy** container in the stack gets and renews a Let's Encrypt certificate for your domain. A blank domain means plain HTTP on the app port (demo or LAN). |
| Schema and first admin | A **one-shot `migrate` container** applies the EF Core migrations before the app starts (after a backup if a database exists). The first admin is created by **one documented command** after registering. **No backend code change**, and no admin account is seeded (the earlier decision stands). |

## Decisions still open (defaults in bold, change before implementing if you disagree)

1. **`scripts/release.bat`:** keep as a thin Windows wrapper that runs the same bash script (Git Bash or WSL), **or** delete it. Default: **keep the wrapper**.
2. **SQL login:** the app connects as `sa` (as today). Default: **leave a limited app login for later** and document it (Phase 7, optional).
3. **CI:** replace the tar-only "Container image" job with the stack test of Phase 5. Default: **replace**.
4. **Backups kept:** default **the last 7**.

## Where things stand today (verified)

- `deploy/docker-compose.yml`: `sqlserver` (2022, volume, healthcheck, published on `127.0.0.1:14331` for host-side migrations), `init-volumes` (chown), `app` (image `bookcart:<tag>`, port 8080, volumes `uploads` and `keys`). `deploy/.env.example` lists the settings; `deploy/.env` is git-ignored (so are `deploy/backups/` and `artifacts/`).
- `scripts/release.bat` (Windows only): generates `deploy/.env`, runs `dotnet publish` twice (binaries to `artifacts/publish`, then the image with `-t:PublishContainer`), starts SQL Server, backs up an existing database, runs `dotnet ef database update` **from the host**, starts the app, waits for `/health`.
- No `Dockerfile`; the image comes from the .NET SDK container support (`ContainerRepository` in `BookCart.csproj`). CI builds that image as a tar archive and never runs it.
- Consequences: the host needs the .NET 10 SDK, Node 24 and the `dotnet-ef` tool; `docker compose up` alone fails because the image does not exist yet; migrations are not run inside Docker; there is no TLS; the first admin is a manual SQL command; Angular is built twice per release.
- Facts the plan relies on: the app refuses to start without `ConnectionStrings__DefaultConnection` and `Jwt__SecretKey`; `/health` is unhealthy until the database is migrated; `BookDBContextFactory` reads `BOOKCART_EF_CONNECTION` (needed by the EF bundle); `PublishBuildClient` in `BookCart.csproj` always runs `npm ci` and the Angular build; `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` makes ASP.NET trust the proxy headers; the container user is `app` (uid 1654, from the base image); `global.json` pins SDK 10.0.201 with `rollForward: latestFeature`, so `sdk:10.0` images satisfy it; Angular 22 needs Node 24 (`^24.15`).

## Target architecture

```
 Internet ──80/443──▶ caddy ──────▶ app (ASP.NET :8080) ──▶ sqlserver (volume sqldata)
          Let's Encrypt            API + built Angular site        ▲
          certificate              volumes: uploads, keys          │
                                                           migrate (runs once, exits)
```

- Only `caddy` is reachable from outside (80/443). The app port is published on `127.0.0.1` only (when Caddy is used), and **SQL Server is not published at all**.
- Start order, enforced by Compose: `sqlserver` healthy, then `migrate` completed successfully, then `app`, then `caddy`.
- HTTP-only mode (no domain): no Caddy, the app is published on `APP_PORT` (default 8080) on all interfaces.

## Files this plan creates or changes

| File | Action |
|---|---|
| `Dockerfile` (repo root) | new: node stage, build stage, `migrate` target, `app` target |
| `.dockerignore` | new |
| `.gitattributes` | new: `*.sh text eol=lf` (a CRLF script copied from Windows breaks on Linux) |
| `BookCart/BookCart.csproj` | small change: `SkipClientBuild` switch on the two npm `Exec` lines |
| `deploy/docker-compose.yml` | rewritten: builds the images, adds `migrate` and `caddy`, drops `init-volumes` and the SQL port |
| `deploy/Caddyfile` | new |
| `deploy/.env.example` | updated (`DOMAIN`, `ACME_EMAIL`, `COMPOSE_PROFILES`, `APP_BIND`, `BOOKCART_TAG`) |
| `deploy/deploy.sh`, `deploy/make-admin.sh`, `deploy/backup.sh` | new |
| `scripts/release.bat` | reduced to a wrapper (or removed), `scripts/lib/ensure-docker.bat` kept for it |
| `.github/workflows/ci.yml` | stack test job replaces the tar job |
| `README.md`, `CLAUDE.md`, `docs/FRONTEND_CHANGES.md` | updated to describe the new flow |

The development scripts (`scripts/dev-*.bat`) are **not touched**.

---

## Phase 0: Prove the three uncertain pieces (spike, nothing committed)

These are the only parts not yet proven in this repo. Settle them first; the rest is routine.

1. **Docker works here.** Start Docker Desktop on the development PC and run `docker run --rm hello-world`. Without a running daemon none of the later checks can run on this machine.
2. **The EF migrations bundle.** In an SDK container (or locally): `dotnet tool restore`, then
   `dotnet ef migrations bundle --project BookCart --configuration Release --self-contained -r linux-x64 -o efbundle --force`.
   Run the result against a throwaway SQL Server container: `./efbundle --connection "Server=...;Database=BookDB_Spike;User Id=sa;Password=...;TrustServerCertificate=True"`. Expected: the migrations apply and the database exists. **Fallback if the bundle fails:** `dotnet ef migrations script --idempotent` at build time into the image, run by a small container with `sqlcmd` (`mcr.microsoft.com/mssql-tools`).
3. **A health check inside the ASP.NET runtime image.** The image has no `curl` or `wget`. Check that `bash` exists (`docker run --rm mcr.microsoft.com/dotnet/aspnet:10.0 bash -c 'echo ok'`). If it does, the check is a `/dev/tcp` request (Phase 1). If it does not, drop the image healthcheck and let `deploy.sh` and the CI job poll `/health` from outside.

**Check:** a one-paragraph note of the three outcomes at the top of the implementation branch's commit message.

### Phase 0 results (done 2026-10-24: all three pieces proven, nothing changed in the repo)

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
1. **Phase 1, health check:** use the version in the Dockerfile below. It reads the status line and checks for ` 200 `, which does not depend on the response body, and `--retries` is 3. The earlier draft used `grep -q Healthy`.
2. **Phase 1, `.dockerignore`:** keep `BookCart/wwwroot/Upload/Default_image.jpg` (it is tracked, and the default cover falls through to it). Excluding the whole `Upload` folder, as the spike did, removes it from the image.
3. **Phase 1, image sizes:** the bundle is a 183 MB self-contained file, so the `migrate` image is about 437 MB and the `app` image about 460 MB (measured in Phase 1; the first estimate of 360 MB was too low). That is acceptable; trimming is not worth the risk.
4. **Logs:** the app logs the warning "Failed to determine the https port for redirect" in HTTP-only containers. It is harmless (TLS ends at Caddy); leave it unless you want it silenced.
5. **Phase 3, waiting for health:** the image health check is usable, so `deploy.sh` can wait on `docker inspect` health (or `docker compose up --wait`) instead of polling `/health` from outside. Allow about 1 minute for a stopped database to be reported and about 40 s for SQL Server to come back.
6. `ASPNETCORE_HTTP_PORTS=8080` is already set in the base image; the `ENV` line in the Dockerfile is redundant but keeps the port visible.

## Phase 1: Dockerfile and .dockerignore

Proposed `Dockerfile` (adjust versions to what Phase 0 confirmed):

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

### Phase 1 results (done 2026-10-24)

Files: `Dockerfile` and `.dockerignore` at the repo root, and the `SkipClientBuild` condition on the two publish-time `npm` lines in `BookCart/BookCart.csproj` (the Debug-only `npm ci` in `DebugEnsureNodeEnv` is untouched). The Dockerfile is the one above, unchanged from Phase 0 except for comments.

Checked:
- `docker build --target app` succeeds in 1 min 28 s on a cold cache (`npm ci` 23 s, Angular build 12 s plus `verify-static.js` passing with 85 files and 3 prerendered routes, restore 16 s, publish, bundle 26 s). `--target migrate` builds from the same cache in 12 s. The build context is 864 KB.
- Cache: a rebuild with nothing changed takes 3.7 s (all steps cached). After changing one C# file, `npm ci`, the Angular build and the restore stay cached; only the publish (13 s) and the migrations bundle (50 s) run again.
- The app image holds only `Default_image.jpg` in `wwwroot/Upload`, the fonts (56 files in `media/`), the prerendered `login/` and `register/` pages and `index.csr.html`; no source, database, `.env` or `node_modules`; empty secrets in `appsettings.json`; the user is `app` (1654), and `/data/uploads` and `/data/keys` are owned by it.
- End to end with the built images on a private network: the `migrate` image created the schema (exit 0, and a second run changes nothing), the `app` image became healthy in 10 s, and `/`, `/login`, `/register`, `/wishlist`, `/api/book`, `/api/book/GetCategoriesList` and `/Upload/Default_image.jpg` answer 200, an unknown `/api/...` path is a 404, a font named by the CSS is 200 `font/woff2`, the guest session survives a restart and the uploads volume is writable by the app user.
- A normal `dotnet publish -c Release` (no `SkipClientBuild`) still runs `npm ci` and the Angular build, and `verify-static.js` passes on its `wwwroot`.

Differences from the plan text:
- `.dockerignore` excludes the whole `deploy/` folder (compose file, scripts, `.env`, backups) instead of only `deploy/.env` and `deploy/backups`: the images never need anything from it, and this keeps secrets out of the build context by construction. It also excludes `scripts`, `DBScript`, `BookCart.slnx`, `*.md`, `**/*.bak`, `**/*.mdf`, `**/*.ldf` and `**/.env*`.
- `appsettings.Development.json` is published into the image (the SDK's default). It holds only logging levels and is read only when `ASPNETCORE_ENVIRONMENT=Development`, so it is left alone.
- Not done here, as planned: `.gitattributes` (`*.sh` with LF) comes with the scripts in Phase 3, and the stale "no Dockerfile" sentences in `README.md` and `CLAUDE.md` are updated in Phase 6.

## Phase 2: Compose file and Caddy

`deploy/docker-compose.yml` (proposed):

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

## Phase 3: `deploy/deploy.sh`, the one command

Behaviour, in order (bash, `set -euo pipefail`, run from anywhere):

1. **Preflight:** `docker` and `docker compose` (v2) exist and the daemon answers; otherwise print what to install.
2. **First run only** (no `deploy/.env`): ask for the domain (blank = HTTP-only) and the email for the certificate; generate `SA_PASSWORD` (SQL Server rule: upper, lower, digit, at least 8) and `JWT_SECRET` (`openssl rand -base64 48`, falling back to `/dev/urandom`); write `deploy/.env` with `chmod 600`; print a reminder to **keep a copy** (the SQL password cannot be recovered from the volume, and a changed `JWT_SECRET` logs everyone out).
3. **Tag:** `BOOKCART_TAG=$(date +%Y%m%d-%H%M)-$(git rev-parse --short HEAD)` (or `-local` outside git); exported for Compose and printed.
4. **Build:** `docker compose build` (images `bookcart:<tag>` and `bookcart-migrate:<tag>`; the unchanged layers come from cache).
5. **Database up:** `docker compose up -d --wait sqlserver`.
6. **Backup if a database exists:** same logic as `release.bat` today (`DB_ID('BookDB')`), via `deploy/backup.sh`: `BACKUP DATABASE ... WITH INIT, CHECKSUM`, `RESTORE VERIFYONLY`, copy to `deploy/backups/BookDB_<tag>.bak`, keep the newest 7. A failed backup stops the script before anything is changed.
7. **Migrate and start:** `docker compose up -d` (the `migrate` service runs first because `app` depends on it; a failing migration leaves the old app running and prints the migrate logs).
8. **Wait for health:** poll `docker inspect` health of `bookcart-app` (or `/health` on `127.0.0.1:<port>` if Phase 0 dropped the image healthcheck) for up to 2 minutes; on failure print `docker logs --tail 40` of `app` and `migrate`.
9. **Summary:** the URL, the tag, `docker compose logs -f app`, how to stop (`docker compose down`, data stays in volumes), and the first-admin command.

Flags: `-y` for no prompts (needs an existing `.env`, for automation). `deploy.sh` never prints secrets and never deletes volumes.

`deploy/make-admin.sh <username>`: validates the name against `^[A-Za-z0-9_.@-]{1,50}$`, runs `UPDATE UserMaster SET UserTypeID = 1 WHERE Username = '<name>'` through `sqlcmd` in the SQL container, reports "promoted" or "no such user" from the affected-row count.

`deploy/backup.sh`: step 6 as a stand-alone command; documents the restore in a comment (stop `app`, `RESTORE DATABASE [BookDB] FROM DISK = ... WITH REPLACE`, start `app`).

`scripts/release.bat` (if kept): checks Docker (existing `ensure-docker.bat`), then runs `bash deploy/deploy.sh %*` (Git for Windows ships bash); if bash is missing it prints that. `.gitattributes` keeps `*.sh` at LF.

**Check:** on a clean checkout with an empty Docker (no volumes): `./deploy/deploy.sh` (HTTP-only, `-y` after creating `.env`) ends healthy; running it a second time backs up, re-migrates (nothing to do) and ends healthy; register a user in the browser, then `./deploy/make-admin.sh <user>` and the admin menu appears.

## Phase 4: Make sure the image really is the app (the F6/F7 checks, in Docker)

Run against the stack from Phase 3, in HTTP-only mode:
- `/` and `/login` and `/register` are the prerendered pages (the body contains the "Books", "Login" and "User Registration" headings without JavaScript); `/wishlist` returns the client shell (`index.csr.html`).
- A font file returns 200 (`/media/roboto-latin-400-normal-*.woff2`; take the file name from the CSS) and the page has no failed requests in a browser.
- `node BookCart/ClientApp/verify-static.js` on the files copied out of the container (`docker cp bookcart-app:/app/wwwroot ./x`) is clean.
- The smoke test passes against it: `API=http://localhost:8080 WEB=http://localhost:8080 node scripts/smoke/smoke.js --expect-f1` (it needs `sqlcmd` on the machine to promote its admin; if that is awkward, use `make-admin.sh` with the smoke admin name beforehand).
- Uploaded covers survive `docker compose up -d --build`: upload a cover as admin, redeploy, the cover is still served (volume `uploads`, written by the non-root user).
- Guest cart survives a restart (the Data Protection keys are in the `keys` volume).

## Phase 5: CI proof that the stack starts

Replace the "Container image" job with a job like this (it runs on `ubuntu-latest`, which has Docker):

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

## Phase 6: Documentation and tidy-up

- `README.md`: replace the "Container" and release sections with the new flow: requirements (a Linux server with Docker, a domain pointing at it, ports 80 and 443 open), the three commands (clone, `./deploy/deploy.sh`, `./deploy/make-admin.sh`), update, backup and restore, rollback (restore the backup, `BOOKCART_TAG=<old tag> docker compose up -d app`), where the data lives (volumes `sqldata`, `uploads`, `keys`, `caddy_data`), and what to keep a copy of (`deploy/.env`).
- `CLAUDE.md`: update the Commands section (the `PublishContainer` line, the one-click scripts line), the Docker/CI description, and add that `docker build` runs the NuGet audit.
- Remove what is now dead: the `PublishContainer` instructions and CI step, `ContainerRepository` in the csproj (only if the owner agrees: it is harmless), `init-volumes`, the published SQL port, `artifacts/publish`.
- `docs/FRONTEND_CHANGES.md`: one line pointing to this plan's result; close F7-5 ("CI checks the publish layout") because the stack job now does.
- Update the memory notes of the project with the new flow.

**Check:** a person who has never seen the repo can deploy from the README alone (try it on a fresh VM or a clean Docker Desktop).

## Phase 7 (optional): limited SQL login

The `migrate` service keeps `sa` (it needs DDL rights). The `app` should run as a login that has only `db_datareader` and `db_datawriter` on `BookDB`: after the migrate step, `deploy.sh` runs one idempotent `CREATE LOGIN/USER ... ; ALTER ROLE ...` script with a generated `APP_DB_PASSWORD` in `.env`, and the app's connection string uses it. Do this only if the server is shared or exposed; for a single-purpose host it adds a moving part for little gain.

---

## First deployment, as the owner will experience it

1. A Linux server with Docker, a domain whose DNS points at it, ports 80 and 443 open (plus 22 for you).
2. `git clone <repo> && cd BookCartApp && ./deploy/deploy.sh`, answer the domain and the email.
3. Open `https://<domain>`, register your account, run `./deploy/make-admin.sh <username>`.
4. Later: `git pull && ./deploy/deploy.sh` (it backs up first).

## Risks and limits

- **Not proven yet:** the EF bundle and the in-image health check (Phase 0); a real Let's Encrypt issuance can only be tested on your server (locally Caddy's own CA proves everything except the certificate authority).
- **Let's Encrypt limits and DNS:** the domain must resolve to the server before the first start, or Caddy retries and can hit rate limits; check DNS first.
- **Server size:** SQL Server 2022 wants at least 2 GB of RAM; use 4 GB.
- **Single host:** one server, one database container, backups on the same host. Copy `deploy/backups` somewhere else on a schedule if the data matters (not part of this plan).
- **The build happens on the server:** the first `deploy.sh` downloads about 1.5 GB of images and builds for several minutes; later runs are faster thanks to the layer cache.
- **Secrets:** `deploy/.env` holds the SQL password and the signing key; it is git-ignored, `chmod 600`, and must be copied by you if the server is rebuilt.

## Not in this plan

A container registry and CI deploys, Kubernetes or a managed cloud service, an external or managed database, monitoring and log shipping, off-host backups, e-mail, and a seeded admin account.

## Order and effort

Phase 0 first (about half a day, it can change Phase 1). Phases 1 to 3 are the core and are done in that order (about one day together). Phase 4 verifies it, Phase 5 keeps it verified, Phase 6 documents it (together about half a day). Phase 7 only on request. Each phase is one commit on one branch, so any phase can be reviewed or reverted on its own.
