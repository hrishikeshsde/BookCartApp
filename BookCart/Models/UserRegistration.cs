using System.ComponentModel.DataAnnotations;

namespace BookCart.Models
{
    public class UserRegistration
    {
        // Length limits match the UserMaster columns (varchar(20), varchar(20), varchar(20), varchar(6)): an
        // over-long value would otherwise be a database error (HTTP 500) instead of a clear 400.
        [Required]
        [StringLength(20)]
        public string FirstName { get; set; }

        [Required]
        [StringLength(20)]
        public string LastName { get; set; }

        [Required]
        [StringLength(20)]
        public string Username { get; set; }

        [Required]
        [StringLength(100, MinimumLength = 8)]
        [RegularExpression(@"^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9]).{8,}$")]
        public string Password { get; set; }

        [Required]
        [Compare("Password")]
        public string ConfirmPassword { get; set; }

        [Required]
        [StringLength(6)]
        [RegularExpression("^(Male|Female)$")]
        public string Gender { get; set; }

        public UserRegistration()
        {
            FirstName = string.Empty;
            LastName = string.Empty;
            Gender = string.Empty;
            Username = string.Empty;
            Password = string.Empty;
            ConfirmPassword = string.Empty;
        }
    }
}
