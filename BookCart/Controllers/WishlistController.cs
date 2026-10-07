using BookCart.Interfaces;
using BookCart.Models;
using BookCart.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BookCart.Controllers
{
    [RequireOwner]
    [ApiController]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [Route("api/[controller]")]
    public class WishlistController(IWishlistService wishlistService, IBookService bookService, IUserService userService) : ControllerBase
    {
        readonly IWishlistService _wishlistService = wishlistService;
        readonly IBookService _bookService = bookService;
        readonly IUserService _userService = userService;

        /// <summary>
        /// Get the list of items in the Wishlist
        /// </summary>
        /// <param name="userId"></param>
        /// <returns>All the items in the Wishlist</returns>
        [HttpGet("{userId:int}")]
        public async Task<List<Book>> Get(int userId)
        {
            return await GetUserWishlist(userId);
        }

        /// <summary>
        /// Toggle the items in Wishlist. If item doesn't exists, it will be added to the Wishlist else it will be removed.
        /// </summary>
        /// <param name="userId"></param>
        /// <param name="bookId"></param>
        /// <returns>All the items in the Wishlist</returns>
        [Authorize]
        [HttpPost]
        [Route("ToggleWishlist/{userId:int}/{bookId:int}")]
        public async Task<List<Book>> Post(int userId, int bookId)
        {
            _wishlistService.ToggleWishlistItem(userId, bookId);
            return await GetUserWishlist(userId);
        }

        /// <summary>
        /// Clear the Wishlist
        /// </summary>
        /// <param name="userId"></param>
        /// <returns></returns>
        [Authorize]
        [HttpDelete("{userId:int}")]
        public int Delete(int userId)
        {
            return _wishlistService.ClearWishlist(userId);
        }

        async Task<List<Book>> GetUserWishlist(int userId)
        {
            bool user = await _userService.isUserExists(userId);
            if (user)
            {
                string Wishlistid = _wishlistService.GetWishlistId(userId);
                return _bookService.GetBooksAvailableInWishlist(Wishlistid);
            }
            else
            {
                return new List<Book>();
            }

        }
    }
}
