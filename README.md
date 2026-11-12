# BookCart

An e-commerce application for an online book store created with ASP.NET Core (.NET 10) and Angular 22, using SQL Server as database.

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
- Visual Studio 2026 (the solution is `BookCart.slnx`; the projects target .NET 10, which Visual Studio 2022 does not load), or any editor with the .NET CLI
- SQL Server 
- .NET 10 SDK (pinned in global.json)
- Node.js 24.15 or newer (or 22.22.3 or newer 22.x) for the Angular app

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
   Angular app's packages (`npm ci`).
5. Register a user in the app, then make them an admin: `UPDATE UserMaster SET UserTypeID = 1 WHERE Username = '<username>'`.

# One-click scripts (Windows)

Run them by double-clicking or from a terminal. The development scripts need Docker Desktop and the .NET 10 SDK + Node.js; `release.bat` needs only Docker Desktop and Git for Windows.

| Script | What it does |
|---|---|
| `scripts\dev-start-all.bat` | Development: starts SQL Server in Docker (`bookcart-dev-sql`, port 14330, data kept in a volume), applies the migrations, then opens the backend (https://localhost:7073) and the frontend (https://localhost:53424) in their own windows. |
| `scripts\dev-sql.bat`, `dev-backend.bat`, `dev-frontend.bat` | The same three parts on their own. |
| `scripts\dev-stop.bat` | Stops the development SQL Server (data stays). |
| `scripts\release.bat` | Deploys with Docker on this machine: it makes sure Docker Desktop is running and hands over to `deploy/deploy.sh` through Git Bash (see "Deploying with Docker" below). `/y` never asks. |

# Run tests

`dotnet test BookCart.Tests -c Release`. The tests host the real API on a throwaway LocalDB database (`BookDB_Test`, dropped and rebuilt on every run).
Set `BOOKCART_TEST_DB` to use another SQL Server; never point it at a real database.

# Deploying with Docker

One command deploys the whole application (SQL Server, the app and, for a domain, HTTPS) on a machine with Docker, and the same command updates it. It works on a Linux server and on a Windows PC with Docker Desktop.

**You need:** Docker with the Compose plugin and git. A Linux server should have about 4 GB of RAM (SQL Server wants at least 2 GB). On Windows, Docker Desktop and Git for Windows. For HTTPS: a domain name whose DNS already points at the server, with ports 80 and 443 open.

1. `git clone https://github.com/hrishikeshsde/BookCartApp.git` and `cd BookCartApp`.
2. `./deploy/deploy.sh` (on Windows: `scripts\release.bat`). The first run asks two questions: the **domain** (leave it blank for plain HTTP on port 8080) and, for a domain, an **e-mail address** for the certificate. It then generates the secrets into `deploy/.env`, builds the images, starts SQL Server, applies the database migrations, starts the app (and Caddy for HTTPS) and waits until the app is healthy. It prints the address when it is done.
3. Open that address, register your account, then make it an administrator: `./deploy/make-admin.sh <username>` (log out and in again afterwards).
4. Check the deployment at any time: `./deploy/verify.sh` (the app is healthy, every page is served from the right file of the build, the fonts load, the security headers are there, SQL Server is not published).

If a script answers "Permission denied", run it through bash: `bash deploy/deploy.sh`.

**Update:** `git pull`, then `./deploy/deploy.sh` again. It takes a verified database backup first (`deploy/backups`, the newest 7 are kept), runs the migrations on their own (a failed migration stops the update and leaves the running version untouched), then replaces the containers. `--pull` also fetches newer base images; `-y` never asks (it needs an existing `deploy/.env`).

**Backup and restore:** `./deploy/backup.sh` takes a backup by hand. The restore commands are in the comment at the top of `deploy/backup.sh`. The backups stay on the same machine, so **copy `deploy/backups` somewhere else on a schedule** if the data matters.

**Roll back:** check out the previous version (`git checkout <commit>`) and run `./deploy/deploy.sh`. If the update changed the database schema, restore the backup that was taken just before it. Earlier images stay available as `bookcart:<date-time>-<commit>`.

**Where the data lives:** the Docker volumes `sqldata` (the database), `uploads` (book covers), `keys` (the guest-cookie encryption keys) and `caddy_data` (the certificates). `docker compose down` keeps them; `down -v` deletes them.

**Keep a copy of `deploy/.env`.** It holds the SQL Server password (it cannot be recovered from the database volume) and the token signing key (changing it signs everybody out). It is git-ignored and, on Linux, readable only by you.

**Stop:** `docker compose --env-file deploy/.env -f deploy/docker-compose.yml --profile '*' down` (the data stays).

**HTTP and HTTPS:** with a domain, Caddy gets and renews a Let's Encrypt certificate and is the only way in (the app listens on `127.0.0.1` only); without one, the app is published on port 8080 in plain HTTP, which is fine for a demo or a private network. The Compose stack runs SQL Server in the free Express edition (the Developer edition is not licensed for production) with the `sa` account, which suits one machine but not a shared server.

**Content-Security-Policy:** the site sends it in report-only mode. A browser check of every page type found no violations, so it can be enforced; the Docker setup keeps it report-only for now (set `Security__EnforceCsp=true` on the app to enforce it).

## Running the image yourself

The image is built from the `Dockerfile` (it needs Docker only: Node and the .NET SDK are inside the build). It has two targets: `docker build --target app -t bookcart .` is the application (non-root user, HTTP on port 8080) and `docker build --target migrate -t bookcart-migrate .` is a one-shot runner that applies the database migrations and exits (give it the connection string in `BOOKCART_EF_CONNECTION`). The application is configured with environment variables; the Compose file sets them for you:

| Variable | Purpose |
|---|---|
| `ConnectionStrings__DefaultConnection` | SQL Server connection string (required) |
| `Jwt__SecretKey` | Token signing key, at least 32 characters (required) |
| `Jwt__Issuer`, `Jwt__Audience` | Set to the public address of the site |
| `Gemini__ApiKey` | Optional; without it book summaries answer 503 |
| `Storage__UploadFolder` | Folder for uploaded covers. In the image `/data/uploads` exists and belongs to the container user (uid 1654), so a new named volume mounted there works |
| `Security__DataProtectionKeysPath` | Folder for the guest-cookie encryption keys (`/data/keys` in the image); put it on a volume, or guest carts are lost on every restart. The keys are stored unencrypted, so keep the volume private |
| `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` | When behind a reverse proxy that terminates TLS |
| `Security__EnforceCsp` | `true` to enforce the Content-Security-Policy instead of only reporting |

The image speaks plain HTTP: put TLS in front of it (HTTPS redirection logs a warning and does nothing while the app has no HTTPS port). The application does not create the database: run the `migrate` image first.

[.github/workflows/ci.yml](.github/workflows/ci.yml) checks the formatting, builds with warnings as errors, runs the backend and Angular tests, and runs a **stack** job that deploys the real stack with `deploy/deploy.sh` (as a first install and then as an update), checks it with `deploy/verify.sh` and runs the browser checks in `scripts/smoke` against it.

Deploying to Azure (App Service, with CI/CD) is planned but not built: see Part A of [docs/DEPLOYMENT_IMPLEMENTATION_PLAN.md](docs/DEPLOYMENT_IMPLEMENTATION_PLAN.md).

# Live Demo
[https://bookcart.azurewebsites.net/](https://bookcart.azurewebsites.net/)

# License
[MIT](https://github.com/hrishikeshsde/BookCartApp/blob/master/LICENSE)

