using BookCart.Dto;
using BookCart.Interfaces;
using BookCart.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BookCart.Controllers
{
    // Carts are usable by signed-in users and by anonymous guests (see GuestController). [AllowAnonymous] is applied
    // per action, because on the class it would also override [Authorize] on SetShoppingCart. [RequireOwner] makes
    // every {userId} route accept only the caller's own user id or guest id.
    [RequireOwner]
    [ApiController]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [Route("api/[controller]")]
    public class ShoppingCartController(ICartService cartService, IBookService bookService, ICurrentUser currentUser) : ControllerBase
    {
        readonly ICartService _cartService = cartService;
        readonly IBookService _bookService = bookService;
        readonly ICurrentUser _currentUser = currentUser;

        /// <summary>
        /// Merge the caller's guest cart into their own cart after login.
        /// </summary>
        /// <param name="oldUserId">The caller's guest id (from the guest cookie)</param>
        /// <param name="newUserId">The caller's own user id</param>
        /// <returns>The count of items in shopping cart</returns>
        [Authorize]
        [HttpGet]
        [Route("SetShoppingCart/{oldUserId:int}/{newUserId:int}")]
        public IActionResult Get(int oldUserId, int newUserId)
        {
            // Only the signed-in user's own cart can be the target, and only their own guest cart the source.
            // Never another user's cart, and admins get no exception: merging deletes the source cart.
            if (_currentUser.UserId != newUserId || _currentUser.GuestId != oldUserId)
            {
                return Forbid();
            }

            _cartService.MergeCart(oldUserId, newUserId);
            return Ok(_cartService.GetCartItemCount(newUserId));
        }

        /// <summary>
        /// Get the list of items in the shopping cart
        /// </summary>
        /// <param name="userId"></param>
        /// <returns></returns>
        [AllowAnonymous]
        [HttpGet("{userId:int}")]
        public async Task<List<CartItemDto>> Get(int userId)
        {
            string cartid = _cartService.GetCartId(userId);
            return await Task.FromResult(_bookService.GetBooksAvailableInCart(cartid)).ConfigureAwait(true);
        }

        /// <summary>
        /// Add a single item into the shopping cart. If the item already exists, increase the quantity by one
        /// </summary>
        /// <param name="userId"></param>
        /// <param name="bookId"></param>
        /// <returns></returns>
        [AllowAnonymous]
        [HttpPost]
        [Route("AddToCart/{userId:int}/{bookId:int}")]
        public async Task<List<CartItemDto>> Post(int userId, int bookId)
        {
            _cartService.AddBookToCart(userId, bookId);
            return await Get(userId);
        }

        /// <summary>
        /// Reduces the quantity by one for an item in shopping cart
        /// </summary>
        /// <param name="userId"></param>
        /// <param name="bookId"></param>
        /// <returns></returns>
        [AllowAnonymous]
        [HttpPut("{userId:int}/{bookId:int}")]
        public async Task<List<CartItemDto>> Put(int userId, int bookId)
        {
            _cartService.DeleteOneCartItem(userId, bookId);
            return await Get(userId);
        }

        /// <summary>
        /// Delete a single item from the cart 
        /// </summary>
        /// <param name="userId"></param>
        /// <param name="bookId"></param>
        /// <returns></returns>
        [AllowAnonymous]
        [HttpDelete("{userId:int}/{bookId:int}")]
        public async Task<List<CartItemDto>> Delete(int userId, int bookId)
        {
            _cartService.RemoveCartItem(userId, bookId);
            return await Get(userId);
        }

        /// <summary>
        /// Clear the shopping cart
        /// </summary>
        /// <param name="userId"></param>
        /// <returns></returns>
        [AllowAnonymous]
        [HttpDelete("{userId:int}")]
        public int Delete(int userId)
        {
            return _cartService.ClearCart(userId);
        }
    }
}
