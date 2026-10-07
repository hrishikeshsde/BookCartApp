using BookCart.Interfaces;
using BookCart.Models;
using BookCart.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace BookCart.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class UserController(IUserService userService, ICartService cartService, IPasswordService passwordService) : ControllerBase
    {
        readonly IUserService _userService = userService;
        readonly ICartService _cartService = cartService;
        readonly IPasswordService _passwordService = passwordService;

        /// <summary>
        /// Get the count of item in the shopping cart
        /// </summary>
        /// <param name="userId"></param>
        /// <returns>The count of items in shopping cart</returns>
        [AllowAnonymous]
        [RequireOwner]
        [HttpGet("{userId:int}")]
        public int Get(int userId)
        {
            int cartItemCount = _cartService.GetCartItemCount(userId);
            return cartItemCount;
        }

        /// <summary>
        /// Check the availability of the username
        /// </summary>
        /// <param name="userName"></param>
        /// <returns></returns>
        [AllowAnonymous]
        [EnableRateLimiting("lookup")]
        [HttpGet]
        [Route("validateUserName/{userName}")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
        public bool ValidateUserName(string userName)
        {
            return _userService.CheckUserNameAvailabity(userName);
        }

        /// <summary>
        /// Register a new user
        /// </summary>
        /// <param name="registrationData"></param>
        [AllowAnonymous]
        [EnableRateLimiting("auth")]
        [HttpPost]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status409Conflict)]
        [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
        public async Task<ActionResult> Post([FromBody] UserRegistration registrationData)
        {
            // [ApiController] has already rejected an invalid model with a 400 listing the invalid fields.
            UserMaster user = new()
            {
                FirstName = registrationData.FirstName,
                LastName = registrationData.LastName,
                Username = registrationData.Username,
                Gender = registrationData.Gender,
                UserTypeId = 2
            };
            user.PasswordHash = _passwordService.Hash(user, registrationData.Password);

            // Must be awaited: otherwise the request finishes (and disposes the DbContext) before the insert does.
            var created = await _userService.RegisterUser(user);

            return created ? Ok() : Conflict("That username is already taken.");
        }
    }
}
