using BookCart.Models;
using Microsoft.AspNetCore.Identity;
using System.Security.Cryptography;
using System.Text;

namespace BookCart.Services
{
    public class PasswordService(IPasswordHasher<UserMaster> hasher) : IPasswordService
    {
        readonly IPasswordHasher<UserMaster> _hasher = hasher;

        public string Hash(UserMaster user, string plainPassword) => _hasher.HashPassword(user, plainPassword);

        public bool Verify(UserMaster user, string plainPassword, out bool needsRehash)
        {
            needsRehash = false;

            if (user.PasswordHash is not null)
            {
                var result = _hasher.VerifyHashedPassword(user, user.PasswordHash, plainPassword);
                needsRehash = result == PasswordVerificationResult.SuccessRehashNeeded;
                return result != PasswordVerificationResult.Failed;
            }

            // Legacy plaintext row: accept once; the caller upgrades it to a hash.
            if (user.Password is not null && CryptographicOperations.FixedTimeEquals(
                    Encoding.UTF8.GetBytes(user.Password), Encoding.UTF8.GetBytes(plainPassword)))
            {
                needsRehash = true;
                return true;
            }

            return false;
        }
    }
}
