using BookCart.Dto;
using BookCart.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BookCart.Controllers
{
    /// <summary>The signed-in user's own wishlist. There is no user id in the URL: it comes from the token.</summary>
    [Authorize]
    [ApiController]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [Route("api/[controller]")]
    public class WishlistController(IWishlistService wishlist, ICurrentUser currentUser) : ControllerBase
    {
        readonly IWishlistService _wishlist = wishlist;
        readonly ICurrentUser _currentUser = currentUser;

        /// <summary>
        /// Get the books on the wishlist
        /// </summary>
        [HttpGet]
        public async Task<ActionResult<List<BookDto>>> Get(CancellationToken cancellationToken) =>
            _currentUser.UserId is { } userId ? await _wishlist.GetWishlistAsync(userId, cancellationToken) : Unauthorized();

        /// <summary>
        /// Toggle a book on the wishlist: added if it is not there, removed if it is.
        /// </summary>
        /// <returns>The updated wishlist</returns>
        [HttpPost("items/{bookId:int}")]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<ActionResult<List<BookDto>>> Toggle(int bookId, CancellationToken cancellationToken)
        {
            if (_currentUser.UserId is not { } userId) return Unauthorized();

            await _wishlist.ToggleAsync(userId, bookId, cancellationToken);
            return await _wishlist.GetWishlistAsync(userId, cancellationToken);
        }

        /// <summary>
        /// Empty the wishlist
        /// </summary>
        [HttpDelete]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        public async Task<IActionResult> Clear(CancellationToken cancellationToken)
        {
            if (_currentUser.UserId is not { } userId) return Unauthorized();

            await _wishlist.ClearAsync(userId, cancellationToken);
            return NoContent();
        }
    }
}
