using BookCart.Dto;
using BookCart.Models;
using Microsoft.EntityFrameworkCore;

namespace BookCart.Services
{
    public interface IOrderService
    {
        /// <summary>Places an order for everything in the user's server-side cart, priced from the database.</summary>
        /// <returns>The order id, or null when there is nothing to check out.</returns>
        Task<string?> CreateOrderAsync(int userId, CancellationToken cancellationToken);

        /// <summary>The user's orders, newest first.</summary>
        Task<List<OrderDto>> GetOrdersAsync(int userId, CancellationToken cancellationToken);
    }

    public class OrderService(BookDBContext dbContext, TimeProvider timeProvider, ILogger<OrderService> logger) : IOrderService
    {
        readonly BookDBContext _db = dbContext;
        readonly TimeProvider _time = timeProvider;
        readonly ILogger<OrderService> _logger = logger;

        /// <summary>
        /// Turns the user's server-side cart into an order. Everything the client could tamper with (prices, totals,
        /// quantities) is read from the database here, and the cart is emptied in the same transaction, so an order
        /// is either fully placed with an empty cart or not placed at all.
        /// </summary>
        /// <returns>The new order id, or null when there is nothing to check out (empty cart, or the cart changed or
        /// was already checked out by a concurrent request).</returns>
        public Task<string?> CreateOrderAsync(int userId, CancellationToken cancellationToken)
        {
            // The context retries transient SQL failures, and EF only allows a hand-managed transaction when the whole
            // unit of work runs inside the execution strategy, so a retry re-runs it from the start. Entities tracked by
            // a failed attempt are dropped first, or the retry would insert them again.
            var strategy = _db.Database.CreateExecutionStrategy();
            return strategy.ExecuteAsync(async () =>
            {
                _db.ChangeTracker.Clear();
                return await PlaceOrderAsync(userId, cancellationToken);
            });
        }

        async Task<string?> PlaceOrderAsync(int userId, CancellationToken cancellationToken)
        {
            await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);

            var cartId = await _db.Cart
                .Where(c => c.UserId == userId)
                .Select(c => c.CartId)
                .FirstOrDefaultAsync(cancellationToken);
            if (cartId is null) return null;

            // Every cart row refers to a real book and has a positive quantity: the database refuses anything else, and
            // a book that is deleted leaves every cart. So one join gives the lines at the books' current prices.
            var lines = await (from item in _db.CartItems.AsNoTracking()
                               where item.CartId == cartId
                               join book in _db.Book.AsNoTracking() on item.ProductId equals book.BookId
                               select new { ProductId = book.BookId, item.Quantity, book.Price })
                .ToListAsync(cancellationToken);
            if (lines.Count == 0) return null;

            // Claim the cart first. A concurrent checkout of the same cart either already took these rows (we
            // delete fewer than we read) or is blocked until we commit, so the cart can only become one order.
            var claimed = await _db.CartItems
                .Where(i => i.CartId == cartId)
                .ExecuteDeleteAsync(cancellationToken);
            if (claimed != lines.Count) return null;

            var order = new CustomerOrders
            {
                OrderId = Guid.NewGuid().ToString("N")[..20],
                UserId = userId,
                DateCreated = _time.GetUtcNow().UtcDateTime,
                CartTotal = lines.Sum(l => l.Price * l.Quantity)
            };
            _db.CustomerOrders.Add(order);
            _db.CustomerOrderDetails.AddRange(lines.Select(l => new CustomerOrderDetails
            {
                OrderId = order.OrderId,
                ProductId = l.ProductId,
                Quantity = l.Quantity,
                Price = l.Price
            }));
            await _db.SaveChangesAsync(cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            _logger.LogInformation("Order {OrderId} placed by user {UserId}: {LineCount} lines, total {CartTotal}",
                order.OrderId, userId, lines.Count, order.CartTotal);
            return order.OrderId;
        }

        public async Task<List<OrderDto>> GetOrdersAsync(int userId, CancellationToken cancellationToken)
        {
            var orders = await _db.CustomerOrders.AsNoTracking()
                .Where(o => o.UserId == userId)
                .OrderByDescending(o => o.DateCreated)
                .ToListAsync(cancellationToken);
            if (orders.Count == 0) return [];

            var orderIds = orders.Select(o => o.OrderId).ToList();

            // One query for every line of every order. A book deleted since the order was placed still shows (with
            // the price paid), so the lines always add up to the order total.
            var lines = await (from detail in _db.CustomerOrderDetails.AsNoTracking()
                               where orderIds.Contains(detail.OrderId)
                               join book in _db.Book.AsNoTracking() on detail.ProductId equals book.BookId into books
                               from book in books.DefaultIfEmpty()
                               orderby detail.OrderDetailsId
                               select new { detail.OrderId, detail.ProductId, detail.Quantity, detail.Price, Book = book })
                .ToListAsync(cancellationToken);

            var linesByOrder = lines.ToLookup(l => l.OrderId);
            return orders.Select(o => new OrderDto(
                    o.OrderId,
                    // Stored as UTC but read back without a kind; say so, or the JSON has no "Z" and a browser shows it as local time.
                    DateTime.SpecifyKind(o.DateCreated, DateTimeKind.Utc),
                    o.CartTotal,
                    linesByOrder[o.OrderId]
                        .Select(l => new CartItemDto(
                            new BookDto(l.ProductId, l.Book?.Title ?? "(book no longer available)", l.Book?.Author ?? "", l.Book?.Category ?? "", l.Price, l.Book?.CoverFileName),
                            l.Quantity))
                        .ToList()))
                .ToList();
        }
    }
}
