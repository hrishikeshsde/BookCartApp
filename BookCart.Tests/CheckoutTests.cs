using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BookCart.DataAccess;
using BookCart.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace BookCart.Tests;

/// <summary>B0.5: checkout is priced from the database and is all-or-nothing (order + emptied cart).</summary>
[Collection(ApiCollection.Name)]
public class CheckoutTests(ApiFactory factory)
{
    readonly ApiFactory _factory = factory;

    [Fact]
    public async Task Checkout_places_the_order_and_empties_the_cart()
    {
        var (userId, client) = await SignedInUserWithCart(new Line(10.00m, 2), new Line(4.50m, 1));

        var response = await client.PostAsJsonAsync($"/api/checkout/{userId}", new { });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var orderId = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("orderId").GetString()!;
        Assert.Equal(20, orderId.Length);   // fits the OrderId varchar(20) column

        await using var db = _factory.CreateDbContext();
        var order = await db.CustomerOrders.AsNoTracking().SingleAsync(o => o.OrderId == orderId);
        Assert.Equal(userId, order.UserId);
        Assert.Equal(24.50m, order.CartTotal);
        Assert.Equal(2, await db.CustomerOrderDetails.CountAsync(d => d.OrderId == orderId));
        Assert.Equal(0, await CartRowCount(db, userId));
    }

    [Fact]
    public async Task Empty_cart_is_rejected_and_creates_no_order()
    {
        var (userId, username, password) = await _factory.NewUserAsync();
        var client = await _factory.LoggedIn(username, password);

        var response = await client.PostAsJsonAsync($"/api/checkout/{userId}", new { });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        await using var db = _factory.CreateDbContext();
        Assert.Equal(0, await db.CustomerOrders.CountAsync(o => o.UserId == userId));
    }

    [Fact]
    public async Task Unbuyable_rows_are_ignored_and_duplicate_rows_are_combined()
    {
        var bookId = await AddBook(8.00m);
        var (userId, username, password) = await _factory.NewUserAsync();
        await SeedCart(userId, (bookId, 1), (bookId, 2), (_factory.BookId, 0), (999_999, 1));   // duplicate, zero quantity, missing book
        var client = await _factory.LoggedIn(username, password);

        var response = await client.PostAsJsonAsync($"/api/checkout/{userId}", new { });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var db = _factory.CreateDbContext();
        var order = await db.CustomerOrders.AsNoTracking().SingleAsync(o => o.UserId == userId);
        var line = await db.CustomerOrderDetails.AsNoTracking().SingleAsync(d => d.OrderId == order.OrderId);
        Assert.Equal(bookId, line.ProductId);
        Assert.Equal(3, line.Quantity);
        Assert.Equal(24.00m, order.CartTotal);
        Assert.Equal(0, await CartRowCount(db, userId));
    }

    [Fact]
    public async Task A_failure_while_saving_rolls_back_so_the_cart_is_not_lost()
    {
        var (userId, _) = await SignedInUserWithCart(new Line(10.00m, 1));

        var options = new DbContextOptionsBuilder<BookDBContext>().UseSqlServer(TestDb.ConnectionString).Options;
        await using (var failing = new FailingSaveDbContext(options))
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() => new OrderDataAccessLayer(failing, NullLogger<OrderDataAccessLayer>.Instance).CreateOrderAsync(userId));
        }

        // The cart rows were deleted inside the transaction before the failure; the rollback must have restored them.
        await using var db = _factory.CreateDbContext();
        Assert.Equal(1, await CartRowCount(db, userId));
        Assert.Equal(0, await db.CustomerOrders.CountAsync(o => o.UserId == userId));
    }

    [Fact]
    public async Task Double_submit_creates_exactly_one_order()
    {
        var (userId, username, password) = await _factory.NewUserAsync();
        await SeedCart(userId, (_factory.BookId, 1));
        var first = await _factory.LoggedIn(username, password);
        var second = await _factory.LoggedIn(username, password);

        var responses = await Task.WhenAll(
            first.PostAsJsonAsync($"/api/checkout/{userId}", new { }),
            second.PostAsJsonAsync($"/api/checkout/{userId}", new { }));

        Assert.Equal(new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }, responses.Select(r => r.StatusCode).Order().ToArray());
        await using var db = _factory.CreateDbContext();
        Assert.Equal(1, await db.CustomerOrders.CountAsync(o => o.UserId == userId));
    }

    [Fact]
    public async Task Nobody_can_check_out_someone_elses_cart_not_even_an_admin()
    {
        var (userId, _) = await SignedInUserWithCart(new Line(10.00m, 1));
        var admin = await _factory.LoggedIn("adminuser", ApiFactory.AdminPassword);

        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsJsonAsync($"/api/checkout/{userId}", new { })).StatusCode);

        await using var db = _factory.CreateDbContext();
        Assert.Equal(1, await CartRowCount(db, userId));
        Assert.Equal(0, await db.CustomerOrders.CountAsync(o => o.UserId == userId));
    }

    // ---- helpers ------------------------------------------------------------------------------------------------

    record Line(decimal Price, int Quantity);

    /// <summary>A new signed-in user whose server-side cart holds one new book per line, at the given price and quantity.</summary>
    async Task<(int UserId, HttpClient Client)> SignedInUserWithCart(params Line[] lines)
    {
        var (userId, username, password) = await _factory.NewUserAsync();
        var items = new List<(int BookId, int Quantity)>();
        foreach (var line in lines) items.Add((await AddBook(line.Price), line.Quantity));
        await SeedCart(userId, items.ToArray());
        return (userId, await _factory.LoggedIn(username, password));
    }

    async Task<int> AddBook(decimal price)
    {
        await using var db = _factory.CreateDbContext();
        var book = new Book { Title = "Priced " + price, Author = "A", Category = "Fiction", Price = price, CoverFileName = "Default_image.jpg" };
        db.Book.Add(book);
        await db.SaveChangesAsync();
        return book.BookId;
    }

    async Task SeedCart(int userId, params (int BookId, int Quantity)[] rows)
    {
        await using var db = _factory.CreateDbContext();
        var cartId = Guid.NewGuid().ToString();
        db.Cart.Add(new Cart { CartId = cartId, UserId = userId, DateCreated = DateTime.UtcNow });
        db.CartItems.AddRange(rows.Select(r => new CartItems { CartId = cartId, ProductId = r.BookId, Quantity = r.Quantity }));
        await db.SaveChangesAsync();
    }

    static Task<int> CartRowCount(BookDBContext db, int userId) =>
        (from c in db.Cart where c.UserId == userId join i in db.CartItems on c.CartId equals i.CartId select i).CountAsync();

    /// <summary>Behaves normally until it has to save, then fails: simulates the database dying mid-checkout.</summary>
    sealed class FailingSaveDbContext(DbContextOptions<BookDBContext> options) : BookDBContext(options)
    {
        public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("simulated failure while saving the order");
    }
}
