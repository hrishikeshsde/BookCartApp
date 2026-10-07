using BookCart.Errors;
using BookCart.Models;
using BookCart.Options;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Microsoft.OpenApi;
using System.Threading.RateLimiting;

namespace BookCart.Extensions
{
    public static class ApiExtensions
    {
        public const string CatalogCachePolicy = "catalog";

        /// <summary>Controllers, error handling, API documentation, rate limits, caching, compression and health checks.</summary>
        public static IServiceCollection AddBookCartApi(this IServiceCollection services)
        {
            services.AddControllers();

            services.AddProblemDetails();
            services.AddExceptionHandler<ApiExceptionHandler>();

            services.AddOpenApi("v1", options =>
            {
                options.AddDocumentTransformer((document, _, _) =>
                {
                    document.Info = new OpenApiInfo
                    {
                        Title = "BookCart API",
                        Description = "An ASP.NET Core Web API for managing the book data",
                        Version = "v1",
                        Contact = new OpenApiContact { Name = "Hrishikesh", Url = new Uri("https://github.com/hrishikeshsde/") },
                        License = new OpenApiLicense
                        {
                            Name = "MIT License",
                            Url = new Uri("https://github.com/hrishikeshsde/BookCartApp/blob/master/LICENSE")
                        }
                    };
                    document.Components ??= new OpenApiComponents();
                    document.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();
                    document.Components.SecuritySchemes["Bearer"] = new OpenApiSecurityScheme
                    {
                        Type = SecuritySchemeType.Http,
                        Scheme = "bearer",
                        BearerFormat = "JWT",
                        Description = "The token returned by POST /api/login."
                    };
                    return Task.CompletedTask;
                });

                // Every endpoint requires a signed-in user unless it opts out with [AllowAnonymous] (fallback policy).
                options.AddOperationTransformer((operation, context, _) =>
                {
                    var anonymous = context.Description.ActionDescriptor.EndpointMetadata.OfType<IAllowAnonymous>().Any();
                    if (!anonymous)
                    {
                        operation.Security ??= [];
                        operation.Security.Add(new OpenApiSecurityRequirement
                        {
                            [new OpenApiSecuritySchemeReference("Bearer", context.Document)] = []
                        });
                    }
                    return Task.CompletedTask;
                });
            });

            // Limits are per client IP (behind a reverse proxy, configure forwarded headers so this is the caller's
            // address and not the proxy's). Read from the validated RateLimitingOptions when the limiter is built.
            services.AddRateLimiter(_ => { });
            services.AddOptions<RateLimiterOptions>().Configure<IOptions<RateLimitingOptions>, ILoggerFactory>((limiter, config, loggerFactory) =>
            {
                var logger = loggerFactory.CreateLogger("BookCart.RateLimiting");
                limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
                limiter.OnRejected = (context, _) =>
                {
                    if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                    {
                        context.HttpContext.Response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString();
                    }
                    logger.LogWarning("Rate limit hit by {Client} on {Path}", Client(context.HttpContext), context.HttpContext.Request.Path);
                    return ValueTask.CompletedTask;
                };

                // Login and registration: each attempt is expensive for an attacker to make useful and cheap to abuse.
                limiter.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(Client(context), _ => PerMinute(config.Value.AuthPermitLimit)));
                // The signup form checks the username while typing, so this one is more generous.
                limiter.AddPolicy("lookup", context => RateLimitPartition.GetFixedWindowLimiter(Client(context), _ => PerMinute(config.Value.LookupPermitLimit)));
            });

            // The book and category lists are public and change rarely; admin writes evict the "catalog" tag.
            services.AddOutputCache(options =>
                options.AddPolicy(CatalogCachePolicy, policy => policy.Expire(TimeSpan.FromMinutes(5)).Tag(CatalogCachePolicy)));

            services.AddResponseCompression();
            services.AddHealthChecks().AddDbContextCheck<BookDBContext>();
            return services;
        }

        static string Client(HttpContext context) => context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        static FixedWindowRateLimiterOptions PerMinute(int limit) => new() { PermitLimit = limit, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 };
    }
}
