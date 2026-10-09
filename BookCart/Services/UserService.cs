using BookCart.Dto;
using BookCart.Models;
using Microsoft.EntityFrameworkCore;

namespace BookCart.Services
{
    public interface IUserService
    {
        /// <returns>The signed-in user's details, or null when the username or password is wrong.</returns>
        Task<AuthenticatedUser?> AuthenticateAsync(UserLogin credentials, CancellationToken cancellationToken);

        /// <summary>Creates a regular (non-admin) user with a hashed password.</summary>
        /// <returns>False when the username is already taken.</returns>
        Task<bool> RegisterAsync(UserRegistration registration, CancellationToken cancellationToken);

        Task<bool> IsUsernameAvailableAsync(string username, CancellationToken cancellationToken);
    }

    public class UserService(BookDBContext dbContext, IPasswordService passwordService) : IUserService
    {
        readonly BookDBContext _db = dbContext;
        readonly IPasswordService _passwords = passwordService;

        public async Task<AuthenticatedUser?> AuthenticateAsync(UserLogin credentials, CancellationToken cancellationToken)
        {
            var user = await _db.UserMaster.FirstOrDefaultAsync(u => u.Username == credentials.Username, cancellationToken);
            if (user is null || !_passwords.Verify(user, credentials.Password, out var needsRehash))
            {
                return null;
            }

            if (needsRehash)
            {
                // Upgrade a legacy plaintext row (or an outdated hash) and drop the plaintext.
                user.PasswordHash = _passwords.Hash(user, credentials.Password);
                user.Password = null;
                await _db.SaveChangesAsync(cancellationToken);
            }

            return new AuthenticatedUser
            {
                UserId = user.UserId,
                Username = user.Username,
                UserTypeName = UserTypeIds.RoleName(user.UserTypeId)
            };
        }

        public async Task<bool> RegisterAsync(UserRegistration registration, CancellationToken cancellationToken)
        {
            if (!await IsUsernameAvailableAsync(registration.Username, cancellationToken))
            {
                return false;
            }

            var user = new UserMaster
            {
                FirstName = registration.FirstName,
                LastName = registration.LastName,
                Username = registration.Username,
                Gender = registration.Gender,
                UserTypeId = UserTypeIds.User
            };
            user.PasswordHash = _passwords.Hash(user, registration.Password);

            _db.UserMaster.Add(user);
            try
            {
                await _db.SaveChangesAsync(cancellationToken);
                return true;
            }
            catch (DbUpdateException)
            {
                // Two signups for the same name can both pass the check above; the unique index decides who wins.
                _db.Entry(user).State = EntityState.Detached;
                if (!await IsUsernameAvailableAsync(registration.Username, cancellationToken)) return false;
                throw;
            }
        }

        public async Task<bool> IsUsernameAvailableAsync(string username, CancellationToken cancellationToken) =>
            !await _db.UserMaster.AsNoTracking().AnyAsync(u => u.Username == username, cancellationToken);
    }
}
