using System.ComponentModel.DataAnnotations;

namespace BookCart.Dto
{
    /// <summary>
    /// The book fields of the admin form (<c>multipart/form-data</c>, next to an optional <c>file</c> part). Only what
    /// the form may decide is here: the id comes from the route or the database, the cover file name from the server.
    /// Lengths match the Book columns, so an over-long value is a 400, not a database error.
    /// </summary>
    public class BookForm
    {
        /// <summary>Which book to update. Ignored when adding.</summary>
        public int BookId { get; set; }

        [Required, StringLength(100)]
        public string Title { get; set; } = string.Empty;

        [Required, StringLength(100)]
        public string Author { get; set; } = string.Empty;

        [Required, StringLength(20)]
        public string Category { get; set; } = string.Empty;

        /// <summary>Nullable so that a missing price is an error instead of silently a price of 0.</summary>
        [Required, Range(0, 99999999.99)]
        public decimal? Price { get; set; }
    }
}
