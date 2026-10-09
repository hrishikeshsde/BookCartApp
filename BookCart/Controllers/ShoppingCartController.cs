using BookCart.Dto;
using BookCart.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BookCart.Controllers
{
    /// <summary>
    /// The caller's own shopping cart. There is no user id in the URL: the cart is the signed-in user's, or else the
    /// anonymous guest's (the first book added starts the guest session). Logging in merges the guest cart into the user's.
    /// </summary>
    [AllowAnonymous]
    [ApiController]
    [Route("api/[controller]")]
    public class ShoppingCartController(ICartService cart, ICurrentUser currentUser, IGuestSession guestSession) : ControllerBase
    {
        readonly ICartService _cart = cart;
        readonly ICurrentUser _currentUser = currentUser;
        readonly IGuestSession _guestSession = guestSession;

        /// <summary>
        /// Get the items in the caller's shopping cart (empty for someone who has not added anything yet)
        /// </summary>
        [HttpGet]
        public Task<List<CartItemDto>> Get(CancellationToken cancellationToken) => CurrentCartAsync(cancellationToken);

        /// <summary>
        /// Get the number of items (counting quantities) in the caller's shopping cart
        /// </summary>
        [HttpGet("count")]
        public async Task<int> Count(CancellationToken cancellationToken) =>
            _currentUser.CartOwnerId is { } owner ? await _cart.GetItemCountAsync(owner, cancellationToken) : 0;

        /// <summary>
        /// Add one copy of a book. If the book is already in the cart, its quantity goes up by one.
        /// </summary>
        /// <returns>The updated cart</returns>
        [HttpPost("items/{bookId:int}")]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<List<CartItemDto>> AddBook(int bookId, CancellationToken cancellationToken)
        {
            // Someone with neither an account nor a guest session gets a guest session now.
            var owner = _currentUser.CartOwnerId ?? _guestSession.StartOrContinue();
            await _cart.AddBookAsync(owner, bookId, cancellationToken);
            return await _cart.GetCartAsync(owner, cancellationToken);
        }

        /// <summary>
        /// Take one copy of a book out of the cart. The last copy removes the book.
        /// </summary>
        /// <returns>The updated cart</returns>
        [HttpPatch("items/{bookId:int}")]
        public async Task<List<CartItemDto>> DecreaseQuantity(int bookId, CancellationToken cancellationToken)
        {
            if (_currentUser.CartOwnerId is { } owner) await _cart.DecreaseQuantityAsync(owner, bookId, cancellationToken);
            return await CurrentCartAsync(cancellationToken);
        }

        /// <summary>
        /// Remove a book from the cart whatever its quantity
        /// </summary>
        /// <returns>The updated cart</returns>
        [HttpDelete("items/{bookId:int}")]
        public async Task<List<CartItemDto>> RemoveBook(int bookId, CancellationToken cancellationToken)
        {
            if (_currentUser.CartOwnerId is { } owner) await _cart.RemoveBookAsync(owner, bookId, cancellationToken);
            return await CurrentCartAsync(cancellationToken);
        }

        /// <summary>
        /// Empty the cart
        /// </summary>
        [HttpDelete]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        public async Task<IActionResult> Clear(CancellationToken cancellationToken)
        {
            if (_currentUser.CartOwnerId is { } owner) await _cart.ClearAsync(owner, cancellationToken);
            return NoContent();
        }

        async Task<List<CartItemDto>> CurrentCartAsync(CancellationToken cancellationToken) =>
            _currentUser.CartOwnerId is { } owner ? await _cart.GetCartAsync(owner, cancellationToken) : [];
    }
}
