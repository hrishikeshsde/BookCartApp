using BookCart.Dto;
using BookCart.Interfaces;
using BookCart.Options;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

namespace BookCart.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class LoginController(IOptions<JwtOptions> jwtOptions, IUserService userService, ILogger<LoginController> logger) : ControllerBase
    {
        readonly JwtOptions _jwt = jwtOptions.Value;
        readonly IUserService _userService = userService;
        readonly ILogger<LoginController> _logger = logger;

        /// <summary>
        /// Login to the application
        /// </summary>
        /// <param name="login"></param>
        /// <returns>A JWT and the signed-in user's details</returns>
        [AllowAnonymous]
        [EnableRateLimiting("auth")]
        [HttpPost]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
        public IActionResult Login([FromBody] UserLogin login)
        {
            AuthenticatedUser authenticatedUser = _userService.AuthenticateUser(login);

            if (string.IsNullOrEmpty(authenticatedUser.Username))
            {
                _logger.LogWarning("Failed login for username {Username}", login.Username);
                return Unauthorized();
            }

            _logger.LogInformation("User {UserId} ({Username}) logged in", authenticatedUser.UserId, authenticatedUser.Username);
            return Ok(new
            {
                token = GenerateJSONWebToken(authenticatedUser),
                userDetails = authenticatedUser,
            });
        }

        string GenerateJSONWebToken(AuthenticatedUser userInfo)
        {
            var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.SecretKey));
            var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);

            var now = DateTime.UtcNow;

            List<Claim> userClaims = new()
            {
                new Claim(JwtRegisteredClaimNames.Name, userInfo.Username),
                // "sub" is the user's id, as the standard says. It used to carry the role name, so clients must
                // read the role from the role claim instead.
                new Claim(JwtRegisteredClaimNames.Sub, userInfo.UserId.ToString()),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
                new Claim(JwtRegisteredClaimNames.Iat, EpochTime.GetIntDate(now).ToString(), ClaimValueTypes.Integer64),
                new Claim(ClaimTypes.Role,userInfo.UserTypeName),
                new Claim("userId", userInfo.UserId.ToString()),
            };

            var token = new JwtSecurityToken(
                issuer: _jwt.Issuer,
                audience: _jwt.Audience,
                claims: userClaims,
                notBefore: now,
                expires: now.AddMinutes(_jwt.ExpiryMinutes),
                signingCredentials: credentials
            );

            return new JwtSecurityTokenHandler().WriteToken(token);
        }
    }
}
