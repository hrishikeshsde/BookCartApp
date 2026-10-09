# Backend: Pending Items

Status as of 2026-10-10, branch `modernize/b5-delivery`. Phases B0 to B5 of [BACKEND_IMPLEMENTATION_PLAN.md](BACKEND_IMPLEMENTATION_PLAN.md) are implemented and tested (207 backend tests pass). **Nothing is committed yet.** What remains is listed here. Details of each finished phase: [B0](B0_SECURITY_CHANGES.md), [B3](B3_API_CHANGES.md), [B4](B4_DATABASE_CHANGES.md), [B5](B5_DELIVERY_CHANGES.md).

## 1. Needs you (required for a real release)

| # | Item | What is needed | Reference |
|---|---|---|---|
| 1 | **Real-database upgrade** | The real database has not been touched. Steps, in order, stopping at the first failure: back up and verify; check that `UserMaster.PasswordHash` exists (if not, run `DBScript/B0.2_password_hash.sql`); run `DBScript/B4_adopt_migrations.sql`; apply the migrations; check row counts. Needed to start: server and database name, how to connect (password through an environment variable, never in chat), a backup folder the SQL Server service can write to. | [B4 doc](B4_DATABASE_CHANGES.md) |
| 2 | **Production secrets** | Generate a new `Jwt__SecretKey` (at least 32 characters) on the target. The key that was committed to git history is compromised: never reuse it. Also set `ConnectionStrings__DefaultConnection`, `Jwt__Issuer`, `Jwt__Audience` (the public address, otherwise the `localhost:44364` defaults apply) and optionally `Gemini__ApiKey`. | README, [B5 doc](B5_DELIVERY_CHANGES.md) |
| 3 | **First admin account** | No admin is seeded. Register a user, then `UPDATE UserMaster SET UserTypeID = 1 WHERE Username = '<username>'`. | README |
| 4 | **Commit and merge B5** | Modified and new files on the branch (solution `.slnx`, `.editorconfig`, CI workflow, `scripts/`, `deploy/`, docs, tests). | |
| 5 | **Housekeeping** | Restore the 49 uploaded covers git removed from the working tree on a branch switch (the restore command was verified, not run). Decide what to do with `stash@{0}` (rebrand edits). | |

## 2. Needs a decision or a real environment

| # | Item | Why it is open |
|---|---|---|
| 6 | **Enforce the CSP** (B0.8) | The Content-Security-Policy is report-only. Check the browser console for violations against the built SPA, then set `Security:EnforceCsp=true`. |
| 7 | **First CI run on GitHub** (B5) | `.github/workflows/ci.yml` only parsed as YAML here. The backend tests have never run on Linux or against a SQL Server container. Likely adjustments: cover tests that use `\` in file names, collation, the legacy-script test. |
| 8 | **Container behind a TLS proxy** (B5) | The image was run locally over plain HTTP. Forwarded headers (`ASPNETCORE_FORWARDEDHEADERS_ENABLED`) and the HTTPS redirect are untested. No registry push or remote deploy exists (the chosen target is Docker Compose on one machine). |
| 9 | **Least-privilege database login** (B5) | The Compose stack connects as `sa`. On a shared server, create a limited login for the app (migrations still need a DDL-capable one). |
| 10 | **Browser smoke test** | The Angular app has not been run in a browser against the final API. |

## 3. Optional items from the plan, not done

| # | Item | Plan phase | Notes |
|---|---|---|---|
| 11 | Refresh-token flow | B0.7 | The JWT only expires after `Jwt:ExpiryMinutes` (default 60). The largest item here. |
| 12 | `rowversion` on `Book` | B4 | Without it, two admins editing the same book get last write wins instead of a 409. The quickest item. |
| 13 | OpenTelemetry (traces, metrics) | B2/B5 | |
| 14 | `LoggerMessage` source-generated logging | B2/B5 | Order and admin paths use plain `ILogger` calls today. |
| 15 | .NET Aspire | B5 | The plan says to decide separately. SpaProxy stays for now. |
| 16 | Remove `BookCart/ClientApp/.npmrc` | B5 | Tied to the frontend: delete it once `@ngrx` is upgraded to match Angular. |

## 4. Facts worth remembering

- **Volumes.** The container runs as uid 1654. A new named volume is root-owned, and then guest sessions and uploads fail with 500 while `/health` still says Healthy. The Compose stack fixes ownership itself (`init-volumes`); for a manual `docker run`, `chown` the volumes to 1654.
- **Data Protection keys** are stored unencrypted on the volume on Linux. They only protect a guest cart id; keep the volume private.
- **Publish the project, not the solution.** `dotnet publish BookCart/BookCart.csproj ...`: a solution-level publish also builds a `bookcart-tests` image.
- **Tests** need LocalDB, or `BOOKCART_TEST_DB` pointing at another SQL Server. The fixture drops that database on every run: never point it at a real one.
- **Database backups.** On Express/LocalDB use `BACKUP ... WITH INIT` (no `COMPRESSION`), and chain steps so a failed backup stops the upgrade.
- **Real databases are never touched without an explicit target.** Scratch databases (`BookDB_Dev`, `BookDB_Test*`) and throwaway containers are fine.
- **Frontend** work (plan F0 to F7) has not started and is tracked separately.
