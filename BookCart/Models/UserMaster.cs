namespace BookCart.Models
{
    public partial class UserMaster
    {
        public int UserId { get; set; }
        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;
        public string Username { get; set; } = string.Empty;
        // Legacy plaintext column: only ever read to upgrade old rows, then nulled. New rows never set it.
        public string? Password { get; set; }
        public string? PasswordHash { get; set; }
        public string Gender { get; set; } = string.Empty;
        public int UserTypeId { get; set; }
    }
}
