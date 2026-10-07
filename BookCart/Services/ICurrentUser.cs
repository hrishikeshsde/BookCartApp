using Microsoft.AspNetCore.DataProtection;
using BookCart.Models;
using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;

namespace BookCart.Services
{
    /// <summary>Who is making the current request: a signed-in user, an anonymous guest with a cart, or nobody.</summary>
    public interface ICurrentUser
    {
        /// <summary>The signed-in user's id, taken from the validated JWT (never from the URL).</summary>
        int? UserId { get; }

        /// <summary>The guest cart id from the server-issued, tamper-proof guest cookie.</summary>
        int? GuestId { get; }

        bool IsAuthenticated { get; }
        bool IsAdmin { get; }

        /// <summary>True when the caller may act on <paramref name="userId"/>'s data (their own user id or guest id, or an admin).</summary>
        bool Owns(int userId);
    }

    public static class GuestCart
    {
        public const string CookieName = "bc_guest";
        public const string ProtectorPurpose = "BookCart.GuestCart.v1";

        /// <summary>Guest ids live in a reserved range far above real (identity) user ids.</summary>
        public const int MinId = 1_000_000_000;

        public static bool IsGuestId(int id) => id >= MinId;
    }

    public class CurrentUser(IHttpContextAccessor accessor, IDataProtectionProvider dataProtection) : ICurrentUser
    {
        readonly IHttpContextAccessor _accessor = accessor;
        readonly IDataProtector _protector = dataProtection.CreateProtector(GuestCart.ProtectorPurpose);
        int? _guestId;
        bool _guestResolved;

        ClaimsPrincipal? Principal => _accessor.HttpContext?.User;

        public bool IsAuthenticated => Principal?.Identity?.IsAuthenticated == true;

        public bool IsAdmin => Principal?.IsInRole(UserRoles.Admin) == true;

        public int? UserId =>
            IsAuthenticated && int.TryParse(Principal!.FindFirstValue("userId"), NumberStyles.None, CultureInfo.InvariantCulture, out var id)
                ? id
                : null;

        public int? GuestId
        {
            get
            {
                if (_guestResolved) return _guestId;
                _guestResolved = true;

                var cookie = _accessor.HttpContext?.Request.Cookies[GuestCart.CookieName];
                if (string.IsNullOrEmpty(cookie)) return null;
                try
                {
                    var plain = _protector.Unprotect(cookie);
                    if (int.TryParse(plain, NumberStyles.None, CultureInfo.InvariantCulture, out var id) && GuestCart.IsGuestId(id))
                    {
                        _guestId = id;
                    }
                }
                catch (CryptographicException)
                {
                    // Forged, corrupted or expired cookie: treat as "no guest".
                }
                return _guestId;
            }
        }

        public bool Owns(int userId) => IsAdmin || UserId == userId || GuestId == userId;
    }
}
