# Backend: Pending Items

Status as of 2026-10-10 on `master` (PRs #1 to #3 merged). The backend plan, [BACKEND_IMPLEMENTATION_PLAN.md](BACKEND_IMPLEMENTATION_PLAN.md), is **implemented through B5**; every plan item was audited against the code. What was built, how to operate it, and where it differs from the plan's wording: [BACKEND_CHANGES.md](BACKEND_CHANGES.md). This file lists only what is **still open**.

Verified on this commit: clean Release build with warnings as errors, `dotnet format --verify-no-changes` clean, 207 backend tests pass.

## 1. Needs you (required for a real release)

| # | Item | What is needed |
|---|---|---|
| 1 | **Real-database upgrade** | Nothing has been run against the real database. To start I need the server and database name, how to connect (password through an environment variable, never in chat), and a backup folder the SQL Server service can write to. The procedure (back up, B0.2 script if needed, adopt migrations, apply, check row counts) is in [BACKEND_CHANGES.md](BACKEND_CHANGES.md), section B4. |
| 2 | **Production secrets** | Generate a new `Jwt__SecretKey` (at least 32 characters) on the target. The key that was committed to git history is compromised: never reuse it. Also set `ConnectionStrings__DefaultConnection`, `Jwt__Issuer`, `Jwt__Audience` (the public address) and optionally `Gemini__ApiKey`. For a one-machine Docker deployment `scripts\release.bat` generates its own into `deploy\.env`. |
| 3 | **First admin account** | None is seeded. Register a user, then `UPDATE UserMaster SET UserTypeID = 1 WHERE Username = '<username>'`. |
| 4 | **Restore the uploaded covers** (only matters for an existing database whose books point at them) | 49 covers were removed from the working tree when uploads stopped being tracked. They are in history: `git restore --source=a395eeb --worktree -- BookCart/wwwroot/Upload`. Tested in a scratch worktree: it restores 50 files, stages nothing, and `git status` stays clean (the folder is git-ignored). |
| 5 | **`stash@{0}` (`wip-before-modernization`)** | Holds the pre-modernization edits: a LICENSE change (`Copyright (c) 2019 Ankit` to `2026 Hrishikesh`), a Swagger title/contact change in the old `Program.cs` (that code no longer exists) and an admin seed row in the legacy script (removed on purpose). Only the LICENSE edit still applies: `git checkout stash@{0} -- LICENSE`, then `git stash drop`. The MIT license requires keeping the original copyright notice, so consider adding your line instead of replacing the original. |

## 2. Needs a decision or a real environment

| # | Item | Why it is open |
|---|---|---|
| 6 | **Enforce the CSP** (B0.7) | The Content-Security-Policy is report-only. Check the browser console for violations against the built SPA, then set `Security:EnforceCsp=true`. |
| 7 | **First CI run on GitHub** (B5) | `.github/workflows/ci.yml` only parsed as YAML here. The backend tests have never run on Linux or against a SQL Server container. Likely adjustments: cover tests that use `\` in file names, collation, the legacy-script test. |
| 8 | **Container behind a TLS proxy** (B5) | The image was run locally over plain HTTP. Forwarded headers (`ASPNETCORE_FORWARDEDHEADERS_ENABLED`) and the HTTPS redirect are untested. Behind a proxy, configure forwarded headers or every caller shares the proxy's IP and the per-IP rate limits all count against it. No registry push or remote deploy exists (the chosen target is Docker Compose on one machine). |
| 9 | **Least-privilege database login** (B5) | The Compose stack connects as `sa`. On a shared server, create a limited login for the app (migrations still need a DDL-capable one). |
| 10 | **`release.bat` interactive prompt** | The Y/N question before migrations needs a console; every test run used `/y`. |

## 3. Optional items from the plan, not done

| # | Item | Plan phase | Notes |
|---|---|---|---|
| 11 | Refresh-token flow | B0.7 | The JWT only expires after `Jwt:ExpiryMinutes` (default 60). The largest item here. |
| 12 | `rowversion` on `Book` | B4 | Without it, two admins editing the same book get last write wins instead of a 409. It also needs the client to send the version back. The quickest backend item. |
| 13 | OpenTelemetry (traces, metrics) | B2/B5 | |
| 14 | `LoggerMessage` source-generated logging | B2/B5 | Order and admin paths use plain `ILogger` calls today. |
| 15 | .NET Aspire | B5 | The plan says to decide separately. SpaProxy stays for now. |
| 16 | `Book.Category` as a real foreign key | B4 | Deferred by the plan: free text duplicating `Categories`; a real FK also changes the Angular `Book` model and the category filter. |

## 4. Carried over to the frontend plan

Found while doing the backend work. They belong to F0 to F7 and are listed so they are not lost.

| # | Item | Belongs to |
|---|---|---|
| 17 | **Browser smoke test.** The Angular app has been compiled but never clicked through against the final API. First thing to do when frontend work starts. | F0 |
| 18 | Karma specs are still the old boilerplate (two do not type-check). | F2 |
| 19 | Initial bundle is 1.08 MB against the 1 MB budget (build warning). | F6 |
| 20 | The catalog still loads every book and filters in the browser; moving it to `GET api/book/search` is a frontend change. | F6 |
| 21 | An empty-cart checkout answers 409; the SPA did not show that message when last checked (B0 note, not rechecked since B3). | F1 |
| 22 | Remove `BookCart/ClientApp/.npmrc` (`legacy-peer-deps`) once `@ngrx` is upgraded to match Angular. | F3 |

## Working rules

- **Real databases are never touched without an explicit target.** Scratch databases (`BookDB_Dev`, `BookDB_Test*`) and throwaway containers are fine.
- Suggested first frontend step: F2 (a working test setup), so later phases have a safety net.
