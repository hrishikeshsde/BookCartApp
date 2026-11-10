# BookCart: Architecture and Code Guide for Beginners

This guide explains how BookCart is built, in plain language, and points at the real code for every idea. You do not need to know the terms beforehand: each one is explained the first time it appears. Open the files named in each section next to this guide and read them side by side.

Contents

1. The big picture
2. How one click travels through the whole system
3. The database
4. Backend (ASP.NET Core, C#)
   - 4.1 Folder map
   - 4.2 Layers: Controller, Service, Database
   - 4.3 Dependency Injection (DI)
   - 4.4 Configuration with the Options pattern
   - 4.5 The request pipeline (middleware)
   - 4.6 Login and security (JWT, passwords, guests)
   - 4.7 Error handling
   - 4.8 Talking to the database (Entity Framework Core)
   - 4.9 Checkout: a transaction walk-through
   - 4.10 C# best practices used here
   - 4.11 Design patterns used in the backend
5. Frontend (Angular)
   - 5.1 Folder map
   - 5.2 Start-up and configuration
   - 5.3 Components: smart and dumb
   - 5.4 Signals
   - 5.5 State management with SignalStore
   - 5.6 Services and dependency injection in Angular
   - 5.7 Routing, lazy loading and guards
   - 5.8 Interceptors
   - 5.9 Forms
   - 5.10 Prerendering and hydration
   - 5.11 Angular fundamentals checklist
6. Tests
7. Build, run and deploy
8. A suggested reading order
9. Glossary

---

## 1. The big picture

BookCart is an online book shop. It is **one repository with two programs** that talk to each other:

- **Backend**: an ASP.NET Core Web API written in C#. It owns the data and the rules (who may do what, what a book costs). It talks to **SQL Server**.
- **Frontend**: an Angular app written in TypeScript. It runs in the visitor's browser and draws the screens. It never touches the database; it asks the backend through HTTP calls (URLs that start with `/api/...`).

```
 +----------------------------- Visitor's browser -----------------------------+
 |                                                                              |
 |   Angular app (the screens)                                                  |
 |   components -> stores (state) -> services -> HttpClient                     |
 |                                                  |                           |
 +--------------------------------------------------|---------------------------+
                                                    |  HTTPS, JSON
                                                    |  GET /api/book
                                                    |  POST /api/login  ...
 +--------------------------------------------------v---------------------------+
 |  ASP.NET Core Web API (the rules)                                            |
 |                                                                              |
 |   middleware pipeline -> Controller -> Service -> DbContext (EF Core)        |
 |                                                      |                       |
 +------------------------------------------------------|-----------------------+
                                                        |  SQL
                                         +--------------v-------------+
                                         |        SQL Server          |
                                         |  tables: Book, Cart, ...   |
                                         +----------------------------+
```

Why two programs? The browser is not trusted. Anyone can open the developer tools and change what the page sends. So every important rule (price, who owns a cart, who is an admin) is checked **on the server**. The Angular app only makes things comfortable to use.

### How they run together in development

```
 browser  --->  https://localhost:53424   (Angular dev server, "ng serve")
                      |
                      |  proxy: anything starting with /api, /Upload, /scalar
                      v
                https://localhost:7073    (ASP.NET Core API)
                      |
                      v
                SQL Server (LocalDB or Docker)
```

The proxy is configured in `BookCart/ClientApp/proxy.conf.js`. Because the browser only ever talks to one address, there is no CORS problem (CORS is the browser rule that blocks a page from calling a different address).

### How they run in production

`dotnet publish` builds the Angular app and copies the result into the API's `wwwroot` folder. The API then serves **both** the website files and the `/api/...` calls from one address. The setting in `BookCart.csproj` (the `PublishBuildClient` target) does that copy.

---

## 2. How one click travels through the whole system

Example: a visitor clicks **Add to Cart** on a book.

```
 1  Browser     user clicks the button in AddtocartComponent
 2  Angular     the button emits  (add) with the book id
 3  Angular     BookCardComponent passes it up  ->  HomeComponent.addToCart(bookId)
 4  Angular     HomeComponent calls  cart.add(bookId)           (CartStore)
 5  Angular     CartStore calls CartService.addBookToCart()     -> HttpClient
 6  Angular     interceptors run: add "Authorization: Bearer <token>" if logged in
 7  Network     POST /api/shoppingcart/items/42
 8  Backend     middleware: security headers, auth, rate limit ...
 9  Backend     ShoppingCartController.AddBook(42)
10  Backend     ICurrentUser says who this is (user id or guest id)
11  Backend     CartService.AddBookAsync(owner, 42)             -> EF Core
12  SQL Server  INSERT / UPDATE in CartItems
13  Backend     returns the whole updated cart as JSON (CartItemDto list)
14  Angular     CartStore stores the list in a signal
15  Angular     the nav bar badge and cart page update by themselves
```

Keep this list in mind: every feature in the app follows the same path. Steps 2-6 are explained in the frontend part, steps 8-13 in the backend part.

---

## 3. The database

SQL Server holds the data. The tables are described by C# classes in `BookCart/Models/`, and the structure is created by **migrations** (`BookCart/Migrations/`): small generated files that say "create this table", "add this index". You never edit the database by hand; you change the C# model and generate a new migration.

```
 UserType 1---* UserMaster                      Categories   (list of category names)
                                                 (Book.Category is just text)

 Cart 1---* CartItems *---1 Book           one Cart per owner (unique index on Cart.UserID)
  ^                                        "UserID" holds a user id OR a guest id
  |
 (owner)

 Wishlist 1---* WishlistItems *---1 Book    one Wishlist per user

 CustomerOrders 1---* CustomerOrderDetails      (no link to Book on purpose)
```

Things worth noticing in `BookCart/Models/BookDBContext.Schema.cs`:

- **The database protects itself.** Unique indexes ("one cart per owner", "one row per book in a cart"), foreign keys and `CHECK` rules (`Quantity > 0`, `Price >= 0`) are enforced by SQL Server itself. Even a bug in the C# code cannot save a negative quantity.
- **Order lines have no foreign key to `Book`.** An order is a record of what was bought at what price. If the book is deleted from the shop later, the old order must still exist. (Cart and wishlist rows, in contrast, are deleted together with the book: `OnDelete(DeleteBehavior.Cascade)`.)
- **Guests are not users.** A guest's cart id lives in the same `Cart.UserID` column, but guest ids start at 1,000,000,000 so they never clash with real user ids (`GuestCart.MinId` in `Services/ICurrentUser.cs`).

---

## 4. Backend (ASP.NET Core, C#)

### 4.1 Folder map

```
BookCart/
  Program.cs            5 lines: build the app, wire it, run it
  Extensions/           the wiring, split by topic (one file each)
    OptionsExtensions     typed settings
    PersistenceExtensions database + services registered for DI
    AuthExtensions        JWT login, policies, current user
    ApiExtensions         controllers, errors, docs, rate limits, cache, health
    PipelineExtensions    the order of the middleware
  Controllers/          HTTP endpoints (thin)
  Services/             business rules (the real work)
  Models/               database tables as C# classes + BookDBContext
  Dto/                  the shapes sent to / received from the browser
  Options/              typed configuration classes
  Errors/               custom exceptions + the one place that turns them into HTTP answers
  Migrations/           generated database change scripts
```

### 4.2 Layers: Controller, Service, Database

The backend is a **layered architecture**. Each layer has one job and only talks to the layer below.

```
   HTTP request
        |
        v
  +-------------+   reads the request, checks it is well formed,
  | Controller  |   calls ONE service method, returns the result.
  +------+------+   No business rules here.  (Controllers/)
         |
         v
  +-------------+   the rules: "price comes from the database",
  |  Service    |   "empty cart means no order". (Services/)
  +------+------+
         |
         v
  +-------------+   EF Core translates C# queries into SQL.
  | BookDBContext|  (Models/)
  +------+------+
         |
         v
     SQL Server
```

Look at `Controllers/CheckOutController.cs`. The whole endpoint is a few lines:

```csharp
var orderId = await _orders.CreateOrderAsync(userId, cancellationToken);
return orderId is null
    ? Conflict("There is nothing to check out ...")
    : Ok(new { orderId });
```

All the real logic (pricing, transaction, clearing the cart) is in `Services/OrderService.cs`. This split makes the logic easy to test and reuse.

**DTOs (Data Transfer Objects)** are the shapes that cross the wire. Controllers never return database classes directly; they return DTOs from `Dto/` such as `BookDto`:

```csharp
public record BookDto(int BookId, string Title, string Author, string Category, decimal Price, string? CoverFileName)
```

Why: if you rename a database column tomorrow, the API stays the same; and a client can never send fields you did not expect (this is called *over-posting*). Admin forms use `BookForm`, a DTO with validation attributes (`[Required]`, `[StringLength(100)]`).

### 4.3 Dependency Injection (DI)

This is the most important idea in the backend.

**The problem.** `CheckOutController` needs an order service. The naive way is to write `new OrderService(...)` inside the controller. But then the controller is glued to that exact class, and `OrderService` itself needs a database context, a clock and a logger, which the controller would also have to build.

**The idea.** A class does not create what it needs. It just *asks* for it in its constructor, and the framework (the **DI container**) builds it and hands it over.

```csharp
// Controllers/CheckOutController.cs
public class CheckOutController(IOrderService orders, ICurrentUser currentUser) : ControllerBase
```

Read it as: "to build me, give me an `IOrderService` and an `ICurrentUser`". The controller does not know or care which class implements them.

**Where the container is told what to build.** In `Extensions/PersistenceExtensions.cs`:

```csharp
services.AddScoped<IBookService, BookService>();
services.AddScoped<ICartService, CartService>();
services.AddScoped<IOrderService, OrderService>();
services.AddSingleton<ICoverStorage, CoverStorage>();
services.AddSingleton(TimeProvider.System);
```

"When someone asks for `IOrderService`, create an `OrderService`." This list is called the **composition root**: the one place where all the pieces are connected. `Program.cs` calls these `AddBookCart...` methods, so `Program.cs` itself stays tiny.

**How it chains.** `OrderService` declares what *it* needs:

```csharp
public class OrderService(BookDBContext dbContext, TimeProvider timeProvider, ILogger<OrderService> logger) : IOrderService
```

```
 Request arrives
      |
      v
 CheckOutController  needs IOrderService, ICurrentUser
      |                              \
      v                               v
 OrderService                      CurrentUser
   needs BookDBContext,              needs IHttpContextAccessor, IGuestSession
   TimeProvider, ILogger                       |
                                               v
                                          GuestSession
                                            needs IHttpContextAccessor, IDataProtectionProvider

 The container builds this whole tree for you, for every request.
```

**Lifetimes: how long does the object live?** Choosing this correctly is a key skill.

| Lifetime | Meaning | Used here for |
|---|---|---|
| **Singleton** | one instance for the whole app | `TimeProvider.System`, `ICoverStorage`, `ITokenService`, `IPasswordService` (no per-request data) |
| **Scoped** | one instance per HTTP request | `BookService`, `CartService`, `OrderService`, `ICurrentUser`, `IGuestSession`, `BookDBContext` (they hold per-request data like the database connection) |
| **Transient** | a new instance every time it is asked for | not used here |

A comment in `PersistenceExtensions.cs` explains the rule used: services that depend on the `DbContext` must be *scoped*, never singleton, because a singleton would keep one database connection forever and share it between requests.

**Why interfaces?** `IOrderService` is a promise ("I can create orders"). `OrderService` keeps it. In tests, `ApiFactory` (`BookCart.Tests/ApiFactory.cs`) can swap a service for a fake without touching any controller. This is the **Dependency Inversion Principle**: depend on abstractions, not on concrete classes.

**Primary constructors.** `class OrderService(BookDBContext dbContext, ...)` puts the constructor parameters in the class header (a C# 12 feature). The code then copies them to `readonly` fields, which keeps the class easy to read.

**DI also supplies framework things.** `ILogger<T>`, `IOptions<T>`, `IHttpContextAccessor` are all injected the same way. And typed `HttpClient`s: `services.AddHttpClient<IBookSummaryService, GeminiBookSummaryService>(...)` registers a service that receives a pre-configured `HttpClient` (base address and timeout set once).

### 4.4 Configuration with the Options pattern

Settings (secret key, token lifetime, rate limits) are not read as loose strings. Each group is a small class in `Options/BookCartOptions.cs`:

```csharp
public sealed class JwtOptions
{
    public const string Section = "Jwt";
    [Required, MinLength(32)] public string SecretKey { get; init; } = "";
    [Range(1, 24 * 60)]       public int ExpiryMinutes { get; init; } = 60;
}
```

`Extensions/OptionsExtensions.cs` connects the class to the `Jwt` section of the configuration and **validates it when the app starts**:

```csharp
services.AddOptions<JwtOptions>().BindConfiguration(JwtOptions.Section)
        .ValidateDataAnnotations().ValidateOnStart();
```

Benefit: if the secret key is missing or too short, the app **refuses to start** with a clear message instead of failing on the first login. Services then ask for `IOptions<JwtOptions>` through DI (see `TokenService`). A project rule says "do not read `IConfiguration` keys directly".

Where do the values come from? A stack of sources, later ones win: `appsettings.json`, `appsettings.Development.json`, **user-secrets** (your machine only, used for the connection string and JWT key), then **environment variables** (used in Docker).

### 4.5 The request pipeline (middleware)

Every request passes through a chain of small steps called **middleware**, then reaches the endpoint, and the response travels back through the chain. The order is set in `Extensions/PipelineExtensions.cs`. Order matters, and the file has a comment on each step.

```
 request ->  [1 security headers]
             [2 exception handler]      catches errors from everything below
             [3 status code pages]
             [4 HTTPS redirect]
             [5 compression]
             [6 static files]           Angular files, covers; may answer here and stop
             [7 routing]                which endpoint matches this URL?
             [8 rate limiter]           too many calls from this IP? -> 429
             [9 authentication]         read the JWT, know who you are
             [10 "no endpoint" => 404]
             [11 authorization]         are you allowed here?
             [12 output cache]
             [13 endpoint: controller]  runs your code
 response <-  (travels back up the same chain)
```

Ideas to notice:

- **Secure by default.** `AuthExtensions` sets a `FallbackPolicy` that requires a signed-in user. Every endpoint is locked unless it says `[AllowAnonymous]`. Forgetting an attribute makes an endpoint *safer*, not open.
- **Output caching.** `GET api/book` is cached for 5 minutes (tag `catalog`). When an admin adds, edits or deletes a book, `BookController` calls `EvictByTagAsync` so the cache is cleared.
- **Rate limiting.** Login and registration allow 10 attempts per minute per IP (`"auth"` policy in `ApiExtensions`), to slow down password guessing.
- **Health check.** `GET /health` is unhealthy if the database cannot be reached or migrations are missing.
- **SPA fallback.** At the end, any URL that is not a file and not an API call returns the Angular `index.html`, so a refresh on `/shopping-cart` still works.

### 4.6 Login and security

**Authentication** answers "who are you?". **Authorization** answers "what may you do?".

```
 LOGIN
 Browser                         API                                   Database
    | POST /api/login            |                                        |
    | {username, password} ----> | LoginController                        |
    |                            |  UserService.AuthenticateAsync ------> | find user
    |                            |  PasswordService.Verify (hash check)   |
    |                            |  merge guest cart into user cart       |
    |                            |  TokenService.CreateToken (JWT)        |
    | <---- { token, userDetails }                                        |
    |
    | stores token in localStorage (TokenStorage)
    |
 LATER CALLS
    | GET /api/order             |
    | Authorization: Bearer <JWT>|  JwtBearer middleware validates the
    | -------------------------> |  signature, issuer, audience, expiry
    |                            |  -> HttpContext.User is filled in
    |                            |  -> OrderController runs
```

- **JWT** (JSON Web Token) is a signed note: it carries the user id, name and role, and is signed with the secret key (`Services/TokenService.cs`). The server does not need to store sessions; it just checks the signature. The Angular app can read the note (it is not secret) but cannot forge it.
- **Passwords are never stored as text.** `Services/PasswordService.cs` uses ASP.NET Identity's `PasswordHasher`. Old plain-text rows from the legacy database are accepted once and immediately upgraded to a hash.
- **Roles.** `[Authorize(Policy = UserRoles.Admin)]` on book add/update/delete (`BookController`) allows only admins.
- **No user id in any URL.** This prevents the classic attack called *IDOR* (changing `/api/cart/5` to `/api/cart/6` to read someone else's cart). `ICurrentUser` (`Services/ICurrentUser.cs`) reads the id from the validated token, so there is nothing for an attacker to change.
- **Guests.** A visitor who is not logged in can still fill a cart. The first "add to cart" calls `GuestSession.StartOrContinue()`, which creates a random id and stores it in an **encrypted, HttpOnly cookie** (`bc_guest`) using ASP.NET Data Protection. The browser's JavaScript cannot read the cookie, and a forged cookie fails decryption and is treated as "no guest". On login, `LoginController` calls `CartService.MergeAsync(guestId, userId)` to move the guest's books into the user's cart.

```
 guest adds a book ---> cookie bc_guest = encrypt(randomGuestId)
 guest logs in      ---> MergeAsync(guestId -> userId), cookie deleted
```

- **Other protections**: security headers and a Content-Security-Policy (in the pipeline's first step), upload validation that checks file type, size and *content* (`Services/CoverStorage.cs`), and the server ignoring any price sent by the browser at checkout.

### 4.7 Error handling

Services signal expected problems by throwing small custom exceptions (`Errors/AppExceptions.cs`): `NotFoundException`, `BadRequestException`, `ConflictException`. One class, `Errors/ApiExceptionHandler.cs`, turns every exception into the right HTTP answer:

```
 NotFoundException  -> 404      BadRequestException -> 400
 ConflictException  -> 409      anything else       -> 500 (logged, details hidden)
```

The body is **ProblemDetails**, the standard JSON error format (`type`, `title`, `status`, `detail`). Benefits: controllers stay free of try/catch, every error looks the same, and a crash never leaks a stack trace to the visitor. The Angular side reads these through `errorText(...)` in `shared/http-error.ts`.

### 4.8 Talking to the database (Entity Framework Core)

EF Core is an **ORM**: you write C# (LINQ), it writes the SQL. `BookDBContext` is the door to the database; each `DbSet<Book> Book` is a table.

Good habits you can see in the services:

```csharp
// Services/BookService.cs
_db.Book.AsNoTracking().Select(BookDto.FromBook).ToListAsync(cancellationToken);
```

- `AsNoTracking()`: for read-only queries, skips the bookkeeping EF does to detect changes (faster).
- `.Select(BookDto.FromBook)`: **projection**. Only the needed columns are read, straight into the DTO. Nothing extra is loaded.
- `ToListAsync(cancellationToken)`: the query is *async* and can be cancelled if the browser disconnects.
- `SearchBooksAsync` filters and pages **in the database** (`Where`, `Skip`, `Take`), not in memory.
- `ExecuteDeleteAsync` (see `OrderService`): a single `DELETE` statement without loading rows first.
- `GetOrdersAsync`: one query for all order lines instead of one query per order (avoids the "N+1" problem).

**DbContext pooling and retries** (`PersistenceExtensions`): `AddDbContextPool` reuses context objects, and `EnableRetryOnFailure()` retries short-lived SQL failures automatically.

**Concurrency.** Two requests can collide (two "first book added" at once). The unique index lets only one win; the loser catches the violation (`Services/DatabaseErrors.cs`) and carries on with the winner's row. The database is the referee, not hope.

### 4.9 Checkout: a transaction walk-through

A **transaction** means "all of these steps happen, or none do". `OrderService.CreateOrderAsync` is the best example in the project:

```
 POST /api/checkout      (body is ignored on purpose)
        |
        v
 CheckOutController: who is calling?  (ICurrentUser.UserId, from the JWT)
        |
        v
 OrderService.CreateOrderAsync
   +-- run inside the retry "execution strategy"
   |
   |   BEGIN TRANSACTION
   |    1. find the user's cart
   |    2. read the cart lines joined with Book -> CURRENT prices from the database
   |    3. DELETE the cart items; count deleted rows
   |         if deleted != lines read  -> someone else already checked out -> return null
   |    4. create CustomerOrders (total = sum of price x quantity, computed here)
   |    5. create CustomerOrderDetails (price paid is copied into the order line)
   |    6. SaveChanges
   |   COMMIT
   |
   +-- return the new order id
        |
        v
 id == null ? 409 Conflict : 200 { orderId }
```

Why it is safe: the browser cannot lie about prices (they are read in step 2); a double-click cannot create two orders (step 3 "claims" the cart first, and the database blocks the second request until the first commits); and a crash in the middle leaves no half-finished order.

### 4.10 C# best practices used here

| Practice | Where to see it |
|---|---|
| `async`/`await` end to end, with a `CancellationToken` | every service method, `Task<...>` controller actions |
| Nullable reference types on (`string?` means "may be null") | `Directory.Build.props`; `Book.CoverFileName` |
| `record` for immutable data | `Dto/BookDto.cs` |
| Primary constructors | controllers and services |
| Pattern matching: `is { } owner`, `is not { } userId`, `switch` expressions | `ShoppingCartController`, `ApiExceptionHandler` |
| Collection expressions `[]` | `CurrentCartAsync` returns `[]` |
| `TimeProvider` instead of `DateTime.Now` (testable clock, UTC) | `OrderService`, `TokenService` |
| `sealed` classes for options | `Options/BookCartOptions.cs` |
| Structured logging with placeholders (`"User {UserId} logged in"`), never passwords | `LoginController`, `OrderService` |
| One place for expected errors (custom exceptions + ProblemDetails) | `Errors/` |
| Validation by attributes on DTOs, `[ApiController]` auto-returns 400 | `Dto/BookForm.cs` |
| XML doc comments that become the API documentation | all controllers; `/scalar/v1` in Development |
| Build rules: warnings are errors, central NuGet versions, pinned SDK | `Directory.Build.props`, `Directory.Packages.props`, `global.json` |
| Code style enforced by `dotnet format --verify-no-changes` | `.editorconfig`, CI |
| Small extension methods keep `Program.cs` short | `Extensions/` |
| Integration tests against the real API and a real database | `BookCart.Tests/` |

### 4.11 Design patterns used in the backend

| Pattern | Idea in one line | Example here |
|---|---|---|
| Layered architecture | each layer has one job | Controller -> Service -> DbContext |
| Dependency Injection / Inversion of Control | classes ask for what they need | constructors everywhere |
| Repository / Unit of Work | the data-access object collects changes and saves them together | `BookDBContext` (EF Core already is both, so no extra repository classes) |
| DTO | separate the wire shape from the database shape | `Dto/` |
| Options pattern | typed, validated settings | `Options/` |
| Chain of Responsibility | a request passes through a chain of handlers | middleware pipeline |
| Strategy | interchangeable behaviour behind an interface | `IExceptionHandler`, EF `ExecutionStrategy`, `IPasswordService` |
| Facade | one simple interface hiding detail | `ICartService`, `ITokenService` |
| Policy-based authorization | rules defined once, applied by name | `UserRoles.Admin` policy |
| Composition root | all wiring in one place | `Extensions/*` |
| Typed client | a configured `HttpClient` owned by one service | `GeminiBookSummaryService` |
| Cache-aside with invalidation | cache reads, evict on writes | output cache tag `catalog` |

---

## 5. Frontend (Angular)

### 5.1 Folder map

```
BookCart/ClientApp/src/
  main.ts                   starts the app
  app/
    app.config.ts           global setup (router, HTTP, interceptors, hydration)
    app.component.*         the page frame: nav bar + <router-outlet>
    routes/                 which URL shows which component
    components/             screens and small UI pieces
    state/<feature>/        one SignalStore per feature (auth, cart, books ...)
    services/               talk to the API / browser storage
    guards/                 "may this visitor open this page?"
    interceptors/           code that runs on every HTTP call
    models/                 TypeScript interfaces describing the data
    shared/                 small helpers (call state, error text, safe redirect)
    testing/                fakes for unit tests
  styles/                   Material theme + Tailwind
```

### 5.2 Start-up and configuration

`main.ts` is one line of substance:

```ts
bootstrapApplication(AppComponent, appConfig)
```

`app/app.config.ts` is the Angular equivalent of the backend's composition root: a list of **providers** (things made available to the whole app):

```ts
provideZonelessChangeDetection(),            // no zone.js, see 5.4
provideHttpClient(withFetch(), withInterceptors([ ... ])),
provideRouter(APP_ROUTES, withComponentInputBinding(), withPreloading(SelectivePreloadingStrategy)),
provideClientHydration(withNoIncrementalHydration()),
```

Everything is a **standalone component**: there are no `NgModule` files. Each component lists what it uses in its own `imports: [...]`.

### 5.3 Components: smart and dumb

A **component** = a TypeScript class + an HTML template + styles. Components form a tree:

```
 AppComponent
  +-- NavBarComponent          (smart: reads auth, cart, wishlist stores)
  +-- <router-outlet>          (shows the page for the current URL)
        +-- HomeComponent                      (smart)
              +-- BookFilterComponent          (dumb)
              +-- PriceFilterComponent         (dumb)
              +-- BookCardComponent  x many    (dumb)
                    +-- AddtocartComponent     (dumb)
                    +-- AddtowishlistComponent (dumb)
```

The project splits components in two kinds:

- **Smart (container)** components are route pages. They inject the stores, read data and decide what happens. Example: `components/home/home.component.ts` injects `BooksStore`, `CartStore`, `WishlistStore`.
- **Dumb (presentational)** components only receive data through `input()` and report events through `output()`. They never inject a store. Example: `AddtocartComponent`:

```ts
readonly bookId = input.required<number>();
readonly add = output<number>();
```
```html
<button matButton="filled" (click)="add.emit(bookId())">Add to Cart</button>
```

Data flows **down** through inputs and events flow **up** through outputs:

```
 HomeComponent (smart)   cart.add(bookId)   <--------------------+
   |  [book]="book"                                              |
   v                                                             |
 BookCardComponent (dumb) --(addToCart)="addToCart($event)"------+
   |  [bookId]="book().bookId"                                   ^
   v                                                             |
 AddtocartComponent (dumb) --(add)---------------------------------+
```

Why bother? Dumb components are trivial to test, reuse anywhere, and cannot cause surprising side effects.

### 5.4 Signals

A **signal** is a box holding a value that tells Angular when it changes. Reading is a function call: `count()`.

| Tool | What it does | Example in the project |
|---|---|---|
| `signal(x)` | a value you can `.set()` or `.update()` | `priceFilter = signal(Number.MAX_SAFE_INTEGER)` in `HomeComponent` |
| `computed(() => ...)` | a value calculated from other signals; recalculated only when they change | `visibleBooks` filters the books by category, search text and price |
| `input()` / `input.required()` | a value the parent passes in | `category = input<string>()` |
| `output()` | an event the parent can listen to | `addToCart = output<number>()` |
| `linkedSignal` | a value that resets when its source changes | `pageIndex` goes back to page 0 whenever the list length changes |
| `effect(() => ...)` | runs code when signals it reads change | `CartStore` reloads when the user changes |

```ts
// HomeComponent: the list on screen is derived, never copied by hand
protected readonly visibleBooks = computed(() => {
  const category = this.category()?.toLocaleLowerCase();
  const maxPrice = this.priceFilter();
  return this.books().filter(book => (!category || ...) && book.price <= maxPrice);
});
```

Change the price slider, and `visibleBooks` and the page update by themselves. There is no manual "refresh" code.

**Zoneless + OnPush.** Older Angular used `zone.js` to guess when to redraw. This app turns it off (`provideZonelessChangeDetection()`), and every component is `ChangeDetectionStrategy.OnPush`: it redraws only when a signal it uses, an input, or an event changes. Faster, and easier to reason about. The rule that follows: **never change a plain field in an async callback**; use a signal.

**Templates** use the modern control flow `@if`, `@else if`, `@for (book of books; track ...)` (see `home.component.html`), and `track` tells Angular how to reuse DOM elements.

### 5.5 State management with SignalStore

**State** is the data the app remembers (who is logged in, what is in the cart). Keeping it in one place per topic avoids "who owns this data?" confusion. The project uses **NgRx SignalStore**, one per feature in `app/state/`:

`AuthStore`, `CartStore`, `BooksStore`, `CategoriesStore`, `WishlistStore`, `OrdersStore`, `SimilarBooksStore`, `RegisterStore`.

A store is assembled from blocks (open `state/cart/cart.store.ts`):

```ts
export const CartStore = signalStore(
  { providedIn: "root" },                          // one shared instance for the app
  withState<{ items: ShoppingCart[] }>({ items: [] }),   // the data
  withCallState(),                                 // loading / loaded / error, see below
  withComputed(({ items }) => ({                   // derived values
    count: computed(() => items().reduce((n, i) => n + i.quantity, 0)),
    total: computed(() => items().reduce((t, i) => t + i.book.price * i.quantity, 0)),
  })),
  withMethods((store, cartService = inject(CartService)) => ({   // actions
    add: rxMethod<number>(pipe(
      tap(() => patchState(store, setLoading())),
      switchMap(bookId => cartService.addBookToCart(bookId).pipe(...))
    )),
  })),
  withHooks(...)                                   // reacts to other stores
);
```

How to read it:

- `withState`: the stored data. Change it only with `patchState(store, {...})`.
- `withComputed`: calculated values (the nav bar's cart badge is `cart.count()`).
- `withMethods`: what components may call. `rxMethod` turns an RxJS pipeline into a method; `switchMap` cancels an older call if a new one starts. `tapResponse` handles success and error.
- `withCallState()` (`shared/with-call-state.ts`): a reusable block that adds `callState` (`"init" | "loading" | "loaded" | {error}`) plus `loading()`, `loaded()`, `error()`. Pages use it for spinners and error text.
- `withHooks`: `onInit` runs when the store is created. `CartStore` uses an `effect` there that watches `AuthStore.userId()`: when someone logs in it reloads (the server has merged the guest cart), and when they log out it empties itself. `AuthStore` knows nothing about the other stores; they watch it. That keeps the dependencies pointing one way.

```
 data flow
 Component --calls--> store method --> Service --> HTTP --> API
     ^                     |
     |                     v
     +---- reads signals <-- patchState(store, ...)
```

`BooksStore` also uses `withEntities`, which gives a ready-made, id-keyed list with `setAllEntities`, `addEntity`, `updateEntity`, `removeEntity`. It fetches the catalogue once; admin changes edit the list in place instead of refetching.

### 5.6 Services and dependency injection in Angular

Angular has DI too, and it works like the backend one. A class marked `@Injectable({ providedIn: "root" })` becomes a **singleton** for the app, and you ask for it with `inject()`:

```ts
@Injectable({ providedIn: "root" })
export class CartService {
  private readonly http = inject(HttpClient);
  getCartItems() { return this.http.get<ShoppingCart[]>("/api/shoppingcart"); }
}
```

| Backend (C#) | Frontend (Angular) |
|---|---|
| `services.AddSingleton<...>()` | `@Injectable({ providedIn: "root" })` |
| constructor parameters | `inject(Something)` |
| `appsettings`/Options | `ApplicationConfig` providers |
| `ILogger`, `IOptions` | `HttpClient`, `Router`, `PLATFORM_ID` |

Responsibilities are separated: **services** talk to the outside world (HTTP, browser storage); **stores** hold state and orchestrate; **components** show it. `TokenStorage` (`services/token-storage.service.ts`) is the only file that knows the login token sits in `localStorage` (and it checks `isPlatformBrowser`, because there is no `localStorage` while pages are prerendered, see 5.10).

### 5.7 Routing, lazy loading and guards

`routes/app.routes.ts` maps URLs to components:

```ts
{ path: "login", loadComponent: () => import("../components/login/login.component").then(c => c.LoginComponent) },
{ path: "checkout", loadComponent: ..., canActivate: [authGuard] },
{ path: "admin/books", loadChildren: () => import("./admin.routes")..., canMatch: [adminGuard],
  data: { preload: false } },
```

- **Lazy loading** (`loadComponent` with `import(...)`): the code of a page is downloaded only when first needed, so the first page loads faster. Only the home page is loaded up front.
- **`SelectivePreloadingStrategy`**: after the first page, the browser quietly downloads other pages in the background, except routes marked `preload: false` (admin pages, which most visitors never open).
- **`withComponentInputBinding()`**: route and query values arrive as `input()`s (`/search?item=abc` fills `item = input<string>()` in `HomeComponent`), so components never touch `ActivatedRoute`.
- **Guards** are plain functions that decide whether navigation continues (`guards/auth.guard.ts`):

```ts
export const authGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  return inject(AuthStore).isAuthenticated()
    ? true
    : router.createUrlTree(["/login"], { queryParams: { returnUrl: state.url } });
};
```

```
 visitor opens /checkout
        |
   authGuard: signed in? --yes--> page opens
        |no
        v
   redirect to /login?returnUrl=/checkout
        |   (login succeeds)
        v
   AuthStore.login -> router.navigateByUrl(safeReturnUrl(returnUrl))
```

`adminGuard` is a `CanMatchFn`: if it says no, the admin route *does not exist* for that visitor and its code is never downloaded. `safeReturnUrl` (`shared/return-url.ts`) only allows app-internal addresses, so a crafted link cannot send someone to another website after login.

**Important**: guards only improve the experience. Real protection is the backend's `[Authorize]`. Never trust the browser.

### 5.8 Interceptors

An **interceptor** is a function that sees every HTTP request on its way out and every response on its way back. They are registered in `app.config.ts`:

```
 component/store -> HttpClient
                      |
        1 noApiOnServerInterceptor   (skips /api calls while pages are prerendered)
        2 authTokenInterceptor       (adds  Authorization: Bearer <token>)
        3 errorInterceptor           (reacts to failures)
                      |
                   network -> API
```

`errorInterceptor` (`interceptors/error-interceptor.service.ts`) in short: a **401** (not from the login call) means the token is no longer good, so `AuthStore.expireSession()` clears it and sends the visitor to log in; **403** and **5xx** show a snackbar message. It always re-throws the original error so callers can still react.

### 5.9 Forms

Login, registration, checkout and the admin book form use **reactive forms**: the form is defined in TypeScript (`NonNullableFormBuilder`, `Validators`), and the template binds to it. Validation messages come from `mat-error`. `services/custom-validation.service.ts` has custom rules, such as a check that asks the API whether a username is free (the backend rate-limits that lookup). Reactive forms are testable because the rules live in code, not in the HTML.

### 5.10 Prerendering and hydration

The production build **draws `/`, `/login` and `/register` as ready HTML at build time** (`app.routes.server.ts`). Visitors see content immediately, even before JavaScript loads; then Angular **hydrates**: it takes over the existing HTML instead of redrawing it. There is no Node server at run time; ASP.NET just serves the pre-drawn files. Consequences you will notice in the code: nothing may touch `window`/`localStorage` unguarded, API calls are skipped during the drawing, and the nav bar adapts to screen size with CSS rather than JavaScript so the page does not "jump".

### 5.11 Angular fundamentals checklist

| Concept | Where it is in this project |
|---|---|
| Standalone components | all of `components/` |
| Templates, `@if`, `@for` | `home.component.html` |
| Property binding `[x]`, event binding `(x)` | `<app-book-card [book]="book" (addToCart)="...">` |
| `input()` / `output()` | dumb components |
| Signals, `computed`, `linkedSignal`, `effect` | `HomeComponent`, stores |
| OnPush + zoneless | every component, `app.config.ts` |
| Dependency injection, `inject()` | services, stores, guards, interceptors |
| Services and `HttpClient` | `services/*.ts` |
| RxJS (`pipe`, `switchMap`, `catchError`) | stores, interceptors |
| Routing, lazy loading, guards, preloading | `routes/`, `guards/` |
| Interceptors | `interceptors/` |
| Reactive forms | login, register, checkout, book form |
| State management | `state/` (SignalStore) |
| `NgOptimizedImage` | `book-card` (fast, correctly sized pictures) |
| Angular Material + Tailwind | `styles/theme.scss`, component templates |
| SSR/prerender + hydration | `main.server.ts`, `app.routes.server.ts` |
| Unit tests (Vitest) | `*.spec.ts` next to the code |
| TypeScript `strict` | `tsconfig.json`; models are `interface`s in `models/` |

---

## 6. Tests

**Backend** (`BookCart.Tests/`, run with `dotnet test BookCart.Tests -c Release`). These are **integration tests**: `ApiFactory` starts the real API in memory against a throwaway LocalDB database (`BookDB_Test`, dropped and rebuilt on every run with the real migrations) and sends real HTTP requests. Helpers in `TestClients.cs` build anonymous, logged-in and guest clients. Files are grouped by topic: `CheckoutTests`, `SecurityTests`, `ConcurrencyTests`, `SchemaTests`, `UploadTests`, and so on. One test even fails if the C# model and the migrations disagree.

**Frontend** (`npm test` in `ClientApp`, uses Vitest): each store and component has a `.spec.ts` beside it. Store tests use the real store with a fake HTTP backend (`HttpTestingController`); component tests use fake stores from `src/app/testing/`. `scripts/smoke` is a browser click-through of the real app.

**CI** (`.github/workflows/ci.yml`) runs on every push: format check, build with warnings as errors, backend tests, frontend tests, production build.

---

## 7. Build, run and deploy

| Task | Command |
|---|---|
| Run backend (debug in Visual Studio 2026) | profile `BookCart (API only)` -> F5 |
| Run frontend (VS Code) | `cd BookCart/ClientApp` then `npm start` |
| Backend tests | `dotnet test BookCart.Tests -c Release` |
| Frontend tests | `npm test` |
| Production build | `dotnet publish BookCart/BookCart.csproj -c Release` |
| Database changes | edit the model, then `dotnet ef migrations add <Name> --project BookCart` |

Planned Docker deployment is described in `docs/DEPLOYMENT_IMPLEMENTATION_PLAN.md`.

---

## 8. A suggested reading order

1. `BookCart/Program.cs` (5 lines), then each file in `Extensions/` to see how the app is assembled.
2. `Models/BookDBContext.Schema.cs` to understand the data rules.
3. `Controllers/ShoppingCartController.cs` -> `Services/CartService.cs`: a complete small feature.
4. `Services/ICurrentUser.cs` and `Services/TokenService.cs`: who is calling.
5. `Services/OrderService.cs`: the transaction.
6. `ClientApp/src/app/app.config.ts`, `routes/app.routes.ts`.
7. `components/home/home.component.ts` + `.html` -> `book-card` -> `addtocart` (smart to dumb).
8. `state/cart/cart.store.ts`, `state/auth/auth.store.ts`.
9. `interceptors/`, `guards/`.
10. Finally, a test (`BookCart.Tests/CheckoutTests.cs`, `state/cart/cart.store.spec.ts`) to see how behaviour is checked.

Exercise ideas: set a breakpoint in `ShoppingCartController.AddBook` and click Add to Cart; watch `ICurrentUser.CartOwnerId` for a guest and for a logged-in user. Change the price filter and watch `visibleBooks` recompute. Remove `[Authorize]` from a test controller and see the fallback policy still protect it.

---

## 9. Glossary

- **API**: a set of URLs a program can call to get or change data.
- **ASP.NET Core**: Microsoft's framework for web servers in C#.
- **Authentication / Authorization**: who you are / what you may do.
- **Claim**: one fact inside a token (user id, role).
- **Component**: an Angular building block: class + template + styles.
- **Controller**: the class that receives HTTP requests.
- **Dependency Injection (DI)**: classes receive what they need instead of creating it.
- **DTO**: a plain object shaped for sending over the network.
- **EF Core (ORM)**: turns C# queries into SQL and rows into objects.
- **Guard**: an Angular function that allows or blocks navigation.
- **Hydration**: Angular taking over HTML that was drawn in advance.
- **Interceptor**: code that runs on every HTTP call.
- **JWT**: a signed token carrying who you are.
- **Lazy loading**: downloading code only when it is needed.
- **Middleware**: one step in the request pipeline.
- **Migration**: a generated script that changes the database structure.
- **Options pattern**: strongly typed, validated configuration.
- **Signal**: an Angular value that notifies its readers when it changes.
- **SignalStore**: an NgRx store built from signals.
- **Transaction**: a group of database steps that all succeed or all fail.
