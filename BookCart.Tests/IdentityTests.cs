using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BookCart.Models;
using Microsoft.EntityFrameworkCore;

namespace BookCart.Tests;

/// <summary>
/// B3: there is no user id in any URL. The server decides whose data a request is about from the token, or else from the
/// guest cookie, so nobody can name somebody else's cart, wishlist or orders.
/// </summary>
[Collection(ApiCollection.Name)]
public class IdentityTests(ApiFactory factory)
{
    readonly ApiFactory _factory = factory;

    static string AddUrl(int bookId) => $"/api/shoppingcart/items/{bookId}";

    static IEnumerable<(int BookId, int Quantity)> Lines(JsonElement cart) =>
        cart.EnumerateArray().Select(i => (i.GetProperty("book").GetProperty("bookId").GetInt32(), i.GetProperty("quantity").GetInt32()));

    static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"expected success, got {(int)response.StatusCode}");
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    async Task<int> NewBookAsync(decimal price = 3m)
    {
        await using var db = _factory.CreateDbContext();
        var book = new Book { Title = "Identity " + Guid.NewGuid().ToString("N"), Author = "A", Category = "Fiction", Price = price, CoverFileName = "Default_image.jpg" };
        db.Book.Add(book);
        await db.SaveChangesAsync();
        return book.BookId;
    }

    // ---- anonymous visitors and guests ----------------------------------------------------------------------------

    [Fact]
    public async Task A_visitor_with_nothing_in_the_cart_sees_an_empty_cart_and_gets_no_cookie()
    {
        var client = _factory.Anonymous();

        var cart = await client.GetAsync("/api/shoppingcart");

        Assert.Equal(HttpStatusCode.OK, cart.StatusCode);
        Assert.Empty((await Json(cart)).EnumerateArray());
        Assert.False(cart.Headers.Contains("Set-Cookie"), "looking at an empty cart must not start a session");
        Assert.Equal(0, await (await client.GetAsync("/api/shoppingcart/count")).Content.ReadFromJsonAsync<int>());
    }

    [Fact]
    public async Task Adding_the_first_book_starts_a_guest_session_by_itself()
    {
        var browser = _factory.Anonymous();
        var bookId = await NewBookAsync();

        var added = await browser.PostAsync(AddUrl(bookId), null);

        Assert.Equal(HttpStatusCode.OK, added.StatusCode);
        var cookie = Assert.Single(added.Headers.GetValues("Set-Cookie"), c => c.StartsWith("bc_guest="));
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(new[] { (bookId, 1) }, Lines(await Json(added)));          // the response is the updated cart

        // The same browser sees it again, and adding the same book raises the quantity instead of adding a row.
        Assert.Equal(new[] { (bookId, 1) }, Lines(await Json(await browser.GetAsync("/api/shoppingcart"))));
        var second = await browser.PostAsync(AddUrl(bookId), null);
        Assert.False(second.Headers.Contains("Set-Cookie"), "the session continues, it is not reissued");
        Assert.Equal(new[] { (bookId, 2) }, Lines(await Json(second)));
        Assert.Equal(2, await (await browser.GetAsync("/api/shoppingcart/count")).Content.ReadFromJsonAsync<int>());
    }

    [Fact]
    public async Task Each_browser_has_its_own_guest_cart()
    {
        var bookId = await NewBookAsync();
        var first = _factory.Anonymous();
        var second = _factory.Anonymous();

        await first.PostAsync(AddUrl(bookId), null);

        Assert.NotEmpty((await Json(await first.GetAsync("/api/shoppingcart"))).EnumerateArray());
        Assert.Empty((await Json(await second.GetAsync("/api/shoppingcart"))).EnumerateArray());
        Assert.Empty((await Json(await _factory.Anonymous().GetAsync("/api/shoppingcart"))).EnumerateArray());
    }

    [Fact]
    public async Task A_forged_guest_cookie_is_ignored_it_cannot_name_somebody_elses_cart()
    {
        var bookId = await NewBookAsync();
        var victim = _factory.Anonymous();
        await victim.PostAsync(AddUrl(bookId), null);
        int victimId;
        await using (var db = _factory.CreateDbContext())
        {
            victimId = await db.Cart.Where(c => c.UserId >= 1_000_000_000).OrderByDescending(c => c.DateCreated).Select(c => c.UserId).FirstAsync();
        }

        // The attacker knows the victim's guest id and presents it, unencrypted, as their cookie.
        var attacker = _factory.WithoutCookies();
        attacker.DefaultRequestHeaders.Add("Cookie", $"bc_guest={victimId}");

        Assert.Empty((await Json(await attacker.GetAsync("/api/shoppingcart"))).EnumerateArray());
        var added = await attacker.PostAsync(AddUrl(bookId), null);
        Assert.Contains(added.Headers.GetValues("Set-Cookie"), c => c.StartsWith("bc_guest="));    // a fresh session, not the victim's
        Assert.Equal(new[] { (bookId, 1) }, Lines(await Json(await victim.GetAsync("/api/shoppingcart"))));    // the victim's cart is untouched
    }

    [Fact]
    public async Task A_guest_can_change_and_empty_their_cart()
    {
        var keep = await NewBookAsync();
        var drop = await NewBookAsync();
        var browser = _factory.Anonymous();
        await browser.PostAsync(AddUrl(keep), null);
        await browser.PostAsync(AddUrl(keep), null);
        await browser.PostAsync(AddUrl(drop), null);
        await browser.PostAsync(AddUrl(drop), null);

        // One copy less: 2 -> 1.
        var decreased = await Json(await browser.PatchAsync(AddUrl(keep), null));
        Assert.Equal(new[] { (keep, 1), (drop, 2) }, Lines(decreased));

        // The last copy removes the book, it does not leave a quantity of 0 behind.
        var removedLast = await Json(await browser.PatchAsync(AddUrl(keep), null));
        Assert.Equal(new[] { (drop, 2) }, Lines(removedLast));

        // Remove a book whatever its quantity.
        var removed = await Json(await browser.DeleteAsync(AddUrl(drop)));
        Assert.Empty(removed.EnumerateArray());

        await browser.PostAsync(AddUrl(keep), null);
        Assert.Equal(HttpStatusCode.NoContent, (await browser.DeleteAsync("/api/shoppingcart")).StatusCode);
        Assert.Empty((await Json(await browser.GetAsync("/api/shoppingcart"))).EnumerateArray());
    }

    [Fact]
    public async Task Adding_an_unknown_book_is_a_404_and_changes_nothing()
    {
        var browser = _factory.Anonymous();

        Assert.Equal(HttpStatusCode.NotFound, (await browser.PostAsync(AddUrl(987_654), null)).StatusCode);

        Assert.Empty((await Json(await browser.GetAsync("/api/shoppingcart"))).EnumerateArray());
    }

    // ---- signed-in users --------------------------------------------------------------------------------------------

    [Fact]
    public async Task Users_have_separate_carts_and_the_cart_does_not_depend_on_any_id_in_the_request()
    {
        var bookId = await NewBookAsync();
        var (_, aName, aPassword) = await _factory.NewUserAsync();
        var (_, bName, bPassword) = await _factory.NewUserAsync();
        var a = await _factory.LoggedIn(aName, aPassword);
        var b = await _factory.LoggedIn(bName, bPassword);

        await a.PostAsync(AddUrl(bookId), null);

        Assert.Equal(new[] { (bookId, 1) }, Lines(await Json(await a.GetAsync("/api/shoppingcart"))));
        Assert.Empty((await Json(await b.GetAsync("/api/shoppingcart"))).EnumerateArray());
        Assert.Empty((await Json(await _factory.Anonymous().GetAsync("/api/shoppingcart"))).EnumerateArray());
    }

    [Fact]
    public async Task Reading_and_undoing_things_never_creates_a_cart_or_wishlist()
    {
        // The old API created a cart row for any id on every read, so anyone could fill the table by browsing.
        var (userId, name, password) = await _factory.NewUserAsync();
        var user = await _factory.LoggedIn(name, password);

        await user.GetAsync("/api/shoppingcart");
        await user.GetAsync("/api/shoppingcart/count");
        await user.PatchAsync("/api/shoppingcart/items/1", null);
        await user.DeleteAsync("/api/shoppingcart/items/1");
        await user.DeleteAsync("/api/shoppingcart");
        await user.GetAsync("/api/wishlist");
        await user.DeleteAsync("/api/wishlist");
        await user.GetAsync("/api/order");

        await using var db = _factory.CreateDbContext();
        Assert.False(await db.Cart.AnyAsync(c => c.UserId == userId), "no cart should exist until a book is added");
        Assert.False(await db.Wishlist.AnyAsync(w => w.UserId == userId), "no wishlist should exist until a book is added");

        // The first book added creates the cart.
        await user.PostAsync(AddUrl(_factory.BookId), null);
        Assert.True(await db.Cart.AnyAsync(c => c.UserId == userId));
    }

    [Fact]
    public async Task A_signed_in_user_with_a_guest_cookie_uses_their_own_cart()
    {
        var guestBook = await NewBookAsync();
        var userBook = await NewBookAsync();
        var (userId, name, password) = await _factory.NewUserAsync();

        // A browser that has a guest cart...
        var browser = _factory.Anonymous();
        await browser.PostAsync(AddUrl(guestBook), null);
        // ...and then also presents a token (obtained elsewhere, so the guest cookie is still there and nothing was merged).
        browser.DefaultRequestHeaders.Authorization = (await _factory.LoggedIn(name, password)).DefaultRequestHeaders.Authorization;

        var cart = await Json(await browser.PostAsync(AddUrl(userBook), null));

        Assert.Equal(new[] { (userBook, 1) }, Lines(cart));       // the user's cart, not the guest's
        await using var db = _factory.CreateDbContext();
        var inGuestCarts = await (from c in db.Cart join i in db.CartItems on c.CartId equals i.CartId
                                  where c.UserId >= 1_000_000_000 && i.ProductId == userBook select i).AnyAsync();
        Assert.False(inGuestCarts, "a signed-in user's additions must not land in a guest cart");
        var inUserCart = await (from c in db.Cart join i in db.CartItems on c.CartId equals i.CartId
                                where c.UserId == userId && i.ProductId == userBook select i).AnyAsync();
        Assert.True(inUserCart);
    }

    // ---- merging the guest cart at login ----------------------------------------------------------------------------

    [Fact]
    public async Task Logging_in_merges_the_guest_cart_into_the_users_cart_and_ends_the_guest_session()
    {
        var onlyGuest = await NewBookAsync();
        var both = await NewBookAsync();
        var (userId, name, password) = await _factory.NewUserAsync();

        // The user already has one copy of `both` from an earlier visit.
        var earlier = await _factory.LoggedIn(name, password);
        await earlier.PostAsync(AddUrl(both), null);

        // Now, logged out, they add two copies of `both` and one of `onlyGuest` as a guest.
        var browser = _factory.Anonymous();
        await browser.PostAsync(AddUrl(both), null);
        await browser.PostAsync(AddUrl(both), null);
        await browser.PostAsync(AddUrl(onlyGuest), null);

        var login = await browser.PostAsJsonAsync("/api/login", new { username = name, password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.Contains(login.Headers.GetValues("Set-Cookie"), c => c.StartsWith("bc_guest=;", StringComparison.Ordinal) || c.Contains("expires=Thu, 01 Jan 1970"));

        var token = (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
        var signedIn = _factory.Anonymous();
        signedIn.DefaultRequestHeaders.Authorization = new("Bearer", token);
        var cart = Lines(await Json(await signedIn.GetAsync("/api/shoppingcart"))).OrderBy(l => l.BookId).ToList();
        Assert.Equal(new[] { (both, 3), (onlyGuest, 1) }.OrderBy(l => l.Item1).ToList(), cart);   // 1 + 2 copies of `both`

        // The guest cart is gone, and the browser's cookie no longer points at anything.
        await using var db = _factory.CreateDbContext();
        Assert.False(await db.Cart.AnyAsync(c => c.UserId >= 1_000_000_000 && db.CartItems.Any(i => i.CartId == c.CartId && (i.ProductId == both || i.ProductId == onlyGuest))));
        Assert.Empty((await Json(await browser.GetAsync("/api/shoppingcart"))).EnumerateArray());
    }

    [Fact]
    public async Task A_failed_login_does_not_merge_or_end_the_guest_session()
    {
        var bookId = await NewBookAsync();
        var (_, name, _) = await _factory.NewUserAsync();
        var browser = _factory.Anonymous();
        await browser.PostAsync(AddUrl(bookId), null);

        var login = await browser.PostAsJsonAsync("/api/login", new { username = name, password = "wrong-password" });

        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
        Assert.False(login.Headers.Contains("Set-Cookie"));
        Assert.Equal(new[] { (bookId, 1) }, Lines(await Json(await browser.GetAsync("/api/shoppingcart"))));
    }

    [Fact]
    public async Task Logging_in_without_a_guest_cart_just_works()
    {
        var (_, name, password) = await _factory.NewUserAsync();

        var login = await _factory.Anonymous().PostAsJsonAsync("/api/login", new { username = name, password });

        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.False(login.Headers.Contains("Set-Cookie"));
    }

    // ---- guest session endpoint -------------------------------------------------------------------------------------

    [Fact]
    public async Task The_guest_endpoint_issues_an_unguessable_id_in_an_HttpOnly_cookie_and_is_idempotent()
    {
        var client = _factory.Anonymous();

        var first = await client.PostAsync("/api/guest", null);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var id = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("guestId").GetInt32();
        Assert.True(id >= 1_000_000_000, "guest ids live in the reserved range, far above real user ids");

        var setCookie = Assert.Single(first.Headers.GetValues("Set-Cookie"), c => c.StartsWith("bc_guest="));
        Assert.Contains("httponly", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(id.ToString(), setCookie);   // the id inside the cookie is encrypted, not readable

        var second = await client.PostAsync("/api/guest", null);
        Assert.Equal(id, (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("guestId").GetInt32());
        Assert.False(second.Headers.Contains("Set-Cookie"), "an existing guest session must not be reissued");
    }

    // ---- wishlist, orders, checkout: signed-in only ------------------------------------------------------------------

    [Fact]
    public async Task Wishlist_orders_and_checkout_need_a_login_even_for_a_guest_with_a_cart()
    {
        var browser = _factory.Anonymous();
        await browser.PostAsync(AddUrl(await NewBookAsync()), null);   // a real guest session

        foreach (var (method, url) in new[]
        {
            (HttpMethod.Get, "/api/wishlist"), (HttpMethod.Post, "/api/wishlist/items/1"), (HttpMethod.Delete, "/api/wishlist"),
            (HttpMethod.Get, "/api/order"), (HttpMethod.Post, "/api/checkout"),
        })
        {
            var status = (await browser.SendAsync(new HttpRequestMessage(method, url))).StatusCode;
            Assert.True(status == HttpStatusCode.Unauthorized, $"{method} {url} should be 401 without a login, got {(int)status}");
        }
    }

    [Fact]
    public async Task Users_have_separate_wishlists()
    {
        var bookId = await NewBookAsync();
        var (_, aName, aPassword) = await _factory.NewUserAsync();
        var (_, bName, bPassword) = await _factory.NewUserAsync();
        var a = await _factory.LoggedIn(aName, aPassword);
        var b = await _factory.LoggedIn(bName, bPassword);

        var added = await Json(await a.PostAsync($"/api/wishlist/items/{bookId}", null));     // toggle on: returns the updated list
        Assert.Equal(bookId, Assert.Single(added.EnumerateArray()).GetProperty("bookId").GetInt32());
        Assert.Empty((await Json(await b.GetAsync("/api/wishlist"))).EnumerateArray());

        var toggledOff = await Json(await a.PostAsync($"/api/wishlist/items/{bookId}", null));
        Assert.Empty(toggledOff.EnumerateArray());

        await a.PostAsync($"/api/wishlist/items/{bookId}", null);
        Assert.Equal(HttpStatusCode.NoContent, (await a.DeleteAsync("/api/wishlist")).StatusCode);
        Assert.Empty((await Json(await a.GetAsync("/api/wishlist"))).EnumerateArray());
    }

    [Fact]
    public async Task Toggling_an_unknown_book_on_the_wishlist_is_a_404()
    {
        var (_, name, password) = await _factory.NewUserAsync();
        var user = await _factory.LoggedIn(name, password);

        Assert.Equal(HttpStatusCode.NotFound, (await user.PostAsync("/api/wishlist/items/987654", null)).StatusCode);
    }

    [Fact]
    public async Task Users_see_only_their_own_orders_even_an_admin()
    {
        var bookId = await NewBookAsync(10m);
        var (aId, aName, aPassword) = await _factory.NewUserAsync();
        var (bId, bName, bPassword) = await _factory.NewUserAsync();
        string orderId;
        await using (var db = _factory.CreateDbContext())
        {
            orderId = $"I-{Guid.NewGuid():N}"[..20];
            db.CustomerOrders.Add(new() { OrderId = orderId, UserId = bId, DateCreated = DateTime.UtcNow, CartTotal = 20m });
            db.CustomerOrderDetails.Add(new() { OrderId = orderId, ProductId = bookId, Quantity = 2, Price = 10m });
            await db.SaveChangesAsync();
        }

        var mine = await Json(await (await _factory.LoggedIn(bName, bPassword)).GetAsync("/api/order"));
        var order = Assert.Single(mine.EnumerateArray());
        Assert.Equal(orderId, order.GetProperty("orderId").GetString());
        Assert.Equal(20m, order.GetProperty("cartTotal").GetDecimal());
        Assert.EndsWith("Z", order.GetProperty("orderDate").GetString());       // a UTC instant, so the browser converts it correctly
        var line = Assert.Single(order.GetProperty("orderDetails").EnumerateArray());
        Assert.Equal(2, line.GetProperty("quantity").GetInt32());
        Assert.Equal(bookId, line.GetProperty("book").GetProperty("bookId").GetInt32());
        Assert.Equal(10m, line.GetProperty("book").GetProperty("price").GetDecimal());       // the price paid
        Assert.False(string.IsNullOrEmpty(line.GetProperty("book").GetProperty("title").GetString()));

        Assert.Empty((await Json(await (await _factory.LoggedIn(aName, aPassword)).GetAsync("/api/order"))).EnumerateArray());
        Assert.Empty((await Json(await (await _factory.LoggedIn("adminuser", ApiFactory.AdminPassword)).GetAsync("/api/order"))).EnumerateArray());
        _ = aId;
    }

    [Fact]
    public async Task An_order_still_lists_a_book_that_was_deleted_afterwards()
    {
        var bookId = await NewBookAsync(7m);
        var (userId, name, password) = await _factory.NewUserAsync();
        await using (var db = _factory.CreateDbContext())
        {
            var orderId = $"D-{Guid.NewGuid():N}"[..20];
            db.CustomerOrders.Add(new() { OrderId = orderId, UserId = userId, DateCreated = DateTime.UtcNow, CartTotal = 7m });
            db.CustomerOrderDetails.Add(new() { OrderId = orderId, ProductId = bookId, Quantity = 1, Price = 7m });
            await db.SaveChangesAsync();
            await db.Book.Where(b => b.BookId == bookId).ExecuteDeleteAsync();
        }

        var orders = await Json(await (await _factory.LoggedIn(name, password)).GetAsync("/api/order"));

        var line = Assert.Single(Assert.Single(orders.EnumerateArray()).GetProperty("orderDetails").EnumerateArray());
        Assert.Equal(7m, line.GetProperty("book").GetProperty("price").GetDecimal());      // the lines still add up to the total
    }

    // ---- the old URL shapes are gone ---------------------------------------------------------------------------------

    [Theory]
    [InlineData("GET", "/api/shoppingcart/1")]
    [InlineData("POST", "/api/shoppingcart/AddToCart/1/1")]
    [InlineData("GET", "/api/shoppingcart/SetShoppingCart/1000000001/1")]
    [InlineData("PUT", "/api/shoppingcart/1/1")]
    [InlineData("DELETE", "/api/shoppingcart/1/1")]
    [InlineData("GET", "/api/wishlist/1")]
    [InlineData("POST", "/api/wishlist/ToggleWishlist/1/1")]
    [InlineData("GET", "/api/order/1")]
    [InlineData("POST", "/api/checkout/1")]
    [InlineData("GET", "/api/user/1")]
    public async Task Routes_that_took_a_user_id_no_longer_exist(string method, string url)
    {
        var admin = await _factory.LoggedIn("adminuser", ApiFactory.AdminPassword);   // even the most privileged caller

        var response = await admin.SendAsync(new HttpRequestMessage(new HttpMethod(method), url));

        // 404 for a GET; for other methods the SPA fallback (GET/HEAD only) makes it a 405. Either way: refused, and not served.
        Assert.True(response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed,
            $"{method} {url} should be gone, got {(int)response.StatusCode}");
    }

    // ---- public by design, protected by design --------------------------------------------------------------------

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
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/shoppingcart")).StatusCode);

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
