# syntax=docker/dockerfile:1
#
# Builds the two images of the deployment (see docs/DEPLOYMENT_IMPLEMENTATION_PLAN.md):
#   --target app      the web application: the API plus the built Angular site
#   --target migrate  a one-shot runner that applies the EF Core migrations and exits
# The build context is the repository root (deploy/docker-compose.yml uses `context: ..`).

# 1. The Angular site: the production build, then the same self-check CI runs (npm run verify:dist).
FROM node:24-bookworm-slim AS client
WORKDIR /src/BookCart/ClientApp
# The package files first, so `npm ci` is cached until the dependencies change.
COPY BookCart/ClientApp/package.json BookCart/ClientApp/package-lock.json ./
RUN npm ci
COPY BookCart/ClientApp/ ./
RUN npm run build -- --configuration production && node verify-static.js

# 2. The .NET build: publish the app (with the Angular output from stage 1) and bundle the migrations.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
# The project file first, so the restore (and the NuGet audit, which can fail on a newly published advisory: see the
# "Transitive pins" group in Directory.Packages.props) is cached until a package changes.
COPY global.json Directory.Build.props Directory.Packages.props dotnet-tools.json ./
COPY BookCart/BookCart.csproj BookCart/
RUN dotnet restore BookCart/BookCart.csproj && dotnet tool restore
COPY BookCart/ BookCart/
COPY --from=client /src/BookCart/ClientApp/dist BookCart/ClientApp/dist
# SkipClientBuild: the Angular site is already built, and this image has no Node.
RUN dotnet publish BookCart/BookCart.csproj -c Release -o /out/app --no-restore -p:SkipClientBuild=true
# A self-contained single file, so the migrate image needs no .NET runtime and no SDK.
RUN dotnet ef migrations bundle --project BookCart --configuration Release --self-contained -r linux-x64 -o /out/efbundle --force

# 3a. The one-shot migration runner. Pass the database with --connection "<connection string>".
# It exits 0 when the database is up to date and 1 on any failure, which is what Compose waits for.
FROM mcr.microsoft.com/dotnet/runtime-deps:10.0 AS migrate
COPY --from=build /out/efbundle /app/efbundle
ENTRYPOINT ["/app/efbundle"]

# 3b. The application.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS app
WORKDIR /app
COPY --from=build /out/app ./
# Created and owned here, so a new named volume mounted on them inherits the owner and the non-root user can write.
# Storage__UploadFolder and Security__DataProtectionKeysPath point at these (see deploy/docker-compose.yml).
RUN mkdir -p /data/uploads /data/keys && chown -R app:app /data
USER app
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
# The image has bash but no curl or wget: ask /health over a plain TCP connection and check for a 200 status line.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/8080; printf "GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n" >&3; read -r line <&3; [[ $line == *" 200 "* ]]' || exit 1
ENTRYPOINT ["dotnet", "BookCart.dll"]
