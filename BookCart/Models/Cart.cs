using System;

namespace BookCart.Models
{
    public partial class Cart
    {
        public string CartId { get; set; } = string.Empty;
        public int UserId { get; set; }
        public DateTime DateCreated { get; set; }
    }
}
