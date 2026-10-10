# Backend Changes, B0 to B5

What was changed in the backend, phase by phase, and how to operate the result. This replaces the separate B0, B3, B4 and B5 notes. Plan: [BACKEND_IMPLEMENTATION_PLAN.md](BACKEND_IMPLEMENTATION_PLAN.md). **Open work, unverified items and decisions: [BACKEND_PENDING_ITEMS.md](BACKEND_PENDING_ITEMS.md)** (not repeated here).

State: 207 tests (`dotnet test BookCart.Tests -c Release`), warnings are errors, `dotnet format` is clean.

| Phase | Theme | Outcome |
|---|---|---|
| B0 | Security | Hashed passwords, secrets out of git, identity from token/cookie, server-side checkout, validated uploads, hardened JWT, rate limits, headers |
| B1 | .NET 10 | SDK pinned, central package management, EF Core 10 |
| B2 | API plumbing | `ControllerBase` APIs, `Extensions/` wiring, typed options, ProblemDetails, health, caching, OpenAPI |
| B3 | Services and contract | Async services, DTOs, final routes without user ids, Gemini summaries |
| B4 | Data | EF Core migrations, constraints, one-query reads, search endpoint |
| B5 | Delivery | `.slnx`, container image, CI, Docker Compose, one-click scripts |

## B0: Security

| Step | Problem | Change | Key files |
|---|---|---|---|
| B0.1 | No safety net | xunit project hosting the real API (`WebApplicationFactory<Program>`) on a throwaway LocalDB database `BookDB_Test` (since B4 rebuilt with the real migrations on every run). `public partial class Program`. | `BookCart.Tests/ApiFactory.cs`, `TestDb.cs` |
| B0.2 | Plaintext passwords | `PasswordHasher<UserMaster>` behind `IPasswordService`. Login loads by username, verifies, and upgrades a legacy plaintext row to a hash on first success (`Password` set to NULL). Register stores only the hash. Seeded `adminuser/qwerty` removed. Passwords are now case-sensitive. | `Services/PasswordService.cs`, `Services/UserService.cs`, `Controllers/UserController.cs` |
| B0.3 | Committed JWT key and connection string | Both moved to user-secrets / environment variables, blank in `appsettings.json`. The app refuses to start without them (typed options, `ValidateOnStart`; key at least 32 characters). The old key is burned (still in git history). | `Options/`, `appsettings.json`, `UserSecretsId` in `BookCart.csproj` |
| B0.4 | IDOR, anonymous carts | `ICurrentUser`: user id from the validated JWT, else guest id from the cookie. Fallback authorization policy (secure by default); public endpoints opt out with `[AllowAnonymous]` per action. `POST api/guest` issues a random id (>= 1,000,000,000) in an encrypted HttpOnly `bc_guest` cookie (Data Protection). First built as an ownership filter on `{userId}` routes; B3 removed user ids from URLs, so there is nothing to forge. | `Services/ICurrentUser.cs`, `Controllers/GuestController.cs`, `Extensions/AuthExtensions.cs` |
| B0.5 | Client-trusted checkout, partial orders | `CreateOrderAsync` ignores the body: prices from `Book`, quantities from the server cart; rows for missing books or quantity <= 0 skipped, duplicates combined. One transaction: claim (delete) cart rows, check the delete count matches what was read (a concurrent double-submit gets 409), insert order and lines, commit. Order id is 20 hex characters (was `Random()`), `DateCreated` is UTC. Returns `{ orderId }`; 409 when there is nothing to check out. | `Services/OrderService.cs`, `Controllers/CheckOutController.cs` |
| B0.6 | Unrestricted upload, delete path traversal | `CoverStorage`: allow-list `.jpg/.jpeg/.png/.webp`, magic-byte check, 1 B to 2 MB, name `<guid>.<ext>` (the client's name is never used), `FileMode.CreateNew`. Request limit 3 MB (was none). Update ignores a client `coverFileName`, deletes the replaced file, cleans up on failure. Delete only removes plain file names inside the upload folder, never the default cover. 404 for missing books, 400 for bad forms. Uploads git-ignored; the 49 tracked covers were untracked. | `Services/CoverStorage.cs`, `Controllers/BookController.cs`, `.gitignore` |
| B0.7 | Token, exposure, brute force | JWT: `sub` is the user id (role only in the role claim), `iat`/`nbf` added, lifetime `Jwt:ExpiryMinutes` default 60 (was 24 h), `RequireHttpsMetadata` outside Development, `SaveToken` and the stray `AddCors()` removed. OpenAPI only in Development. Rate limits per IP in a 1-minute window: `auth` (login, register) 10, `lookup` (username check) 30; 429 with `Retry-After`. Headers on every response: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, CSP (report-only unless `Security:EnforceCsp=true`; `/scalar` exempt). Registration limits match the DB columns, gender regex anchored, 400 lists the invalid fields, taken username 409. Requests matching no endpoint get 404 before authorization. | `Services/TokenService.cs`, `Controllers/LoginController.cs`, `Extensions/PipelineExtensions.cs`, `Models/UserRegistration.cs` |

Found on the way: `UserController.Post` did not await `RegisterUser` (lost registrations, a race); the secure-by-default policy turned missing static files into 401 (fixed in B0.7).

Existing databases need `DBScript/B0.2_password_hash.sql` once (idempotent) before the B4 migrations: it adds `UserMaster.PasswordHash varchar(256)`, makes `Password` nullable and adds the unique index `UX_UserMaster_Username` (fails if usernames collide case-insensitively).

## B1 and B2: .NET 10 and API plumbing

- **B1:** `global.json` pins SDK 10.0.x; `Directory.Build.props` sets `net10.0`, nullable, implicit usings and (from B3) warnings as errors; `Directory.Packages.props` holds every NuGet version. EF Core 10. Newtonsoft and Swashbuckle removed; JSON is System.Text.Json only.
- **B2:** controllers derive from `ControllerBase` with `[ApiController]`, `ProducesResponseType` and `{id:int}` constraints; `Pages/` deleted. `Program.cs` is five lines, the wiring is in `Extensions/` (`AddBookCartOptions`, `AddBookCartPersistence`, `AddBookCartAuth`, `AddBookCartApi`, `UseBookCart`: read the comments before reordering middleware). Services are scoped; the DbContext is pooled with `EnableRetryOnFailure`. Typed, validated options replace every `IConfiguration` read. Built-in OpenAPI plus Scalar UI (`/openapi/v1.json`, `/scalar/v1`) in Development only, with the Bearer scheme. `AddProblemDetails` + `ApiExceptionHandler` map `NotFoundException`/`BadRequestException`/`ConflictException` to 404/400/409 and anything else to a logged 500 without details. `GET /health` (database check; since B4 also pending migrations), response compression, output cache for the catalog with tag eviction on admin writes. The SPA fallback answers GET/HEAD page routes only, so unknown `/api` paths are 404 ProblemDetails, not `index.html`.

## B3: API contract and services

Backend and frontend changed together; the Angular app in this repo is already updated. Any other client must follow these tables. No URL carries a user id: who is calling comes from the JWT, else the guest cookie.

| Before | Now | Notes |
|---|---|---|
| `GET api/shoppingcart/{userId}` | `GET api/shoppingcart` | Empty list for a visitor with no cart; creates nothing |
| `POST api/shoppingcart/AddToCart/{userId}/{bookId}` | `POST api/shoppingcart/items/{bookId}` | Returns the updated cart. Starts the guest session if the caller has no identity. 404 for an unknown book |
| `PUT api/shoppingcart/{userId}/{bookId}` | `PATCH api/shoppingcart/items/{bookId}` | One copy less; the last copy removes the book (no quantity 0 rows) |
| `DELETE api/shoppingcart/{userId}/{bookId}` | `DELETE api/shoppingcart/items/{bookId}` | Returns the updated cart |
| `DELETE api/shoppingcart/{userId}` | `DELETE api/shoppingcart` | 204 |
| `GET api/user/{userId}` | `GET api/shoppingcart/count` | Item count |
| `GET api/shoppingcart/SetShoppingCart/{old}/{new}` | removed | Login merges the guest cart on the server |
| `GET api/wishlist/{userId}` | `GET api/wishlist` | Login required |
| `POST api/wishlist/ToggleWishlist/{userId}/{bookId}` | `POST api/wishlist/items/{bookId}` | Returns the updated list. 404 for an unknown book |
| `DELETE api/wishlist/{userId}` | `DELETE api/wishlist` | 204 |
| `GET api/order/{userId}` | `GET api/order` | Own orders only, newest first, `orderDate` is UTC (`Z`) |
| `POST api/checkout/{userId}` + body | `POST api/checkout` | Body ignored; returns `{ orderId }`; 409 if nothing to check out |

The old shapes now answer 404 (GET) or 405 (other methods). Other statuses a client can meet: 400 (bad upload/form/registration), 401, 403, 404, 409 (username taken, empty cart), 429 (rate limit), 503 (summaries without a Gemini key), 502 (AI service error).

**Books (admin).** `POST api/book` / `PUT api/book` take `multipart/form-data` with one field per property: `bookId` (PUT only), `title` (max 100), `author` (max 100), `category` (max 20), `price` (0 to 99,999,999.99, required), plus optional `file`. The old `bookFormData` JSON field is gone; a `coverFileName` field is ignored. Invalid input is a 400 listing the fields; a non-form body is 415. POST answers **201** with the saved book (`Location` header), PUT **200** with it, DELETE **204** (they used to answer the number `1`, which the Angular reducers stored as a book). Book, category, cart and order JSON are DTOs with the same camelCase names as before; order lines carry `book.bookId/title/author/category/price/coverFileName` (price = price paid; a deleted book shows as "(book no longer available)").

**Book summaries.** `POST api/book/{id}/summary` returns `{ summary }`. Public, rate limited (`RateLimiting:SummaryPermitLimit`, default 5/min per client), cached per book for `Gemini:CacheDays` (default 7). The API calls Google Gemini with the key held server-side; without `Gemini:ApiKey` the answer is 503. The browser no longer calls Google, so `@google/genai` and the CSP `connect-src` allowance are gone.

**Behaviour changes worth knowing**
- **Guest session:** the first `POST items/{bookId}` without a token sets the encrypted HttpOnly `bc_guest` cookie (30 days); the same-origin Angular app sends it automatically (a client on another origin must send credentials). A forged or expired cookie counts as no cookie.
- **Login** merges the guest cart into the user's (quantities add) and deletes the cookie; a failed login changes nothing.
- **Reads create nothing:** carts and wishlists used to be created by any read.
- **Service layer:** everything async with `CancellationToken`; one interface plus implementation per file under `Services/` (`BookService`, `CartService`, `WishlistService`, `OrderService`, `UserService`, `TokenService`, `GeminiBookSummaryService`, `CoverStorage`, `PasswordService`); controllers return DTOs from `Dto/`, never entities; `TimeProvider` for time; role and user-type ids are constants (`UserRoles`, `UserTypeIds`).
- **Removed:** `DataAccess/`, `Interfaces/`, `RequireOwnerAttribute`, `Dto/OrdersDto`, `Dto/Checkout`, the Angular `selectCurrentUserId`/`setTempUserId` (no more random guest id in `localStorage`).
- **Angular files changed:** `services/` (cart, wishlist, myorders, checkout, authentication, book), `state/effects/` (cart, wishlist, order, checkout, auth), `state/selectors/auth.selectors.ts`, `app.component.ts` (loads the cart at start), `admin/book-form`, `book-summary` + `book-details`, `addtowishlist`, `package.json`/lock.
- **Token:** the role is in the `.../claims/role` claim, not `sub` (`auth.effects.ts` reads it, and still reads old tokens). Sessions last `Jwt:ExpiryMinutes` with no refresh.

## B4: Database, migrations and catalog queries

The schema is defined by EF Core migrations (`BookCart/Migrations`: `Baseline`, `SchemaHardening`) and the database enforces the rules the code used to hope for. **Existing databases must be upgraded before running this version** (`/health` reports unhealthy until they are).

### Upgrading an existing database (one created from `DBScript/BookDB.txt`)

Do these in order; stop at the first failure. Rehearsed on a scratch copy loaded with deliberately dirty data and on the local dev database; not yet run against the real database (see the pending list).

1. **Back up.** `BACKUP DATABASE [BookDB] TO DISK = N'<path>' WITH INIT;` (no `COMPRESSION` on Express/LocalDB; chain steps so a failed backup stops the upgrade). The cleanup in step 4 deletes and merges rows, so the backup is the only way back.
2. **Make sure it is at the B0.2 schema** (has `UserMaster.PasswordHash`). If not, run `DBScript/B0.2_password_hash.sql` first.
3. **Adopt the migrations history:** `sqlcmd -S <server> -d <database> -i DBScript/B4_adopt_migrations.sql`. It changes no table; it records that `Baseline` (the schema `BookDB.txt` creates) is already in place, and refuses a database that is not at the expected starting point. Safe to run twice.
4. **Apply the rest**, either
   - `BOOKCART_EF_CONNECTION="<connection string>" dotnet ef database update --project BookCart` (restore the tool once with `dotnet tool restore`), or
   - `dotnet ef migrations script --idempotent --project BookCart -o schema.sql`, review it, run it with `sqlcmd -I -b -d <database> -i schema.sql`.
5. Deploy this version of the app.

**A brand-new database** needs none of this: create an empty database and run step 4. The migrations create everything, including the user types and categories.

If step 4 stops with a message such as "Book has negative prices", nothing was changed (the migration is one transaction). Fix the rows it names and run it again.

### What the upgrade does to existing data

| Data | Result |
|---|---|
| Several carts (or wishlists) for one owner (a race in the old code) | Merged into the oldest; items moved, quantities added |
| The same book twice in one cart | One line, quantities added (wishlist: one entry) |
| Cart lines for a missing cart or book, or with quantity 0 | Deleted |
| Wishlist entries for a missing wishlist or book | Deleted |
| Negative book prices; order lines with quantity <= 0, a negative price or no order; users with an unknown type | **Stops with a message.** Never changed automatically |
| Order history, users, books, guest carts | Untouched (dates move from `datetime` to `datetime2` with the same value) |

### What the database now enforces

- **Relationships:** cart lines -> cart and book; wishlist lines -> wishlist and book; order lines -> order; user -> user type.
- **Uniqueness:** one cart and one wishlist per owner; a book once per cart/wishlist; unique username.
- **Value rules:** book price >= 0; cart quantity > 0; order line quantity > 0 and price >= 0.
- **Cascades:** deleting a book removes it from every cart and wishlist. Order lines deliberately have **no** foreign key to books, so an order keeps its history after a book is deleted.
- **Types:** `Title` and `Author` are `nvarchar(100)` (any script, not only ASCII); `DateCreated` columns are `datetime2`.
- **Indexes:** book category; cart/wishlist owner; order lines by order; orders by (user, date); lines by book.

### Code that follows from it

- `CartService`/`WishlistService` handle the new races: if two requests create the same cart or line at once, the loser carries on with the winner's row (`DatabaseErrors` recognises the unique-index violation; tested with 12 parallel requests, repeated). The order list and cart read are joins, because cart rows are always valid.
- Any code that opens its own transaction must run inside `Database.CreateExecutionStrategy().ExecuteAsync(...)` and clear the change tracker at the start of each attempt (the DbContext retries transient failures); see `OrderService.CreateOrderAsync` and `CartService.MergeAsync`.
- `BookDBContextFactory` lets `dotnet ef` run without the web host or secrets (`BOOKCART_EF_CONNECTION`, else the local `BookDB_Dev`); `dotnet-tools.json` pins `dotnet-ef` 10.0.12.
- Tests build their database with the real migrations and fail if the model changes without a migration (`The_migrations_describe_exactly_the_current_model`).
- **Search:** `GET api/book/search?page&pageSize&category&search&minPrice&maxPrice` returns `{ items, total, page, pageSize }`: filtering, ordering by title and paging happen in the database. Defaults: page 1, 24 per page, max 100. `search` matches title or author, case-insensitive, with `%` `_` `[` taken literally. Invalid values are a 400 naming the field. Not cached. `GET api/book` (the full list, cached 5 minutes) is unchanged and is what the Angular app still uses. `GET api/book/GetSimilarBooks/{id}` picks five books of the category from the ids only instead of sorting every row by a random GUID.

### Rolling back, and adding migrations

`Down()` is generated for both migrations, but the data cleanup cannot be undone and narrowing columns back would lose non-ASCII text and sub-millisecond time: **restore the backup** instead. To remove a migration that is not applied anywhere: `dotnet ef migrations remove --project BookCart`.

To add one: change the model (`Models/BookDBContext.Schema.cs` for rules, the entity classes for columns), then `dotnet ef migrations add <Name> --project BookCart --configuration Release` and review the file. A migration that changes existing data needs the same care as `SchemaHardening`: merge or delete only what could never have been valid, stop with a clear message for anything needing a decision, keep it in one transaction. Do not edit `DBScript/BookDB.txt` (the legacy script that created every existing database).

## B5: Delivery

| Area | Change |
|---|---|
| Solution | `BookCart.slnx` replaces `BookCart.sln` and the duplicate `BookCart/BookCart.sln` (Visual Studio 2022 17.13+ or the CLI). |
| Launch profiles | IIS Express profile removed; only `BookCart` (Kestrel + SpaProxy) remains. |
| Style | `.editorconfig` records the style the code already follows. `dotnet format BookCart.slnx --verify-no-changes` is clean with no code reformatted; CI runs it. Rules that would have rewritten the repo (usings order, BOM, brace and initializer layout) are deliberately left out. |
| Client install | `ClientApp/.npmrc` sets `legacy-peer-deps=true`: `npm install`/`npm ci` no longer fail with ERESOLVE (`@ngrx/*` 19 vs Angular 20). The Debug build and publish both use `npm ci`. |
| Publish | Target `PublishRunWebpack` renamed `PublishBuildClient`. `prerendered-routes.json` and `BookCart.xml` are not published. |
| API docs | `GenerateDocumentationFile` + `NoWarn 1591`: XML comments on controllers appear as summaries in the OpenAPI document (a test checks it). |
| Container | `dotnet publish BookCart/BookCart.csproj -c Release -t:PublishContainer` (SDK container support, no Dockerfile). Image `bookcart`: base `aspnet:10.0`, non-root user (1654), HTTP on 8080. Add `--os linux --arch x64 -p:ContainerArchiveOutputPath=<file>.tar` to write a tar archive without a Docker daemon. Publish the project, not the solution: a solution-level publish also builds a `bookcart-tests` image. |
| Volumes | Optional settings `Storage:UploadFolder` (covers stored and served from there; the default cover still falls through to `wwwroot/Upload`) and `Security:DataProtectionKeysPath` (guest-cookie keys survive restarts). Without them nothing changes. |
| CI | `.github/workflows/ci.yml`: backend (restore, format check, warnings-as-errors build, tests against a SQL Server service container), frontend (`npm ci`, production build), container (image archive artifact, after the other two pass). |

### Running it in a container

Environment variables: `ConnectionStrings__DefaultConnection`, `Jwt__SecretKey` (>= 32 characters), `Jwt__Issuer`, `Jwt__Audience`, optional `Gemini__ApiKey`, `Storage__UploadFolder`, `Security__DataProtectionKeysPath`, and `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` behind a TLS-terminating proxy.

- The container user (uid 1654) must be able to write to the two mounted folders. A new named volume is root-owned, and then **guest sessions return 500 and uploads fail while `/health` still says Healthy** (it only checks the database). The Compose stack fixes ownership itself (`init-volumes`); for a manual `docker run`: `docker run --rm --user 0 -v <volume>:/d --entrypoint chown bookcart:latest -R 1654:1654 /d` for each volume.
- Linux has no key encryption at rest: the guest-cookie keys sit unencrypted on the volume (startup logs "No XML encryptor configured"). They only protect a guest cart id, but keep the volume private.
- The image speaks HTTP only. `UseHttpsRedirection` logs "Failed to determine the https port" and does nothing until TLS is terminated in front of it with forwarded headers on.
- The container does not create or migrate the database. Run the migrations first (B4 above).
- `/health` is unhealthy until the database is reachable and migrated: use it as the readiness probe.
- Without `Jwt__Issuer`/`Jwt__Audience` the committed `https://localhost:44364/` values are used; tokens still validate, but set them to the public address.

### One-click scripts (Windows batch, `scripts/`; see README)

`dev-start-all.bat` (SQL Server in Docker + migrations + backend and frontend windows), `dev-sql.bat`, `dev-backend.bat`, `dev-frontend.bat`, `dev-stop.bat`, and `release.bat` (binaries to `artifacts\publish`, image, Docker Compose stack in `deploy/`, backup of an existing database with `RESTORE VERIFYONLY`, confirmed migrations, health wait; `/y` skips the question). `deploy/.env` (generated secrets), `deploy/backups/` and `artifacts/` are git-ignored. Host-side SQL connections use `127.0.0.1` (a `localhost` connection tries IPv6 first and fails). `aspnetcore-https.js` (the `npm start` prestart) now creates the certificate folder it exports into; before, it failed on a machine that had never exported the dev certificate.

### How it was verified

The published output ran in Production (SPA, API and `/health` answer; `/openapi` and `/scalar` are not served, pinned by a test). The image was built to a tar archive and inspected, then run in Docker against SQL Server 2022 (non-root start, SPA, register, login, admin book create with a cover on the volume, restart keeping cover, key file and guest id; failure with root-owned volumes and success after `chown`). The scripts were run end to end, including a second `release.bat` run against an existing database. Mutation checks: with XML docs off, `UploadFolder` ignored, or the keys path ignored, a test fails each time.

## Differences from the plan's literal text

Deliberate; they are listed so nobody "fixes" them by mistake.

| Plan said | What exists | Why |
|---|---|---|
| Keep the old `userId` routes with ownership checks first (B0.4) | Went straight to the final routes in B3 | The ownership check was transitional; the frontend moved in the same release. |
| Baseline migration with an empty `Up()` (B4) | A real `Baseline` migration plus `DBScript/B4_adopt_migrations.sql` for existing databases | A new database is created entirely by migrations; existing ones record the baseline as applied. |
| Navigation properties on every entity (B4) | Relationships mapped with `HasOne<T>().WithMany()` and no navigation properties; queries use joins | Same integrity in the database with no change to the entity classes the services return. |
| `Title`/`Author` as `nvarchar(200)` (B4) | `nvarchar(100)` | Same length as before; only the character set changed. |
| FK from order lines to `Book` with `Restrict` (B4) | No FK from order lines to `Book`; carts and wishlists cascade on book delete | Order history must outlive a deleted book. |
| Order history in one query (B4) | Two queries (orders, then all lines) | Avoids a cartesian product; still constant in the number of orders. |
| Keep `GET api/book/all` (B4) | `GET api/book` stays, cached 5 minutes, plus `GET api/book/search` | Matches what the frontend calls today. |
| Service unit tests in `BookCart.Tests/Services/*` (B3) | Integration tests through the real API on LocalDB | Same behaviour with the real database rules; there are no isolated service tests. |
| Testcontainers (B0.1) | LocalDB, or `BOOKCART_TEST_DB`; CI uses a SQL Server service container | Works without Docker. |
| `Book.Category` as a real FK (B4) | Left as free text | The plan itself defers it (it touches the frontend model and the category filter). |

## Configuration reference

| Key | Required | Default / notes |
|---|---|---|
| `ConnectionStrings:DefaultConnection` | yes | none (startup fails) |
| `Jwt:SecretKey` | yes | at least 32 characters (startup fails) |
| `Jwt:Issuer`, `Jwt:Audience` | yes | committed default `https://localhost:44364/` satisfies the check; set both to the public address |
| `Jwt:ExpiryMinutes` | no | 60 |
| `Storage:DefaultCoverImageFile` | no | `Default_image.jpg` |
| `Storage:UploadFolder` | no | `wwwroot/Upload` |
| `Security:EnforceCsp` | no | false (report-only) |
| `Security:DataProtectionKeysPath` | no | the framework's own key location |
| `RateLimiting:AuthPermitLimit`, `LookupPermitLimit`, `SummaryPermitLimit` | no | 10, 30, 5 per minute per client IP |
| `Gemini:ApiKey` | no | without it summaries answer 503 |
| `Gemini:Model`, `Gemini:CacheDays`, `Gemini:TimeoutSeconds` | no | CacheDays 7 |
