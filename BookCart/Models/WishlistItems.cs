namespace BookCart.Models
{
    public partial class WishlistItems
    {
        public int WishlistItemId { get; set; }
        public string WishlistId { get; set; } = string.Empty;
        public int ProductId { get; set; }
    }
}
