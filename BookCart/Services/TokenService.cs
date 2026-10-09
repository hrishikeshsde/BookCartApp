using BookCart.Dto;
using BookCart.Options;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

namespace BookCart.Services
{
    public interface ITokenService
    {
        string CreateToken(AuthenticatedUser user);
    }

    public class TokenService(IOptions<JwtOptions> jwtOptions, TimeProvider timeProvider) : ITokenService
    {
        readonly JwtOptions _jwt = jwtOptions.Value;
        readonly TimeProvider _time = timeProvider;

        public string CreateToken(AuthenticatedUser user)
        {
            var credentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.SecretKey)), SecurityAlgorithms.HmacSha256);
            var now = _time.GetUtcNow().UtcDateTime;

            List<Claim> claims =
            [
                new(JwtRegisteredClaimNames.Name, user.Username),
                // "sub" is the user's id, as the standard says. It used to carry the role name, so clients must
                // read the role from the role claim instead.
                new(JwtRegisteredClaimNames.Sub, user.UserId.ToString()),
                new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
                new(JwtRegisteredClaimNames.Iat, EpochTime.GetIntDate(now).ToString(), ClaimValueTypes.Integer64),
                new(ClaimTypes.Role, user.UserTypeName),
                new("userId", user.UserId.ToString()),
            ];

            var token = new JwtSecurityToken(
                issuer: _jwt.Issuer,
                audience: _jwt.Audience,
                claims: claims,
                notBefore: now,
                expires: now.AddMinutes(_jwt.ExpiryMinutes),
                signingCredentials: credentials);

            return new JwtSecurityTokenHandler().WriteToken(token);
        }
    }
}
