using BookCart.Dto;
using System.Collections.Generic;

namespace BookCart.Interfaces
{
    public interface IOrderService
    {
        /// <summary>Places an order for everything in the user's server-side cart, priced from the database.</summary>
        /// <returns>The order id, or null when there is nothing to check out.</returns>
        Task<string?> CreateOrderAsync(int userId, CancellationToken cancellationToken = default);
        List<OrdersDto> GetOrderList(int userId);
    }
}
