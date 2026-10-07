using BookCart.Extensions;
using BookCart.Interfaces;
using BookCart.Models;
using BookCart.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using System.Text.Json;

namespace BookCart.Controllers
{
    [Produces("application/json")]
    [ApiController]
    [Route("api/[controller]")]
    public class BookController(IBookService bookService, CoverStorage coverStorage, IOutputCacheStore outputCache, ILogger<BookController> logger) : ControllerBase
    {
        // The admin form sends camelCase names and its price field as a string ("12.5"). Newtonsoft accepted both by
        // default; System.Text.Json only does with the Web defaults (case-insensitive names, numbers from strings).
        static readonly JsonSerializerOptions BookFormJson = new(JsonSerializerDefaults.Web);

        // The cover is capped at CoverStorage.MaxBytes (2 MB); this leaves room for the rest of the multipart form.
        const int MaxRequestBytes = 3_000_000;

        readonly IBookService _bookService = bookService;
        readonly CoverStorage _covers = coverStorage;
        readonly IOutputCacheStore _outputCache = outputCache;
        readonly ILogger<BookController> _logger = logger;

        /// <summary>
        /// Get the list of available books
        /// </summary>
        /// <returns>List of Book</returns>
        [AllowAnonymous]
        [OutputCache(PolicyName = ApiExtensions.CatalogCachePolicy)]
        [HttpGet]
        public async Task<List<Book>> Get()
        {
            return await Task.FromResult(_bookService.GetAllBooks()).ConfigureAwait(true);
        }

        /// <summary>
        /// Get the specific book data corresponding to the BookId
        /// </summary>
        /// <param name="id"></param>
        /// <returns></returns>
        [AllowAnonymous]
        [HttpGet("{id:int}")]
        [ProducesResponseType(typeof(Book), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public IActionResult Get(int id)
        {
            Book book = _bookService.GetBookData(id);
            if (book != null)
            {
                return Ok(book);
            }
            return NotFound();
        }

        /// <summary>
        /// Get the list of available categories
        /// </summary>
        /// <returns></returns>
        [AllowAnonymous]
        [OutputCache(PolicyName = ApiExtensions.CatalogCachePolicy)]
        [HttpGet]
        [Route("GetCategoriesList")]
        public async Task<IEnumerable<Categories>> CategoryDetails()
        {
            return await Task.FromResult(_bookService.GetCategories()).ConfigureAwait(true);
        }

        /// <summary>
        /// Get the random five books from the category of book whose BookId is supplied
        /// </summary>
        /// <param name="bookId"></param>
        /// <returns></returns>
        [AllowAnonymous]
        [HttpGet]
        [Route("GetSimilarBooks/{bookId:int}")]
        [ProducesResponseType(typeof(List<Book>), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<List<Book>> SimilarBooks(int bookId)
        {
            return await Task.FromResult(_bookService.GetSimilarBooks(bookId)).ConfigureAwait(true);
        }

        /// <summary>
        /// Add a new book record
        /// </summary>
        /// <returns></returns>
        [HttpPost]
        [RequestSizeLimit(MaxRequestBytes)]
        [Authorize(Policy = UserRoles.Admin)]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        public async Task<IActionResult> Post(CancellationToken cancellationToken)
        {
            var (book, cover, error) = await ReadBookForm(cancellationToken);
            if (error is not null) return error;

            book!.BookId = 0;   // the database assigns the id
            string? savedCover = null;
            try
            {
                // The client never chooses the cover file name: it is the generated name, or the default.
                book.CoverFileName = cover is null
                    ? _covers.DefaultFileName
                    : savedCover = await _covers.SaveAsync(cover, cancellationToken);
                var result = _bookService.AddBook(book);
                await _outputCache.EvictByTagAsync(ApiExtensions.CatalogCachePolicy, cancellationToken);
                _logger.LogInformation("Admin {AdminId} added book {BookId} '{Title}'", AdminId, book.BookId, book.Title);
                return Ok(result);
            }
            catch (InvalidUploadException ex)
            {
                return BadRequest(ex.Message);
            }
            catch
            {
                _covers.Delete(savedCover);   // do not leave an orphaned file behind a failed insert
                throw;
            }
        }

        /// <summary>
        /// Update a particular book record
        /// </summary>
        /// <returns></returns>
        [HttpPut]
        [RequestSizeLimit(MaxRequestBytes)]
        [Authorize(Policy = UserRoles.Admin)]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> Put(CancellationToken cancellationToken)
        {
            var (book, cover, error) = await ReadBookForm(cancellationToken);
            if (error is not null) return error;

            var existing = _bookService.GetBookData(book!.BookId);
            if (existing is null) return NotFound();

            // A cover name sent by the client is ignored; null makes the data layer keep the stored one.
            book.CoverFileName = null;
            string? savedCover = null;
            try
            {
                if (cover is not null)
                {
                    book.CoverFileName = savedCover = await _covers.SaveAsync(cover, cancellationToken);
                }
                var result = _bookService.UpdateBook(book);
                if (savedCover is not null)
                {
                    _covers.Delete(existing.CoverFileName);   // replaced: the old file is no longer referenced
                }
                await _outputCache.EvictByTagAsync(ApiExtensions.CatalogCachePolicy, cancellationToken);
                _logger.LogInformation("Admin {AdminId} updated book {BookId}{CoverChange}", AdminId, book.BookId, savedCover is null ? "" : " (cover replaced)");
                return Ok(result);
            }
            catch (InvalidUploadException ex)
            {
                return BadRequest(ex.Message);
            }
            catch
            {
                _covers.Delete(savedCover);
                throw;
            }
        }

        /// <summary>
        /// Delete a particular book record
        /// </summary>
        /// <param name="id"></param>
        /// <returns></returns>
        [HttpDelete("{id:int}")]
        [Authorize(Policy = UserRoles.Admin)]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
        {
            if (_bookService.GetBookData(id) is null) return NotFound();

            _covers.Delete(_bookService.DeleteBook(id));
            await _outputCache.EvictByTagAsync(ApiExtensions.CatalogCachePolicy, cancellationToken);
            _logger.LogInformation("Admin {AdminId} deleted book {BookId}", AdminId, id);
            return Ok(1);
        }

        string? AdminId => User.FindFirst("userId")?.Value;

        /// <summary>Reads the multipart form the admin UI sends: the book as JSON in <c>bookFormData</c>, plus an optional cover file.</summary>
        async Task<(Book? Book, IFormFile? Cover, IActionResult? Error)> ReadBookForm(CancellationToken cancellationToken)
        {
            if (!Request.HasFormContentType)
            {
                return (null, null, BadRequest("Expected a multipart/form-data request."));
            }

            var form = await Request.ReadFormAsync(cancellationToken);
            Book? book;
            try
            {
                book = JsonSerializer.Deserialize<Book>(form["bookFormData"].ToString(), BookFormJson);
            }
            catch (JsonException)
            {
                book = null;
            }

            return book is null
                ? (null, null, BadRequest("The form field 'bookFormData' must contain the book as JSON."))
                : (book, form.Files.Count > 0 ? form.Files[0] : null, null);
        }
    }
}
