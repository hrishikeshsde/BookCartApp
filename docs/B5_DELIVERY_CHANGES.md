# B5: Developer Experience and Delivery

Build, packaging and CI. No API contract or schema change. 207 backend tests pass (6 new in `DeploymentTests`).

## What changed

| Area | Change |
|---|---|
| Solution | `BookCart.slnx` replaces `BookCart.sln` and the duplicate `BookCart/BookCart.sln` (Visual Studio 2022 17.13+ or the CLI). `TestDb.RepositoryRoot()` looks for it. |
| Launch profiles | IIS Express profile removed; only `BookCart` (Kestrel + SpaProxy) remains. |
| Style | `.editorconfig` records the style the code already follows. `dotnet format BookCart.slnx --verify-no-changes` is clean with **no** code reformatted; CI runs it. Rules that would have rewritten the repo (usings order, BOM, brace and initializer layout) are deliberately left out. |
| Client install | `ClientApp/.npmrc` sets `legacy-peer-deps=true`: `npm install`/`npm ci` no longer fail with ERESOLVE (`@ngrx/*` 19 vs Angular 20). Delete it when ngrx is upgraded. The Debug build and publish both use `npm ci` (lock file, reproducible). |
| Publish | Target `PublishRunWebpack` renamed `PublishBuildClient` (it runs the Angular CLI). `prerendered-routes.json` and `BookCart.xml` are not published. |
| API docs | `GenerateDocumentationFile` + `NoWarn 1591`: the XML comments on controllers now appear as summaries in the OpenAPI document (a test checks it). |
| Container | `dotnet publish -c Release -t:PublishContainer` (SDK container support, no Dockerfile). Image `bookcart`: base `aspnet:10.0`, non-root user (1654), HTTP on 8080. |
| Volumes | New optional settings `Storage:UploadFolder` (covers stored and served from there; the default cover still falls through to `wwwroot/Upload`) and `Security:DataProtectionKeysPath` (guest-cookie keys survive restarts). Without them nothing changes. |
| CI | `.github/workflows/ci.yml`: backend (restore, format check, warnings-as-errors build, tests against a SQL Server service container), frontend (`npm ci`, production build), container (image archive artifact, after the other two pass). |
| Docs | `README.md` (tests, container variables, prerequisites, no more `--legacy-peer-deps` step) and `CLAUDE.md` updated. |

## Running it in a container

Environment variables: `ConnectionStrings__DefaultConnection`, `Jwt__SecretKey` (>= 32 characters), `Jwt__Issuer`, `Jwt__Audience`, optional `Gemini__ApiKey`,
`Storage__UploadFolder`, `Security__DataProtectionKeysPath`, and `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` behind a TLS-terminating proxy.

- The container user (uid 1654) must be able to write to the two mounted folders. A new named volume is root-owned and then **guest sessions return 500 and uploads fail while `/health` still says Healthy** (it only checks the database). Fix once: `docker run --rm --user 0 -v <volume>:/d --entrypoint chown bookcart:latest -R 1654:1654 /d` for each volume.
- Linux has no key encryption at rest: the guest-cookie keys sit unencrypted on the volume (startup logs "No XML encryptor configured"). They only protect a guest cart id, but keep the volume private.
- The image speaks HTTP only. `UseHttpsRedirection` logs a warning ("Failed to determine the https port") and does nothing until TLS is terminated in front of it with forwarded headers on.
- The container does not create or migrate the database. Run the migrations first (README step 2, `docs/B4_DATABASE_CHANGES.md` for an existing database).
- `/health` is unhealthy until the database is reachable and migrated: use it as the readiness probe.
- Without `Jwt__Issuer`/`Jwt__Audience` the committed `https://localhost:44364/` values are used; tokens still validate, but set them to the public address.

## Checked, and what was not

Checked here:
- `dotnet publish` output run in Production against a dev database: SPA, API and `/health` answer; `/openapi` and `/scalar` are not served (a test pins this, with a realistic web root that has an `index.html`).
- **The image run in Docker** (Docker Desktop, SQL Server 2022 container, migrations applied with `dotnet ef`): started as non-root, SPA shell and page routes, unknown `/api` 404, no API docs, security headers, register, login, admin book create with a cover upload stored on the volume and served back, default cover. After `docker restart` the cover, the key file (still one) and the guest id from the cookie were unchanged. With root-owned volumes it failed as described above; after the `chown` it worked.
- The image built to a tar archive: non-root user, entrypoint, port, `wwwroot` with the SPA and the default cover, no XML file, no `prerendered-routes.json`.
- A Debug build with no `node_modules` installs the client by itself; `dotnet format` clean; the workflow file parses as YAML.
- Mutations: with `GenerateDocumentationFile` off, `UploadFolder` ignored, or the keys path ignored, a test fails each time.

**Not verified** (no Docker daemon, no Linux, no GitHub here):
- Anything on a real host: Docker was only used locally against a throwaway SQL Server container (no TLS proxy, so forwarded headers and the HTTPS redirect were not exercised).
- The CI workflow on GitHub. The backend job runs the suite on Linux against SQL Server 2022 in a container for the first time: path handling (cover tests use `\` in names), collation, and the legacy-script test could behave differently from LocalDB on Windows. Expect to adjust the first run.
- The Angular app in a browser, and the CSP (still report-only, `Security:EnforceCsp`).
- Not done: OpenTelemetry and source-generated logging (optional in the plan); Angular unit tests are not run in CI (the frontend test setup is the separate frontend plan).

## One-click scripts (added after B5)

`scripts/` (Windows batch, see README): `dev-start-all.bat` (SQL Server in Docker + migrations + backend + frontend windows), `dev-sql/backend/frontend.bat`, `dev-stop.bat`, and `release.bat` (binaries, image, Docker Compose stack in `deploy/`, backup of an existing database, confirmed migrations, health wait). `deploy/.env` (generated secrets), `deploy/backups/` and `artifacts/` are git-ignored.

Checked by running them: dev SQL container + migrations (twice, the second a no-op), dev backend healthy against it, dev frontend serving the SPA and proxying `/api`; `release.bat /y` from nothing to a healthy site, then a second run against the now-existing database (backup written and `RESTORE VERIFYONLY` passed, migrations a no-op, data and login intact, new image tag deployed). Not exercised: the interactive `choice` prompt (needs a console), `release.bat` on a machine without Docker running (Docker Desktop auto-start is only the same code path as in the dev scripts).

Fixed on the way: `aspnetcore-https.js` (`npm start` prestart) failed on a machine that had never exported the dev certificate because it did not create its target folder; a `localhost` connection from the host to the Docker SQL port failed (IPv6 is tried first), so the scripts use `127.0.0.1`.

Not done: the app connects as `sa` in the Compose stack (single-machine setup); a limited SQL login is the better practice on a shared server.
