# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

BookCart is an online book store: an ASP.NET Core Web API (.NET 10, EF Core 10, SQL Server) in `BookCart/` hosting an Angular 20 SPA in `BookCart/ClientApp/`. Both live in one project (`BookCart.csproj`) wired together with `Microsoft.AspNetCore.SpaProxy`.

## Commands

Build layout: `global.json` pins the .NET SDK (10.0.x). `Directory.Build.props` sets `TargetFramework` (net10.0), nullable and implicit usings for every project. `Directory.Packages.props` holds all NuGet versions (central package management): project files reference packages without a `Version`, so change versions there.

Backend (run from `BookCart/`):
- `dotnet build`: the first Debug build runs `npm install` in `ClientApp/` automatically if `node_modules` is missing.
- `dotnet run --launch-profile BookCart`: starts the API at https://localhost:7073. SpaProxy then runs `npm start` and serves the Angular dev server at https://localhost:53424.
- `dotnet publish -c Release`: runs `npm run build -- --configuration production` and copies `dist/` into `wwwroot`.

Frontend (run from `BookCart/ClientApp/`):
- `npm start`: runs `ng serve` on port 53424 over HTTPS, using the ASP.NET dev cert (the `prestart` step runs `aspnetcore-https.js` to generate it).
- `npm run build`
- `npm test`: runs Karma/Jasmine tests in Chrome.
- To run one spec file: `npx ng test --include src/app/services/cart.service.spec.ts`

Backend tests (run from the repo root): `dotnet test BookCart.Tests -c Release`. Use `-c Release`: a Debug build of `BookCart` runs `npm install`, which currently fails with an ERESOLVE peer-dependency error (`@ngrx/*` 19 vs Angular 20). The tests host the real API against a throwaway LocalDB database `BookDB_Test` that `ApiFactory` drops and recreates on every run. Set `BOOKCART_TEST_DB` to use another SQL Server, and never point it at a real database. The security tests in `SecurityTests.cs` fail until the matching B0 fixes in `docs/BACKEND_IMPLEMENTATION_PLAN.md` are done.

The repo has no lint configuration.

## Setup prerequisites

- Create the database with `DBScript/BookDB.txt`. It contains the SQL schema, category/user-type seed data, and the `Scaffold-DbContext` command that generated `Models/`. No admin account is seeded: register a user in the app, then promote it with `UPDATE UserMaster SET UserTypeID = 1 WHERE Username = '<username>'`.
- Passwords are stored as ASP.NET Identity hashes in `UserMaster.PasswordHash` (`Services/PasswordService.cs`). The legacy plaintext `Password` column is only read to upgrade old rows on their next login, then nulled. An existing database needs `DBScript/B0.2_password_hash.sql` run once.
- Secrets are not stored in `appsettings.json` (the committed values are blank, and startup fails fast if they are missing). In development set them with user-secrets from `BookCart/`: `dotnet user-secrets set "ConnectionStrings:DefaultConnection" "<conn string>"` and `dotnet user-secrets set "Jwt:SecretKey" "$(openssl rand -base64 48)"` (min 32 chars). In other environments use the `ConnectionStrings__DefaultConnection` and `Jwt__SecretKey` environment variables or a vault. The old key that was committed to git history is compromised and must never be reused.
- The Gemini book-summary feature (`components/book-summary`) calls `@google/genai` directly from the browser. It needs `API_KEY` set in that component.

## Architecture

### Backend (`BookCart/`)

- The database was built first and the EF Core code scaffolded from it: entities and `BookDBContext` in `Models/` are generated. When the schema changes, update `DBScript/BookDB.txt` and re-scaffold or hand-edit the models to match. The project has no EF migrations.
- Startup layout: `Program.cs` is five lines; the wiring lives in `Extensions/` (`AddBookCartOptions`, `AddBookCartPersistence`, `AddBookCartAuth`, `AddBookCartApi`, and `UseBookCart` for the ordered request pipeline: read its comments before reordering middleware).
- Request flow: `Controllers/` → `Interfaces/I*Service` → `DataAccess/*DataAccessLayer`. The DataAccess classes implement the service interfaces, take `BookDBContext` directly, and are registered as scoped (`PersistenceExtensions`). Request/response shapes that differ from entities go in `Dto/`. Controllers derive from `ControllerBase` with `[ApiController]` (automatic 400 with the invalid fields listed), and id route parameters are constrained (`{userId:int}`): a non-numeric id is a 404.
- Configuration is typed options in `Options/` (`JwtOptions`, `DatabaseOptions`, `StorageOptions`, `RateLimitingOptions`, `SecurityOptions`), validated at startup: the app refuses to start and lists every invalid setting. Do not read `IConfiguration` keys directly. The cover default moved from `DefaultCoverImageFile` to `Storage:DefaultCoverImageFile`.
- Errors: throw `NotFoundException`, `BadRequestException` or `ConflictException` (`Errors/`); `ApiExceptionHandler` maps them to 404/400/409 ProblemDetails and everything else to a logged 500 with no details. Bodiless 401/403/404/429 responses also get a ProblemDetails body (`UseStatusCodePages`).
- The DbContext is pooled and retries transient SQL failures (`EnableRetryOnFailure`), so any code that opens its own transaction must run inside `Database.CreateExecutionStrategy().ExecuteAsync(...)` and clear the change tracker at the start of each attempt (see `OrderDataAccessLayer.CreateOrderAsync`). `BookDBContext` has a single options constructor (required for pooling).
- `GET api/book` and `GET api/book/GetCategoriesList` are output-cached for 5 minutes under the `catalog` tag; admin add/update/delete evicts it. Authenticated requests are never cached. Responses are gzip/brotli compressed (not over HTTPS). `GET /health` (public) checks the database. Unknown `/api/...` routes are 404, not the SPA shell.
- All controllers use the route `api/[controller]`. Many endpoints still take `userId` as a URL segment (it is removed in plan phase B3), but `[RequireOwner]` (`Services/RequireOwnerAttribute.cs`) only lets a caller use their own user id (from the JWT via `ICurrentUser`) or their own guest id; admins can use any. A caller with no identity gets 401, one who does not own the id gets 403.
- Checkout (`POST api/checkout/{userId}`) ignores the request body: `OrderDataAccessLayer.CreateOrderAsync` prices the order from the `Book` table and the server-side cart, claims (deletes) the cart rows and writes the order in one transaction, and returns `{ orderId }`. It returns 409 when there is nothing to check out, including a concurrent double-submit. Only the caller's own user id is accepted (admins included).
- Secure by default: `Program.cs` sets a fallback authorization policy, so every endpoint requires a signed-in user unless it has `[AllowAnonymous]` (login, register, username check, book reads, `POST api/guest`, guest-capable cart actions) or its own `[Authorize]`. Do not put `[AllowAnonymous]` on a class that also holds `[Authorize]` actions: it overrides them. The SPA fallback route is explicitly `.AllowAnonymous()`.
- Guest carts: anonymous users call `POST api/guest` to get a server-generated id (>= 1,000,000,000) in an encrypted HttpOnly `bc_guest` cookie (Data Protection). Cart endpoints accept that id only from the cookie's holder. After login the SPA must call `GET api/shoppingcart/SetShoppingCart/{guestId}/{userId}` to merge; it only accepts the caller's own guest cart into their own cart.
- Auth: `LoginController` issues an HS256 JWT valid for `Jwt:ExpiryMinutes` (default 60; there is no refresh flow yet). `sub` and `userId` are the user id, and the role ("Admin" or "User") is the `ClaimTypes.Role` claim (key `http://schemas.microsoft.com/ws/2008/06/identity/claims/role`); `sub` no longer holds the role. Authorization policies are named after `UserRoles.Admin`/`UserRoles.User` (see `Models/Policies.cs`) and applied with `[Authorize(Policy = UserRoles.Admin)]`. JWT settings come from the `Jwt` section of appsettings.
- `BookController` POST/PUT take `multipart/form-data`: the book JSON goes in the form field `bookFormData`, with an optional cover image file. `Services/CoverStorage.cs` owns the file handling: only `.jpg/.jpeg/.png/.webp` up to 2 MB whose content matches the extension, saved as `<guid>.<ext>` in `wwwroot/Upload/` (the client's file name is never used); a bad file is a 400. If no file is sent, a new book gets `DefaultCoverImageFile`, and an update keeps the stored cover (a `coverFileName` in the JSON is ignored). The old file is deleted when a cover is replaced or the book is deleted (never the default). Uploaded covers are git-ignored; only `Default_image.jpg` is tracked.
- API documentation is Development only: the OpenAPI document at `/openapi/v1.json` (built-in `AddOpenApi`, Microsoft.OpenApi 2 types in `Microsoft.OpenApi`) and the Scalar UI at `/scalar/v1`. Endpoints are marked as requiring the Bearer scheme unless they have `[AllowAnonymous]`. JSON is System.Text.Json only; the book form is parsed with `JsonSerializerDefaults.Web`, which the admin form relies on (its price is a string).
- Rate limits (per client IP, fixed 1-minute window): login and registration share the `auth` policy (`RateLimiting:AuthPermitLimit`, default 10); the signup username check uses `lookup` (`RateLimiting:LookupPermitLimit`, default 30). Over the limit is 429 with `Retry-After`. Behind a reverse proxy configure forwarded headers, or every caller shares the proxy's address.
- Every response, including errors, carries `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy`, plus a Content-Security-Policy that is **report-only** until `Security:EnforceCsp` is `true` (it has not been checked against the built SPA yet: check the browser console for violations first; the Gemini call needs `connect-src`; `/scalar` is exempt). Requests that match no endpoint get 404 before authorization (the fallback policy would otherwise make them 401).
- Logging: default level is Information; orders placed, admin book changes, logins, failed logins and rate-limit hits are logged (never passwords or tokens).

### Frontend (`BookCart/ClientApp/src/app/`)

- The app is all standalone components with no NgModules. `main.ts` bootstraps with `provideRouter`, `provideHttpClient(withInterceptors(...))`, and NgRx.
- Services call relative URLs (`/api/...`). In development, `proxy.conf.js` forwards `/api`, `/Upload` and `/swagger` to the ASP.NET backend.
- `interceptors/http-interceptor.service.ts` reads the JWT from `localStorage["authToken"]` and adds the Bearer header. `error-interceptor.service.ts` handles error responses.
- State management uses NgRx under `state/`, split into `actions/`, `reducers/`, `effects/` and `selectors/`, one file per feature in each:
  - Global features registered in `main.ts`: auth, books, categories, cart, wishlist, and router-store.
  - Route-scoped features registered through `providers` on routes in `routes/app.routes.ts`: register, similar-books, orders, checkout. A new lazily loaded feature should follow this route-scoped pattern.
  - Effects are classes that use `inject()`. They read the current user with `concatLatestFrom(() => store.select(selectCurrentUserId))` and pass it to services. Cart and wishlist effects reload on the `setAuthState` action.
  - Reducers track request status with `CallState` from `shared/call-state.ts` (`LoadingState` or `{ errorMessage }`).
- Routes: all pages except Home are lazy-loaded with `loadComponent`. `AuthGuard` protects checkout, myorders and wishlist. `AdminAuthGuard` protects `admin/books`, whose child routes are in `routes/admin.routes.ts`.
- `SubscriptionService` keeps one piece of state outside NgRx: the price-filter value, held in a `BehaviorSubject`.
- Path imports use the `src/app/...` form, resolved through `baseUrl` in tsconfig.
