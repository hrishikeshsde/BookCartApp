using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;

namespace BookCart.Tests;

/// <summary>
/// Regression tests for the original B0 findings. Access to somebody else's data is covered by <see cref="IdentityTests"/>
/// (there is no id left to tamper with), authentication and token handling by <see cref="HardeningTests"/>.
/// </summary>
[Collection(ApiCollection.Name)]
public class SecurityTests(ApiFactory factory)
{
    readonly ApiFactory _factory = factory;

    [Fact]
    public async Task Checkout_ignores_client_prices()
    {
        var (userId, username, password) = await _factory.NewUserAsync();   // own cart, unaffected by other tests
        var client = await _factory.LoggedIn(username, password);
        await client.PostAsync($"/api/shoppingcart/items/{_factory.BookId}", null);
        await client.PostAsync($"/api/shoppingcart/items/{_factory.BookId}", null);   // quantity 2

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
        var response = await client.PostAsJsonAsync("/api/checkout", tampered);
        Assert.True(response.IsSuccessStatusCode, $"Checkout request itself failed: {(int)response.StatusCode}");

        await using var db = _factory.CreateDbContext();
        var order = await db.CustomerOrders.AsNoTracking().SingleAsync(o => o.UserId == userId);
        var line = await db.CustomerOrderDetails.AsNoTracking().SingleAsync(d => d.OrderId == order.OrderId);

        // The server priced the order from the database and from the server-side cart (2 x 10.00).
        Assert.Equal(2 * _factory.BookPrice, order.CartTotal);
        Assert.Equal(_factory.BookPrice, line.Price);
        Assert.Equal(2, line.Quantity);
    }
}
