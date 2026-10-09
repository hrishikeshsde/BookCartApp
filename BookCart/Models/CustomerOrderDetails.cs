namespace BookCart.Models
{
    public partial class CustomerOrderDetails
    {
        public int OrderDetailsId { get; set; }
        public string OrderId { get; set; } = string.Empty;
        public int ProductId { get; set; }
        public int Quantity { get; set; }
        public decimal Price { get; set; }
    }
}
