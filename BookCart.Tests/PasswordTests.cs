using System.Net;
using System.Net.Http.Json;
using BookCart.Models;
using Microsoft.EntityFrameworkCore;

namespace BookCart.Tests;

/// <summary>B0.2: passwords are stored as hashes; legacy plaintext rows are upgraded on first login.</summary>
[Collection(ApiCollection.Name)]
public class PasswordTests(ApiFactory factory)
{
    readonly ApiFactory _factory = factory;

    [Fact]
    public async Task Legacy_plaintext_login_upgrades_row_to_hash()
    {
        var username = NewUsername();
        await SeedLegacyUser(username, "Legacy-pass-1");

        var first = await Login(username, "Legacy-pass-1");
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var row = await LoadUser(username);
        Assert.False(string.IsNullOrEmpty(row.PasswordHash));
        Assert.Null(row.Password);
        Assert.DoesNotContain("Legacy-pass-1", row.PasswordHash);

        // The upgraded hash keeps working.
        Assert.Equal(HttpStatusCode.OK, (await Login(username, "Legacy-pass-1")).StatusCode);
    }

    [Fact]
    public async Task Wrong_password_is_rejected_for_legacy_and_hashed_users()
    {
        var username = NewUsername();
        await SeedLegacyUser(username, "Legacy-pass-1");

        Assert.Equal(HttpStatusCode.Unauthorized, (await Login(username, "wrong")).StatusCode);
        // Rejection must not upgrade (or otherwise touch) the row.
        Assert.Null((await LoadUser(username)).PasswordHash);

        await Login(username, "Legacy-pass-1");   // upgrades to a hash
        Assert.Equal(HttpStatusCode.Unauthorized, (await Login(username, "wrong")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Login(username, "legacy-pass-1")).StatusCode);   // case-sensitive
    }

    [Fact]
    public async Task Registration_stores_only_a_hash()
    {
        var username = NewUsername();
        const string password = "Brand-new-1";
        var client = _factory.CreateClient();

        var register = await client.PostAsJsonAsync("/api/user", new
        {
            firstName = "New", lastName = "User", username, gender = "Male",
            password, confirmPassword = password
        });
        Assert.Equal(HttpStatusCode.OK, register.StatusCode);

        var row = await LoadUser(username);
        Assert.Null(row.Password);
        Assert.False(string.IsNullOrEmpty(row.PasswordHash));
        Assert.NotEqual(password, row.PasswordHash);
        Assert.Equal(HttpStatusCode.OK, (await Login(username, password)).StatusCode);
    }

    [Fact]
    public async Task Registering_a_taken_username_is_a_conflict_and_changes_nothing()
    {
        var username = NewUsername();
        await SeedLegacyUser(username, "Legacy-pass-1");
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/user", new
        {
            firstName = "Imposter", lastName = "User", username = username.ToUpperInvariant(), gender = "Male",
            password = "Brand-new-1", confirmPassword = "Brand-new-1"
        });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var row = await LoadUser(username);
        Assert.Equal("Legacy", row.FirstName);   // the existing account is untouched
    }

    [Fact]
    public async Task Hash_column_is_unique_per_username()
    {
        var username = NewUsername();
        await SeedLegacyUser(username, "Legacy-pass-1");

        // Same username with a different case: SQL Server's default collation is case-insensitive,
        // so the unique index (UX_UserMaster_Username) must reject it.
        await Assert.ThrowsAsync<DbUpdateException>(() => SeedLegacyUser(username.ToUpperInvariant(), "Other-pass-1"));
    }

    static string NewUsername() => "u" + Guid.NewGuid().ToString("N")[..12];

    Task<HttpResponseMessage> Login(string username, string password) =>
        _factory.CreateClient().PostAsJsonAsync("/api/login", new { username, password });

    async Task SeedLegacyUser(string username, string password)
    {
        await using var db = _factory.CreateDbContext();
        var userTypeId = await db.UserType.Where(t => t.UserTypeName == "User").Select(t => t.UserTypeId).SingleAsync();
        db.UserMaster.Add(new UserMaster
        {
            FirstName = "Legacy", LastName = "User", Username = username,
            Password = password, Gender = "Male", UserTypeId = userTypeId
        });
        await db.SaveChangesAsync();
    }

    async Task<UserMaster> LoadUser(string username)
    {
        await using var db = _factory.CreateDbContext();
        return await db.UserMaster.AsNoTracking().SingleAsync(u => u.Username == username);
    }
}
