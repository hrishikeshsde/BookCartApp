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

        /// <summary>Book summary requests allowed per client per minute (each uncached one costs a paid AI call).</summary>
        [Range(1, 100_000)]
        public int SummaryPermitLimit { get; init; } = 5;
    }

    /// <summary>The AI service behind book summaries. Optional: without an ApiKey the feature answers 503.</summary>
    public sealed class GeminiOptions
    {
        public const string Section = "Gemini";

        /// <summary>Set it with user-secrets or the Gemini__ApiKey environment variable, never in a file that is committed.</summary>
        public string ApiKey { get; init; } = "";

        public string Model { get; init; } = "gemini-2.0-flash";

        [Required, Url]
        public string BaseUrl { get; init; } = "https://generativelanguage.googleapis.com/";

        /// <summary>How long a generated summary is reused. Summaries of a book hardly change, and each one costs money.</summary>
        [Range(1, 365)]
        public int CacheDays { get; init; } = 7;

        [Range(1, 120)]
        public int TimeoutSeconds { get; init; } = 20;
    }

    public sealed class SecurityOptions
    {
        public const string Section = "Security";

        /// <summary>False: the Content-Security-Policy is sent report-only (violations are logged by the browser, nothing is blocked).</summary>
        public bool EnforceCsp { get; init; }
    }
}
