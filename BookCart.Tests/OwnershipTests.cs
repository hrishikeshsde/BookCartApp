using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace BookCart.Tests;

/// <summary>
/// B0.4: every endpoint that takes a {userId} only serves the caller's own user id or guest id (admins excepted),
/// carts work for anonymous guests through a server-issued cookie, and endpoints are secure by default.
/// </summary>
[Collection(ApiCollection.Name)]
public class OwnershipTests(ApiFactory factory)
{
    readonly ApiFactory _factory = factory;

    /// <summary>Every {userId} endpoint, as (method, url, body) for the given id.</summary>
    IEnumerable<(HttpMethod Method, string Url, object? Body)> UserScopedRequests(int id) =>
    [
        (HttpMethod.Get, $"/api/shoppingcart/{id}", null),
        (HttpMethod.Post, $"/api/shoppingcart/AddToCart/{id}/{_factory.BookId}", null),
        (HttpMethod.Put, $"/api/shoppingcart/{id}/{_factory.BookId}", null),
        (HttpMethod.Delete, $"/api/shoppingcart/{id}/{_factory.BookId}", null),
        (HttpMethod.Delete, $"/api/shoppingcart/{id}", null),
        (HttpMethod.Get, $"/api/wishlist/{id}", null),
        (HttpMethod.Post, $"/api/wishlist/ToggleWishlist/{id}/{_factory.BookId}", null),
        (HttpMethod.Delete, $"/api/wishlist/{id}", null),
        (HttpMethod.Get, $"/api/order/{id}", null),
        (HttpMethod.Post, $"/api/checkout/{id}", new { cartTotal = 0m, orderDetails = Array.Empty<object>() }),
        (HttpMethod.Get, $"/api/user/{id}", null),
    ];

    static async Task<HttpStatusCode> Send(HttpClient client, (HttpMethod Method, string Url, object? Body) r)
    {
        var request = new HttpRequestMessage(r.Method, r.Url);
        if (r.Body is not null) request.Content = JsonContent.Create(r.Body);
        using var response = await client.SendAsync(request);
        return response.StatusCode;
    }

    // ---- anonymous callers --------------------------------------------------------------------------------------

    [Fact]
    public async Task Anonymous_callers_get_401_on_every_user_scoped_endpoint()
    {
        var client = _factory.Anonymous();
        foreach (var r in UserScopedRequests(_factory.UserAId))
        {
            Assert.True(HttpStatusCode.Unauthorized == await Send(client, r), $"{r.Method} {r.Url} should be 401 for anonymous callers");
        }
    }

    // ---- signed-in users ----------------------------------------------------------------------------------------

    [Fact]
    public async Task User_can_use_their_own_cart_wishlist_and_orders()
    {
        var client = await _factory.LoggedIn("usera", ApiFactory.UserAPassword);
        var ownRequests = new[]
        {
            (HttpMethod.Get, $"/api/shoppingcart/{_factory.UserAId}", (object?)null),
            (HttpMethod.Post, $"/api/shoppingcart/AddToCart/{_factory.UserAId}/{_factory.BookId}", null),
            (HttpMethod.Get, $"/api/wishlist/{_factory.UserAId}", null),
            (HttpMethod.Get, $"/api/order/{_factory.UserAId}", null),
            (HttpMethod.Get, $"/api/user/{_factory.UserAId}", null),
        };
        foreach (var r in ownRequests)
        {
            Assert.True(HttpStatusCode.OK == await Send(client, r), $"{r.Item1} {r.Item2} should be 200 for the owner");
        }
    }

    [Fact]
    public async Task User_gets_403_on_every_endpoint_scoped_to_someone_else()
    {
        var client = await _factory.LoggedIn("usera", ApiFactory.UserAPassword);
        foreach (var r in UserScopedRequests(_factory.UserBId))
        {
            Assert.True(HttpStatusCode.Forbidden == await Send(client, r), $"{r.Method} {r.Url} should be 403 for another user");
        }
    }

    [Fact]
    public async Task User_cannot_reach_a_guest_cart_that_is_not_theirs()
    {
        var (_, guestId) = await _factory.Guest();
        var client = await _factory.LoggedIn("usera", ApiFactory.UserAPassword);

        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync($"/api/shoppingcart/{guestId}")).StatusCode);
    }

    [Fact]
    public async Task Admin_can_read_any_users_orders()
    {
        var client = await _factory.LoggedIn("adminuser", ApiFactory.AdminPassword);

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/order/{_factory.UserBId}")).StatusCode);
    }

    // ---- guests -------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Guest_session_issues_an_unguessable_id_in_an_HttpOnly_cookie()
    {
        var client = _factory.Anonymous();

        var first = await client.PostAsync("/api/guest", null);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var id = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("guestId").GetInt32();
        Assert.True(id >= 1_000_000_000, "guest ids live in the reserved range, far above real user ids");

        var setCookie = Assert.Single(first.Headers.GetValues("Set-Cookie"), c => c.StartsWith("bc_guest="));
        Assert.Contains("httponly", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(id.ToString(), setCookie);   // the id inside the cookie is encrypted, not readable

        // Same browser asking again keeps its session instead of minting a new one.
        var second = await client.PostAsync("/api/guest", null);
        Assert.Equal(id, (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("guestId").GetInt32());
        Assert.False(second.Headers.Contains("Set-Cookie"), "an existing guest session must not be reissued");
    }

    [Fact]
    public async Task Guest_can_use_their_own_cart_but_nothing_else()
    {
        var (guest, guestId) = await _factory.Guest();

        Assert.Equal(HttpStatusCode.OK, (await guest.PostAsync($"/api/shoppingcart/AddToCart/{guestId}/{_factory.BookId}", null)).StatusCode);
        var cart = await guest.GetFromJsonAsync<JsonElement>($"/api/shoppingcart/{guestId}");
        Assert.Contains(cart.EnumerateArray(), i => i.GetProperty("book").GetProperty("bookId").GetInt32() == _factory.BookId);
        Assert.Equal(HttpStatusCode.OK, (await guest.GetAsync($"/api/user/{guestId}")).StatusCode);

        // A guest is not a user: no orders, no wishlist, no checkout, nobody else's cart.
        Assert.Equal(HttpStatusCode.Unauthorized, (await guest.GetAsync($"/api/order/{guestId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await guest.GetAsync($"/api/wishlist/{guestId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await guest.GetAsync($"/api/shoppingcart/{_factory.UserAId}")).StatusCode);
    }

    [Fact]
    public async Task One_guest_cannot_use_another_guests_cart_even_knowing_the_id()
    {
        var (_, victimId) = await _factory.Guest();
        var (attacker, _) = await _factory.Guest();

        Assert.Equal(HttpStatusCode.Forbidden, (await attacker.GetAsync($"/api/shoppingcart/{victimId}")).StatusCode);
    }

    [Fact]
    public async Task Guest_id_without_the_cookie_or_with_a_forged_cookie_is_refused()
    {
        var (_, guestId) = await _factory.Guest();

        var noCookie = _factory.WithoutCookies();
        Assert.Equal(HttpStatusCode.Unauthorized, (await noCookie.GetAsync($"/api/shoppingcart/{guestId}")).StatusCode);

        var forged = _factory.WithoutCookies();
        forged.DefaultRequestHeaders.Add("Cookie", $"bc_guest={guestId}");   // plaintext id, not issued by the server
        Assert.Equal(HttpStatusCode.Unauthorized, (await forged.GetAsync($"/api/shoppingcart/{guestId}")).StatusCode);
    }

    // ---- merging a guest cart into a user's cart ----------------------------------------------------------------

    [Fact]
    public async Task Guest_cart_can_be_merged_into_the_users_own_cart_after_login()
    {
        var (browser, guestId) = await _factory.Guest();
        await browser.PostAsync($"/api/shoppingcart/AddToCart/{guestId}/{_factory.BookId}", null);
        await _factory.LoggedIn("userb", ApiFactory.UserBPassword, browser);   // same browser: keeps the guest cookie

        var merge = await browser.GetAsync($"/api/shoppingcart/SetShoppingCart/{guestId}/{_factory.UserBId}");
        Assert.Equal(HttpStatusCode.OK, merge.StatusCode);

        var cart = await browser.GetFromJsonAsync<JsonElement>($"/api/shoppingcart/{_factory.UserBId}");
        Assert.Contains(cart.EnumerateArray(), i => i.GetProperty("book").GetProperty("bookId").GetInt32() == _factory.BookId);
    }

    [Fact]
    public async Task Merge_refuses_other_peoples_carts_and_unauthenticated_callers()
    {
        var (browser, guestId) = await _factory.Guest();
        await _factory.LoggedIn("usera", ApiFactory.UserAPassword, browser);

        // Target is someone else's cart.
        Assert.Equal(HttpStatusCode.Forbidden, (await browser.GetAsync($"/api/shoppingcart/SetShoppingCart/{guestId}/{_factory.UserBId}")).StatusCode);
        // Source is another real user's cart, which merging would then delete.
        Assert.Equal(HttpStatusCode.Forbidden, (await browser.GetAsync($"/api/shoppingcart/SetShoppingCart/{_factory.UserBId}/{_factory.UserAId}")).StatusCode);

        // Source is a different guest's cart (this browser's cookie names another id).
        var (other, otherGuestId) = await _factory.Guest();
        Assert.Equal(HttpStatusCode.Forbidden, (await browser.GetAsync($"/api/shoppingcart/SetShoppingCart/{otherGuestId}/{_factory.UserAId}")).StatusCode);

        // Signed in but without any guest cookie.
        var noGuest = await _factory.LoggedIn("usera", ApiFactory.UserAPassword);
        Assert.Equal(HttpStatusCode.Forbidden, (await noGuest.GetAsync($"/api/shoppingcart/SetShoppingCart/{guestId}/{_factory.UserAId}")).StatusCode);

        // Admins get no exception: merging deletes the source cart.
        var admin = await _factory.LoggedIn("adminuser", ApiFactory.AdminPassword);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync($"/api/shoppingcart/SetShoppingCart/{guestId}/{_factory.UserAId}")).StatusCode);

        // Not signed in at all.
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.GetAsync($"/api/shoppingcart/SetShoppingCart/{otherGuestId}/{_factory.UserAId}")).StatusCode);
    }

    // ---- secure by default, public by choice --------------------------------------------------------------------

    [Fact]
    public async Task Public_endpoints_stay_public()
    {
        var client = _factory.Anonymous();

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/book")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/book/{_factory.BookId}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/book/GetCategoriesList")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/book/GetSimilarBooks/{_factory.BookId}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/user/validateUserName/someone-new")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/api/guest", null)).StatusCode);

        // The SPA shell is served through an endpoint too; it must not be caught by the login requirement.
        Assert.NotEqual(HttpStatusCode.Unauthorized, (await client.GetAsync("/some/angular/route")).StatusCode);
    }

    [Theory]
    [InlineData("/Upload/does-not-exist.png")]
    [InlineData("/missing-chunk.js")]
    [InlineData("/some/folder/file.css")]
    public async Task A_missing_file_is_a_404_not_a_login_prompt(string path)
    {
        var response = await _factory.Anonymous().GetAsync(path);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Admin_only_book_endpoints_stay_admin_only()
    {
        var anonymous = _factory.Anonymous();
        var user = await _factory.LoggedIn("usera", ApiFactory.UserAPassword);

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.DeleteAsync($"/api/book/{_factory.BookId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.DeleteAsync($"/api/book/{_factory.BookId}")).StatusCode);
    }
}
