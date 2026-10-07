using BookCart.Dto;
using BookCart.Interfaces;
using BookCart.Models;
using BookCart.Services;
using Microsoft.EntityFrameworkCore;

namespace BookCart.DataAccess
{
    public class UserDataAccessLayer(BookDBContext dbContext, IPasswordService passwordService) : IUserService
    {
        readonly BookDBContext _dbContext = dbContext;
        readonly IPasswordService _passwordService = passwordService;

        public AuthenticatedUser AuthenticateUser(UserLogin loginCredentials)
        {
            AuthenticatedUser authenticatedUser = new();

            var userDetails = _dbContext.UserMaster.FirstOrDefault(u => u.Username == loginCredentials.Username);

            if (userDetails != null && _passwordService.Verify(userDetails, loginCredentials.Password, out bool needsRehash))
            {
                if (needsRehash)
                {
                    // Upgrade a legacy plaintext row (or an outdated hash) and drop the plaintext.
                    userDetails.PasswordHash = _passwordService.Hash(userDetails, loginCredentials.Password);
                    userDetails.Password = null;
                    _dbContext.SaveChanges();
                }

                authenticatedUser = new AuthenticatedUser
                {
                    Username = userDetails.Username,
                    UserId = userDetails.UserId,
                    UserTypeName = userDetails.UserTypeId == 1 ? "Admin" : "User"
                };
            }
            return authenticatedUser;
        }

        public async Task<bool> RegisterUser(UserMaster userData)
        {
            bool isUserNameAvailable = CheckUserNameAvailabity(userData.Username);
            try
            {
                if (isUserNameAvailable)
                {
                    await _dbContext.UserMaster.AddAsync(userData);
                    await _dbContext.SaveChangesAsync();
                    return true;
                }
                else
                {
                    return false;
                }
            }
            catch
            {
                throw;
            }
        }

        public bool CheckUserNameAvailabity(string userName)
        {
            UserMaster user = _dbContext.UserMaster.FirstOrDefault(x => x.Username == userName);

            return user == null;
        }

        public async Task<bool> isUserExists(int userId)
        {
            UserMaster user = await _dbContext.UserMaster.FirstOrDefaultAsync(x => x.UserId == userId);

            return user != null;
        }
    }
}
