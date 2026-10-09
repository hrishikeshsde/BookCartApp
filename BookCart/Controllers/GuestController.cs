using BookCart.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BookCart.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class GuestController(IGuestSession guestSession) : ControllerBase
    {
        readonly IGuestSession _guestSession = guestSession;

        /// <summary>
        /// Start (or continue) an anonymous guest session for a shopping cart. The server picks an unguessable id and
        /// remembers it in a tamper-proof HttpOnly cookie. Clients rarely need this: adding the first book to the cart
        /// starts the session by itself. Calling it again with a valid cookie returns the same id.
        /// </summary>
        /// <returns>The guest id</returns>
        [AllowAnonymous]
        [HttpPost]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public IActionResult Create() => Ok(new { guestId = _guestSession.StartOrContinue() });
    }
}
