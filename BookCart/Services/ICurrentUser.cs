using BookCart.Models;
using Microsoft.AspNetCore.DataProtection;
using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;

namespace BookCart.Services
{
    /// <summary>Who is making the current request: a signed-in user, an anonymous guest with a cart, or nobody.</summary>
    public interface ICurrentUser
    {
        /// <summary>The signed-in user's id, taken from the validated JWT (never from the URL or the body).</summary>
        int? UserId { get; }

        /// <summary>The guest id from the server-issued, tamper-proof guest cookie.</summary>
        int? GuestId { get; }

        bool IsAuthenticated { get; }
        bool IsAdmin { get; }

        /// <summary>
        /// The id the caller's shopping cart is stored under: their user id, or else their guest id. Null for someone
        /// with neither, who has no cart yet.
        /// </summary>
        int? CartOwnerId { get; }
    }

    /// <summary>
    /// The anonymous "guest" session that lets a visitor fill a cart before logging in. It is a server-issued random id
    /// in an encrypted HttpOnly cookie: only the holder of the cookie can use the id, and the client cannot choose it.
    /// </summary>
    public interface IGuestSession
    {
        /// <summary>The guest id from a valid cookie on the request, or null (no cookie, or a forged or expired one).</summary>
        int? Current { get; }

        /// <summary>Returns the current guest id, or issues a new session (and its cookie) if there is none.</summary>
        int StartOrContinue();

        /// <summary>Removes the guest cookie, for example once the guest cart has been merged into a user's.</summary>
        void End();
    }

    public static class GuestCart
    {
        public const string CookieName = "bc_guest";
        public const string ProtectorPurpose = "BookCart.GuestCart.v1";

        /// <summary>Guest ids live in a reserved range far above real (identity) user ids.</summary>
        public const int MinId = 1_000_000_000;

        public static bool IsGuestId(int id) => id >= MinId;
    }

    public class GuestSession(IHttpContextAccessor accessor, IDataProtectionProvider dataProtection) : IGuestSession
    {
        readonly IHttpContextAccessor _accessor = accessor;
        readonly IDataProtector _protector = dataProtection.CreateProtector(GuestCart.ProtectorPurpose);
        int? _issuedThisRequest;
        bool _ended;

        HttpContext Http => _accessor.HttpContext ?? throw new InvalidOperationException("There is no current HTTP request.");

        public int? Current
        {
            get
            {
                if (_ended) return null;
                if (_issuedThisRequest is { } issued) return issued;

                var cookie = Http.Request.Cookies[GuestCart.CookieName];
                if (string.IsNullOrEmpty(cookie)) return null;
                try
                {
                    var plain = _protector.Unprotect(cookie);
                    return int.TryParse(plain, NumberStyles.None, CultureInfo.InvariantCulture, out var id) && GuestCart.IsGuestId(id) ? id : null;
                }
                catch (CryptographicException)
                {
                    // Forged, corrupted or expired cookie: treat as "no guest".
                    return null;
                }
            }
        }

        public int StartOrContinue()
        {
            if (Current is { } existing) return existing;

            var id = RandomNumberGenerator.GetInt32(GuestCart.MinId, int.MaxValue);
            Http.Response.Cookies.Append(GuestCart.CookieName, _protector.Protect(id.ToString(CultureInfo.InvariantCulture)), new CookieOptions
            {
                HttpOnly = true,
                Secure = Http.Request.IsHttps,
                SameSite = SameSiteMode.Lax,
                MaxAge = TimeSpan.FromDays(30),
                IsEssential = true
            });
            _issuedThisRequest = id;
            _ended = false;
            return id;
        }

        public void End()
        {
            Http.Response.Cookies.Delete(GuestCart.CookieName);
            _ended = true;
        }
    }

    public class CurrentUser(IHttpContextAccessor accessor, IGuestSession guest) : ICurrentUser
    {
        readonly IHttpContextAccessor _accessor = accessor;

        ClaimsPrincipal? Principal => _accessor.HttpContext?.User;

        public bool IsAuthenticated => Principal?.Identity?.IsAuthenticated == true;

        public bool IsAdmin => Principal?.IsInRole(UserRoles.Admin) == true;

        public int? UserId =>
            IsAuthenticated && int.TryParse(Principal!.FindFirstValue("userId"), NumberStyles.None, CultureInfo.InvariantCulture, out var id)
                ? id
                : null;

        public int? GuestId => guest.Current;

        public int? CartOwnerId => UserId ?? GuestId;
    }
}
