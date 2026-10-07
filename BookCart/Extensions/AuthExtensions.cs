using BookCart.Models;
using BookCart.Options;
using BookCart.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using System.Text;

namespace BookCart.Extensions
{
    public static class AuthExtensions
    {
        /// <summary>JWT authentication, authorization policies, password hashing and "who is calling" (user or guest).</summary>
        public static IServiceCollection AddBookCartAuth(this IServiceCollection services)
        {
            services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
            // Configured from the validated JwtOptions instead of reading raw configuration keys.
            services.ConfigureOptions<ConfigureJwtBearer>();

            services.AddAuthorization(options =>
            {
                // Secure by default: any endpoint without [Authorize] or [AllowAnonymous] requires a signed-in user.
                // Public endpoints must opt out explicitly with [AllowAnonymous].
                options.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
                options.AddPolicy(UserRoles.Admin, policy => policy.RequireAuthenticatedUser().RequireRole(UserRoles.Admin));
            });

            services.AddSingleton<IPasswordHasher<UserMaster>, PasswordHasher<UserMaster>>();
            services.AddSingleton<IPasswordService, PasswordService>();

            // The signed-in user (from the JWT) or an anonymous guest (from the tamper-proof guest cookie).
            services.AddHttpContextAccessor();
            services.AddDataProtection();
            services.AddScoped<ICurrentUser, CurrentUser>();
            return services;
        }

        sealed class ConfigureJwtBearer(IOptions<JwtOptions> jwt, IHostEnvironment environment) : IConfigureNamedOptions<JwtBearerOptions>
        {
            public void Configure(string? name, JwtBearerOptions options)
            {
                if (name != JwtBearerDefaults.AuthenticationScheme) return;

                options.RequireHttpsMetadata = !environment.IsDevelopment();
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    ValidIssuer = jwt.Value.Issuer,
                    ValidAudience = jwt.Value.Audience,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Value.SecretKey)),
                    ClockSkew = TimeSpan.Zero // Override the default clock skew of 5 mins
                };
            }

            public void Configure(JwtBearerOptions options) => Configure(JwtBearerDefaults.AuthenticationScheme, options);
        }
    }
}
