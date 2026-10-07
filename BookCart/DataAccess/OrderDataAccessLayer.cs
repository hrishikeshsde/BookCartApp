using BookCart.Dto;
using BookCart.Interfaces;
using BookCart.Models;
using Microsoft.EntityFrameworkCore;

namespace BookCart.DataAccess
{
    public class OrderDataAccessLayer(BookDBContext dbContext, ILogger<OrderDataAccessLayer> logger) : IOrderService
    {
        readonly BookDBContext _dbContext = dbContext;
        readonly ILogger<OrderDataAccessLayer> _logger = logger;

        /// <summary>
        /// Turns the user's server-side cart into an order. Everything the client could tamper with (prices, totals,
        /// quantities) is read from the database here, and the cart is emptied in the same transaction, so an order
        /// is either fully placed with an empty cart or not placed at all.
        /// </summary>
        /// <returns>The new order id, or null when there is nothing to check out (empty cart, or the cart changed or
        /// was already checked out by a concurrent request).</returns>
        public Task<string?> CreateOrderAsync(int userId, CancellationToken cancellationToken = default)
        {
            // The context retries transient SQL failures, and EF only allows a hand-managed transaction when the whole
            // unit of work runs inside the execution strategy, so a retry re-runs it from the start. Entities tracked by
            // a failed attempt are dropped first, or the retry would insert them again.
            var strategy = _dbContext.Database.CreateExecutionStrategy();
            return strategy.ExecuteAsync(async () =>
            {
                _dbContext.ChangeTracker.Clear();
                return await PlaceOrderAsync(userId, cancellationToken);
            });
        }

        async Task<string?> PlaceOrderAsync(int userId, CancellationToken cancellationToken)
        {
            await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

            var cartId = await _dbContext.Cart
                .Where(c => c.UserId == userId)
                .Select(c => c.CartId)
                .FirstOrDefaultAsync(cancellationToken);
            if (cartId is null) return null;

            var cartItems = await _dbContext.CartItems.AsNoTracking()
                .Where(i => i.CartId == cartId)
                .ToListAsync(cancellationToken);
            if (cartItems.Count == 0) return null;

            var productIds = cartItems.Select(i => i.ProductId).Distinct().ToList();
            var prices = await _dbContext.Book.AsNoTracking()
                .Where(b => productIds.Contains(b.BookId))
                .ToDictionaryAsync(b => b.BookId, b => b.Price, cancellationToken);

            // Rows for deleted books or with a non-positive quantity cannot be bought. Duplicate rows for the
            // same book (nothing prevents them in the schema yet) are combined into one line.
            var lines = cartItems
                .Where(i => i.Quantity > 0 && prices.ContainsKey(i.ProductId))
                .GroupBy(i => i.ProductId)
                .Select(g => (ProductId: g.Key, Quantity: g.Sum(i => i.Quantity), Price: prices[g.Key]))
                .ToList();
            if (lines.Count == 0) return null;

            // Claim the cart first. A concurrent checkout of the same cart either already took these rows (we
            // delete fewer than we read) or is blocked until we commit, so the cart can only become one order.
            var claimed = await _dbContext.CartItems
                .Where(i => i.CartId == cartId)
                .ExecuteDeleteAsync(cancellationToken);
            if (claimed != cartItems.Count) return null;

            var order = new CustomerOrders
            {
                OrderId = Guid.NewGuid().ToString("N")[..20],
                UserId = userId,
                DateCreated = DateTime.UtcNow,
                CartTotal = lines.Sum(l => l.Price * l.Quantity)
            };
            _dbContext.CustomerOrders.Add(order);
            _dbContext.CustomerOrderDetails.AddRange(lines.Select(l => new CustomerOrderDetails
            {
                OrderId = order.OrderId,
                ProductId = l.ProductId,
                Quantity = l.Quantity,
                Price = l.Price
            }));
            await _dbContext.SaveChangesAsync(cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            _logger.LogInformation("Order {OrderId} placed by user {UserId}: {LineCount} lines, total {CartTotal}",
                order.OrderId, userId, lines.Count, order.CartTotal);
            return order.OrderId;
        }

        public List<OrdersDto> GetOrderList(int userId)
        {
            List<OrdersDto> userOrders = new();
            List<string> userOrderId = new();

            userOrderId = _dbContext.CustomerOrders.Where(x => x.UserId == userId)
                .Select(x => x.OrderId).ToList();

            foreach (string orderid in userOrderId)
            {
                var customerOrder = _dbContext.CustomerOrders.FirstOrDefault(x => x.OrderId == orderid);
                if (customerOrder == null) continue;

                OrdersDto order = new()
                {
                    OrderId = orderid,
                    CartTotal = customerOrder.CartTotal,
                    OrderDate = customerOrder.DateCreated,
                    OrderDetails = []
                };

                List<CustomerOrderDetails> orderDetail = _dbContext.CustomerOrderDetails.Where(x => x.OrderId == orderid).ToList();

                foreach (CustomerOrderDetails customerOrderDetail in orderDetail)
                {
                    var book = _dbContext.Book.FirstOrDefault(x => x.BookId == customerOrderDetail.ProductId && customerOrderDetail.OrderId == orderid);
                    if (book == null) continue;

                    CartItemDto item = new()
                    {
                        Book = new Book
                        {
                            BookId = customerOrderDetail.ProductId,
                            Title = book.Title,
                            Price = customerOrderDetail.Price
                        },
                        Quantity = customerOrderDetail.Quantity
                    };

                    order.OrderDetails.Add(item);
                }
                userOrders.Add(order);
            }
            return userOrders.OrderByDescending(x => x.OrderDate).ToList();
        }
    }
}
