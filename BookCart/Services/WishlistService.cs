using BookCart.Dto;
using BookCart.Errors;
using BookCart.Models;
using Microsoft.EntityFrameworkCore;

namespace BookCart.Services
{
    /// <summary>A signed-in user's wishlist. Reading never creates anything; a wishlist is created by the first book added to it.</summary>
    public interface IWishlistService
    {
        Task<List<BookDto>> GetWishlistAsync(int userId, CancellationToken cancellationToken);

        /// <summary>Adds the book if it is not on the wishlist, otherwise removes it. Throws <see cref="NotFoundException"/> for an unknown book.</summary>
        Task ToggleAsync(int userId, int bookId, CancellationToken cancellationToken);

        Task ClearAsync(int userId, CancellationToken cancellationToken);
    }

    /// <remarks>
    /// The database guarantees one wishlist per user and a book at most once on it, so two parallel requests cannot
    /// create duplicates: the one that loses the race carries on with what the winner created.
    /// </remarks>
    public class WishlistService(BookDBContext dbContext, TimeProvider timeProvider) : IWishlistService
    {
        readonly BookDBContext _db = dbContext;
        readonly TimeProvider _time = timeProvider;

        public Task<List<BookDto>> GetWishlistAsync(int userId, CancellationToken cancellationToken) =>
            (from wishlist in _db.Wishlist.AsNoTracking()
             where wishlist.UserId == userId
             join item in _db.WishlistItems.AsNoTracking() on wishlist.WishlistId equals item.WishlistId
             join book in _db.Book.AsNoTracking() on item.ProductId equals book.BookId
             orderby item.WishlistItemId
             select new BookDto(book.BookId, book.Title, book.Author, book.Category, book.Price, book.CoverFileName))
            .ToListAsync(cancellationToken);

        public async Task ToggleAsync(int userId, int bookId, CancellationToken cancellationToken)
        {
            if (!await _db.Book.AnyAsync(b => b.BookId == bookId, cancellationToken))
            {
                throw new NotFoundException($"Book {bookId} does not exist.");
            }

            var wishlistId = await GetOrCreateWishlistIdAsync(userId, cancellationToken);

            var removed = await _db.WishlistItems.Where(i => i.WishlistId == wishlistId && i.ProductId == bookId).ExecuteDeleteAsync(cancellationToken);
            if (removed > 0) return;

            var item = new WishlistItems { WishlistId = wishlistId, ProductId = bookId };
            _db.WishlistItems.Add(item);
            try
            {
                await _db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException ex) when (DatabaseErrors.IsUniqueViolation(ex))
            {
                // A parallel request put the same book on the list a moment ago, which is what was asked for.
                _db.Entry(item).State = EntityState.Detached;
            }
            catch (DbUpdateException ex) when (DatabaseErrors.IsConstraintViolation(ex))
            {
                // The book was deleted a moment ago.
                _db.Entry(item).State = EntityState.Detached;
                throw new NotFoundException($"Book {bookId} does not exist.");
            }
        }

        public async Task ClearAsync(int userId, CancellationToken cancellationToken)
        {
            var wishlistId = await FindWishlistIdAsync(userId, cancellationToken);
            if (wishlistId is null) return;

            await _db.WishlistItems.Where(i => i.WishlistId == wishlistId).ExecuteDeleteAsync(cancellationToken);
        }

        Task<string?> FindWishlistIdAsync(int userId, CancellationToken cancellationToken) =>
            _db.Wishlist.AsNoTracking().Where(w => w.UserId == userId).Select(w => w.WishlistId).FirstOrDefaultAsync(cancellationToken);

        async Task<string> GetOrCreateWishlistIdAsync(int userId, CancellationToken cancellationToken)
        {
            var existing = await FindWishlistIdAsync(userId, cancellationToken);
            if (existing is not null) return existing;

            var wishlist = new Wishlist { WishlistId = Guid.NewGuid().ToString(), UserId = userId, DateCreated = _time.GetUtcNow().UtcDateTime };
            _db.Wishlist.Add(wishlist);
            try
            {
                await _db.SaveChangesAsync(cancellationToken);
                return wishlist.WishlistId;
            }
            catch (DbUpdateException ex) when (DatabaseErrors.IsUniqueViolation(ex))
            {
                _db.Entry(wishlist).State = EntityState.Detached;
                var winner = await FindWishlistIdAsync(userId, cancellationToken);
                if (winner is null) throw;   // the other request's row is gone again: report the original error
                return winner;
            }
        }
    }
}
