using System.Net;
using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using BookCart.Models;
using Microsoft.EntityFrameworkCore;

namespace BookCart.Tests;

/// <summary>B0.6: cover uploads are validated, named by the server, cleaned up, and cannot reach outside the upload folder.</summary>
[Collection(ApiCollection.Name)]
public partial class UploadTests(ApiFactory factory)
{
    readonly ApiFactory _factory = factory;

    static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5, 6, 7, 8];
    static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    static readonly byte[] Webp = [.. "RIFF"u8, 0, 0, 0, 0, .. "WEBP"u8, 1, 2, 3, 4];

    [GeneratedRegex("^[0-9a-f]{32}\\.(png|jpg|webp)$")]
    private static partial Regex GeneratedName();

    // ---- adding ------------------------------------------------------------------------------------------------

    [Theory]
    [InlineData("cover.png", "png")]
    [InlineData("COVER.PNG", "png")]
    [InlineData("photo.jpg", "jpg")]
    [InlineData("photo.jpeg", "jpg")]
    [InlineData("image.webp", "webp")]
    public async Task Valid_cover_is_stored_under_a_server_generated_name(string clientName, string kind)
    {
        var admin = await AdminClient();
        var bytes = kind switch { "png" => Png, "jpg" => Jpeg, _ => Webp };
        var title = $"Valid {clientName} {Guid.NewGuid():N}";   // SQL Server compares titles case-insensitively

        var response = await admin.PostAsync("/api/book", BookForm(title, file: (clientName, bytes)));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var book = await FindBook(title);
        Assert.Matches(@"^[0-9a-f]{32}\.(png|jpeg|jpg|webp)$", book.CoverFileName);
        Assert.DoesNotContain("cover", book.CoverFileName, StringComparison.OrdinalIgnoreCase);   // the client's name is not used
        Assert.Equal(bytes, await File.ReadAllBytesAsync(Path.Combine(_factory.UploadFolder, book.CoverFileName!)));
    }

    [Theory]
    [InlineData(@"..\..\..\escape.png")]
    [InlineData("../../escape.png")]
    [InlineData("a/b/c.png")]
    public async Task A_path_in_the_client_file_name_cannot_move_the_file(string clientName)
    {
        var admin = await AdminClient();
        var title = "Path " + Guid.NewGuid().ToString("N");

        var response = await admin.PostAsync("/api/book", BookForm(title, file: (clientName, Png)));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var book = await FindBook(title);
        Assert.Matches(GeneratedName(), book.CoverFileName);
        Assert.True(File.Exists(Path.Combine(_factory.UploadFolder, book.CoverFileName!)));
        // Wherever "escape.png" could have ended up (the web root, or any folder the name climbs to), it is not there.
        Assert.Empty(Directory.GetFiles(_factory.Sandbox, "escape.png", SearchOption.AllDirectories));
        Assert.Empty(Directory.GetFiles(_factory.Sandbox, "c.png", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Book_without_a_file_gets_the_default_cover_and_no_file_is_written()
    {
        var admin = await AdminClient();
        var before = Directory.GetFiles(_factory.UploadFolder).Length;

        var response = await admin.PostAsync("/api/book", BookForm("No cover"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("Default_image.jpg", (await FindBook("No cover")).CoverFileName);
        Assert.Equal(before, Directory.GetFiles(_factory.UploadFolder).Length);
    }

    [Theory]
    [InlineData("page.html", "<html><script>alert(1)</script></html>")]
    [InlineData("vector.svg", "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>")]
    [InlineData("tool.exe", "MZ-not-an-image")]
    [InlineData("noextension", "whatever")]
    [InlineData("double.png.html", "<html></html>")]
    public async Task Disallowed_file_types_are_rejected_and_nothing_is_created(string clientName, string content)
    {
        var admin = await AdminClient();
        var title = "Rejected " + clientName;

        var response = await admin.PostAsync("/api/book", BookForm(title, file: (clientName, System.Text.Encoding.UTF8.GetBytes(content))));

        await AssertRejected(response, title);
    }

    [Theory]
    [InlineData("fake.png", "html")]      // HTML renamed to .png
    [InlineData("fake.jpg", "png")]       // a real PNG with a .jpg name
    [InlineData("fake.webp", "jpeg")]
    [InlineData("empty.png", "empty")]
    [InlineData("tiny.png", "short")]
    public async Task Content_must_match_the_extension(string clientName, string content)
    {
        var admin = await AdminClient();
        var title = "Mismatch " + clientName;
        var bytes = content switch
        {
            "html" => System.Text.Encoding.UTF8.GetBytes("<html><script>alert(1)</script></html>"),
            "png" => Png,
            "jpeg" => Jpeg,
            "short" => new byte[] { 0x89, 0x50 },
            _ => []
        };

        var response = await admin.PostAsync("/api/book", BookForm(title, file: (clientName, bytes)));

        await AssertRejected(response, title);
    }

    [Fact]
    public async Task Cover_larger_than_the_limit_is_rejected()
    {
        var admin = await AdminClient();
        var tooBig = new byte[(2 * 1024 * 1024) + 1];
        Png.CopyTo(tooBig, 0);

        var response = await admin.PostAsync("/api/book", BookForm("Too big", file: ("big.png", tooBig)));

        Assert.True(response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.RequestEntityTooLarge, $"got {(int)response.StatusCode}");
        await AssertNoBook("Too big");
    }

    [Fact]
    public async Task Cover_at_the_limit_is_accepted()
    {
        var admin = await AdminClient();
        var atLimit = new byte[2 * 1024 * 1024];
        Png.CopyTo(atLimit, 0);

        var response = await admin.PostAsync("/api/book", BookForm("At limit", file: ("limit.png", atLimit)));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Invalid_forms_are_400_and_name_the_invalid_fields()
    {
        var admin = await AdminClient();

        // Nothing but an unrelated field: every required field is reported.
        var empty = new MultipartFormDataContent { { new StringContent("x"), "somethingElse" } };
        var response = await admin.PostAsync("/api/book", empty);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
        foreach (var field in new[] { "Title", "Author", "Category", "Price" })
        {
            Assert.True(errors.TryGetProperty(field, out _), $"{field} should be reported as invalid");
        }
    }

    [Theory]
    [InlineData("price", "abc")]
    [InlineData("price", "-1")]
    [InlineData("price", "100000000")]            // more than decimal(10,2) can hold
    [InlineData("bookId", "not a number")]
    [InlineData("title", "")]
    [InlineData("title", "101 characters")]       // stands for a 101-character value, see below
    [InlineData("author", "101 characters")]
    [InlineData("category", "21 characters")]
    public async Task Invalid_or_wrongly_typed_book_fields_are_a_400_and_store_nothing(string field, string value)
    {
        var admin = await AdminClient();
        value = value switch { "101 characters" => new string('x', 101), "21 characters" => new string('x', 21), _ => value };
        var title = "Invalid " + Guid.NewGuid().ToString("N");

        // A valid form with just this one field replaced, so the field has exactly one value.
        var fields = new Dictionary<string, string> { ["bookId"] = "0", ["title"] = title, ["author"] = "A", ["category"] = "Fiction", ["price"] = "5" };
        fields[field] = value;
        var form = new MultipartFormDataContent();
        foreach (var (name, text) in fields) form.Add(new StringContent(text), name);

        var response = await admin.PostAsync("/api/book", form);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await AssertNoBook(title);   // when the title itself is the invalid field nothing could have been stored under it either
    }

    [Fact]
    public async Task A_request_that_is_not_a_form_is_rejected()
    {
        var admin = await AdminClient();

        var json = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await admin.PostAsync("/api/book", json)).StatusCode);
    }

    [Fact]
    public async Task The_form_the_angular_app_really_sends_is_accepted_and_the_saved_book_comes_back()
    {
        // The admin form sends each field on its own and the price as the TEXT of an input ("12.5").
        var admin = await AdminClient();
        var title = "Angular " + Guid.NewGuid().ToString("N");
        var form = new MultipartFormDataContent
        {
            { new StringContent("0"), "bookId" }, { new StringContent(title), "title" }, { new StringContent("A. Author"), "author" },
            { new StringContent("Fiction"), "category" }, { new StringContent("12.5"), "price" }
        };

        var response = await admin.PostAsync("/api/book", form);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        // The Angular reducers add this straight to the store, so it must be the saved book (it used to be the number 1).
        Assert.True(body.GetProperty("bookId").GetInt32() > 0);
        Assert.Equal(title, body.GetProperty("title").GetString());
        Assert.Equal(12.5m, body.GetProperty("price").GetDecimal());
        Assert.Equal("Default_image.jpg", body.GetProperty("coverFileName").GetString());
        Assert.Equal($"/api/Book/{body.GetProperty("bookId").GetInt32()}", response.Headers.Location?.AbsolutePath, ignoreCase: true);

        var book = await FindBook(title);
        Assert.Equal(12.5m, book.Price);
        Assert.Equal("A. Author", book.Author);
    }

    [Fact]
    public async Task A_client_cannot_choose_the_id_or_the_cover_name_of_a_new_book()
    {
        var admin = await AdminClient();
        var title = "Mine " + Guid.NewGuid().ToString("N");
        var form = BookForm(title, bookId: 424242, coverFileName: @"..\..\evil.png");

        var response = await admin.PostAsync("/api/book", form);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var book = await FindBook(title);
        Assert.NotEqual(424242, book.BookId);
        Assert.Equal("Default_image.jpg", book.CoverFileName);
    }

    [Fact]
    public async Task Only_admins_can_upload()
    {
        var anonymous = _factory.Anonymous();
        var user = await _factory.LoggedIn("usera", ApiFactory.UserAPassword);

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsync("/api/book", BookForm("Anon", file: ("a.png", Png)))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.PostAsync("/api/book", BookForm("User", file: ("a.png", Png)))).StatusCode);
        await AssertNoBook("Anon");
        await AssertNoBook("User");
    }

    // ---- updating ----------------------------------------------------------------------------------------------

    [Fact]
    public async Task Replacing_the_cover_stores_the_new_file_and_deletes_the_old_one()
    {
        var admin = await AdminClient();
        var title = "Replace " + Guid.NewGuid().ToString("N");
        await admin.PostAsync("/api/book", BookForm(title, file: ("one.png", Png)));
        var original = await FindBook(title);

        var response = await admin.PutAsync("/api/book", BookForm(title, bookId: original.BookId, file: ("two.jpg", Jpeg)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await FindBook(title);
        Assert.NotEqual(original.CoverFileName, updated.CoverFileName);
        Assert.EndsWith(".jpg", updated.CoverFileName);
        Assert.True(File.Exists(Path.Combine(_factory.UploadFolder, updated.CoverFileName!)));
        Assert.False(File.Exists(Path.Combine(_factory.UploadFolder, original.CoverFileName!)), "the replaced cover must not be left behind");
    }

    [Fact]
    public async Task Updating_without_a_file_keeps_the_stored_cover_and_ignores_a_client_supplied_name()
    {
        var admin = await AdminClient();
        var title = "Keep " + Guid.NewGuid().ToString("N");
        await admin.PostAsync("/api/book", BookForm(title, file: ("one.png", Png)));
        var original = await FindBook(title);

        var response = await admin.PutAsync("/api/book",
            BookForm(title, bookId: original.BookId, coverFileName: @"..\..\somewhere\else.png", price: 12.34m));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await FindBook(title);
        Assert.Equal(original.CoverFileName, updated.CoverFileName);
        Assert.Equal(12.34m, updated.Price);   // the rest of the update still applied
        Assert.True(File.Exists(Path.Combine(_factory.UploadFolder, original.CoverFileName!)));
    }

    [Fact]
    public async Task A_rejected_replacement_changes_nothing()
    {
        var admin = await AdminClient();
        var title = "Safe " + Guid.NewGuid().ToString("N");
        await admin.PostAsync("/api/book", BookForm(title, file: ("one.png", Png)));
        var original = await FindBook(title);

        var response = await admin.PutAsync("/api/book",
            BookForm(title, bookId: original.BookId, file: ("evil.html", System.Text.Encoding.UTF8.GetBytes("<html/>"))));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(original.CoverFileName, (await FindBook(title)).CoverFileName);
        Assert.True(File.Exists(Path.Combine(_factory.UploadFolder, original.CoverFileName!)));
    }

    [Fact]
    public async Task Updating_a_missing_book_is_404_and_stores_nothing()
    {
        var admin = await AdminClient();
        var before = Directory.GetFiles(_factory.UploadFolder).Length;

        var response = await admin.PutAsync("/api/book", BookForm("Ghost", bookId: 987_654, file: ("ghost.png", Png)));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(before, Directory.GetFiles(_factory.UploadFolder).Length);
    }

    // ---- deleting ----------------------------------------------------------------------------------------------

    [Fact]
    public async Task Deleting_a_book_deletes_its_cover_file()
    {
        var admin = await AdminClient();
        var title = "Delete " + Guid.NewGuid().ToString("N");
        await admin.PostAsync("/api/book", BookForm(title, file: ("one.png", Png)));
        var book = await FindBook(title);
        var path = Path.Combine(_factory.UploadFolder, book.CoverFileName!);
        Assert.True(File.Exists(path));

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/book/{book.BookId}")).StatusCode);

        Assert.False(File.Exists(path));
        await AssertNoBook(title);
    }

    [Fact]
    public async Task Deleting_a_book_never_deletes_the_default_cover()
    {
        var admin = await AdminClient();
        var defaultCover = Path.Combine(_factory.UploadFolder, "Default_image.jpg");
        await File.WriteAllBytesAsync(defaultCover, Jpeg);
        await admin.PostAsync("/api/book", BookForm("Default cover book"));
        var book = await FindBook("Default cover book");

        await admin.DeleteAsync($"/api/book/{book.BookId}");

        Assert.True(File.Exists(defaultCover));
    }

    [Theory]
    [InlineData(@"..\sentinel.txt")]
    [InlineData("../sentinel.txt")]
    public async Task A_stored_cover_name_that_is_a_path_cannot_delete_files_outside_the_upload_folder(string storedName)
    {
        var admin = await AdminClient();
        var sentinel = Path.Combine(_factory.WebRoot, "sentinel.txt");
        await File.WriteAllTextAsync(sentinel, "must survive");
        int bookId;
        await using (var db = _factory.CreateDbContext())
        {
            // A name like this could have been written by an earlier API call that trusted the client.
            var poisoned = new Book { Title = "Poisoned " + storedName, Author = "A", Category = "Fiction", Price = 1m, CoverFileName = storedName };
            db.Book.Add(poisoned);
            await db.SaveChangesAsync();
            bookId = poisoned.BookId;
        }

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/book/{bookId}")).StatusCode);

        Assert.True(File.Exists(sentinel), "a file outside the upload folder was deleted");
    }

    [Fact]
    public async Task Deleting_a_missing_book_is_404()
    {
        var admin = await AdminClient();

        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync("/api/book/987654")).StatusCode);
    }

    // ---- helpers -----------------------------------------------------------------------------------------------

    Task<HttpClient> AdminClient() => _factory.LoggedIn("adminuser", ApiFactory.AdminPassword);

    /// <summary>The multipart form the admin UI sends: one field per book property, plus an optional "file".</summary>
    static MultipartFormDataContent BookForm(string title, int bookId = 0, decimal price = 9.99m,
        (string Name, byte[] Bytes)? file = null, string? coverFileName = null)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(bookId.ToString(CultureInfo.InvariantCulture)), "bookId" },
            { new StringContent(title), "title" },
            { new StringContent("Author"), "author" },
            { new StringContent("Fiction"), "category" },
            { new StringContent(price.ToString(CultureInfo.InvariantCulture)), "price" }
        };
        // Not a book field any more. A client that still sends one must have it ignored.
        if (coverFileName is not null) form.Add(new StringContent(coverFileName), "coverFileName");
        if (file is { } f)
        {
            var part = new ByteArrayContent(f.Bytes);
            part.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
            form.Add(part, "file", f.Name);
        }
        return form;
    }

    async Task<Book> FindBook(string title)
    {
        await using var db = _factory.CreateDbContext();
        return await db.Book.AsNoTracking().SingleAsync(b => b.Title == title);
    }

    async Task AssertNoBook(string title)
    {
        await using var db = _factory.CreateDbContext();
        Assert.False(await db.Book.AnyAsync(b => b.Title == title), $"book '{title}' should not exist");
    }

    async Task AssertRejected(HttpResponseMessage response, string title)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await AssertNoBook(title);
    }
}
