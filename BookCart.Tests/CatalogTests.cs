using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BookCart.Models;
using Microsoft.EntityFrameworkCore;

namespace BookCart.Tests;

/// <summary>B4: the catalog is queried in the database (paging, filtering, similar books) and deleting books keeps carts and orders consistent.</summary>
[Collection(ApiCollection.Name)]
public class CatalogTests(ApiFactory factory)
{
    readonly ApiFactory _factory = factory;

    /// <summary>Creates books in a category of their own, so a test sees only its own books.</summary>
    async Task<string> SeedAsync(params (string Title, string Author, decimal Price)[] books)
    {
        var category = "C" + Guid.NewGuid().ToString("N")[..12];
        await using var db = _factory.CreateDbContext();
        db.Book.AddRange(books.Select(b => new Book { Title = b.Title, Author = b.Author, Category = category, Price = b.Price, CoverFileName = "Default_image.jpg" }));
        await db.SaveChangesAsync();
        return category;
    }

    async Task<JsonElement> SearchAsync(string query)
    {
        var response = await _factory.Anonymous().GetAsync("/api/book/search?" + query);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    static string[] Titles(JsonElement page) => page.GetProperty("items").EnumerateArray().Select(b => b.GetProperty("title").GetString()!).ToArray();

    // ---- paging ----------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Books_come_in_pages_ordered_by_title_with_the_total_count()
    {
        var category = await SeedAsync(Enumerable.Range(1, 25).Select(i => ($"Book {i:00}", "Author", 5m)).ToArray());

        var first = await SearchAsync($"category={category}&page=1&pageSize=10");
        var second = await SearchAsync($"category={category}&page=2&pageSize=10");
        var last = await SearchAsync($"category={category}&page=3&pageSize=10");
        var beyond = await SearchAsync($"category={category}&page=4&pageSize=10");

        Assert.Equal(Enumerable.Range(1, 10).Select(i => $"Book {i:00}"), Titles(first));
        Assert.Equal(Enumerable.Range(11, 10).Select(i => $"Book {i:00}"), Titles(second));
        Assert.Equal(Enumerable.Range(21, 5).Select(i => $"Book {i:00}"), Titles(last));     // a partial last page
        Assert.Empty(Titles(beyond));
        foreach (var page in new[] { first, second, last, beyond })
        {
            Assert.Equal(25, page.GetProperty("total").GetInt32());                          // the total does not depend on the page
            Assert.Equal(10, page.GetProperty("pageSize").GetInt32());
        }
        Assert.Equal(3, last.GetProperty("page").GetInt32());
    }

    [Fact]
    public async Task Without_paging_parameters_the_first_24_books_are_returned()
    {
        var category = await SeedAsync(Enumerable.Range(1, 30).Select(i => ($"Book {i:00}", "Author", 5m)).ToArray());

        var page = await SearchAsync($"category={category}");

        Assert.Equal(24, Titles(page).Length);
        Assert.Equal(30, page.GetProperty("total").GetInt32());
        Assert.Equal(1, page.GetProperty("page").GetInt32());
        Assert.Equal(24, page.GetProperty("pageSize").GetInt32());
    }

    [Fact]
    public async Task Books_with_the_same_title_never_repeat_or_vanish_between_pages()
    {
        var category = await SeedAsync(("Same", "A", 1m), ("Same", "B", 1m), ("Same", "C", 1m), ("Same", "D", 1m), ("Same", "E", 1m));

        var authors = new List<string>();
        foreach (var page in new[] { 1, 2, 3 })
        {
            var result = await SearchAsync($"category={category}&page={page}&pageSize=2");
            authors.AddRange(result.GetProperty("items").EnumerateArray().Select(b => b.GetProperty("author").GetString()!));
        }

        Assert.Equal(["A", "B", "C", "D", "E"], authors.Order());
        Assert.Equal(5, authors.Distinct().Count());
    }

    // ---- filters ---------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Search_matches_the_title_or_the_author_ignoring_case()
    {
        var category = await SeedAsync(("The Hobbit", "Tolkien", 5m), ("Dune", "Frank Herbert", 5m), ("Emma", "Jane Austen", 5m));

        Assert.Equal(["The Hobbit"], Titles(await SearchAsync($"category={category}&search=HOBB")));
        Assert.Equal(["Dune"], Titles(await SearchAsync($"category={category}&search=herbert")));
        Assert.Equal(["Dune", "Emma"], Titles(await SearchAsync($"category={category}&search=an")).Order());      // "Frank", "Jane": in the author, not the title
        Assert.Empty(Titles(await SearchAsync($"category={category}&search=nothing-like-this")));
    }

    [Fact]
    public async Task Search_takes_wildcard_characters_literally()
    {
        var category = await SeedAsync(("100% Pure", "A", 5m), ("1000 Pure", "A", 5m), ("snake_case", "A", 5m), ("snakexcase", "A", 5m), ("[brackets]", "A", 5m));

        Assert.Equal(["100% Pure"], Titles(await SearchAsync($"category={category}&search={Uri.EscapeDataString("100%")}")));
        Assert.Equal(["snake_case"], Titles(await SearchAsync($"category={category}&search={Uri.EscapeDataString("snake_")}")));
        Assert.Equal(["[brackets]"], Titles(await SearchAsync($"category={category}&search={Uri.EscapeDataString("[brackets]")}")));
    }

    [Fact]
    public async Task Price_limits_are_inclusive_and_combine_with_the_other_filters()
    {
        var category = await SeedAsync(("Cheap", "A", 5.00m), ("Middle", "A", 10.00m), ("Dear", "A", 15.00m), ("Dearer", "B", 20.00m));

        Assert.Equal(["Cheap", "Middle"], Titles(await SearchAsync($"category={category}&maxPrice=10")));
        Assert.Equal(["Dear", "Dearer", "Middle"], Titles(await SearchAsync($"category={category}&minPrice=10")));
        Assert.Equal(["Middle"], Titles(await SearchAsync($"category={category}&minPrice=10&maxPrice=10")));
        Assert.Equal(["Dear"], Titles(await SearchAsync($"category={category}&minPrice=10&maxPrice=19&search=dear")));
        Assert.Equal(["Cheap"], Titles(await SearchAsync($"category={category}&search=a&maxPrice=5")));
    }

    [Theory]
    [InlineData("page=0", "Page")]
    [InlineData("page=-1", "Page")]
    [InlineData("pageSize=0", "PageSize")]
    [InlineData("pageSize=101", "PageSize")]
    [InlineData("page=abc", "page")]
    [InlineData("minPrice=-1", "MinPrice")]
    [InlineData("minPrice=10&maxPrice=5", "MinPrice")]
    [InlineData("category=this-category-name-is-too-long", "Category")]
    public async Task Invalid_search_parameters_are_a_400_that_names_the_field(string query, string field)
    {
        var response = await _factory.Anonymous().GetAsync("/api/book/search?" + query);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
        Assert.Contains(errors.EnumerateObject(), e => e.Name.Equals(field, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task A_search_that_is_too_long_is_a_400()
    {
        var response = await _factory.Anonymous().GetAsync("/api/book/search?search=" + new string('x', 101));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_book_the_admin_adds_is_searchable_at_once()
    {
        var admin = await _factory.LoggedIn("adminuser", ApiFactory.AdminPassword);
        var title = "Fresh " + Guid.NewGuid().ToString("N");
        await admin.PostAsync("/api/book", new MultipartFormDataContent
        {
            { new StringContent(title), "title" }, { new StringContent("A"), "author" }, { new StringContent("Fiction"), "category" }, { new StringContent("5"), "price" }
        });

        var page = await SearchAsync($"search={title}");     // the search is not cached: nothing to wait for

        Assert.Equal([title], Titles(page));
    }

    // ---- similar books -----------------------------------------------------------------------------------------------

    [Fact]
    public async Task Similar_books_are_other_books_of_the_same_category_at_most_five()
    {
        var category = await SeedAsync(Enumerable.Range(1, 9).Select(i => ($"Similar {i}", "A", 5m)).ToArray());
        var other = await SeedAsync(("Elsewhere", "A", 5m));
        int firstId;
        await using (var db = _factory.CreateDbContext())
        {
            firstId = await db.Book.Where(b => b.Category == category).OrderBy(b => b.BookId).Select(b => b.BookId).FirstAsync();
        }

        var similar = await _factory.Anonymous().GetFromJsonAsync<JsonElement>($"/api/book/GetSimilarBooks/{firstId}");

        var books = similar.EnumerateArray().ToList();
        Assert.Equal(5, books.Count);
        Assert.All(books, b => Assert.Equal(category, b.GetProperty("category").GetString()));
        Assert.DoesNotContain(books, b => b.GetProperty("bookId").GetInt32() == firstId);        // never the book itself
        Assert.Equal(5, books.Select(b => b.GetProperty("bookId").GetInt32()).Distinct().Count());
        _ = other;
    }

    [Fact]
    public async Task Similar_books_are_really_random_not_the_same_five_every_time()
    {
        var category = await SeedAsync(Enumerable.Range(1, 12).Select(i => ($"Random {i}", "A", 5m)).ToArray());
        int firstId;
        await using (var db = _factory.CreateDbContext())
        {
            firstId = await db.Book.Where(b => b.Category == category).OrderBy(b => b.BookId).Select(b => b.BookId).FirstAsync();
        }
        var client = _factory.Anonymous();

        var seen = new HashSet<int>();
        for (var i = 0; i < 12; i++)
        {
            var similar = await client.GetFromJsonAsync<JsonElement>($"/api/book/GetSimilarBooks/{firstId}");
            foreach (var book in similar.EnumerateArray()) seen.Add(book.GetProperty("bookId").GetInt32());
        }

        // 11 candidates, 5 per answer: if the choice were fixed or a fixed window, 12 answers would show only 5 (or a few) books.
        Assert.True(seen.Count >= 9, $"expected a varied choice but only {seen.Count} different books appeared");
    }

    [Fact]
    public async Task Fewer_than_five_candidates_are_all_returned_and_none_is_an_empty_list()
    {
        var three = await SeedAsync(("A1", "A", 5m), ("A2", "A", 5m), ("A3", "A", 5m), ("A4", "A", 5m));
        var alone = await SeedAsync(("Alone", "A", 5m));
        await using var db = _factory.CreateDbContext();
        var threeId = await db.Book.Where(b => b.Category == three).Select(b => b.BookId).FirstAsync();
        var aloneId = await db.Book.Where(b => b.Category == alone).Select(b => b.BookId).FirstAsync();
        var client = _factory.Anonymous();

        Assert.Equal(3, (await client.GetFromJsonAsync<JsonElement>($"/api/book/GetSimilarBooks/{threeId}")).GetArrayLength());
        Assert.Equal(0, (await client.GetFromJsonAsync<JsonElement>($"/api/book/GetSimilarBooks/{aloneId}")).GetArrayLength());
    }

    // ---- deleting a book that is in use --------------------------------------------------------------------------------

    [Fact]
    public async Task Deleting_a_book_that_is_in_carts_wishlists_and_orders_works_and_keeps_the_orders_whole()
    {
        var category = await SeedAsync(("Doomed", "A", 12m));
        int bookId;
        await using (var db = _factory.CreateDbContext())
        {
            bookId = await db.Book.Where(b => b.Category == category).Select(b => b.BookId).FirstAsync();
        }
        var (_, name, password) = await _factory.NewUserAsync();
        var user = await _factory.LoggedIn(name, password);
        var guest = _factory.Anonymous();

        await user.PostAsync($"/api/shoppingcart/items/{bookId}", null);                  // in the user's cart...
        await user.PostAsync($"/api/wishlist/items/{bookId}", null);                      // ...on their wishlist...
        await guest.PostAsync($"/api/shoppingcart/items/{bookId}", null);                 // ...in a guest's cart...
        await user.PostAsync($"/api/shoppingcart/items/{bookId}", null);
        Assert.Equal(HttpStatusCode.OK, (await user.PostAsJsonAsync("/api/checkout", new { })).StatusCode);   // ...and in an order
        await user.PostAsync($"/api/shoppingcart/items/{bookId}", null);                  // (back in the cart after the order)

        var admin = await _factory.LoggedIn("adminuser", ApiFactory.AdminPassword);
        var deleted = await admin.DeleteAsync($"/api/book/{bookId}");

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Empty((await user.GetFromJsonAsync<JsonElement>("/api/shoppingcart")).EnumerateArray());
        Assert.Empty((await guest.GetFromJsonAsync<JsonElement>("/api/shoppingcart")).EnumerateArray());
        Assert.Empty((await user.GetFromJsonAsync<JsonElement>("/api/wishlist")).EnumerateArray());

        var orders = await user.GetFromJsonAsync<JsonElement>("/api/order");
        var order = Assert.Single(orders.EnumerateArray());
        var line = Assert.Single(order.GetProperty("orderDetails").EnumerateArray());
        Assert.Equal(24m, order.GetProperty("cartTotal").GetDecimal());                       // 2 x 12.00, as bought
        Assert.Equal(2, line.GetProperty("quantity").GetInt32());
        Assert.Equal(12m, line.GetProperty("book").GetProperty("price").GetDecimal());
        Assert.Equal("(book no longer available)", line.GetProperty("book").GetProperty("title").GetString());
    }
}
