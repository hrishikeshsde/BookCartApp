using System;

namespace BookCart.Models
{
    public partial class Wishlist
    {
        public string WishlistId { get; set; } = string.Empty;
        public int UserId { get; set; }
        public DateTime DateCreated { get; set; }
    }
}
