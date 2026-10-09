using BookCart.Dto;
using BookCart.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace BookCart.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class LoginController(
        IUserService users,
        ITokenService tokens,
        ICartService cart,
        IGuestSession guestSession,
        ILogger<LoginController> logger) : ControllerBase
    {
        readonly IUserService _users = users;
        readonly ITokenService _tokens = tokens;
        readonly ICartService _cart = cart;
        readonly IGuestSession _guestSession = guestSession;
        readonly ILogger<LoginController> _logger = logger;

        /// <summary>
        /// Login to the application. Whatever the visitor put in their cart as a guest is merged into their own cart.
        /// </summary>
        /// <param name="login">The username and password.</param>
        /// <param name="cancellationToken">Cancelled when the caller disconnects.</param>
        /// <returns>A JWT and the signed-in user's details</returns>
        [AllowAnonymous]
        [EnableRateLimiting("auth")]
        [HttpPost]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
        public async Task<IActionResult> Login([FromBody] UserLogin login, CancellationToken cancellationToken)
        {
            var user = await _users.AuthenticateAsync(login, cancellationToken);
            if (user is null)
            {
                _logger.LogWarning("Failed login for username {Username}", login.Username);
                return Unauthorized();
            }

            _logger.LogInformation("User {UserId} ({Username}) logged in", user.UserId, user.Username);

            if (_guestSession.Current is { } guestId)
            {
                await _cart.MergeAsync(guestId, user.UserId, cancellationToken);
                _guestSession.End();
                _logger.LogInformation("Guest cart merged into the cart of user {UserId}", user.UserId);
            }

            return Ok(new { token = _tokens.CreateToken(user), userDetails = user });
        }
    }
}
