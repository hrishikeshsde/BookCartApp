# BookCart

An e-commerce application for an online book store created with .NET and Angular 18, using SQL Server as database.

# Concepts Covered

### .NET

 - Web API created using EF Core DB first approach
 - Policy based Authorization using JWT
 - Repository pattern
 - Dependency Injection
 - Swagger implementation

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
- Visual Studio 2022 
- SQL Server 
- .NET 10 SDK (pinned in global.json)
- Node.js 22 or newer for the Angular app

# Steps to run the app
1. Clone the Repo
2. Create an empty SQL Server database, then create its tables and reference data with the EF Core migrations:
   `dotnet tool restore`, then `BOOKCART_EF_CONNECTION="<your connection string>" dotnet ef database update --project BookCart`.
   (An existing database created from the old DBScript needs the upgrade steps in [docs/B4_DATABASE_CHANGES.md](docs/B4_DATABASE_CHANGES.md).)
3. Set your secrets with [user-secrets](https://learn.microsoft.com/aspnet/core/security/app-secrets) from the `BookCart` folder:
   `dotnet user-secrets set "ConnectionStrings:DefaultConnection" "<your connection string>"` and
   `dotnet user-secrets set "Jwt:SecretKey" "<a random string of at least 32 characters>"`.
   Optional, for AI book summaries: `dotnet user-secrets set "Gemini:ApiKey" "<your key>"`.
4. Install the Angular app's packages once: `npm ci --legacy-peer-deps` in `BookCart/ClientApp` (the plain `npm install` that a Debug build runs
   currently fails on an `@ngrx` / Angular version conflict, which the planned Angular upgrade resolves).
   Then run `dotnet run --launch-profile BookCart` from the `BookCart` folder (or launch from Visual Studio).
5. Register a user in the app, then make them an admin: `UPDATE UserMaster SET UserTypeID = 1 WHERE Username = '<username>'`.

# Live Demo
[https://bookcart.azurewebsites.net/](https://bookcart.azurewebsites.net/)

# License
[MIT](https://github.com/hrishikeshsde/BookCartApp/blob/master/LICENSE)

