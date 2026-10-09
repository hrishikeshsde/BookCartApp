using BookCart.Models;
using System.Linq.Expressions;

namespace BookCart.Dto
{
    /// <summary>A book as the API shows it. Entities are never returned directly, so database columns can change freely.</summary>
    public record BookDto(int BookId, string Title, string Author, string Category, decimal Price, string? CoverFileName)
    {
        /// <summary>Usable inside EF queries (<c>.Select(BookDto.FromBook)</c>), so only the needed columns are read.</summary>
        public static readonly Expression<Func<Book, BookDto>> FromBook =
            b => new BookDto(b.BookId, b.Title, b.Author, b.Category, b.Price, b.CoverFileName);

        static readonly Func<Book, BookDto> Compiled = FromBook.Compile();

        /// <summary>The same mapping for an entity already in memory.</summary>
        public static BookDto From(Book book) => Compiled(book);
    }

    public record CategoryDto(int CategoryId, string CategoryName);

    /// <summary>A book in a cart, or one line of a placed order (then <c>Book.Price</c> is the price paid at the time).</summary>
    public record CartItemDto(BookDto Book, int Quantity);

    public record OrderDto(string OrderId, DateTime OrderDate, decimal CartTotal, List<CartItemDto> OrderDetails);

    public record BookSummaryDto(string Summary);
}
