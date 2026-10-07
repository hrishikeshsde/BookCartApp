using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using BookCart.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace BookCart.Tests;

/// <summary>B2: error handling, routing, API conventions, health, compression, caching, options validation, OpenAPI, logging.</summary>
[Collection(ApiCollection.Name)]
public class PlumbingTests(ApiFactory factory)
{
    readonly ApiFactory _factory = factory;

    WebApplicationFactory<Program> WithBoom() => _factory.WithWebHostBuilder(b => b.ConfigureTestServices(services =>
        services.AddControllers().AddApplicationPart(typeof(BoomController).Assembly)));

    static Func<IWebHostBuilder, IWebHostBuilder> Config(params (string Key, string? Value)[] settings) => builder =>
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
            settings.ToDictionary(s => s.Key, s => s.Value)));

    // ---- error handling ----------------------------------------------------------------------------------------

    [Fact]
    public async Task An_unexpected_exception_is_a_500_problem_that_reveals_nothing_and_keeps_the_security_headers()
    {
        var response = await WithBoom().CreateClient().GetAsync("/api/test-boom/unexpected");

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("secret internal detail", body);
        Assert.DoesNotContain("InvalidOperationException", body);
        var problem = JsonDocument.Parse(body).RootElement;
        Assert.Equal(500, problem.GetProperty("status").GetInt32());
        Assert.True(problem.TryGetProperty("traceId", out _), "a trace id lets support find the log entry");

        // The exception handler clears the response; the security headers must survive it.
        Assert.Equal("nosniff", Assert.Single(response.Headers.GetValues("X-Content-Type-Options")));
        Assert.True(response.Headers.Contains("Content-Security-Policy-Report-Only"));
    }

    [Fact]
    public async Task An_unexpected_exception_is_logged_as_an_error()
    {
        var logs = new LogCapture();
        var host = WithBoom().WithWebHostBuilder(b => b.ConfigureLogging(l => l.AddProvider(logs)));

        await host.CreateClient().GetAsync("/api/test-boom/unexpected");

        var entry = Assert.Single(logs.Entries, e => e.Level == LogLevel.Error && e.Exception is InvalidOperationException);
        Assert.Contains("/api/test-boom/unexpected", entry.Message);
    }

    [Theory]
    [InlineData("not-found", HttpStatusCode.NotFound, "The widget does not exist.")]
    [InlineData("bad-request", HttpStatusCode.BadRequest, "The widget is malformed.")]
    [InlineData("conflict", HttpStatusCode.Conflict, "The widget already exists.")]
    public async Task Expected_failures_keep_their_status_and_explain_themselves(string route, HttpStatusCode status, string detail)
    {
        var response = await WithBoom().CreateClient().GetAsync("/api/test-boom/" + route);

        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = (await response.Content.ReadFromJsonAsync<JsonElement>());
        Assert.Equal(detail, problem.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task A_missing_book_is_a_404_not_a_server_error()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/book/GetSimilarBooks/987654");   // used to be a NullReferenceException (500)

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Theory]
    [InlineData("/api/nope")]
    [InlineData("/api")]
    [InlineData("/api/book/abc")]               // {id:int}
    [InlineData("/api/shoppingcart/abc")]       // {userId:int}
    public async Task Unknown_api_routes_are_404_problems(string path)
    {
        var response = await _factory.CreateClient().GetAsync(path);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Bodiless_error_statuses_get_a_problem_body_too()
    {
        var unauthorized = await _factory.CreateClient().GetAsync($"/api/order/{_factory.UserAId}");

        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        Assert.Equal("application/problem+json", unauthorized.Content.Headers.ContentType?.MediaType);
        Assert.True(unauthorized.Headers.WwwAuthenticate.Count > 0, "the Bearer challenge must survive");
    }

    // ---- [ApiController] conventions ---------------------------------------------------------------------------

    [Fact]
    public async Task An_invalid_body_is_rejected_automatically_with_the_invalid_fields_listed()
    {
        var login = await _factory.CreateClient().PostAsJsonAsync("/api/login", new { });

        Assert.Equal(HttpStatusCode.BadRequest, login.StatusCode);
        var errors = (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
        Assert.True(errors.TryGetProperty("Username", out _) && errors.TryGetProperty("Password", out _));

        var malformed = await _factory.CreateClient().PostAsync("/api/login", new StringContent("{ not json", System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
    }

    // ---- SPA fallback ------------------------------------------------------------------------------------------

    [Fact]
    public async Task The_spa_shell_is_served_for_page_routes_only()
    {
        Directory.CreateDirectory(_factory.WebRoot);
        var index = Path.Combine(_factory.WebRoot, "index.html");
        await File.WriteAllTextAsync(index, "<html>spa shell</html>");
        try
        {
            var client = _factory.CreateClient();

            Assert.Contains("spa shell", await client.GetStringAsync("/"));
            Assert.Contains("spa shell", await client.GetStringAsync("/books/details/5"));        // an Angular route
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/nope")).StatusCode);      // not the shell
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/missing-chunk.js")).StatusCode);   // a file, not a page
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/book")).StatusCode);
        }
        finally
        {
            File.Delete(index);
        }
    }

    // ---- health ------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Health_check_is_public_and_reports_a_working_database_as_healthy()
    {
        var response = await _factory.CreateClient().GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Health_check_reports_an_unreachable_database_as_unhealthy()
    {
        // Nothing listens on port 1, so connecting fails immediately.
        var host = _factory.WithWebHostBuilder(b => Config(("ConnectionStrings:DefaultConnection",
            "Server=127.0.0.1,1;Database=Nope;User Id=x;Password=y;Connect Timeout=1;TrustServerCertificate=True"))(b));

        var response = await host.CreateClient().GetAsync("/health");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("Unhealthy", await response.Content.ReadAsStringAsync());
    }

    // ---- compression and caching -------------------------------------------------------------------------------

    [Fact]
    public async Task Responses_are_compressed_for_clients_that_accept_it()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.AcceptEncoding.Add(new StringWithQualityHeaderValue("gzip"));

        var response = await client.GetAsync("/api/book");

        Assert.Contains("gzip", response.Content.Headers.ContentEncoding);
    }

    [Fact]
    public async Task The_catalog_is_cached_and_an_admin_change_evicts_it()
    {
        var admin = await _factory.LoggedIn("adminuser", ApiFactory.AdminPassword);
        var anonymous = _factory.CreateClient();
        var token = Guid.NewGuid().ToString("N");

        // Reset: an admin write evicts the cache, then the next read repopulates it.
        await admin.PostAsync("/api/book", Form($"Warm-up {token}"));
        var first = await anonymous.GetAsync("/api/book");
        Assert.False(first.Headers.Contains("Age"), "the first read after an eviction is a miss");

        // A book added behind the API's back is invisible while the cached list is served...
        await using (var db = _factory.CreateDbContext())
        {
            db.Book.Add(new Book { Title = $"Sneaked in {token}", Author = "A", Category = "Fiction", Price = 1m, CoverFileName = "Default_image.jpg" });
            await db.SaveChangesAsync();
        }
        var cached = await anonymous.GetAsync("/api/book");
        Assert.True(cached.Headers.Contains("Age"), "the second read is served from the cache");
        Assert.DoesNotContain($"Sneaked in {token}", await cached.Content.ReadAsStringAsync());

        // ...until an admin change evicts it.
        await admin.PostAsync("/api/book", Form($"Evictor {token}"));
        var fresh = await anonymous.GetAsync("/api/book");
        Assert.Contains($"Sneaked in {token}", await fresh.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Categories_are_cached_but_signed_in_requests_are_never_cached()
    {
        var anonymous = _factory.CreateClient();
        await anonymous.GetAsync("/api/book/GetCategoriesList");
        Assert.True((await anonymous.GetAsync("/api/book/GetCategoriesList")).Headers.Contains("Age"));

        var user = await _factory.LoggedIn("usera", ApiFactory.UserAPassword);
        await user.GetAsync("/api/book");
        Assert.False((await user.GetAsync("/api/book")).Headers.Contains("Age"), "responses to authenticated requests must not be cached");
    }

    // ---- options validation ------------------------------------------------------------------------------------

    [Theory]
    [InlineData("Jwt:SecretKey", "too-short", "SecretKey")]
    [InlineData("Jwt:Issuer", "", "Issuer")]
    [InlineData("ConnectionStrings:DefaultConnection", "", "DefaultConnection")]
    [InlineData("Storage:DefaultCoverImageFile", "", "DefaultCoverImageFile")]
    [InlineData("RateLimiting:AuthPermitLimit", "0", "AuthPermitLimit")]
    [InlineData("Jwt:ExpiryMinutes", "100000", "ExpiryMinutes")]
    public void The_app_refuses_to_start_with_invalid_configuration_and_says_which_setting(string key, string value, string expectedInMessage)
    {
        var host = _factory.WithWebHostBuilder(b => Config((key, value))(b));

        var failure = Record.Exception(() => host.CreateClient());

        Assert.NotNull(failure);
        Assert.Contains(expectedInMessage, failure!.ToString());
    }

    // ---- OpenAPI -----------------------------------------------------------------------------------------------

    [Fact]
    public async Task The_openapi_document_describes_bearer_auth_and_marks_only_protected_operations()
    {
        var doc = await _factory.CreateClient().GetFromJsonAsync<JsonElement>("/openapi/v1.json");

        var scheme = doc.GetProperty("components").GetProperty("securitySchemes").GetProperty("Bearer");
        Assert.Equal("http", scheme.GetProperty("type").GetString());
        Assert.Equal("bearer", scheme.GetProperty("scheme").GetString());
        Assert.Equal("BookCart API", doc.GetProperty("info").GetProperty("title").GetString());

        bool Secured(string path, string method)
        {
            var paths = doc.GetProperty("paths");
            var key = paths.EnumerateObject().Single(p => string.Equals(p.Name, path, StringComparison.OrdinalIgnoreCase)).Value;
            return key.GetProperty(method).TryGetProperty("security", out var security) && security.GetArrayLength() > 0;
        }

        Assert.False(Secured("/api/Login", "post"));
        Assert.False(Secured("/api/Book", "get"));
        Assert.False(Secured("/api/User", "post"));
        Assert.True(Secured("/api/Book", "post"));                  // admin only
        Assert.True(Secured("/api/Order/{userId}", "get"));
        Assert.True(Secured("/api/Wishlist/{userId}", "get"));
        Assert.True(Secured("/api/CheckOut/{userId}", "post"));
    }

    // ---- logging -----------------------------------------------------------------------------------------------

    [Fact]
    public async Task Important_events_are_logged()
    {
        var logs = new LogCapture();
        var host = _factory.WithWebHostBuilder(b => b.ConfigureLogging(l => l.AddProvider(logs)));
        var client = host.CreateClient();

        await client.PostAsJsonAsync("/api/login", new { username = "usera", password = "wrong" });
        var admin = host.CreateClient();
        await _factory.LoggedIn("adminuser", ApiFactory.AdminPassword, admin);
        var title = "Logged " + Guid.NewGuid().ToString("N");
        await admin.PostAsync("/api/book", Form(title));

        Assert.Contains(logs.Entries, e => e.Level == LogLevel.Warning && e.Message.Contains("Failed login for username usera"));
        Assert.Contains(logs.Entries, e => e.Level == LogLevel.Information && e.Message.Contains("(adminuser) logged in"));
        Assert.Contains(logs.Entries, e => e.Level == LogLevel.Information && e.Message.Contains($"added book") && e.Message.Contains(title));
        Assert.DoesNotContain(logs.Entries, e => e.Message.Contains(ApiFactory.AdminPassword));   // never log secrets
    }

    [Fact]
    public async Task Rate_limit_rejections_are_logged()
    {
        var logs = new LogCapture();
        var client = _factory.WithWebHostBuilder(b => b.ConfigureLogging(l => l.AddProvider(logs))).CreateClient();

        for (var i = 0; i <= ApiFactory.AuthPermitLimit; i++)
        {
            await client.PostAsJsonAsync("/api/login", new { username = "usera", password = "wrong" + i });
        }

        Assert.Contains(logs.Entries, e => e.Level == LogLevel.Warning && e.Category == "BookCart.RateLimiting" && e.Message.Contains("/api/login"));
    }

    // ---- helpers -----------------------------------------------------------------------------------------------

    static MultipartFormDataContent Form(string title) => new()
    {
        { new StringContent(JsonSerializer.Serialize(new { bookId = 0, title, author = "A", category = "Fiction", price = "5" })), "bookFormData" }
    };
}
