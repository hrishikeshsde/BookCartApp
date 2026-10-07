# B0 Security Phase: Technical Changes

Backend only (plus one frontend line). Tests: `BookCart.Tests`, 86 tests, run with `dotnet test BookCart.Tests -c Release` (Release only: a Debug build runs `npm install`, which fails on an `@ngrx` 19 / Angular 20 peer conflict).

## Changes by step

| Step | Problem | Change | Key files |
|---|---|---|---|
| B0.1 | No safety net | xunit project hosting the real API (`WebApplicationFactory<Program>`) on a throwaway LocalDB database `BookDB_Test`, dropped, recreated from the EF model and seeded each run. `public partial class Program` added. | `BookCart.Tests/ApiFactory.cs`, `TestDb.cs`, `Program.cs` |
| B0.2 | Plaintext passwords | `PasswordHasher<UserMaster>` via `IPasswordService`. Login loads by username, verifies, and upgrades legacy plaintext rows to a hash on first success (`Password` set to NULL). Register stores only the hash. Seeded `adminuser/qwerty` removed. Passwords are now case-sensitive. | `Services/PasswordService.cs`, `DataAccess/UserDataAccessLayer.cs`, `UserController.cs` |
| B0.3 | Committed JWT key and connection string | Both moved to user-secrets / env vars, blank in `appsettings.json`. Startup throws if the key is missing or under 32 chars, or the connection string is missing. The old key is burned (still in git history). | `Program.cs`, `appsettings.json`, `BookCart.csproj` (`UserSecretsId`) |
| B0.4 | IDOR, anonymous carts | `ICurrentUser` (user id from JWT, guest id from cookie). `[RequireOwner]` filter on every `{userId}` route: no identity 401, not the owner 403, admin allowed. Fallback authorization policy (secure by default); public endpoints opt out with `[AllowAnonymous]` per action. `POST api/guest` issues a random id (>= 1,000,000,000) in an encrypted HttpOnly `bc_guest` cookie (Data Protection). `SetShoppingCart` accepts only the caller's own guest cart into their own cart (admins excluded). | `Services/ICurrentUser.cs`, `RequireOwnerAttribute.cs`, `Controllers/GuestController.cs`, all controllers |
| B0.5 | Client-trusted checkout, partial orders | `CreateOrderAsync` ignores the body: prices from `Book`, quantities from the server cart, rows for missing books or quantity <= 0 skipped, duplicate rows combined. One transaction: claim (delete) cart rows, check the delete count matches what was read (concurrent double-submit gets 409), insert order and lines, commit. Order id is 20 hex chars (was `Random()`), `DateCreated` is UTC. Only the caller's own id (admins too). Returns `{ orderId }`, 409 when nothing to check out. | `DataAccess/OrderDataAccessLayer.cs`, `CheckOutController.cs`, `IOrderService.cs`; `Dto/Checkout.cs` deleted |
| B0.6 | Unrestricted upload, delete path traversal | `CoverStorage`: allow-list `.jpg/.jpeg/.png/.webp`, magic-byte check, 1 B to 2 MB, name `<guid>.<ext>` (client name never used), `FileMode.CreateNew`. Request limit 3 MB (was none). Update ignores a client `coverFileName`, deletes the replaced file, cleans up on failure. Delete only removes plain file names inside the upload folder, never the default cover. 404 for missing books, 400 for bad forms or JSON. Uploads git-ignored, 49 tracked covers untracked. | `Services/CoverStorage.cs`, `BookController.cs`, `.gitignore` |
| B0.7 | Token, exposure, brute force | JWT: `sub` is the user id (role only in the role claim), `iat`/`nbf` added, lifetime `Jwt:ExpiryMinutes` default 60 (was 24 h), `RequireHttpsMetadata` outside Development, `SaveToken` and stray `AddCors()` removed. Swagger in Development only. Rate limits per IP, 1-minute window: `auth` (login, register) 10, `lookup` (username check) 30; 429 with `Retry-After`. Headers on every response: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, CSP (report-only unless `Security:EnforceCsp=true`, Swagger exempt). Registration length limits match DB columns, gender regex anchored, 400 body lists the invalid fields, taken username 409. Requests matching no endpoint get 404 before authorization. | `Program.cs`, `LoginController.cs`, `UserController.cs`, `Models/UserRegistration.cs` |

Other fixes found on the way: `UserController.Post` did not await `RegisterUser` (lost registrations, racy); the secure-by-default policy turned missing static files into 401 (fixed in B0.7).

## API contract changes (frontend impact)

- Cart, wishlist, order, checkout and `api/user/{id}` require the caller to own `{userId}`. **Guests must call `POST api/guest` first** and use the returned `guestId` as `userId`; ids invented in `localStorage` now get 401 (the SPA reacts to a 401 with logout and page reload).
- After login the SPA must call `GET api/shoppingcart/SetShoppingCart/{guestId}/{userId}` (it never did) to merge the guest cart.
- Checkout: body ignored, cart cleared server-side, 409 on empty cart (the SPA does not show it).
- Token: role in `.../claims/role`, not `sub` (`auth.effects.ts` updated, also reads old tokens). Sessions last 60 min with no refresh.
- New statuses: 400 (bad upload/form/registration), 403 (not owner), 404 (book), 409 (username taken, empty cart), 429 (rate limit).

## Configuration

| Key | Required | Default |
|---|---|---|
| `Jwt:SecretKey` (>= 32 chars), `ConnectionStrings:DefaultConnection` | yes | none (startup fails) |
| `Jwt:ExpiryMinutes` | no | 60 |
| `RateLimiting:AuthPermitLimit`, `RateLimiting:LookupPermitLimit` | no | 10, 30 |
| `Security:EnforceCsp` | no | false (report-only) |

## Database

Existing databases: run `DBScript/B0.2_password_hash.sql` once (idempotent): adds `UserMaster.PasswordHash varchar(256)`, makes `Password` nullable, adds unique index `UX_UserMaster_Username` (fails if usernames collide case-insensitively). `BookDB.txt` creates the same for new databases. **Back up the real database first (still pending).**

## Pending / known gaps

- Real-database backup and applying the B0.2 script there.
- Frontend F1 work (guest session, merge call, 401 handling, 409 message) so the app works end to end with B0.
- CSP unverified against the built SPA; Gemini key still in the browser (needs `connect-src` until B3).
- Guest cart rows are still created on first read (B4). Data Protection keys must persist, or guests lose carts on restart.
- Rate limits count the proxy's IP unless forwarded headers are configured.
- `git stash@{0}` holds the pre-B0 rebranding edits; popping conflicts on `DBScript/BookDB.txt`.
- All B0 work is uncommitted.
