using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BookCart.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace BookCart.Tests;

/// <summary>
/// B5: what has to hold when the app runs in a container, where the application folder is read-only or thrown away on
/// every deploy: uploaded covers and the guest cookie's encryption keys can live on a mounted volume.
/// </summary>
[Collection(ApiCollection.Name)]
public class DeploymentTests(ApiFactory factory)
{
    static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 9, 8, 7, 6, 5, 4, 3, 2];

    readonly ApiFactory _factory = factory;

    WebApplicationFactory<Program> HostWith(params (string Key, string? Value)[] settings) =>
        _factory.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(settings.ToDictionary(s => s.Key, s => s.Value))));

    string NewFolder(string name)
    {
        var path = Path.Combine(_factory.Sandbox, name + "-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(path);
        return path;
    }

    static MultipartFormDataContent CoverForm(string title) => new()
    {
        { new StringContent(title), "title" }, { new StringContent("A"), "author" }, { new StringContent("Fiction"), "category" },
        { new StringContent("5"), "price" },
        { new ByteArrayContent(Png) { Headers = { ContentType = new("image/png") } }, "file", "cover.png" }
    };

    async Task<string> AddBookWithCoverAsync(HttpClient admin)
    {
        var title = "Cover " + Guid.NewGuid().ToString("N");
        var created = await admin.PostAsync("/api/book", CoverForm(title));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        return (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("coverFileName").GetString()!;
    }

    // ---- uploaded covers are served -------------------------------------------------------------------------------

    [Fact]
    public async Task An_uploaded_cover_is_served_as_an_image_that_the_browser_may_not_second_guess()
    {
        var admin = await _factory.LoggedIn("adminuser", ApiFactory.AdminPassword);
        var cover = await AddBookWithCoverAsync(admin);

        var response = await _factory.Anonymous().GetAsync("/Upload/" + cover);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/png", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Png, await response.Content.ReadAsByteArrayAsync());
        Assert.Equal("nosniff", Assert.Single(response.Headers.GetValues("X-Content-Type-Options")));
    }

    [Fact]
    public async Task Covers_can_live_on_a_separate_volume_and_the_default_cover_still_shows()
    {
        var volume = NewFolder("volume");
        // The application's own folder holds the default cover, as in the published app.
        Directory.CreateDirectory(_factory.UploadFolder);
        var defaultCover = Path.Combine(_factory.UploadFolder, "Default_image.jpg");
        await File.WriteAllBytesAsync(defaultCover, [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);
        var host = HostWith(("Storage:UploadFolder", volume));
        var admin = await _factory.LoggedIn("adminuser", ApiFactory.AdminPassword, host.CreateClient());

        var cover = await AddBookWithCoverAsync(admin);

        // Stored on the volume, not inside the application...
        Assert.True(File.Exists(Path.Combine(volume, cover)));
        Assert.False(File.Exists(Path.Combine(_factory.UploadFolder, cover)));
        // ...served from there...
        var client = host.CreateClient();
        Assert.Equal(Png, await client.GetByteArrayAsync("/Upload/" + cover));
        // ...while the default cover, which is not on the (empty) volume, falls through to the application's own folder.
        var fallback = await client.GetAsync("/Upload/Default_image.jpg");
        Assert.Equal(HttpStatusCode.OK, fallback.StatusCode);
        Assert.Equal("image/jpeg", fallback.Content.Headers.ContentType?.MediaType);
        // A cover that exists nowhere is a plain 404.
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/Upload/not-there.png")).StatusCode);
    }

    [Fact]
    public async Task Deleting_a_book_removes_its_cover_from_the_volume_but_never_the_default_cover()
    {
        var volume = NewFolder("volume");
        Directory.CreateDirectory(_factory.UploadFolder);
        var defaultCover = Path.Combine(_factory.UploadFolder, "Default_image.jpg");
        await File.WriteAllBytesAsync(defaultCover, [0xFF, 0xD8, 0xFF, 0xE0, 4, 5, 6]);
        var host = HostWith(("Storage:UploadFolder", volume));
        var admin = await _factory.LoggedIn("adminuser", ApiFactory.AdminPassword, host.CreateClient());
        var cover = await AddBookWithCoverAsync(admin);
        int bookId;
        await using (var db = _factory.CreateDbContext())
        {
            bookId = await db.Book.Where(b => b.CoverFileName == cover).Select(b => b.BookId).SingleAsync();
        }

        Assert.True(File.Exists(Path.Combine(volume, cover)));      // it really is on the volume before the delete

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/book/{bookId}")).StatusCode);

        Assert.False(File.Exists(Path.Combine(volume, cover)));
        Assert.True(File.Exists(defaultCover));
    }

    // ---- the guest cookie survives a restart when its keys are kept on a volume -----------------------------------------

    [Fact]
    public async Task A_guest_session_survives_a_restart_when_the_encryption_keys_are_on_a_volume()
    {
        var keys = NewFolder("keys");
        var before = HostWith(("Security:DataProtectionKeysPath", keys));

        var started = await before.CreateClient().PostAsync("/api/guest", null);
        var guestId = (await started.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("guestId").GetInt32();
        var cookie = Assert.Single(started.Headers.GetValues("Set-Cookie"), c => c.StartsWith("bc_guest=")).Split(';')[0];

        Assert.NotEmpty(Directory.GetFiles(keys, "key-*.xml"));      // the keys are on the volume, not in the process

        // A new process (a new host) that finds the same keys folder understands the cookie the old one issued.
        var after = HostWith(("Security:DataProtectionKeysPath", keys));
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/guest");
        request.Headers.Add("Cookie", cookie);
        var continued = await (await after.CreateClient().SendAsync(request)).Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(guestId, continued.GetProperty("guestId").GetInt32());
    }

    [Fact]
    public async Task A_guest_cookie_from_another_key_ring_is_not_understood_and_gets_a_fresh_session()
    {
        var one = HostWith(("Security:DataProtectionKeysPath", NewFolder("keys")));
        var other = HostWith(("Security:DataProtectionKeysPath", NewFolder("keys")));
        var started = await one.CreateClient().PostAsync("/api/guest", null);
        var guestId = (await started.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("guestId").GetInt32();
        var cookie = Assert.Single(started.Headers.GetValues("Set-Cookie"), c => c.StartsWith("bc_guest=")).Split(';')[0];

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/guest");
        request.Headers.Add("Cookie", cookie);
        var answer = await (await other.CreateClient().SendAsync(request)).Content.ReadFromJsonAsync<JsonElement>();

        Assert.NotEqual(guestId, answer.GetProperty("guestId").GetInt32());   // the second ring cannot read the first's cookie
    }

    [Fact]
    public async Task The_new_settings_are_optional_and_have_safe_defaults()
    {
        // Without them the app behaves as before: covers in wwwroot/Upload, the framework's own key location.
        var admin = await _factory.LoggedIn("adminuser", ApiFactory.AdminPassword);
        var cover = await AddBookWithCoverAsync(admin);

        Assert.True(File.Exists(Path.Combine(_factory.UploadFolder, cover)));
        Assert.Equal(HttpStatusCode.OK, (await _factory.Anonymous().PostAsync("/api/guest", null)).StatusCode);
    }
}
