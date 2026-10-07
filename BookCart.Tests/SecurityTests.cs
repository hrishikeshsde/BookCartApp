using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;

namespace BookCart.Tests;

/// <summary>
/// Regression tests for the B0 security fixes. They are written first and are expected to FAIL against the
/// current code; each one goes green when the matching B0 step lands:
///   Cart_requires_auth                      -> B0.4 (authorization)
///   User_cannot_read_other_users_orders     -> B0.4 (ownership checks)
///   Checkout_ignores_client_prices          -> B0.5 (server-side pricing)
/// </summary>
[Collection(ApiCollection.Name)]
public class SecurityTests(ApiFactory factory)
{
    readonly ApiFactory _factory = factory;

    [Fact]
    public async Task Cart_requires_auth()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync($"/api/shoppingcart/{_factory.UserAId}");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task User_cannot_read_other_users_orders()
    {
        await using (var db = _factory.CreateDbContext())
        {
            var orderId = $"T-{Guid.NewGuid():N}"[..20];
            db.CustomerOrders.Add(new() { OrderId = orderId, UserId = _factory.UserBId, DateCreated = DateTime.UtcNow, CartTotal = 10m });
            db.CustomerOrderDetails.Add(new() { OrderId = orderId, ProductId = _factory.BookId, Quantity = 1, Price = 10m });
            await db.SaveChangesAsync();
        }
        var client = await LoggedInClient("usera", ApiFactory.UserAPassword);

        var response = await client.GetAsync($"/api/order/{_factory.UserBId}");

        Assert.True(response.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound,
            $"Expected 403/404 when user A reads user B's orders, got {(int)response.StatusCode}.");
    }

    [Fact]
    public async Task Checkout_ignores_client_prices()
    {
        var (userId, username, password) = await _factory.NewUserAsync();   // own cart, unaffected by other tests
        var client = await LoggedInClient(username, password);
        await client.PostAsync($"/api/shoppingcart/AddToCart/{userId}/{_factory.BookId}", null);
        await client.PostAsync($"/api/shoppingcart/AddToCart/{userId}/{_factory.BookId}", null);   // quantity 2

        // A tampered client claims the books cost one cent and the whole order is worth one cent.
        var tampered = new
        {
            cartTotal = 0.01m,
            orderDetails = new[]
            {
                new { quantity = 1, book = new { bookId = _factory.BookId, title = "Test Book", author = "Test Author",
                                                 category = "Fiction", price = 0.01m, coverFileName = "Default_image.jpg" } }
            }
        };
        var response = await client.PostAsJsonAsync($"/api/checkout/{userId}", tampered);
        Assert.True(response.IsSuccessStatusCode, $"Checkout request itself failed: {(int)response.StatusCode}");

        await using var db = _factory.CreateDbContext();
        var order = await db.CustomerOrders.AsNoTracking().SingleAsync(o => o.UserId == userId);
        var line = await db.CustomerOrderDetails.AsNoTracking().SingleAsync(d => d.OrderId == order.OrderId);

        // The server priced the order from the database and from the server-side cart (2 x 10.00).
        Assert.Equal(2 * _factory.BookPrice, order.CartTotal);
        Assert.Equal(_factory.BookPrice, line.Price);
        Assert.Equal(2, line.Quantity);
    }

    async Task<HttpClient> LoggedInClient(string username, string password)
    {
        var client = _factory.CreateClient();
        var login = await client.PostAsJsonAsync("/api/login", new { username, password });
        login.EnsureSuccessStatusCode();
        var body = await login.Content.ReadFromJsonAsync<LoginResponse>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", body!.Token);
        return client;
    }

    record LoginResponse(string Token);
}
