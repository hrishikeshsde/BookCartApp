using BookCart.Dto;
using BookCart.Errors;
using BookCart.Models;
using Microsoft.EntityFrameworkCore;

namespace BookCart.Services
{
    public interface IBookService
    {
        Task<List<BookDto>> GetAllBooksAsync(CancellationToken cancellationToken);
        Task<BookDto?> GetBookAsync(int bookId, CancellationToken cancellationToken);
        Task<List<CategoryDto>> GetCategoriesAsync(CancellationToken cancellationToken);

        /// <summary>One page of the books matching the filters, ordered by title. The filtering and the paging happen in the database.</summary>
        Task<PagedResult<BookDto>> SearchBooksAsync(BookQuery query, CancellationToken cancellationToken);

        /// <summary>Up to five random other books of the same category. Throws <see cref="NotFoundException"/> for an unknown book.</summary>
        Task<List<BookDto>> GetSimilarBooksAsync(int bookId, CancellationToken cancellationToken);

        Task<BookDto> AddBookAsync(BookForm form, string coverFileName, CancellationToken cancellationToken);

        /// <summary>
        /// Updates the book's fields, and its cover too when <paramref name="newCoverFileName"/> is given.
        /// Throws <see cref="NotFoundException"/> for an unknown book.
        /// </summary>
        /// <returns>The updated book, and the cover file it no longer uses (null if the cover did not change).</returns>
        Task<(BookDto Book, string? ReplacedCoverFileName)> UpdateBookAsync(BookForm form, string? newCoverFileName, CancellationToken cancellationToken);

        /// <summary>Deletes the book. Throws <see cref="NotFoundException"/> for an unknown book.</summary>
        /// <returns>The deleted book's cover file name, so the caller can remove the file.</returns>
        Task<string?> DeleteBookAsync(int bookId, CancellationToken cancellationToken);
    }

    public class BookService(BookDBContext dbContext) : IBookService
    {
        readonly BookDBContext _db = dbContext;

        public Task<List<BookDto>> GetAllBooksAsync(CancellationToken cancellationToken) =>
            _db.Book.AsNoTracking().Select(BookDto.FromBook).ToListAsync(cancellationToken);

        public Task<BookDto?> GetBookAsync(int bookId, CancellationToken cancellationToken) =>
            _db.Book.AsNoTracking().Where(b => b.BookId == bookId).Select(BookDto.FromBook).FirstOrDefaultAsync(cancellationToken);

        public Task<List<CategoryDto>> GetCategoriesAsync(CancellationToken cancellationToken) =>
            _db.Categories.AsNoTracking().Select(c => new CategoryDto(c.CategoryId, c.CategoryName)).ToListAsync(cancellationToken);

        public async Task<PagedResult<BookDto>> SearchBooksAsync(BookQuery query, CancellationToken cancellationToken)
        {
            var books = _db.Book.AsNoTracking().AsQueryable();

            if (!string.IsNullOrWhiteSpace(query.Category))
            {
                books = books.Where(b => b.Category == query.Category);
            }
            if (!string.IsNullOrWhiteSpace(query.Search))
            {
                var text = query.Search.Trim();
                // Contains is translated with the wildcard characters escaped, so searching for "100%" finds "100%".
                books = books.Where(b => b.Title.Contains(text) || b.Author.Contains(text));
            }
            if (query.MinPrice is { } min) books = books.Where(b => b.Price >= min);
            if (query.MaxPrice is { } max) books = books.Where(b => b.Price <= max);

            var total = await books.CountAsync(cancellationToken);
            var items = await books
                .OrderBy(b => b.Title).ThenBy(b => b.BookId)   // the id makes the order stable between pages
                .Skip((query.Page - 1) * query.PageSize)
                .Take(query.PageSize)
                .Select(BookDto.FromBook)
                .ToListAsync(cancellationToken);

            return new PagedResult<BookDto>(items, total, query.Page, query.PageSize);
        }

        public async Task<List<BookDto>> GetSimilarBooksAsync(int bookId, CancellationToken cancellationToken)
        {
            var category = await _db.Book.AsNoTracking().Where(b => b.BookId == bookId).Select(b => b.Category).FirstOrDefaultAsync(cancellationToken)
                           ?? throw new NotFoundException($"Book {bookId} does not exist.");

            // Pick the five at random among the ids only (a list of numbers), then load just those five books. Sorting
            // whole rows by a random value would read and sort every book of the category on each request.
            var candidates = await _db.Book.AsNoTracking()
                .Where(b => b.Category == category && b.BookId != bookId)
                .Select(b => b.BookId)
                .ToListAsync(cancellationToken);
            if (candidates.Count == 0) return [];

            Random.Shared.Shuffle(System.Runtime.InteropServices.CollectionsMarshal.AsSpan(candidates));
            var picked = candidates.Take(5).ToList();

            return await _db.Book.AsNoTracking()
                .Where(b => picked.Contains(b.BookId))
                .Select(BookDto.FromBook)
                .ToListAsync(cancellationToken);
        }

        public async Task<BookDto> AddBookAsync(BookForm form, string coverFileName, CancellationToken cancellationToken)
        {
            var book = new Book
            {
                Title = form.Title,
                Author = form.Author,
                Category = form.Category,
                Price = form.Price!.Value,
                CoverFileName = coverFileName
            };
            _db.Book.Add(book);
            await _db.SaveChangesAsync(cancellationToken);
            return BookDto.From(book);
        }

        public async Task<(BookDto Book, string? ReplacedCoverFileName)> UpdateBookAsync(BookForm form, string? newCoverFileName, CancellationToken cancellationToken)
        {
            var book = await _db.Book.FirstOrDefaultAsync(b => b.BookId == form.BookId, cancellationToken)
                       ?? throw new NotFoundException($"Book {form.BookId} does not exist.");

            book.Title = form.Title;
            book.Author = form.Author;
            book.Category = form.Category;
            book.Price = form.Price!.Value;

            string? replaced = null;
            if (newCoverFileName is not null)
            {
                replaced = book.CoverFileName;
                book.CoverFileName = newCoverFileName;
            }

            await _db.SaveChangesAsync(cancellationToken);
            return (BookDto.From(book), replaced);
        }

        public async Task<string?> DeleteBookAsync(int bookId, CancellationToken cancellationToken)
        {
            var book = await _db.Book.FirstOrDefaultAsync(b => b.BookId == bookId, cancellationToken)
                       ?? throw new NotFoundException($"Book {bookId} does not exist.");

            _db.Book.Remove(book);
            await _db.SaveChangesAsync(cancellationToken);
            return book.CoverFileName;
        }
    }
}
