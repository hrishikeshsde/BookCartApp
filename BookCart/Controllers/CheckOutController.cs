using BookCart.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BookCart.Controllers
{
    [Authorize]
    [ApiController]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [Route("api/[controller]")]
    public class CheckOutController(IOrderService orders, ICurrentUser currentUser) : ControllerBase
    {
        readonly IOrderService _orders = orders;
        readonly ICurrentUser _currentUser = currentUser;

        /// <summary>
        /// Place an order for everything in the signed-in user's shopping cart. The server prices the order from the
        /// database and empties the cart in the same transaction; any request body (prices, totals) is ignored.
        /// </summary>
        /// <returns>The new order id</returns>
        [HttpPost]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status409Conflict)]
        public async Task<IActionResult> Post(CancellationToken cancellationToken)
        {
            if (_currentUser.UserId is not { } userId) return Unauthorized();

            var orderId = await _orders.CreateOrderAsync(userId, cancellationToken);
            return orderId is null
                ? Conflict("There is nothing to check out: the cart is empty, changed, or was already checked out.")
                : Ok(new { orderId });
        }
    }
}
