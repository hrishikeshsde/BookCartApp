using BookCart.Interfaces;
using BookCart.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BookCart.Controllers
{
    [Authorize]
    [RequireOwner]
    [ApiController]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [Route("api/[controller]")]
    public class CheckOutController(IOrderService orderService, ICurrentUser currentUser) : ControllerBase
    {
        readonly IOrderService _orderService = orderService;
        readonly ICurrentUser _currentUser = currentUser;

        /// <summary>
        /// Place an order for everything in the signed-in user's shopping cart. The server prices the order from
        /// the database and empties the cart in the same transaction; any request body (prices, totals) is ignored.
        /// </summary>
        /// <param name="userId">Must be the caller's own user id. Admins cannot place orders for other users.</param>
        /// <returns>The new order id</returns>
        [HttpPost("{userId:int}")]
        public async Task<IActionResult> Post(int userId, CancellationToken cancellationToken)
        {
            if (_currentUser.UserId != userId)
            {
                return Forbid();
            }

            var orderId = await _orderService.CreateOrderAsync(userId, cancellationToken);
            return orderId is null
                ? Conflict("There is nothing to check out: the cart is empty, changed, or was already checked out.")
                : Ok(new { orderId });
        }
    }
}
