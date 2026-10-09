using BookCart.Models;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace BookCart.Tests;

/// <summary>
/// B4: upgrading databases that already exist. These use databases of their own (never the API test database), and
/// check what a real upgrade must do: keep data, repair what the old code could have broken, stop when a person has to
/// decide, and end at exactly the schema a brand-new database gets.
/// </summary>
public class MigrationUpgradeTests : IAsyncLifetime
{
    readonly string _connection = TestDb.Scratch("Upgrade");

    public async Task InitializeAsync() => await TestDb.DropAsync(_connection);

    public async Task DisposeAsync() => await TestDb.DropAsync(_connection);

    static string MigrationNamed(BookDBContext db, string name) =>
        db.Database.GetMigrations().Single(m => m.EndsWith("_" + name, StringComparison.Ordinal));

    /// <summary>A database as it was before B4 (migrated only as far as the baseline), holding data the old code could create.</summary>
    async Task<BookDBContext> BaselineDatabaseWithOldDataAsync(string extraSql = "")
    {
        var db = TestDb.Context(_connection);
        await db.GetService<IMigrator>().MigrateAsync(MigrationNamed(db, "Baseline"));
        await db.Database.ExecuteSqlRawAsync(OldData);
        if (extraSql.Length > 0) await db.Database.ExecuteSqlRawAsync(extraSql);
        return db;
    }

    // User 10 has two carts and two wishlists (two requests raced on first load), the same book twice in a cart,
    // lines for carts/books that do not exist, a line with quantity 0, and an order with a line for a book that was
    // deleted since. Book ids are 1..3; 999 does not exist.
    const string OldData = """
        INSERT INTO UserMaster (FirstName, LastName, Username, Password, PasswordHash, Gender, UserTypeID) VALUES
         ('Ann', 'One', 'ann', NULL, 'hash-a', 'Female', 2), ('Bob', 'Two', 'bob', NULL, 'hash-b', 'Male', 2);
        INSERT INTO Book (Title, Author, Category, Price, CoverFileName) VALUES
         ('Book One', 'Author A', 'Fiction', 10.00, 'Default_image.jpg'),
         ('Book Two', 'Author B', 'Mystery', 20.50, 'Default_image.jpg'),
         ('Book Three', 'Author C', 'Fiction', 30.00, 'Default_image.jpg');
        INSERT INTO Cart (CartId, UserID, DateCreated) VALUES
         ('cart-old', 10, '2025-01-01T10:00:00'), ('cart-new', 10, '2025-02-01T10:00:00'),
         ('cart-bob', 20, '2025-01-05T09:00:00'), ('cart-guest', 1000000001, '2025-01-06T09:00:00');
        INSERT INTO CartItems (CartId, ProductId, Quantity) VALUES
         ('cart-old', 1, 2), ('cart-old', 2, 1), ('cart-old', 2, 1), ('cart-old', 999, 4),
         ('cart-new', 1, 3), ('cart-new', 2, 1), ('ghost-cart', 1, 1),
         ('cart-bob', 3, 1), ('cart-bob', 1, 0), ('cart-guest', 3, 2);
        INSERT INTO Wishlist (WishlistId, UserID, DateCreated) VALUES
         ('wish-old', 10, '2025-01-01T10:00:00'), ('wish-new', 10, '2025-02-01T10:00:00');
        INSERT INTO WishlistItems (WishlistId, ProductId) VALUES
         ('wish-old', 1), ('wish-old', 1), ('wish-new', 2), ('wish-new', 1), ('ghost-wish', 1), ('wish-old', 999);
        INSERT INTO CustomerOrders (OrderId, UserID, DateCreated, CartTotal) VALUES ('ORDER-0000000000001', 10, '2025-03-01T10:15:30', 17.00);
        INSERT INTO CustomerOrderDetails (OrderId, ProductId, Quantity, Price) VALUES
         ('ORDER-0000000000001', 1, 1, 10.00), ('ORDER-0000000000001', 999, 1, 7.00);
        """;

    [Fact]
    public async Task Duplicates_are_merged_and_invalid_rows_removed_when_the_database_is_upgraded()
    {
        await using var db = await BaselineDatabaseWithOldDataAsync();

        await db.Database.MigrateAsync();

        // One cart for user 10 (the oldest), holding the books of both: 2+3 copies of book 1, and book 2 three times over.
        Assert.Equal(["cart-old"], await db.Cart.Where(c => c.UserId == 10).Select(c => c.CartId).ToListAsync());
        var lines = await db.CartItems.Where(i => i.CartId == "cart-old").OrderBy(i => i.ProductId).Select(i => new { i.ProductId, i.Quantity }).ToListAsync();
        Assert.Equal([(1, 5), (2, 3)], lines.Select(l => (l.ProductId, l.Quantity)));

        // Rows nobody could have used are gone (unknown cart, unknown book, quantity 0); everyone else's cart is untouched.
        Assert.False(await db.CartItems.AnyAsync(i => i.CartId == "ghost-cart" || i.ProductId == 999 || i.Quantity <= 0));
        Assert.Equal([(3, 1)], (await db.CartItems.Where(i => i.CartId == "cart-bob").Select(i => new { i.ProductId, i.Quantity }).ToListAsync()).Select(l => (l.ProductId, l.Quantity)));
        Assert.Equal([(3, 2)], (await db.CartItems.Where(i => i.CartId == "cart-guest").Select(i => new { i.ProductId, i.Quantity }).ToListAsync()).Select(l => (l.ProductId, l.Quantity)));

        // One wishlist, each book once.
        Assert.Equal(["wish-old"], await db.Wishlist.Where(w => w.UserId == 10).Select(w => w.WishlistId).ToListAsync());
        Assert.Equal([1, 2], await db.WishlistItems.OrderBy(i => i.ProductId).Select(i => i.ProductId).ToListAsync());
    }

    [Fact]
    public async Task Order_history_survives_the_upgrade_unchanged_even_for_a_book_that_no_longer_exists()
    {
        await using var db = await BaselineDatabaseWithOldDataAsync();

        await db.Database.MigrateAsync();

        var order = await db.CustomerOrders.SingleAsync();
        Assert.Equal(new DateTime(2025, 3, 1, 10, 15, 30), order.DateCreated);        // datetime -> datetime2 keeps the value
        Assert.Equal(17.00m, order.CartTotal);
        var lines = await db.CustomerOrderDetails.OrderBy(d => d.ProductId).ToListAsync();
        Assert.Equal([(1, 1, 10.00m), (999, 1, 7.00m)], lines.Select(d => (d.ProductId, d.Quantity, d.Price)));
    }

    [Fact]
    public async Task Books_and_users_are_untouched_and_unicode_titles_can_now_be_stored()
    {
        await using var db = await BaselineDatabaseWithOldDataAsync();

        await db.Database.MigrateAsync();

        Assert.Equal(["Book One", "Book Three", "Book Two"], await db.Book.OrderBy(b => b.Title).Select(b => b.Title).ToListAsync());
        Assert.Equal(["ann", "bob"], await db.UserMaster.OrderBy(u => u.Username).Select(u => u.Username).ToListAsync());

        // varchar could only hold ASCII; Title and Author are nvarchar now.
        db.Book.Add(new Book { Title = "Les Misérables — 日本語", Author = "Ça va", Category = "Fiction", Price = 1m });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        Assert.Contains("Les Misérables — 日本語", await db.Book.Select(b => b.Title).ToListAsync());
    }

    [Theory]
    [InlineData("UPDATE Book SET Price = -5 WHERE BookID = 1;", "negative prices")]
    [InlineData("UPDATE CustomerOrderDetails SET Quantity = 0 WHERE ProductId = 1;", "Order history")]
    [InlineData("UPDATE CustomerOrderDetails SET Price = -1 WHERE ProductId = 1;", "Order history")]
    [InlineData("INSERT INTO CustomerOrderDetails (OrderId, ProductId, Quantity, Price) VALUES ('NO-SUCH-ORDER', 1, 1, 1.00);", "order does not exist")]
    [InlineData("INSERT INTO UserMaster (FirstName, LastName, Username, Gender, UserTypeID) VALUES ('X', 'Y', 'xy', 'Male', 77);", "UserTypeID that does not exist")]
    public async Task Data_that_needs_a_persons_decision_stops_the_upgrade_and_changes_nothing(string problem, string expectedInMessage)
    {
        await using var db = await BaselineDatabaseWithOldDataAsync(problem);

        var failure = await Assert.ThrowsAnyAsync<Exception>(() => db.Database.MigrateAsync());

        Assert.Contains(expectedInMessage, failure.ToString());
        // The migration is one transaction: everything it had already done (merging carts...) is undone too.
        Assert.Equal(2, await db.Cart.CountAsync(c => c.UserId == 10));
        Assert.Equal(10, await db.CartItems.CountAsync());
        Assert.Equal(["Baseline"], (await db.Database.GetAppliedMigrationsAsync()).Select(m => m[(m.IndexOf('_') + 1)..]));
        Assert.False(await ObjectExistsAsync("UX_Cart_UserID"), "no part of the hardening may be left behind");
    }

    [Fact]
    public async Task Running_the_migrations_again_is_a_no_op()
    {
        await using var db = await BaselineDatabaseWithOldDataAsync();
        await db.Database.MigrateAsync();
        var before = await db.Database.GetAppliedMigrationsAsync();

        await db.Database.MigrateAsync();

        Assert.Equal(before, await db.Database.GetAppliedMigrationsAsync());
        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
    }

    async Task<bool> ObjectExistsAsync(string indexName)
    {
        await using var connection = new SqlConnection(_connection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sys.indexes WHERE name = @name";
        command.Parameters.AddWithValue("@name", indexName);
        return (int)(await command.ExecuteScalarAsync())! > 0;
    }
}
