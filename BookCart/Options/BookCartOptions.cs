using System.ComponentModel.DataAnnotations;

namespace BookCart.Options
{
    // Strongly typed configuration. Each class is validated when the host starts (ValidateOnStart), so a missing or
    // malformed setting stops the app at startup with a clear message instead of failing on the first request.

    public sealed class JwtOptions
    {
        public const string Section = "Jwt";

        [Required, MinLength(32)]
        public string SecretKey { get; init; } = "";

        [Required]
        public string Issuer { get; init; } = "";

        [Required]
        public string Audience { get; init; } = "";

        /// <summary>How long a login stays valid. There is no refresh flow yet.</summary>
        [Range(1, 24 * 60)]
        public int ExpiryMinutes { get; init; } = 60;
    }

    /// <summary>Maps to the <c>ConnectionStrings</c> section, so <c>ConnectionStrings:DefaultConnection</c> is validated.</summary>
    public sealed class DatabaseOptions
    {
        public const string Section = "ConnectionStrings";

        [Required]
        public string DefaultConnection { get; init; } = "";
    }

    public sealed class StorageOptions
    {
        public const string Section = "Storage";

        /// <summary>The cover used for books without an uploaded image. It is never deleted.</summary>
        [Required]
        public string DefaultCoverImageFile { get; init; } = "";
    }

    public sealed class RateLimitingOptions
    {
        public const string Section = "RateLimiting";

        /// <summary>Login and registration attempts allowed per client per minute.</summary>
        [Range(1, 100_000)]
        public int AuthPermitLimit { get; init; } = 10;

        /// <summary>Signup username checks allowed per client per minute.</summary>
        [Range(1, 100_000)]
        public int LookupPermitLimit { get; init; } = 30;
    }

    public sealed class SecurityOptions
    {
        public const string Section = "Security";

        /// <summary>False: the Content-Security-Policy is sent report-only (violations are logged by the browser, nothing is blocked).</summary>
        public bool EnforceCsp { get; init; }
    }
}
