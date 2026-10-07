using BookCart.Models;

namespace BookCart.Services
{
    public interface IPasswordService
    {
        string Hash(UserMaster user, string plainPassword);

        /// <summary>
        /// Verifies a password. Rows that still hold a legacy plaintext password are accepted once and flagged
        /// through <paramref name="needsRehash"/> so the caller can upgrade them.
        /// </summary>
        bool Verify(UserMaster user, string plainPassword, out bool needsRehash);
    }
}
