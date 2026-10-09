using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.IdentityModel.Tokens;

namespace BookCart.Tests;

/// <summary>B0.7: token contents and validation, Swagger exposure, security headers, rate limits and signup validation.</summary>
[Collection(ApiCollection.Name)]
public class HardeningTests(ApiFactory factory)
{
    // Same values ApiFactory configures, so tests can mint tokens the API will (or must refuse to) accept.
    const string TestKey = "test-secret-test-secret-test-secret-123456";
    const string TestIssuer = "https://bookcart.tests/";

    readonly ApiFactory _factory = factory;

    // ---- tokens ------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Token_has_the_user_id_as_subject_a_role_claim_and_a_one_hour_lifetime()
    {
        var token = await LoginToken(_factory.CreateClient(), "usera", ApiFactory.UserAPassword);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        Assert.Equal(_factory.UserAId.ToString(), jwt.Subject);   // "sub" is the user id, no longer the role name
        Assert.Equal("User", jwt.Claims.Single(c => c.Type == ClaimTypes.Role || c.Type == "role").Value);
        Assert.Equal(_factory.UserAId.ToString(), jwt.Claims.Single(c => c.Type == "userId").Value);
        Assert.Equal("usera", jwt.Claims.Single(c => c.Type == "name").Value);

        var issuedAt = DateTimeOffset.FromUnixTimeSeconds(long.Parse(jwt.Claims.Single(c => c.Type == "iat").Value));
        Assert.InRange(DateTimeOffset.UtcNow - issuedAt, TimeSpan.FromSeconds(-5), TimeSpan.FromMinutes(1));
        Assert.Equal(TimeSpan.FromHours(1), jwt.ValidTo - jwt.ValidFrom);
        Assert.True(jwt.ValidTo > DateTime.UtcNow.AddMinutes(55) && jwt.ValidTo < DateTime.UtcNow.AddMinutes(65));
    }

    [Fact]
    public async Task Admin_token_carries_the_admin_role()
    {
        var token = await LoginToken(_factory.CreateClient(), "adminuser", ApiFactory.AdminPassword);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        Assert.Equal("Admin", jwt.Claims.Single(c => c.Type == ClaimTypes.Role || c.Type == "role").Value);
    }

    [Fact]
    public async Task Token_lifetime_can_be_configured()
    {
        var host = _factory.WithWebHostBuilder(b => b.UseSetting("Jwt:ExpiryMinutes", "5"));

        var token = await LoginToken(host.CreateClient(), "usera", ApiFactory.UserAPassword);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        Assert.Equal(TimeSpan.FromMinutes(5), jwt.ValidTo - jwt.ValidFrom);
    }

    [Fact]
    public async Task Only_a_valid_token_signed_with_the_servers_key_is_accepted()
    {
        var now = DateTime.UtcNow;
        var userId = _factory.UserAId;

        // Control: a well-formed token the server should accept, so the refusals below mean something.
        Assert.Equal(HttpStatusCode.OK, await OrdersStatus(MintToken(userId, now.AddMinutes(-1), now.AddMinutes(30))));

        Assert.Equal(HttpStatusCode.Unauthorized, await OrdersStatus(MintToken(userId, now.AddHours(-2), now.AddHours(-1))));              // expired
        Assert.Equal(HttpStatusCode.Unauthorized, await OrdersStatus(MintToken(userId, now.AddHours(1), now.AddHours(2))));                // not valid yet
        Assert.Equal(HttpStatusCode.Unauthorized, await OrdersStatus(MintToken(userId, now.AddMinutes(-1), now.AddMinutes(30), issuer: "https://evil.example/")));
        Assert.Equal(HttpStatusCode.Unauthorized, await OrdersStatus(MintToken(userId, now.AddMinutes(-1), now.AddMinutes(30), audience: "https://evil.example/")));
        Assert.Equal(HttpStatusCode.Unauthorized, await OrdersStatus(MintToken(userId, now.AddMinutes(-1), now.AddMinutes(30), key: "another-secret-another-secret-another-123456")));
        Assert.Equal(HttpStatusCode.Unauthorized, await OrdersStatus(MintUnsignedToken(userId, now)));                                      // alg: none
    }

    // ---- API documentation -------------------------------------------------------------------------------------

    [Fact]
    public async Task The_api_reference_is_served_in_development_only()
    {
        var development = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await development.GetAsync("/openapi/v1.json")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await development.GetAsync("/scalar/v1")).StatusCode);

        // A published app has an index.html: an unknown page route is answered with the Angular shell, so what matters
        // is that the API reference is not what comes back.
        Directory.CreateDirectory(_factory.WebRoot);
        var index = Path.Combine(_factory.WebRoot, "index.html");
        await File.WriteAllTextAsync(index, "<html><body><app-root>angular shell</app-root></body></html>");
        try
        {
            var production = _factory.WithWebHostBuilder(b => b.UseEnvironment("Production"));
            var client = production.CreateClient();

            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/openapi/v1.json")).StatusCode);
            foreach (var path in new[] { "/scalar/v1", "/scalar" })
            {
                var body = await (await client.GetAsync(path)).Content.ReadAsStringAsync();
                Assert.Contains("angular shell", body);
                Assert.DoesNotContain("scalar", body, StringComparison.OrdinalIgnoreCase);
            }
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/book")).StatusCode);   // the API itself still works
        }
        finally
        {
            File.Delete(index);
        }
    }

    // ---- security headers --------------------------------------------------------------------------------------

    [Theory]
    [InlineData("/api/book")]
    [InlineData("/api/order")]                // an error response (401)
    [InlineData("/does/not/exist.js")]       // a not-found response
    public async Task Every_response_carries_the_security_headers(string path)
    {
        var response = await _factory.CreateClient().GetAsync(path);

        Assert.Equal("nosniff", Single(response, "X-Content-Type-Options"));
        Assert.Equal("DENY", Single(response, "X-Frame-Options"));
        Assert.Equal("strict-origin-when-cross-origin", Single(response, "Referrer-Policy"));

        // Report-only by default, so a policy that is wrong for the built SPA cannot break the site.
        var csp = Single(response, "Content-Security-Policy-Report-Only");
        Assert.Contains("default-src 'self'", csp);
        Assert.Contains("script-src 'self'", csp);
        Assert.Contains("object-src 'none'", csp);
        Assert.Contains("frame-ancestors 'none'", csp);
        Assert.False(response.Headers.Contains("Content-Security-Policy"));
    }

    [Fact]
    public async Task The_csp_is_enforced_when_switched_on()
    {
        var enforcing = _factory.WithWebHostBuilder(b => b.UseSetting("Security:EnforceCsp", "true"));

        var response = await enforcing.CreateClient().GetAsync("/api/book");

        Assert.Contains("frame-ancestors 'none'", Single(response, "Content-Security-Policy"));
        Assert.False(response.Headers.Contains("Content-Security-Policy-Report-Only"));
    }

    [Fact]
    public async Task The_api_reference_page_is_exempt_from_the_csp_but_not_from_the_other_headers()
    {
        var response = await _factory.CreateClient().GetAsync("/scalar/v1");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        Assert.False(response.Headers.Contains("Content-Security-Policy-Report-Only"));
        Assert.Equal("nosniff", Single(response, "X-Content-Type-Options"));
    }

    // ---- rate limits -------------------------------------------------------------------------------------------

    [Fact]
    public async Task Login_attempts_are_limited_per_client_and_one_client_cannot_lock_out_another()
    {
        var attacker = _factory.CreateClient();
        for (var i = 0; i < ApiFactory.AuthPermitLimit; i++)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await Login(attacker, "usera", "wrong-" + i)).StatusCode);
        }

        var blocked = await Login(attacker, "usera", "wrong-again");
        Assert.Equal(HttpStatusCode.TooManyRequests, blocked.StatusCode);
        Assert.True(blocked.Headers.RetryAfter?.Delta > TimeSpan.Zero, "a 429 should say when to retry");

        // Even the right password is refused once the limit is hit: that is what stops password guessing.
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Login(attacker, "usera", ApiFactory.UserAPassword)).StatusCode);

        // Someone else, from another address, is unaffected.
        Assert.Equal(HttpStatusCode.OK, (await Login(_factory.CreateClient(), "usera", ApiFactory.UserAPassword)).StatusCode);
    }

    [Fact]
    public async Task Registration_is_limited()
    {
        var client = _factory.CreateClient();
        for (var i = 0; i < ApiFactory.AuthPermitLimit; i++)
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/user", new { })).StatusCode);   // invalid, but it counts
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PostAsJsonAsync("/api/user", new { })).StatusCode);
    }

    [Fact]
    public async Task Username_lookups_have_their_own_more_generous_limit()
    {
        var client = _factory.CreateClient();
        for (var i = 0; i < ApiFactory.LookupPermitLimit; i++)
        {
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/user/validateUserName/name{i}")).StatusCode);
        }
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.GetAsync("/api/user/validateUserName/onemore")).StatusCode);

        // The lookup limit is separate from the login limit, and ordinary endpoints are not limited at all.
        Assert.Equal(HttpStatusCode.OK, (await Login(client, "usera", ApiFactory.UserAPassword)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/book")).StatusCode);
    }

    // ---- registration validation -------------------------------------------------------------------------------

    [Theory]
    [InlineData("firstName", 21)]
    [InlineData("lastName", 21)]
    [InlineData("username", 21)]
    public async Task Over_long_names_are_a_400_not_a_database_error(string field, int length)
    {
        var response = await Register(Valid(field, new string('x', length)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(field, await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);   // the error says which field
    }

    [Theory]
    [InlineData("xMalex")]
    [InlineData("Other")]
    [InlineData("male")]
    [InlineData("Female2")]
    public async Task Gender_must_be_exactly_Male_or_Female(string gender)
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await Register(Valid("gender", gender))).StatusCode);
    }

    [Fact]
    public async Task Password_length_is_bounded()
    {
        var tooLong = "Aa1" + new string('x', 98);   // 101 characters: has every required class, but too long
        Assert.Equal(HttpStatusCode.BadRequest, (await Register(Valid("password", tooLong, "confirmPassword", tooLong))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Register(Valid("password", "Aa1xxxx", "confirmPassword", "Aa1xxxx"))).StatusCode);   // 7 characters
    }

    [Fact]
    public async Task Values_at_the_limits_are_accepted()
    {
        var longPassword = "Aa1" + new string('x', 97);   // exactly 100 characters
        var response = await Register(Valid(
            "firstName", new string('f', 20), "lastName", new string('l', 20), "username", "u" + Guid.NewGuid().ToString("N")[..19],
            "gender", "Female", "password", longPassword, "confirmPassword", longPassword));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ---- helpers -----------------------------------------------------------------------------------------------

    static string Single(HttpResponseMessage response, string header) => Assert.Single(response.Headers.GetValues(header));

    static Task<HttpResponseMessage> Login(HttpClient client, string username, string password) =>
        client.PostAsJsonAsync("/api/login", new { username, password });

    static async Task<string> LoginToken(HttpClient client, string username, string password)
    {
        var response = await Login(client, username, password);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
    }

    /// <summary>Registers with a fresh client (own rate-limit bucket) so tests in this class never interfere with each other.</summary>
    Task<HttpResponseMessage> Register(Dictionary<string, string> form) => _factory.CreateClient().PostAsJsonAsync("/api/user", form);

    /// <summary>A valid registration form, with the given field/value pairs replaced.</summary>
    static Dictionary<string, string> Valid(params string[] overrides)
    {
        var form = new Dictionary<string, string>
        {
            ["firstName"] = "First", ["lastName"] = "Last", ["username"] = "u" + Guid.NewGuid().ToString("N")[..12],
            ["gender"] = "Male", ["password"] = "Valid-pass-1", ["confirmPassword"] = "Valid-pass-1"
        };
        for (var i = 0; i < overrides.Length; i += 2) form[overrides[i]] = overrides[i + 1];
        if (overrides.Contains("password") && !overrides.Contains("confirmPassword")) form["confirmPassword"] = form["password"];
        return form;
    }

    async Task<HttpStatusCode> OrdersStatus(string token)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return (await client.GetAsync("/api/order")).StatusCode;
    }

    string MintToken(int userId, DateTime notBefore, DateTime expires, string issuer = TestIssuer, string audience = TestIssuer, string key = TestKey)
    {
        var credentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(issuer, audience, UserClaims(userId), notBefore, expires, credentials);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    string MintUnsignedToken(int userId, DateTime now)
    {
        var payload = new JwtPayload(TestIssuer, TestIssuer, UserClaims(userId), now.AddMinutes(-1), now.AddMinutes(30));
        return new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(new JwtHeader(), payload));
    }

    static Claim[] UserClaims(int userId) =>
    [
        new(JwtRegisteredClaimNames.Name, "usera"), new(JwtRegisteredClaimNames.Sub, userId.ToString()),
        new(ClaimTypes.Role, "User"), new("userId", userId.ToString())
    ];
}
