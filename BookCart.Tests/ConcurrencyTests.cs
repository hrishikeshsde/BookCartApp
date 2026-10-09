using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace BookCart.Tests;

/// <summary>
/// B4: the database now refuses duplicates (one cart per owner, one line per book), so requests that race must not fail
/// or lose anything. The old code answered such races by quietly creating duplicate rows. The requests are released
/// together to make a collision as likely as possible; the invariants are checked whatever order they ran in.
/// </summary>
[Collection(ApiCollection.Name)]
public class ConcurrencyTests(ApiFactory factory)
{
    const int Parallel = 12;
    const int Rounds = 4;

    readonly ApiFactory _factory = factory;

    /// <summary>Starts all the actions at the same moment and waits for their results.</summary>
    static async Task<T[]> TogetherAsync<T>(IEnumerable<Func<Task<T>>> actions)
    {
        var gate = new TaskCompletionSource();
        var tasks = actions.Select(action => Task.Run(async () => { await gate.Task; return await action(); })).ToArray();
        await Task.Delay(50);       // let every task reach the gate
        gate.SetResult();
        return await Task.WhenAll(tasks);
    }

    async Task<int> NewBookAsync()
    {
        await using var db = _factory.CreateDbContext();
        var book = new Models.Book { Title = "Race " + Guid.NewGuid().ToString("N"), Author = "A", Category = "Fiction", Price = 1m, CoverFileName = "Default_image.jpg" };
        db.Book.Add(book);
        await db.SaveChangesAsync();
        return book.BookId;
    }

    [Fact]
    public async Task Parallel_first_additions_by_one_user_create_one_cart_and_lose_no_copy()
    {
        for (var round = 0; round < Rounds; round++)
        {
            var bookId = await NewBookAsync();
            var (userId, name, password) = await _factory.NewUserAsync();
            var clients = new List<HttpClient>();
            for (var i = 0; i < Parallel; i++) clients.Add(await _factory.LoggedIn(name, password));

            var statuses = await TogetherAsync(clients.Select(c => (Func<Task<HttpStatusCode>>)(async () => (await c.PostAsync($"/api/shoppingcart/items/{bookId}", null)).StatusCode)));

            Assert.All(statuses, s => Assert.Equal(HttpStatusCode.OK, s));
            await using var db = _factory.CreateDbContext();
            Assert.Equal(1, await db.Cart.CountAsync(c => c.UserId == userId));
            var lines = await (from c in db.Cart where c.UserId == userId join i in db.CartItems on c.CartId equals i.CartId select i).ToListAsync();
            var line = Assert.Single(lines);
            Assert.Equal(Parallel, line.Quantity);        // every request's copy was counted exactly once
        }
    }

    [Fact]
    public async Task Parallel_first_additions_of_different_books_end_in_one_cart_with_every_book()
    {
        var books = new List<int>();
        for (var i = 0; i < Parallel; i++) books.Add(await NewBookAsync());
        var (userId, name, password) = await _factory.NewUserAsync();
        var clients = new List<HttpClient>();
        for (var i = 0; i < Parallel; i++) clients.Add(await _factory.LoggedIn(name, password));

        var statuses = await TogetherAsync(clients.Select((c, i) => (Func<Task<HttpStatusCode>>)(async () => (await c.PostAsync($"/api/shoppingcart/items/{books[i]}", null)).StatusCode)));

        Assert.All(statuses, s => Assert.Equal(HttpStatusCode.OK, s));
        await using var db = _factory.CreateDbContext();
        Assert.Equal(1, await db.Cart.CountAsync(c => c.UserId == userId));
        var inCart = await (from c in db.Cart where c.UserId == userId join i in db.CartItems on c.CartId equals i.CartId select i.ProductId).ToListAsync();
        Assert.Equal(books.Order(), inCart.Order());
    }

    [Fact]
    public async Task Parallel_wishlist_toggles_never_fail_or_duplicate_anything()
    {
        for (var round = 0; round < Rounds; round++)
        {
            var bookId = await NewBookAsync();
            var (userId, name, password) = await _factory.NewUserAsync();
            var clients = new List<HttpClient>();
            for (var i = 0; i < Parallel; i++) clients.Add(await _factory.LoggedIn(name, password));

            var statuses = await TogetherAsync(clients.Select(c => (Func<Task<HttpStatusCode>>)(async () => (await c.PostAsync($"/api/wishlist/items/{bookId}", null)).StatusCode)));

            Assert.All(statuses, s => Assert.Equal(HttpStatusCode.OK, s));
            await using var db = _factory.CreateDbContext();
            Assert.Equal(1, await db.Wishlist.CountAsync(w => w.UserId == userId));
            var onList = await (from w in db.Wishlist where w.UserId == userId join i in db.WishlistItems on w.WishlistId equals i.WishlistId select i).CountAsync();
            Assert.InRange(onList, 0, 1);      // however the toggles interleaved: on the list once, or off it
        }
    }

    [Fact]
    public async Task Parallel_guest_additions_in_one_browser_share_one_guest_cart()
    {
        var bookId = await NewBookAsync();
        // One browser (so one cookie jar) that already has its guest session, then many requests at once.
        var browser = _factory.Anonymous();
        await browser.PostAsync($"/api/shoppingcart/items/{bookId}", null);

        var statuses = await TogetherAsync(Enumerable.Range(0, Parallel).Select(_ => (Func<Task<HttpStatusCode>>)(async () => (await browser.PostAsync($"/api/shoppingcart/items/{bookId}", null)).StatusCode)));

        Assert.All(statuses, s => Assert.Equal(HttpStatusCode.OK, s));
        var cart = await browser.GetFromJsonAsync<JsonElement>("/api/shoppingcart");
        var line = Assert.Single(cart.EnumerateArray());
        Assert.Equal(Parallel + 1, line.GetProperty("quantity").GetInt32());
    }

    [Fact]
    public async Task Two_logins_at_once_that_merge_into_the_same_cart_lose_nothing()
    {
        var shared = await NewBookAsync();
        var (_, name, password) = await _factory.NewUserAsync();

        // Two devices, each with its own guest cart containing the same book, log in as the same user at the same time.
        var devices = new List<HttpClient>();
        for (var i = 0; i < 2; i++)
        {
            var device = _factory.Anonymous();
            await device.PostAsync($"/api/shoppingcart/items/{shared}", null);
            await device.PostAsync($"/api/shoppingcart/items/{shared}", null);
            devices.Add(device);
        }

        var statuses = await TogetherAsync(devices.Select(d => (Func<Task<HttpStatusCode>>)(async () =>
            (await d.PostAsJsonAsync("/api/login", new { username = name, password })).StatusCode)));

        Assert.All(statuses, s => Assert.Equal(HttpStatusCode.OK, s));
        var user = await _factory.LoggedIn(name, password);
        var line = Assert.Single((await user.GetFromJsonAsync<JsonElement>("/api/shoppingcart")).EnumerateArray());
        Assert.Equal(4, line.GetProperty("quantity").GetInt32());          // 2 + 2, merged exactly once each
    }
}
