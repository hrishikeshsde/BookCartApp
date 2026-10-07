using BookCart.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using System.Security.Cryptography;

namespace BookCart.Controllers
{
    [Route("api/[controller]")]
    public class GuestController(ICurrentUser currentUser, IDataProtectionProvider dataProtection) : ControllerBase
    {
        readonly ICurrentUser _currentUser = currentUser;
        readonly IDataProtector _protector = dataProtection.CreateProtector(GuestCart.ProtectorPurpose);

        /// <summary>
        /// Get (or start) an anonymous guest session for a shopping cart. The server picks an unguessable id and
        /// remembers it in a tamper-proof HttpOnly cookie; only the holder of that cookie can use the id.
        /// Calling it again with a valid cookie returns the same id.
        /// </summary>
        /// <returns>The guest id to use as the <c>userId</c> of cart endpoints</returns>
        [AllowAnonymous]
        [HttpPost]
        public IActionResult Create()
        {
            var guestId = _currentUser.GuestId;
            if (guestId is null)
            {
                guestId = RandomNumberGenerator.GetInt32(GuestCart.MinId, int.MaxValue);
                Response.Cookies.Append(GuestCart.CookieName, _protector.Protect(guestId.Value.ToString()), new CookieOptions
                {
                    HttpOnly = true,
                    Secure = Request.IsHttps,
                    SameSite = SameSiteMode.Lax,
                    MaxAge = TimeSpan.FromDays(30),
                    IsEssential = true
                });
            }
            return Ok(new { guestId });
        }
    }
}
