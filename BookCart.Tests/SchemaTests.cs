using BookCart.Models;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace BookCart.Tests;

/// <summary>
/// B4: what the database itself guarantees. Each test breaks one rule on purpose and checks that SQL Server (not the
/// application) refuses, naming the constraint that did.
/// </summary>
public class SchemaTests : IAsyncLifetime
{
    readonly string _connection = TestDb.Scratch("Schema");

    public async Task InitializeAsync()
    {
        await TestDb.DropAsync(_connection);
        await using var db = TestDb.Context(_connection);
        await db.Database.MigrateAsync();
    }

    public async Task DisposeAsync() => await TestDb.DropAsync(_connection);

    BookDBContext Db() => TestDb.Context(_connection);

    static string Unique() => Guid.NewGuid().ToString("N")[..12];

    async Task<int> NewBookAsync(decimal price = 5m)
    {
        await using var db = Db();
        var book = new Book { Title = "Schema " + Unique(), Author = "A", Category = "Fiction", Price = price };
        db.Book.Add(book);
        await db.SaveChangesAsync();
        return book.BookId;
    }

    async Task<string> NewCartAsync(int ownerId)
    {
        await using var db = Db();
        var cart = new Cart { CartId = Guid.NewGuid().ToString(), UserId = ownerId, DateCreated = DateTime.UtcNow };
        db.Cart.Add(cart);
        await db.SaveChangesAsync();
        return cart.CartId;
    }

    static int NewOwnerId() => Random.Shared.Next(1_000_000, 900_000_000);

    /// <summary>Runs the change and asserts SQL Server refused it, naming <paramref name="constraint"/>.</summary>
    static async Task AssertRefusedAsync(string constraint, Func<BookDBContext, Task> change, Func<BookDBContext> newDb)
    {
        await using var db = newDb();
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => change(db));
        var sql = Assert.IsType<SqlException>(failure.InnerException);
        Assert.Contains(constraint, sql.Message);
    }

    // ---- the migrations themselves --------------------------------------------------------------------------------

    [Fact]
    public async Task The_migrations_describe_exactly_the_current_model()
    {
        await using var db = Db();

        // If this fails, the model was changed without adding a migration: run `dotnet ef migrations add <Name>`.
        Assert.False(db.Database.HasPendingModelChanges(), "the model differs from the migrations");
        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
    }

    [Fact]
    public async Task A_new_database_has_the_reference_data()
    {
        await using var db = Db();

        Assert.Equal([(1, "Admin"), (2, "User")], (await db.UserType.OrderBy(t => t.UserTypeId).ToListAsync()).Select(t => (t.UserTypeId, t.UserTypeName)));
        Assert.Equal(["Biography", "Fiction", "Mystery", "Fantasy", "Romance"], (await db.Categories.OrderBy(c => c.CategoryId).ToListAsync()).Select(c => c.CategoryName));
        Assert.Equal(UserTypeIds.Admin, 1);
        Assert.Equal(UserTypeIds.User, 2);
    }

    // ---- carts ---------------------------------------------------------------------------------------------------

    [Fact]
    public async Task A_cart_line_needs_a_real_cart_and_a_real_book()
    {
        var bookId = await NewBookAsync();
        var cartId = await NewCartAsync(NewOwnerId());

        await AssertRefusedAsync("FK_CartItems_Cart_CartId", async db =>
        {
            db.CartItems.Add(new CartItems { CartId = "no-such-cart", ProductId = bookId, Quantity = 1 });
            await db.SaveChangesAsync();
        }, Db);

        await AssertRefusedAsync("FK_CartItems_Book_ProductId", async db =>
        {
            db.CartItems.Add(new CartItems { CartId = cartId, ProductId = 987_654, Quantity = 1 });
            await db.SaveChangesAsync();
        }, Db);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-3)]
    public async Task A_cart_line_needs_a_positive_quantity(int quantity)
    {
        var bookId = await NewBookAsync();
        var cartId = await NewCartAsync(NewOwnerId());

        await AssertRefusedAsync("CK_CartItems_Quantity", async db =>
        {
            db.CartItems.Add(new CartItems { CartId = cartId, ProductId = bookId, Quantity = quantity });
            await db.SaveChangesAsync();
        }, Db);
    }

    [Fact]
    public async Task A_book_appears_once_per_cart_and_an_owner_has_one_cart()
    {
        var bookId = await NewBookAsync();
        var owner = NewOwnerId();
        var cartId = await NewCartAsync(owner);
        await using (var db = Db())
        {
            db.CartItems.Add(new CartItems { CartId = cartId, ProductId = bookId, Quantity = 1 });
            await db.SaveChangesAsync();
        }

        await AssertRefusedAsync("UX_CartItems_CartId_ProductId", async db =>
        {
            db.CartItems.Add(new CartItems { CartId = cartId, ProductId = bookId, Quantity = 1 });
            await db.SaveChangesAsync();
        }, Db);

        await AssertRefusedAsync("UX_Cart_UserID", async db =>
        {
            db.Cart.Add(new Cart { CartId = Guid.NewGuid().ToString(), UserId = owner, DateCreated = DateTime.UtcNow });
            await db.SaveChangesAsync();
        }, Db);
    }

    [Fact]
    public async Task Deleting_a_cart_deletes_its_lines()
    {
        var bookId = await NewBookAsync();
        var cartId = await NewCartAsync(NewOwnerId());
        await using var db = Db();
        db.CartItems.Add(new CartItems { CartId = cartId, ProductId = bookId, Quantity = 2 });
        await db.SaveChangesAsync();

        await db.Cart.Where(c => c.CartId == cartId).ExecuteDeleteAsync();

        Assert.False(await db.CartItems.AnyAsync(i => i.CartId == cartId));
    }

    // ---- wishlists -----------------------------------------------------------------------------------------------

    [Fact]
    public async Task A_wishlist_line_needs_a_real_wishlist_and_book_and_appears_once()
    {
        var bookId = await NewBookAsync();
        var userId = NewOwnerId();
        string wishlistId;
        await using (var db = Db())
        {
            var wishlist = new Wishlist { WishlistId = Guid.NewGuid().ToString(), UserId = userId, DateCreated = DateTime.UtcNow };
            db.Wishlist.Add(wishlist);
            db.WishlistItems.Add(new WishlistItems { WishlistId = wishlist.WishlistId, ProductId = bookId });
            await db.SaveChangesAsync();
            wishlistId = wishlist.WishlistId;
        }

        await AssertRefusedAsync("FK_WishlistItems_Wishlist_WishlistId", async db =>
        {
            db.WishlistItems.Add(new WishlistItems { WishlistId = "no-such-wishlist", ProductId = bookId });
            await db.SaveChangesAsync();
        }, Db);
        await AssertRefusedAsync("FK_WishlistItems_Book_ProductId", async db =>
        {
            db.WishlistItems.Add(new WishlistItems { WishlistId = wishlistId, ProductId = 987_654 });
            await db.SaveChangesAsync();
        }, Db);
        await AssertRefusedAsync("UX_WishlistItems_WishlistId_ProductId", async db =>
        {
            db.WishlistItems.Add(new WishlistItems { WishlistId = wishlistId, ProductId = bookId });
            await db.SaveChangesAsync();
        }, Db);
        await AssertRefusedAsync("UX_Wishlist_UserID", async db =>
        {
            db.Wishlist.Add(new Wishlist { WishlistId = Guid.NewGuid().ToString(), UserId = userId, DateCreated = DateTime.UtcNow });
            await db.SaveChangesAsync();
        }, Db);
    }

    // ---- books and order history ---------------------------------------------------------------------------------

    [Fact]
    public async Task A_book_cannot_have_a_negative_price()
    {
        await AssertRefusedAsync("CK_Book_Price", async db =>
        {
            db.Book.Add(new Book { Title = "Cheap " + Unique(), Author = "A", Category = "Fiction", Price = -0.01m });
            await db.SaveChangesAsync();
        }, Db);
    }

    [Fact]
    public async Task Deleting_a_book_empties_it_from_carts_and_wishlists_but_not_from_order_history()
    {
        var bookId = await NewBookAsync();
        var cartId = await NewCartAsync(NewOwnerId());
        var orderId = "S-" + Unique();
        await using var db = Db();
        var wishlist = new Wishlist { WishlistId = Guid.NewGuid().ToString(), UserId = NewOwnerId(), DateCreated = DateTime.UtcNow };
        db.Wishlist.Add(wishlist);
        db.WishlistItems.Add(new WishlistItems { WishlistId = wishlist.WishlistId, ProductId = bookId });
        db.CartItems.Add(new CartItems { CartId = cartId, ProductId = bookId, Quantity = 1 });
        db.CustomerOrders.Add(new CustomerOrders { OrderId = orderId, UserId = 1, DateCreated = DateTime.UtcNow, CartTotal = 5m });
        db.CustomerOrderDetails.Add(new CustomerOrderDetails { OrderId = orderId, ProductId = bookId, Quantity = 1, Price = 5m });
        await db.SaveChangesAsync();

        await db.Book.Where(b => b.BookId == bookId).ExecuteDeleteAsync();

        Assert.False(await db.CartItems.AnyAsync(i => i.ProductId == bookId));
        Assert.False(await db.WishlistItems.AnyAsync(i => i.ProductId == bookId));
        Assert.True(await db.CustomerOrderDetails.AnyAsync(d => d.OrderId == orderId && d.ProductId == bookId),
            "an order is a record of what was bought: it must outlive the book");
    }

    [Fact]
    public async Task Order_lines_need_a_real_order_a_positive_quantity_and_no_negative_price()
    {
        var bookId = await NewBookAsync();
        var orderId = "S-" + Unique();
        await using (var db = Db())
        {
            db.CustomerOrders.Add(new CustomerOrders { OrderId = orderId, UserId = 1, DateCreated = DateTime.UtcNow, CartTotal = 5m });
            await db.SaveChangesAsync();
        }

        await AssertRefusedAsync("FK_CustomerOrderDetails_CustomerOrders_OrderId", async db =>
        {
            db.CustomerOrderDetails.Add(new CustomerOrderDetails { OrderId = "NO-SUCH-ORDER", ProductId = bookId, Quantity = 1, Price = 5m });
            await db.SaveChangesAsync();
        }, Db);
        await AssertRefusedAsync("CK_CustomerOrderDetails_Quantity", async db =>
        {
            db.CustomerOrderDetails.Add(new CustomerOrderDetails { OrderId = orderId, ProductId = bookId, Quantity = 0, Price = 5m });
            await db.SaveChangesAsync();
        }, Db);
        await AssertRefusedAsync("CK_CustomerOrderDetails_Price", async db =>
        {
            db.CustomerOrderDetails.Add(new CustomerOrderDetails { OrderId = orderId, ProductId = bookId, Quantity = 1, Price = -1m });
            await db.SaveChangesAsync();
        }, Db);
    }

    // ---- users ---------------------------------------------------------------------------------------------------

    [Fact]
    public async Task A_user_needs_a_real_user_type_and_a_unique_username_whatever_its_case()
    {
        var name = "u" + Unique();
        await using (var db = Db())
        {
            db.UserMaster.Add(new UserMaster { FirstName = "A", LastName = "B", Username = name, Gender = "Male", UserTypeId = UserTypeIds.User });
            await db.SaveChangesAsync();
        }

        await AssertRefusedAsync("FK_UserMaster_UserType_UserTypeID", async db =>
        {
            db.UserMaster.Add(new UserMaster { FirstName = "A", LastName = "B", Username = "u" + Unique(), Gender = "Male", UserTypeId = 77 });
            await db.SaveChangesAsync();
        }, Db);
        await AssertRefusedAsync("UX_UserMaster_Username", async db =>
        {
            db.UserMaster.Add(new UserMaster { FirstName = "A", LastName = "B", Username = name.ToUpperInvariant(), Gender = "Male", UserTypeId = UserTypeIds.User });
            await db.SaveChangesAsync();
        }, Db);
    }

    // ---- column types --------------------------------------------------------------------------------------------

    [Fact]
    public async Task Titles_can_hold_any_script_and_dates_keep_their_full_precision()
    {
        var title = "Les Misérables — 日本語 " + Unique();
        var created = new DateTime(2026, 10, 9, 12, 34, 56, 789).AddTicks(1234);   // sub-millisecond: datetime would round it
        string cartId;
        await using (var db = Db())
        {
            db.Book.Add(new Book { Title = title, Author = "Ça va 日本", Category = "Fiction", Price = 1m });
            var cart = new Cart { CartId = Guid.NewGuid().ToString(), UserId = NewOwnerId(), DateCreated = created };
            db.Cart.Add(cart);
            await db.SaveChangesAsync();
            cartId = cart.CartId;
        }

        await using var read = Db();
        Assert.True(await read.Book.AnyAsync(b => b.Title == title && b.Author == "Ça va 日本"));
        Assert.Equal(created, (await read.Cart.SingleAsync(c => c.CartId == cartId)).DateCreated);
    }
}
