using BookCart.Dto;
using BookCart.Errors;
using BookCart.Extensions;
using BookCart.Models;
using BookCart.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using Microsoft.AspNetCore.RateLimiting;

namespace BookCart.Controllers
{
    [Produces("application/json")]
    [ApiController]
    [Route("api/[controller]")]
    public class BookController(
        IBookService books,
        IBookSummaryService summaries,
        ICoverStorage covers,
        IOutputCacheStore outputCache,
        ILogger<BookController> logger) : ControllerBase
    {
        // The cover is capped at CoverStorage.MaxBytes (2 MB); this leaves room for the rest of the multipart form.
        const int MaxRequestBytes = 3_000_000;

        readonly IBookService _books = books;
        readonly IBookSummaryService _summaries = summaries;
        readonly ICoverStorage _covers = covers;
        readonly IOutputCacheStore _outputCache = outputCache;
        readonly ILogger<BookController> _logger = logger;

        string? AdminId => User.FindFirst("userId")?.Value;

        /// <summary>
        /// Get the list of available books
        /// </summary>
        [AllowAnonymous]
        [OutputCache(PolicyName = ApiExtensions.CatalogCachePolicy)]
        [HttpGet]
        public Task<List<BookDto>> Get(CancellationToken cancellationToken) => _books.GetAllBooksAsync(cancellationToken);

        /// <summary>
        /// One page of books, filtered and ordered by title in the database. Query: page (1-based), pageSize (max 100),
        /// category, search (title or author contains), minPrice, maxPrice.
        /// </summary>
        [AllowAnonymous]
        [HttpGet("search")]
        [ProducesResponseType(typeof(PagedResult<BookDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public Task<PagedResult<BookDto>> Search([FromQuery] BookQuery query, CancellationToken cancellationToken) =>
            _books.SearchBooksAsync(query, cancellationToken);

        /// <summary>
        /// Get the specific book data corresponding to the BookId
        /// </summary>
        [AllowAnonymous]
        [HttpGet("{id:int}")]
        [ProducesResponseType(typeof(BookDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<ActionResult<BookDto>> Get(int id, CancellationToken cancellationToken) =>
            await _books.GetBookAsync(id, cancellationToken) is { } book ? book : NotFound();

        /// <summary>
        /// Get the list of available categories
        /// </summary>
        [AllowAnonymous]
        [OutputCache(PolicyName = ApiExtensions.CatalogCachePolicy)]
        [HttpGet("GetCategoriesList")]
        public Task<List<CategoryDto>> CategoryDetails(CancellationToken cancellationToken) => _books.GetCategoriesAsync(cancellationToken);

        /// <summary>
        /// Get up to five random other books from the category of the book whose BookId is supplied
        /// </summary>
        [AllowAnonymous]
        [HttpGet("GetSimilarBooks/{bookId:int}")]
        [ProducesResponseType(typeof(List<BookDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public Task<List<BookDto>> SimilarBooks(int bookId, CancellationToken cancellationToken) => _books.GetSimilarBooksAsync(bookId, cancellationToken);

        /// <summary>
        /// An AI-written summary of the book. The key to the AI service stays on the server, and each book is
        /// summarised once per cache period, however many people ask.
        /// </summary>
        [AllowAnonymous]
        [EnableRateLimiting("summary")]
        [HttpPost("{id:int}/summary")]
        [ProducesResponseType(typeof(BookSummaryDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
        [ProducesResponseType(StatusCodes.Status502BadGateway)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<ActionResult<BookSummaryDto>> Summary(int id, CancellationToken cancellationToken)
        {
            var book = await _books.GetBookAsync(id, cancellationToken);
            if (book is null) return NotFound();

            return new BookSummaryDto(await _summaries.GetSummaryAsync(book, cancellationToken));
        }

        /// <summary>
        /// Add a new book. Form fields: title, author, category, price, and an optional cover image in <c>file</c>.
        /// </summary>
        [HttpPost]
        [RequestSizeLimit(MaxRequestBytes)]
        [Authorize(Policy = UserRoles.Admin)]
        [ProducesResponseType(typeof(BookDto), StatusCodes.Status201Created)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<BookDto>> Post([FromForm] BookForm form, IFormFile? file, CancellationToken cancellationToken)
        {
            string? savedCover = null;
            try
            {
                // The client never chooses the cover file name: it is the generated name, or the default.
                savedCover = file is null ? null : await _covers.SaveAsync(file, cancellationToken);
                var book = await _books.AddBookAsync(form, savedCover ?? _covers.DefaultFileName, cancellationToken);

                await _outputCache.EvictByTagAsync(ApiExtensions.CatalogCachePolicy, cancellationToken);
                _logger.LogInformation("Admin {AdminId} added book {BookId} '{Title}'", AdminId, book.BookId, book.Title);
                return CreatedAtAction(nameof(Get), new { id = book.BookId }, book);
            }
            catch
            {
                _covers.Delete(savedCover);   // do not leave an orphaned file behind a failed insert
                throw;
            }
        }

        /// <summary>
        /// Update a book. Form fields: bookId, title, author, category, price, and an optional new cover in <c>file</c>
        /// (without one, the stored cover is kept).
        /// </summary>
        [HttpPut]
        [RequestSizeLimit(MaxRequestBytes)]
        [Authorize(Policy = UserRoles.Admin)]
        [ProducesResponseType(typeof(BookDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<ActionResult<BookDto>> Put([FromForm] BookForm form, IFormFile? file, CancellationToken cancellationToken)
        {
            // Checked before anything is stored, so an update of a missing book leaves no file behind.
            if (await _books.GetBookAsync(form.BookId, cancellationToken) is null) return NotFound();

            string? savedCover = null;
            try
            {
                savedCover = file is null ? null : await _covers.SaveAsync(file, cancellationToken);
                var (book, replacedCover) = await _books.UpdateBookAsync(form, savedCover, cancellationToken);

                _covers.Delete(replacedCover);   // replaced: the old file is no longer referenced
                await _outputCache.EvictByTagAsync(ApiExtensions.CatalogCachePolicy, cancellationToken);
                _logger.LogInformation("Admin {AdminId} updated book {BookId}{CoverChange}", AdminId, book.BookId, savedCover is null ? "" : " (cover replaced)");
                return book;
            }
            catch
            {
                _covers.Delete(savedCover);
                throw;
            }
        }

        /// <summary>
        /// Delete a book, and its cover image
        /// </summary>
        [HttpDelete("{id:int}")]
        [Authorize(Policy = UserRoles.Admin)]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
        {
            _covers.Delete(await _books.DeleteBookAsync(id, cancellationToken));

            await _outputCache.EvictByTagAsync(ApiExtensions.CatalogCachePolicy, cancellationToken);
            _logger.LogInformation("Admin {AdminId} deleted book {BookId}", AdminId, id);
            return NoContent();
        }
    }
}
