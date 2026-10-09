using BookCart.Dto;
using BookCart.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BookCart.Controllers
{
    [Authorize]
    [ApiController]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [Route("api/[controller]")]
    public class OrderController(IOrderService orders, ICurrentUser currentUser) : ControllerBase
    {
        readonly IOrderService _orders = orders;
        readonly ICurrentUser _currentUser = currentUser;

        /// <summary>
        /// Get the signed-in user's own orders, newest first. There is no user id in the URL: it comes from the token.
        /// </summary>
        [HttpGet]
        public async Task<ActionResult<List<OrderDto>>> Get(CancellationToken cancellationToken) =>
            _currentUser.UserId is { } userId ? await _orders.GetOrdersAsync(userId, cancellationToken) : Unauthorized();
    }
}
