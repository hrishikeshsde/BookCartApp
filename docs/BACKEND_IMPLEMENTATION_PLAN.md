# Backend Implementation Plan: BookCart API (.NET 9 → .NET 10)

Scope: everything under `BookCart/` except `ClientApp/`. Each phase is one branch and one PR, and each ends with a check you can run. Phases B0 → B5 are ordered by risk. B0 is a set of security fixes and does not need the .NET 10 upgrade.

**Environment confirmed on this machine:** .NET SDKs 9.0.315 and 10.0.103/112/201 installed, Node 24.21.
**Shell:** commands are PowerShell/Git Bash compatible unless marked.

## Step 0: Before touching anything

```bash
cd D:/GitLocal/AnkitSharma/BookCartApp
git status --short          # BookCart/Program.cs, DBScript/BookDB.txt, LICENSE are modified, CLAUDE.md is untracked
git stash -u -m "wip-before-modernization"   # or commit them first, then:
git checkout -b modernize/b0-security
```

Back up the database before any schema step (B0.2 and B4):

```sql
BACKUP DATABASE [BookDB] TO DISK = N'C:\backup\BookDB_pre_modernize.bak' WITH INIT;
```

Create a **second database for tests and development**, so migrations are never first run on real data.

---

## Phase B0: Critical security fixes (stay on .NET 9)

Order within the phase matters. Do B0.1 first because everything else builds on it.

### B0.1: Test harness first (so each fix can be proven)

```bash
cd BookCart/..                       # repo root
dotnet new xunit -n BookCart.Tests -o BookCart.Tests
dotnet sln BookCart.sln add BookCart.Tests/BookCart.Tests.csproj
dotnet add BookCart.Tests reference BookCart/BookCart.csproj
dotnet add BookCart.Tests package Microsoft.AspNetCore.Mvc.Testing --version 9.0.*
dotnet add BookCart.Tests package Microsoft.EntityFrameworkCore.Sqlite --version 9.0.*
dotnet add BookCart.Tests package Testcontainers.MsSql      # needs Docker; skip if unavailable
```

Make `Program` visible to tests: append to the end of `BookCart/Program.cs`:

```csharp
public partial class Program { }
```

Add `BookCart.Tests/ApiFactory.cs`. Swap the real DbContext for a test database and inject a test JWT config:

```csharp
public class ApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureAppConfiguration((_, cfg) => cfg.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jwt:SecretKey"] = "test-secret-test-secret-test-secret-123456",
            ["Jwt:Issuer"] = "test", ["Jwt:Audience"] = "test",
            ["ConnectionStrings:DefaultConnection"] = "unused-in-tests"
        }));
        builder.ConfigureServices(s =>
        {
            var d = s.Single(x => x.ServiceType == typeof(DbContextOptions<BookDBContext>));
            s.Remove(d);
            // Use a real SQL Server (Testcontainers/LocalDB) for fidelity: the schema uses
            // varchar, decimal(10,2) and SQL Server-specific defaults that SQLite does not model.
            s.AddDbContext<BookDBContext>(o => o.UseSqlServer(TestDb.ConnectionString));
        });
    }
}
```

Write the three **failing** tests now (they go green as B0.2–B0.5 land):

```csharp
[Fact] public async Task Cart_requires_auth() =>
    Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync("/api/shoppingcart/1")).StatusCode);

[Fact] public async Task User_cannot_read_other_users_orders() { /* login as user A, GET /api/order/{B's id} → 403/404 */ }

[Fact] public async Task Checkout_ignores_client_prices() { /* POST item with price 0.01 → order total equals DB price */ }
```

**Verify:** `dotnet test` runs and the three tests fail for the expected reasons.

### B0.2: Passwords (hash, with migration of existing rows)

1. Schema change, added to `DBScript/BookDB.txt` and applied to the dev DB:

```sql
ALTER TABLE UserMaster ADD PasswordHash varchar(256) NULL;
ALTER TABLE UserMaster ALTER COLUMN Password varchar(40) NULL;   -- legacy column, emptied on first login
CREATE UNIQUE INDEX UX_UserMaster_Username ON UserMaster(Username);
```

If the unique index fails, there are duplicate usernames. Resolve those rows by hand first.

2. Add the property to `Models/UserMaster.cs` (`public string? PasswordHash { get; set; }`) and map it in `BookDBContext.OnModelCreating` (`HasMaxLength(256).IsUnicode(false)`).
3. Add `Services/IPasswordService.cs`, a thin wrapper over `PasswordHasher<UserMaster>`:

```csharp
public class PasswordService(IPasswordHasher<UserMaster> hasher)
{
    public string Hash(UserMaster u, string plain) => hasher.HashPassword(u, plain);
    public bool Verify(UserMaster u, string plain, out bool needsRehash)
    {
        needsRehash = false;
        if (u.PasswordHash is not null)
        {
            var r = hasher.VerifyHashedPassword(u, u.PasswordHash, plain);
            needsRehash = r == PasswordVerificationResult.SuccessRehashNeeded;
            return r != PasswordVerificationResult.Failed;
        }
        // Legacy plaintext row: accept once, caller upgrades it.
        if (u.Password is not null && CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(u.Password), Encoding.UTF8.GetBytes(plain)))
        { needsRehash = true; return true; }
        return false;
    }
}
```

Register in `Program.cs`: `builder.Services.AddSingleton<IPasswordHasher<UserMaster>, PasswordHasher<UserMaster>>();`

4. Change `UserDataAccessLayer.AuthenticateUser` to load by `Username` only, call `Verify`, and when `needsRehash` set `PasswordHash`, set `Password = null`, and `SaveChanges`. Change `RegisterUser` to store only `PasswordHash`.
5. **Remove the seeded `adminuser/qwerty`** from `DBScript/BookDB.txt` and replace it with a note: create the admin via a one-off script that writes a hash. Update `CLAUDE.md`, which currently documents these credentials.

**Verify:** log in with an existing plaintext user, check that the row now has `PasswordHash` and a null `Password`, then log in again. Register a new user and confirm `Password` is never written.

### B0.3: Secrets

```bash
cd BookCart
dotnet user-secrets init
dotnet user-secrets set "Jwt:SecretKey" "$(openssl rand -base64 48)"
dotnet user-secrets set "ConnectionStrings:DefaultConnection" "Server=...;Database=BookDB;..."
```

- In `appsettings.json` set `"SecretKey": ""` and `"DefaultConnection": ""`. Production values come from environment variables (`Jwt__SecretKey`, `ConnectionStrings__DefaultConnection`) or Key Vault.
- **The committed key `5kR2X99X...` is compromised** (it is in git history). Treat it as burned: it only needs rotating, and rotation logs all users out, which is intended.
- Fail fast at startup (see the options classes in B2). For now, add right after `CreateBuilder`:

```csharp
var jwtKey = builder.Configuration["Jwt:SecretKey"];
if (string.IsNullOrWhiteSpace(jwtKey) || jwtKey.Length < 32)
    throw new InvalidOperationException("Jwt:SecretKey must be set (min 32 chars).");
```

### B0.4: Authorization / IDOR

1. Add `Services/ICurrentUser.cs`:

```csharp
public interface ICurrentUser { int? UserId { get; } bool IsAdmin { get; } }
public class CurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    ClaimsPrincipal? P => accessor.HttpContext?.User;
    public int? UserId => int.TryParse(P?.FindFirstValue("userId"), out var id) ? id : null;
    public bool IsAdmin => P?.IsInRole(UserRoles.Admin) == true;
}
```

Register `AddHttpContextAccessor()` and `AddScoped<ICurrentUser, CurrentUser>()`.

2. Add a **fallback authorization policy** so new endpoints are secure by default, and opt public ones out with `[AllowAnonymous]`:

```csharp
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())
    .AddPolicy(UserRoles.Admin, Policies.AdminPolicy())
    .AddPolicy(UserRoles.User, Policies.UserPolicy());
```

Mark `[AllowAnonymous]` on: `LoginController.Login`, `UserController` register and validate-username, and the read endpoints of `BookController` (`Get`, `Get/{id}`, `GetCategoriesList`, `GetSimilarBooks`).

3. **Keep the old routes and add ownership checks** (the transitional approach, so the frontend keeps working): in each of `ShoppingCartController`, `WishlistController`, `OrderController`, `CheckOutController`, `UserController`, add

```csharp
if (currentUser.UserId != userId && !currentUser.IsAdmin) return Forbid();
```

at the top of every action that takes `userId`. `SetShoppingCart/{oldUserId}/{newUserId}`: require `newUserId == currentUser.UserId`, and require `oldUserId` to be a **guest** cart (see step 4), never another user's.
Ship the final route shape (no `userId` in the URL) in B3, when the frontend moves in lockstep.

4. **Guest carts.** Today the browser invents a random integer id in `localStorage`, and anyone can read `GET /api/shoppingcart/{id}`. Interim: allow anonymous cart access only for ids ≥ 1,000,000,000 (a reserved guest range), issued by a new `POST /api/guest` endpoint that returns a server-generated id in an HttpOnly cookie. Replace the client's `setTempUserId()` with that call (frontend F1). Stop `GetCartId` from creating a row on every `GET` (see B4).

**Verify:** the B0.1 tests `Cart_requires_auth` and `User_cannot_read_other_users_orders` go green. Manual:
```bash
curl -k https://localhost:7073/api/shoppingcart/1            # expect 401
curl -k -H "Authorization: Bearer <userA token>" https://localhost:7073/api/order/<userB id>   # expect 403
```

### B0.5: Checkout (server-side pricing and a transaction)

Rewrite `OrderDataAccessLayer.CreateOrder` to ignore client prices:

```csharp
public async Task<string> CreateOrderAsync(int userId, CancellationToken ct)
{
    await using var tx = await _db.Database.BeginTransactionAsync(ct);
    var cartId = await _db.Cart.Where(c => c.UserId == userId).Select(c => c.CartId).FirstOrDefaultAsync(ct)
                 ?? throw new NotFoundException("Cart is empty");
    var lines = await (from i in _db.CartItems.Where(i => i.CartId == cartId)
                       join b in _db.Book on i.ProductId equals b.BookId
                       select new { b.BookId, i.Quantity, b.Price }).ToListAsync(ct);
    if (lines.Count == 0) throw new NotFoundException("Cart is empty");

    var order = new CustomerOrders
    {
        OrderId = Guid.NewGuid().ToString("N")[..20],      // replaces Random() "NNN-NNNNNN"
        UserId = userId,
        DateCreated = DateTime.UtcNow,
        CartTotal = lines.Sum(l => l.Price * l.Quantity)
    };
    _db.CustomerOrders.Add(order);
    _db.CustomerOrderDetails.AddRange(lines.Select(l => new CustomerOrderDetails
        { OrderId = order.OrderId, ProductId = l.BookId, Quantity = l.Quantity, Price = l.Price }));
    await _db.CartItems.Where(i => i.CartId == cartId).ExecuteDeleteAsync(ct);   // clear cart in same tx
    await _db.SaveChangesAsync(ct);
    await tx.CommitAsync(ct);
    return order.OrderId;
}
```

`CheckOutController.Post` now takes no body (or ignores it) and uses `currentUser.UserId`. The frontend `checkout` effect stops sending the cart total and items (see the frontend plan F1/F5), and stops calling "clear cart" separately.

**Verify:** the `Checkout_ignores_client_prices` test goes green, and a forced exception in the middle leaves neither a partial order nor a cleared cart.

### B0.6: File upload (`BookController` POST and PUT)

Add `Services/CoverStorage.cs`:

```csharp
public class CoverStorage(IWebHostEnvironment env)
{
    static readonly Dictionary<string, byte[]> Magic = new()
    {
        [".jpg"] = [0xFF, 0xD8, 0xFF], [".jpeg"] = [0xFF, 0xD8, 0xFF],
        [".png"] = [0x89, 0x50, 0x4E, 0x47]
        // add .webp (RIFF....WEBP) if needed
    };
    const long MaxBytes = 2 * 1024 * 1024;

    public async Task<string> SaveAsync(IFormFile file, CancellationToken ct)
    {
        if (file.Length is 0 or > MaxBytes) throw new BadRequestException("Cover must be 1B-2MB.");
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();   // never use the client name itself
        if (!Magic.TryGetValue(ext, out var sig)) throw new BadRequestException("Unsupported image type.");
        await using var s = file.OpenReadStream();
        var head = new byte[sig.Length];
        if (await s.ReadAsync(head, ct) != sig.Length || !head.SequenceEqual(sig))
            throw new BadRequestException("File content does not match its extension.");
        s.Position = 0;
        var name = $"{Guid.NewGuid():N}{ext}";
        var dir = Path.Combine(env.WebRootPath, "Upload");
        Directory.CreateDirectory(dir);
        await using var o = File.Create(Path.Combine(dir, name));
        await s.CopyToAsync(o, ct);
        return name;
    }
    public void Delete(string? name)
    {
        if (string.IsNullOrEmpty(name) || name == "Default_image.jpg") return;
        var p = Path.Combine(env.WebRootPath, "Upload", Path.GetFileName(name));
        if (File.Exists(p)) File.Delete(p);
    }
}
```

- Replace `[DisableRequestSizeLimit]` with `[RequestSizeLimit(3_000_000)]`. Replace both inline upload blocks with `await storage.SaveAsync(...)`. Delete the old cover on `PUT` and on `DELETE`. This also removes the `Directory.Exists(fullPath)` bug.
- Stop tracking uploads in git:

```bash
git rm -r --cached BookCart/wwwroot/Upload
echo "BookCart/wwwroot/Upload/*" >> .gitignore
echo "!BookCart/wwwroot/Upload/Default_image.jpg" >> .gitignore
git add -f BookCart/wwwroot/Upload/Default_image.jpg
```

(Check that the seed data does not reference the 51 existing files. If it does, keep them as seed assets under a different folder.)

### B0.7: JWT hardening, Swagger, headers, rate limits

In `LoginController.GenerateJSONWebToken`:
- `expires: DateTime.UtcNow.AddMinutes(60)` (24h → 60 min; add a refresh-token flow later, optional).
- `Sub` = `userInfo.UserId.ToString()` (it currently holds the role name). The frontend reads `sub` as the role, so **update `auth.effects.ts` `handleLoginSuccess$` to read the `role` claim instead**. Do both in the same release.
- Add `JwtRegisteredClaimNames.Iat`.

In `Program.cs`:
- `options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();` and delete `SaveToken = true`.
- Delete the stray `builder.Services.AddCors();` inside the `AddJwtBearer` lambda (CORS is unused: the SPA is same-origin).
- Wrap Swagger in `if (app.Environment.IsDevelopment())`.
- Rate limiting:

```csharp
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "anon",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
});
// app.UseRateLimiter(); and [EnableRateLimiting("auth")] on Login, RegisterUser, ValidateUserName
```

- Security headers middleware (placed before `UseStaticFiles`):

```csharp
app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["X-Content-Type-Options"] = "nosniff";
    h["Referrer-Policy"] = "strict-origin-when-cross-origin";
    h["Content-Security-Policy"] =
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; frame-ancestors 'none'";
    await next();
});
```

Tighten this once the frontend self-hosts its fonts (frontend F0). `unsafe-inline` for styles is needed by Angular Material until nonces are set up. Test the CSP in the browser console before merging.

- Registration (`Models/UserRegistration.cs`): add `[StringLength(20)]` on `FirstName`, `LastName`, `Username`, `[StringLength(6)]` on `Gender`, `[StringLength(100, MinimumLength = 8)]` on `Password`. Return `Conflict()` when the username exists, and stop ignoring the result of `RegisterUser`.

**Phase B0 verify (full):** `dotnet test` all green, the curl attacks above are rejected, and the end-to-end smoke test passes with the frontend updated. Merge as one PR with the matching frontend changes (the frontend plan F1).

```bash
git add -A && git commit -m "Security: auth ownership checks, password hashing, secrets, upload validation, server-side checkout"
```

---

## Phase B1: Upgrade to .NET 10

```bash
git checkout -b modernize/b1-net10
```

1. `global.json` (repo root):
```json
{ "sdk": { "version": "10.0.201", "rollForward": "latestFeature" } }
```
2. `Directory.Build.props` (repo root):
```xml
<Project>
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AnalysisLevel>latest</AnalysisLevel>
  </PropertyGroup>
</Project>
```
Remove `TargetFramework` from `BookCart.csproj` and `BookCart.Tests.csproj`.
3. Central package management. Create `Directory.Packages.props` with `<ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>`, move each `Version=` from the csproj files into `<PackageVersion Include=... Version=... />` entries, and remove the `Version` attributes from the `PackageReference` items.
4. Update packages:
```bash
dotnet list package --outdated
# set all Microsoft.AspNetCore.* and Microsoft.EntityFrameworkCore.* to 10.0.*
dotnet remove BookCart package Microsoft.AspNetCore.Mvc.NewtonsoftJson
```
5. Replace the `JsonConvert.DeserializeObject<Book>(Request.Form["bookFormData"])` calls in `BookController` with `System.Text.Json` and `PropertyNameCaseInsensitive = true` (a DTO binding comes in B3).
6. **Swashbuckle will probably not compile** against Microsoft.OpenApi v2 (the `OpenApiInfo`, `OpenApiSecurityScheme` namespaces moved). Rather than chasing versions, do the OpenAPI swap (B2) now, in this branch. As a stop-gap while upgrading: comment out the Swagger block, build, then restore it from B2.
7. Build and test:
```bash
dotnet restore
dotnet build -warnaserror:false
dotnet test
```
Fix compile errors, then check the official ".NET 10 breaking changes" pages for ASP.NET Core and EF Core against your usage (JWT claim mapping, EF query translation). Pay special attention to `OrderBy(Guid.NewGuid())` and any `Contains` queries.

**Verify:** the build is clean, the tests pass, the app runs (`dotnet run --launch-profile BookCart` from `BookCart/`), and login, book list, cart and checkout all work.

---

## Phase B2: `Program.cs` and API plumbing

```bash
git checkout -b modernize/b2-plumbing
```

1. **Delete dead files:** `BookCart/Pages/` (3 files) and, if nothing else references it, `UseExceptionHandler("/Error")`-related code.
2. **Controllers → `ControllerBase`.** In each of the 7 controllers: base class `Controller` → `ControllerBase`, add `[ApiController]`, return `ActionResult<T>`/`IActionResult` with `NotFound()`, `Conflict()`, `CreatedAtAction()`, and add `{id:int}` route constraints. Add `[ProducesResponseType]` on each action.
3. **`Program.cs` rewrite**, split into extension methods in `Extensions/`:

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services
    .AddBookCartOptions(builder.Configuration)
    .AddBookCartPersistence(builder.Configuration)
    .AddBookCartAuth(builder.Configuration, builder.Environment)
    .AddBookCartApi();

var app = builder.Build();
app.UseBookCartPipeline();
app.Run();

public partial class Program { }
```

   - `AddControllers()` replaces `AddControllersWithViews()`.
   - Services `AddScoped`, not `AddTransient`.
   - `AddDbContextPool<BookDBContext>(o => o.UseSqlServer(cs, sql => sql.EnableRetryOnFailure()))`.
   - Pipeline: `UseExceptionHandler()`, `UseStatusCodePages()`, `UseHsts` (non-dev), `UseHttpsRedirection`, `UseResponseCompression`, security headers, `UseStaticFiles`, `UseRateLimiter`, `UseAuthentication`, `UseAuthorization`, `UseOutputCache`, `MapControllers()`, `MapHealthChecks("/health")`, `MapOpenApi()` (dev only), then the SPA fallback.
   - The fallback must not swallow API paths: `app.MapFallbackToFile("/{*path:regex(^(?!api/).*)}", "index.html");`
4. **Options pattern.** `Options/JwtOptions.cs`:

```csharp
public sealed class JwtOptions
{
    public const string Section = "Jwt";
    [Required, MinLength(32)] public string SecretKey { get; init; } = "";
    [Required] public string Issuer { get; init; } = "";
    [Required] public string Audience { get; init; } = "";
    public int ExpiryMinutes { get; init; } = 60;
}
services.AddOptions<JwtOptions>().BindConfiguration(JwtOptions.Section)
        .ValidateDataAnnotations().ValidateOnStart();
```
   Add `StorageOptions` (`DefaultCoverImageFile`, `UploadFolder`). Replace every `_config["..."]` read (`LoginController`, `BookController`, `Program.cs`) with `IOptions<T>`. Remove the stop-gap check from B0.3.
5. **OpenAPI.** Remove `Swashbuckle.AspNetCore` and `Swashbuckle.AspNetCore.Filters`. Then:

```csharp
builder.Services.AddOpenApi(o => o.AddDocumentTransformer((doc, _, _) =>
{
    doc.Info = new() { Title = "BookCart API", Version = "v1" };
    doc.Components ??= new();
    doc.Components.SecuritySchemes["Bearer"] = new OpenApiSecurityScheme
        { Type = SecuritySchemeType.Http, Scheme = "bearer", BearerFormat = "JWT" };
    return Task.CompletedTask;
}));
// dev only: app.MapOpenApi();  UI: dotnet add package Scalar.AspNetCore → app.MapScalarApiReference();
```
   The exact types in the transformer depend on the Microsoft.OpenApi v2 API that ships with your package versions. Check IntelliSense and the OpenAPI docs for the 10.x packages.
6. **Global error handling.** `Errors/AppExceptions.cs` (`NotFoundException`, `BadRequestException`, `ConflictException`) and:

```csharp
public sealed class ApiExceptionHandler(IProblemDetailsService pds, ILogger<ApiExceptionHandler> log) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext ctx, Exception ex, CancellationToken ct)
    {
        var (status, title) = ex switch
        {
            NotFoundException => (404, "Not found"), BadRequestException => (400, "Bad request"),
            ConflictException => (409, "Conflict"), _ => (500, "Server error")
        };
        if (status == 500) log.LogError(ex, "Unhandled exception");
        ctx.Response.StatusCode = status;
        return await pds.TryWriteAsync(new() { HttpContext = ctx, ProblemDetails = { Status = status, Title = title,
            Detail = status == 500 ? null : ex.Message } });
    }
}
// services.AddProblemDetails(); services.AddExceptionHandler<ApiExceptionHandler>();
```
7. **Health, compression, caching:**
```csharp
services.AddHealthChecks().AddDbContextCheck<BookDBContext>();   // dotnet add package Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore
services.AddResponseCompression();
services.AddOutputCache(o => o.AddPolicy("catalog", p => p.Expire(TimeSpan.FromMinutes(5)).Tag("catalog")));
// [OutputCache(PolicyName = "catalog")] on GET api/book and GetCategoriesList
// admin Post/Put/Delete: await cache.EvictByTagAsync("catalog", ct);   // inject IOutputCacheStore
```
8. Delete the unused `Policies` static class if `UserPolicy` is unused. Keep `AdminPolicy`.

**Verify:** `dotnet build`, `dotnet test`, `GET /health` returns 200, `GET /api/nope` returns 404 ProblemDetails JSON (not `index.html`), `GET /openapi/v1.json` works in Development only, and a thrown `NotFoundException` becomes a 404 response.

---

## Phase B3: Services layer refactor (async, DTOs, SOLID) and the final API shape

```bash
git checkout -b modernize/b3-services
```

This phase changes the API contract. Release it together with frontend phases F1/F5 (see the frontend plan), or version the routes.

1. **Async end to end**, one DAL class at a time (`BookDataAccessLayer` → `CartDataAccessLayer` → `WishlistDataAccessLayer` → `OrderDataAccessLayer` → `UserDataAccessLayer`). In each: methods return `Task<T>`, take a `CancellationToken ct`, and use `ToListAsync`/`FirstOrDefaultAsync`/`AnyAsync`/`SaveChangesAsync`. Remove the `try { } catch { throw; }` wrappers, and every `Task.FromResult(...).ConfigureAwait(true)` in the controllers. Pass `ct` from the action parameter.
   Find what's left:
   ```bash
   grep -rnE "\.(ToList|FirstOrDefault|First|Single|Any|Count|SaveChanges)\(" BookCart/DataAccess BookCart/Controllers
   ```
2. **Rename the services (honest names):** `BookDataAccessLayer` → `BookService`, and so on, and move to a `Services/` folder. Fix the typos (`isUserExists` → `UserExistsAsync`, `CheckUserNameAvailabity` → `IsUsernameAvailableAsync`).
3. **Split interfaces:** move `GetBooksAvailableInCart` to `ICartService` and `GetBooksAvailableInWishlist` to `IWishlistService`. Move the cart-count endpoint from `UserController` to `ShoppingCartController` (`GET api/shoppingcart/count`).
4. **Extract:** `ITokenService` (from `LoginController`), `ICoverStorage` (B0.6 class), `IPasswordService` (B0.2). Controllers only translate HTTP ↔ service calls.
5. **Final route shape.** Drop `userId` from the URL everywhere, and use `ICurrentUser`:

| Old | New |
|---|---|
| `GET api/shoppingcart/{userId}` | `GET api/shoppingcart` |
| `POST api/shoppingcart/addToCart/{userId}/{bookId}` | `POST api/shoppingcart/items/{bookId}` |
| `PUT api/shoppingcart/{userId}/{bookId}` | `PATCH api/shoppingcart/items/{bookId}` (decrement) |
| `DELETE api/shoppingcart/{userId}/{bookId}` | `DELETE api/shoppingcart/items/{bookId}` |
| `DELETE api/shoppingcart/{userId}` | `DELETE api/shoppingcart` |
| `GET api/wishlist/{userId}` | `GET api/wishlist` |
| `GET api/order/{userId}` | `GET api/order` |
| `POST api/checkout/{userId}` | `POST api/checkout` |

   Guest carts: a guest id comes from the HttpOnly cookie (B0.4 step 4). Merge on login is done server side inside the login action (merge the guest cart into the user's cart), so `SetShoppingCart/{old}/{new}` is deleted.
6. **DTOs, not entities.** Add `Dto/BookDto.cs`, `BookCreateRequest`, `CartItemDto` (without the nested EF `Book`), `OrderDto`. Map with explicit `Select(...)` projections (no AutoMapper needed). Bind the book form as a typed model: `[FromForm] BookCreateRequest request, IFormFile? cover` (replaces the `bookFormData` JSON-in-a-form-field hack, and removes over-posting of `BookId`/`CoverFileName`). Controllers return `201 Created` and `204 No Content`, not the magic `int 1`.
7. **Time:** inject `TimeProvider` (`services.AddSingleton(TimeProvider.System)`) and replace `DateTime.Now`/`DateTime.UtcNow` in the services. Tests can then use `FakeTimeProvider`.
8. **Constants:** replace `UserTypeId == 1 ? "Admin" : "User"` and `UserTypeId = 2` with a lookup of `UserType` by name (or enum constants), and `"Upload"` with `StorageOptions`.
9. **Nullability:** make the build warning-free:
   ```bash
   dotnet build -warnaserror:false 2>&1 | grep -c "warning CS86"      # watch this go to 0
   ```
   Use `required` on non-null model properties, `string?` for nullable columns, and `NotFoundException` rather than returning null. Then enable `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>` in `Directory.Build.props`.
10. **Gemini summary endpoint** (replaces the browser-side API call, see frontend F1):
    - `dotnet user-secrets set "Gemini:ApiKey" "<key>"`, `GeminiOptions` with `ValidateOnStart`.
    - `POST api/book/{id}/summary` (`[Authorize]`, rate-limited). It loads the book title from the DB (never trust a client-sent prompt), calls Gemini via a typed `HttpClient`, and caches the result per book id (`IMemoryCache` or `HybridCache`) so repeated clicks cost nothing.

**Verify:** unit tests for the services (`BookCart.Tests/Services/*`, using the test database), the B0 integration tests updated to the new routes and green, the grep above returns nothing, and the build has zero warnings.

---

## Phase B4: Data access and schema (migrations, FKs, indexes, query fixes)

```bash
git checkout -b modernize/b4-data
```

> **This phase changes the database. Run it on a copy first.** Restore the B0 backup into a scratch database, apply, and compare row counts.

1. **Baseline migration (no schema change yet):**
```bash
dotnet tool install --global dotnet-ef        # or: dotnet tool update --global dotnet-ef
cd BookCart
dotnet ef migrations add Baseline
```
Edit the generated `Up()` to be **empty** (the DB already has these tables). Then, on every existing database, record it as applied:
```sql
INSERT INTO __EFMigrationsHistory (MigrationId, ProductVersion) VALUES ('<timestamp>_Baseline', '10.0.0');
```
(Or run `dotnet ef database update` after creating the history table, with the empty `Up`.) From now on `DBScript/BookDB.txt` is only for bootstrapping an empty database. Keep it, but treat migrations as the source of truth.
2. **Fix the model first** (so the following migration is clean): remove the parameterless constructor and the empty `OnConfiguring`, add `IsRequired()` for NOT NULL columns (`Book.Title`, `Book.Author`), add navigation properties (`Cart.Items`, `CartItems.Book`, `CustomerOrders.Details`, `CustomerOrderDetails.Book`, `Wishlist.Items`, `WishlistItems.Book`, `Book.CategoryNavigation` (see the note on `Book.Category` below)), and remove the scaffolded `HasName("PK__...")` constraint names.
3. **Schema migration** (`dotnet ef migrations add SchemaHardening`). Configure in `OnModelCreating`, then review the generated SQL before applying (`dotnet ef migrations script --idempotent -o schema.sql`):
   - Foreign keys with `DeleteBehavior.Cascade` for item → parent (`CartItems→Cart`, `WishlistItems→Wishlist`, `CustomerOrderDetails→CustomerOrders`) and `Restrict` for `→Book`.
   - Indexes: `Cart(UserId)`, `CartItems(CartId, ProductId)` **unique**, `Wishlist(UserId)`, `WishlistItems(WishlistId, ProductId)` unique, `CustomerOrders(UserId)`, `CustomerOrderDetails(OrderId)`, `Book(Category)`, `UserMaster(Username)` unique (already added in B0.2).
   - Check constraints: `Quantity > 0`, `Price >= 0`.
   - `DateCreated` → `datetime2`.
   - `Book.Title`/`Author` → `nvarchar(200)` (existing data converts losslessly).
   - **Before adding the unique and FK constraints, clean the data**, or the migration fails:
   ```sql
   -- orphan rows that would violate the new FKs
   SELECT * FROM CartItems ci LEFT JOIN Cart c ON c.CartId = ci.CartId WHERE c.CartId IS NULL;
   SELECT * FROM CartItems ci LEFT JOIN Book b ON b.BookID = ci.ProductId WHERE b.BookID IS NULL;
   SELECT CartId, ProductId, COUNT(*) FROM CartItems GROUP BY CartId, ProductId HAVING COUNT(*) > 1;
   -- same three checks for WishlistItems and CustomerOrderDetails
   ```
   Put the cleanup (`DELETE` orphans, merge duplicates) at the top of `Up()` with `migrationBuilder.Sql(...)`.
   - `Book.Category` is a free-text `varchar(20)` that duplicates `Categories.CategoryName`. Converting it to a real FK (`CategoryId`) is a larger change that also touches the frontend `Book` model and the category filter. **Leave it as is in this phase** and track it as follow-up work.
4. **Query rewrites** (each with a test that asserts the result is unchanged):
   - `GetOrderList`: one query instead of ~1 + 2N + lines:
   ```csharp
   var orders = await _db.CustomerOrders.AsNoTracking()
       .Where(o => o.UserId == userId).OrderByDescending(o => o.DateCreated)
       .Select(o => new OrderDto(o.OrderId, o.DateCreated, o.CartTotal,
            o.Details.Select(d => new OrderLineDto(d.ProductId, d.Book.Title, d.Book.CoverFileName, d.Quantity, d.Price))))
       .ToListAsync(ct);
   ```
   - Cart and wishlist books: a single `join` or `Select` through the navigation properties instead of a `GetBookData` call per item.
   - Reads: `AsNoTracking()` everywhere that does not modify (remove the manual `Entry(book).State = Detached` in `GetBookData`).
   - Existence checks: `AnyAsync`. Quantity changes and clears: `ExecuteUpdateAsync`/`ExecuteDeleteAsync` (e.g. `ClearCart`, `ClearWishlist`, and the decrement, which removes the row at zero).
   - `GetSimilarBooks`: stop sorting the whole category by `NEWID()`:
   ```csharp
   var count = await q.CountAsync(ct);
   var skip = count > 5 ? Random.Shared.Next(count - 4) : 0;
   return await q.OrderBy(b => b.BookId).Skip(skip).Take(5).ToListAsync(ct);   // five consecutive books from a random window
   ```
   (use a hash of `bookId` if you want it deterministic and cacheable.) Return 404 if the book does not exist.
   - **Create the cart on first write**, not on read: `GetCartId` becomes read-only, and `AddBookToCart` upserts.
   - `MergeCart` runs inside a transaction and is a set operation (`ExecuteUpdate` for rows that move, a merge for duplicates), not a per-item loop.
5. **Pagination** (do it with the frontend's catalog work, F6): `GET api/book?page=1&pageSize=24&category=&search=&minPrice=&maxPrice=` returning `{ items, total }`, with the filtering done in SQL. Keep `GET api/book/all` (cached, `[OutputCache]`) until the frontend is migrated.
6. **Concurrency (optional):** add a `[Timestamp] byte[] RowVersion` to `Book` so two admins editing the same book get a 409 instead of last-write-wins.

**Verify:**
```bash
dotnet ef migrations script --idempotent -o schema.sql     # review it
dotnet ef database update                                  # on the scratch copy first
dotnet test
```
Turn on `LogLevel: Microsoft.EntityFrameworkCore.Database.Command: Information` in Development and load the order and cart pages. Confirm the command count dropped from dozens to one or two per request.

---

## Phase B5: Developer experience and delivery

```bash
git checkout -b modernize/b5-delivery
```

1. `.editorconfig` at the repo root (C# style and analyzer severities). Run `dotnet format` once, as its own commit.
2. `BookCart.csproj`:
   - Rename the target `PublishRunWebpack` → `PublishBuildClient`, use `npm ci` instead of `npm install`.
   - Add `<GenerateDocumentationFile>true</GenerateDocumentationFile>` with `<NoWarn>$(NoWarn);1591</NoWarn>` so the XML comments reach OpenAPI.
3. Solution: `dotnet sln BookCart.sln migrate` (produces `BookCart.slnx`), then delete `BookCart.sln` and the duplicate `BookCart/BookCart.sln`.
4. `launchSettings.json`: remove the unused "IIS Express" profile.
5. Container:
```bash
dotnet publish BookCart/BookCart.csproj -c Release /t:PublishContainer -p:ContainerRepository=bookcart
```
   (or a multi-stage Dockerfile: `node:24` builds the client, `mcr.microsoft.com/dotnet/sdk:10.0` builds the API, `aspnet:10.0` runs it.)
6. CI: `.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with: { global-json-file: global.json }
      - run: dotnet restore
      - run: dotnet build -c Release --no-restore
      - run: dotnet test -c Release --no-build      # Testcontainers works on ubuntu runners (Docker preinstalled)
```
7. Update `README.md` (it says Angular 18 and .NET 8 and tells people to run SQL by hand) and `CLAUDE.md` (commands and the removed admin credentials).
8. Optional: observability with OpenTelemetry (`OpenTelemetry.Extensions.Hosting`, `...Instrumentation.AspNetCore`, `...Instrumentation.EntityFrameworkCore`/`SqlClient`, OTLP exporter) and structured logging (`LoggerMessage` source generator in the order and admin paths).

**Verify:** a clean clone runs `dotnet build && dotnet test` with zero warnings, CI is green, and `docker run` of the container serves `/health`.

---

## Rollback notes

- **B0/B2/B3:** plain `git revert` of the PR. B0.2 is safe to roll back because the legacy `Password` column is only nulled on a user's next login after the hash is verified. Keep the column (do not drop it) until B4 is stable for a release or two.
- **B1:** revert `global.json` and `Directory.Build.props`.
- **B4:** this one is not a plain revert. Keep the pre-migration `.bak`, and write `Down()` methods for the constraint and index changes (the `datetime2` and `nvarchar` conversions are widening, so they are safe to leave).
- The JWT secret rotation in B0.3 logs everyone out. Do it outside business hours.

## Order summary

`B0.1 tests → B0.2 passwords → B0.3 secrets → B0.4 auth → B0.5 checkout → B0.6 upload → B0.7 hardening → B1 .NET 10 → B2 plumbing → B3 services/DTOs/routes → B4 schema/queries → B5 delivery`
