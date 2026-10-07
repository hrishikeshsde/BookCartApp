using BookCart.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace BookCart.Tests;

/// <summary>
/// Hosts the real API against a throwaway SQL Server database (BookDB_Test) that is dropped, recreated
/// from the EF model and seeded once per test run. One instance is shared by all tests via <see cref="ApiCollection"/>.
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public const string UserAPassword = "UserA-pass-1";
    public const string UserBPassword = "UserB-pass-1";
    public const string AdminPassword = "Admin-pass-1";
    public const int AuthPermitLimit = 5;
    public const int LookupPermitLimit = 8;

    /// <summary>
    /// Everything the tests write lives here and is deleted afterwards. The web root sits three levels down, so even
    /// a file name like "../../../x.png" that got past the upload checks would still land inside the sandbox, where
    /// the tests can find it, instead of in the user's real temp folders.
    /// </summary>
    public string Sandbox { get; } = Path.Combine(Path.GetTempPath(), "bookcart-tests-" + Guid.NewGuid().ToString("N"));

    /// <summary>A throwaway web root, so uploads in tests never touch the project's real wwwroot/Upload.</summary>
    public string WebRoot => Path.Combine(Sandbox, "a", "b", "wwwroot");
    public string UploadFolder => Path.Combine(WebRoot, "Upload");

    public int AdminId { get; private set; }
    public int UserAId { get; private set; }
    public int UserBId { get; private set; }
    public int BookId { get; private set; }
    public decimal BookPrice => 10.00m;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");

        Directory.CreateDirectory(UploadFolder);
        builder.UseSetting(WebHostDefaults.WebRootKey, WebRoot);

        var settings = new Dictionary<string, string?>
        {
            ["Jwt:SecretKey"] = "test-secret-test-secret-test-secret-123456",
            ["Jwt:Issuer"] = "https://bookcart.tests/",
            ["Jwt:Audience"] = "https://bookcart.tests/",
            ["ConnectionStrings:DefaultConnection"] = TestDb.ConnectionString,
            // Low enough to test the limiters cheaply. Every test client has its own IP (see ConfigureClient), so
            // ordinary tests never come near these limits.
            ["RateLimiting:AuthPermitLimit"] = AuthPermitLimit.ToString(),
            ["RateLimiting:LookupPermitLimit"] = LookupPermitLimit.ToString()
        };

        // UseSetting feeds host configuration, which the eager startup checks in Program.cs can see.
        foreach (var (key, value) in settings) builder.UseSetting(key, value);

        // An in-memory source added last wins over appsettings, user-secrets and environment variables, so a
        // developer's own secrets (which point at their dev database) can never leak into the test run.
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(settings));

        builder.ConfigureTestServices(services => services.AddSingleton<IStartupFilter, FakeRemoteIpStartupFilter>());
    }

    static int _nextClient;

    /// <summary>Gives each client its own fake IP address, so one test's requests never use up another's rate limit.</summary>
    protected override void ConfigureClient(HttpClient client)
    {
        base.ConfigureClient(client);
        var n = Interlocked.Increment(ref _nextClient);
        client.DefaultRequestHeaders.Add(FakeRemoteIpStartupFilter.Header, $"10.{(n >> 16) & 255}.{(n >> 8) & 255}.{n & 255}");
    }

    /// <summary>Creates a brand-new user (legacy plaintext row, upgraded on first login) so a test owns its own cart and orders.</summary>
    public async Task<(int Id, string Username, string Password)> NewUserAsync()
    {
        var username = "u" + Guid.NewGuid().ToString("N")[..12];
        const string password = "Fresh-pass-1";
        await using var db = CreateDbContext();
        var userTypeId = await db.UserType.Where(t => t.UserTypeName == "User").Select(t => t.UserTypeId).SingleAsync();
        var user = NewUser(username, password, userTypeId);
        db.UserMaster.Add(user);
        await db.SaveChangesAsync();
        return (user.UserId, username, password);
    }

    public BookDBContext CreateDbContext() =>
        new(new DbContextOptionsBuilder<BookDBContext>().UseSqlServer(TestDb.ConnectionString).Options);

    public async Task InitializeAsync()
    {
        await using var db = CreateDbContext();
        await db.Database.EnsureDeletedAsync();
        await db.Database.EnsureCreatedAsync();

        var admin = new UserType { UserTypeName = "Admin" };
        var user = new UserType { UserTypeName = "User" };
        db.UserType.AddRange(admin, user);
        db.Categories.Add(new Categories { CategoryName = "Fiction" });
        await db.SaveChangesAsync();

        var a = NewUser("usera", UserAPassword, user.UserTypeId);
        var b = NewUser("userb", UserBPassword, user.UserTypeId);
        var adminUser = NewUser("adminuser", AdminPassword, admin.UserTypeId);
        var book = new Book { Title = "Test Book", Author = "Test Author", Category = "Fiction", Price = BookPrice, CoverFileName = "Default_image.jpg" };
        db.UserMaster.AddRange(a, b, adminUser);
        db.Book.Add(book);
        await db.SaveChangesAsync();

        UserAId = a.UserId;
        UserBId = b.UserId;
        AdminId = adminUser.UserId;
        BookId = book.BookId;
    }

    // IAsyncLifetime.DisposeAsync; WebApplicationFactory already implements IAsyncDisposable.
    async Task IAsyncLifetime.DisposeAsync()
    {
        SqlConnection.ClearAllPools();
        await base.DisposeAsync();
        if (Directory.Exists(Sandbox)) Directory.Delete(Sandbox, recursive: true);
    }

    static UserMaster NewUser(string username, string password, int userTypeId) => new()
    {
        FirstName = username, LastName = "Test", Username = username,
        Password = password, Gender = "Male", UserTypeId = userTypeId
    };
}

[CollectionDefinition(Name)]
public class ApiCollection : ICollectionFixture<ApiFactory>
{
    public const string Name = "api";
}
