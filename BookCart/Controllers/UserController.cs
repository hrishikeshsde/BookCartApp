using BookCart.Models;
using BookCart.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace BookCart.Controllers
{
    [AllowAnonymous]
    [ApiController]
    [Route("api/[controller]")]
    public class UserController(IUserService users) : ControllerBase
    {
        readonly IUserService _users = users;

        /// <summary>
        /// Check the availability of the username
        /// </summary>
        /// <returns>True when the username is free</returns>
        [EnableRateLimiting("lookup")]
        [HttpGet("validateUserName/{userName}")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
        public Task<bool> ValidateUserName(string userName, CancellationToken cancellationToken) =>
            _users.IsUsernameAvailableAsync(userName, cancellationToken);

        /// <summary>
        /// Register a new user
        /// </summary>
        [EnableRateLimiting("auth")]
        [HttpPost]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status409Conflict)]
        [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
        public async Task<IActionResult> Post([FromBody] UserRegistration registrationData, CancellationToken cancellationToken)
        {
            // [ApiController] has already rejected an invalid model with a 400 listing the invalid fields.
            var created = await _users.RegisterAsync(registrationData, cancellationToken);
            return created ? Ok() : Conflict("That username is already taken.");
        }
    }
}
