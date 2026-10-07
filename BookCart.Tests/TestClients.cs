using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace BookCart.Tests;

/// <summary>Helpers for building anonymous, signed-in and guest HTTP clients.</summary>
public static class TestClients
{
    /// <summary>Each client has its own cookie jar, so each one is its own browser.</summary>
    public static HttpClient Anonymous(this ApiFactory factory) => factory.CreateClient();

    public static HttpClient WithoutCookies(this ApiFactory factory) =>
        factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

    public static async Task<HttpClient> LoggedIn(this ApiFactory factory, string username, string password, HttpClient? client = null)
    {
        client ??= factory.CreateClient();
        var login = await client.PostAsJsonAsync("/api/login", new { username, password });
        login.EnsureSuccessStatusCode();
        var body = await login.Content.ReadFromJsonAsync<JsonElement>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", body.GetProperty("token").GetString());
        return client;
    }

    /// <summary>Starts a guest session. The returned client holds the guest cookie.</summary>
    public static async Task<(HttpClient Client, int GuestId)> Guest(this ApiFactory factory, HttpClient? client = null)
    {
        client ??= factory.CreateClient();
        var response = await client.PostAsync("/api/guest", content: null);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return (client, body.GetProperty("guestId").GetInt32());
    }
}
