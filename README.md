# BookCart

An e-commerce application for an online book store created with ASP.NET Core (.NET 10) and Angular 20, using SQL Server as database.

# Concepts Covered

### .NET

 - Web API with EF Core migrations (code first)
 - Policy based Authorization using JWT
 - Service layer, DTOs and problem-details error handling
 - Dependency Injection
 - OpenAPI document and Scalar API reference (development only)

### Angular

 - Angular Material 
 - Routing & Navigation
 - Auth guards
 - Standalone components
 - Lazy loading of Standalone components
 - HTTP Interceptors
 - Reactive forms
 - Form validation (inbuilt and custom)
 - Pipes

# Prerequisites
- Visual Studio 2022 17.13 or newer (the solution is `BookCart.slnx`), or any editor with the .NET CLI
- SQL Server 
- .NET 10 SDK (pinned in global.json)
- Node.js 22 or newer for the Angular app

# Steps to run the app
1. Clone the Repo
2. Create an empty SQL Server database, then create its tables and reference data with the EF Core migrations:
   `dotnet tool restore`, then `BOOKCART_EF_CONNECTION="<your connection string>" dotnet ef database update --project BookCart`.
   (An existing database created from the old DBScript needs the upgrade steps in [docs/BACKEND_CHANGES.md](docs/BACKEND_CHANGES.md) (section B4).)
3. Set your secrets with [user-secrets](https://learn.microsoft.com/aspnet/core/security/app-secrets) from the `BookCart` folder:
   `dotnet user-secrets set "ConnectionStrings:DefaultConnection" "<your connection string>"` and
   `dotnet user-secrets set "Jwt:SecretKey" "<a random string of at least 32 characters>"`.
   Optional, for AI book summaries: `dotnet user-secrets set "Gemini:ApiKey" "<your key>"`.
4. Run `dotnet run --launch-profile BookCart` from the `BookCart` folder (or launch from Visual Studio). The first Debug build installs the
   Angular app's packages (`npm ci`; `ClientApp/.npmrc` sets `legacy-peer-deps` because the `@ngrx` 19 packages declare an Angular 19 peer).
5. Register a user in the app, then make them an admin: `UPDATE UserMaster SET UserTypeID = 1 WHERE Username = '<username>'`.

# One-click scripts (Windows)

Need Docker Desktop and the .NET 10 SDK + Node.js. Run them by double-clicking or from a terminal.

| Script | What it does |
|---|---|
| `scriptsdev-start-all.bat` | Development: starts SQL Server in Docker (`bookcart-dev-sql`, port 14330, data kept in a volume), applies the migrations, then opens the backend (https://localhost:7073) and the frontend (https://localhost:53424) in their own windows. |
| `scriptsdev-sql.bat`, `dev-backend.bat`, `dev-frontend.bat` | The same three parts on their own. |
| `scriptsdev-stop.bat` | Stops the development SQL Server (data stays). |
| `scriptselease.bat` | Production release on this machine: publishes the binaries to `artifactspublish`, builds the Docker image (`bookcart:latest` and `bookcart:<date-time>`), starts SQL Server + the app with Docker Compose (`deploydocker-compose.yml`), **backs up an existing database** (`deployackups`), asks before applying the migrations, and waits for `/health`. Run with `/y` to skip the question. |

The first `release.bat` run creates `deploy.env` with generated secrets (SQL Server password, JWT key). It is git-ignored: keep a copy, and set `JWT_ISSUER`/`JWT_AUDIENCE` to the public address and optionally `GEMINI_API_KEY`. The site is then on http://localhost:8080 (plain HTTP: put a TLS proxy in front for real use). The first time, trust the dev certificate once: `dotnet dev-certs https --trust`.

The release stack runs the app with the SQL Server `sa` account, which is fine on one machine but not for a shared server: create a limited login there.

# Run tests

`dotnet test BookCart.Tests -c Release`. The tests host the real API on a throwaway LocalDB database (`BookDB_Test`, dropped and rebuilt on every run).
Set `BOOKCART_TEST_DB` to use another SQL Server; never point it at a real database.

# Container

`dotnet publish BookCart/BookCart.csproj -c Release -t:PublishContainer` builds the Angular app and a Linux image (`bookcart`, runs as a non-root user,
listens on HTTP port 8080) with the .NET SDK, no Dockerfile needed. Add `--os linux --arch x64 -p:ContainerArchiveOutputPath=bookcart.tar` to write a
tar archive instead of using a local Docker daemon. Configure it with environment variables:

| Variable | Purpose |
|---|---|
| `ConnectionStrings__DefaultConnection` | SQL Server connection string (required) |
| `Jwt__SecretKey` | Token signing key, at least 32 characters (required) |
| `Jwt__Issuer`, `Jwt__Audience` | Set to the public address of the site |
| `Gemini__ApiKey` | Optional; without it book summaries answer 503 |
| `Storage__UploadFolder` | Folder for uploaded covers; mount a volume there and `chown` it to uid 1654 (the container user), otherwise uploads fail |
| `Security__DataProtectionKeysPath` | Folder for the guest-cookie encryption keys; mount a volume (owned by uid 1654), or guest carts are lost on every restart. Keys are stored unencrypted, so keep the volume private |
| `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` | When behind a reverse proxy that terminates TLS |

The image speaks plain HTTP: put TLS in front of it (HTTPS redirection logs a warning and does nothing while the app has no HTTPS port).
The database schema is not created by the container: run the migrations first (step 2 above).
[.github/workflows/ci.yml](.github/workflows/ci.yml) builds, checks formatting, runs the tests against a SQL Server container and builds the image archive.

# Live Demo
[https://bookcart.azurewebsites.net/](https://bookcart.azurewebsites.net/)

# License
[MIT](https://github.com/hrishikeshsde/BookCartApp/blob/master/LICENSE)

