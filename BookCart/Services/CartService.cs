using BookCart.Dto;
using BookCart.Errors;
using BookCart.Models;
using Microsoft.EntityFrameworkCore;

namespace BookCart.Services
{
    /// <summary>
    /// Shopping carts. A cart belongs to an "owner id": a signed-in user's id, or a guest's id (see <see cref="IGuestSession"/>).
    /// Reading never creates anything; a cart is created by the first book added to it.
    /// </summary>
    public interface ICartService
    {
        Task<List<CartItemDto>> GetCartAsync(int ownerId, CancellationToken cancellationToken);
        Task<int> GetItemCountAsync(int ownerId, CancellationToken cancellationToken);

        /// <summary>Adds one copy of the book. Throws <see cref="NotFoundException"/> for an unknown book.</summary>
        Task AddBookAsync(int ownerId, int bookId, CancellationToken cancellationToken);

        /// <summary>Removes the book from the cart whatever its quantity.</summary>
        Task RemoveBookAsync(int ownerId, int bookId, CancellationToken cancellationToken);

        /// <summary>Takes one copy out; the last copy removes the book from the cart.</summary>
        Task DecreaseQuantityAsync(int ownerId, int bookId, CancellationToken cancellationToken);

        Task ClearAsync(int ownerId, CancellationToken cancellationToken);

        /// <summary>Moves everything in one owner's cart into another's (a guest's into the user's after login) and deletes the source cart.</summary>
        Task MergeAsync(int fromOwnerId, int intoOwnerId, CancellationToken cancellationToken);
    }

    /// <remarks>
    /// The database guarantees one cart per owner, one row per book in a cart, positive quantities, and that a cart row
    /// refers to a real cart and a real book. Two requests can therefore race (two first additions at once): the
    /// loser's insert is refused, and it carries on with what the winner created instead of failing.
    /// </remarks>
    public class CartService(BookDBContext dbContext, TimeProvider timeProvider) : ICartService
    {
        readonly BookDBContext _db = dbContext;
        readonly TimeProvider _time = timeProvider;

        public Task<List<CartItemDto>> GetCartAsync(int ownerId, CancellationToken cancellationToken) =>
            (from cart in _db.Cart.AsNoTracking()
             where cart.UserId == ownerId
             join item in _db.CartItems.AsNoTracking() on cart.CartId equals item.CartId
             join book in _db.Book.AsNoTracking() on item.ProductId equals book.BookId
             orderby item.CartItemId
             select new CartItemDto(new BookDto(book.BookId, book.Title, book.Author, book.Category, book.Price, book.CoverFileName), item.Quantity))
            .ToListAsync(cancellationToken);

        public async Task<int> GetItemCountAsync(int ownerId, CancellationToken cancellationToken) =>
            await (from cart in _db.Cart
                   where cart.UserId == ownerId
                   join item in _db.CartItems on cart.CartId equals item.CartId
                   select item.Quantity)
                .SumAsync(cancellationToken);

        public async Task AddBookAsync(int ownerId, int bookId, CancellationToken cancellationToken)
        {
            if (!await _db.Book.AnyAsync(b => b.BookId == bookId, cancellationToken))
            {
                throw new NotFoundException($"Book {bookId} does not exist.");
            }

            var cartId = await GetOrCreateCartIdAsync(ownerId, cancellationToken);
            await AddOrIncreaseAsync(cartId, bookId, 1, cancellationToken);
        }

        public async Task RemoveBookAsync(int ownerId, int bookId, CancellationToken cancellationToken)
        {
            var cartId = await FindCartIdAsync(ownerId, cancellationToken);
            if (cartId is null) return;

            await _db.CartItems.Where(i => i.CartId == cartId && i.ProductId == bookId).ExecuteDeleteAsync(cancellationToken);
        }

        public async Task DecreaseQuantityAsync(int ownerId, int bookId, CancellationToken cancellationToken)
        {
            var cartId = await FindCartIdAsync(ownerId, cancellationToken);
            if (cartId is null) return;

            // Delete first, then decrement: a row at 1 disappears, a row at 2 or more drops by one. Never a row at 0
            // (the database would refuse one).
            await _db.CartItems.Where(i => i.CartId == cartId && i.ProductId == bookId && i.Quantity <= 1).ExecuteDeleteAsync(cancellationToken);
            await _db.CartItems.Where(i => i.CartId == cartId && i.ProductId == bookId && i.Quantity > 1)
                .ExecuteUpdateAsync(set => set.SetProperty(i => i.Quantity, i => i.Quantity - 1), cancellationToken);
        }

        public async Task ClearAsync(int ownerId, CancellationToken cancellationToken)
        {
            var cartId = await FindCartIdAsync(ownerId, cancellationToken);
            if (cartId is null) return;

            await _db.CartItems.Where(i => i.CartId == cartId).ExecuteDeleteAsync(cancellationToken);
        }

        public Task MergeAsync(int fromOwnerId, int intoOwnerId, CancellationToken cancellationToken)
        {
            if (fromOwnerId == intoOwnerId) return Task.CompletedTask;

            // A hand-managed transaction must run inside the execution strategy (see OrderService); a retry starts clean.
            return _db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                _db.ChangeTracker.Clear();
                await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);

                var fromCartId = await FindCartIdAsync(fromOwnerId, cancellationToken);
                if (fromCartId is null) return;

                var moving = await _db.CartItems.AsNoTracking()
                    .Where(i => i.CartId == fromCartId)
                    .Select(i => new { i.ProductId, i.Quantity })
                    .ToListAsync(cancellationToken);

                if (moving.Count > 0)
                {
                    var intoCartId = await GetOrCreateCartIdAsync(intoOwnerId, cancellationToken);
                    foreach (var line in moving)
                    {
                        await AddOrIncreaseAsync(intoCartId, line.ProductId, line.Quantity, cancellationToken);
                    }
                }

                await _db.CartItems.Where(i => i.CartId == fromCartId).ExecuteDeleteAsync(cancellationToken);
                await _db.Cart.Where(c => c.CartId == fromCartId).ExecuteDeleteAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            });
        }

        Task<string?> FindCartIdAsync(int ownerId, CancellationToken cancellationToken) =>
            _db.Cart.AsNoTracking().Where(c => c.UserId == ownerId).Select(c => c.CartId).FirstOrDefaultAsync(cancellationToken);

        async Task<string> GetOrCreateCartIdAsync(int ownerId, CancellationToken cancellationToken)
        {
            var existing = await FindCartIdAsync(ownerId, cancellationToken);
            if (existing is not null) return existing;

            var cart = new Cart { CartId = Guid.NewGuid().ToString(), UserId = ownerId, DateCreated = _time.GetUtcNow().UtcDateTime };
            _db.Cart.Add(cart);
            try
            {
                await _db.SaveChangesAsync(cancellationToken);
                return cart.CartId;
            }
            catch (DbUpdateException ex) when (DatabaseErrors.IsUniqueViolation(ex))
            {
                // A parallel request created this owner's cart first (UX_Cart_UserID): use theirs.
                _db.Entry(cart).State = EntityState.Detached;
                var winner = await FindCartIdAsync(ownerId, cancellationToken);
                if (winner is null) throw;   // the other request's row is gone again: report the original error
                return winner;
            }
        }

        /// <summary>Adds <paramref name="quantity"/> copies to the cart's line for the book, creating the line if there is none.</summary>
        async Task AddOrIncreaseAsync(string cartId, int bookId, int quantity, CancellationToken cancellationToken)
        {
            if (await IncreaseAsync(cartId, bookId, quantity, cancellationToken) > 0) return;

            var line = new CartItems { CartId = cartId, ProductId = bookId, Quantity = quantity };
            _db.CartItems.Add(line);
            try
            {
                await _db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException ex) when (DatabaseErrors.IsUniqueViolation(ex))
            {
                // A parallel request created the line between our update and our insert: add to theirs.
                _db.Entry(line).State = EntityState.Detached;
                await IncreaseAsync(cartId, bookId, quantity, cancellationToken);
            }
            catch (DbUpdateException ex) when (DatabaseErrors.IsConstraintViolation(ex))
            {
                // The book was deleted a moment ago.
                _db.Entry(line).State = EntityState.Detached;
                throw new NotFoundException($"Book {bookId} does not exist.");
            }
        }

        Task<int> IncreaseAsync(string cartId, int bookId, int quantity, CancellationToken cancellationToken) =>
            _db.CartItems
                .Where(i => i.CartId == cartId && i.ProductId == bookId)
                .ExecuteUpdateAsync(set => set.SetProperty(i => i.Quantity, i => i.Quantity + quantity), cancellationToken);
    }
}
