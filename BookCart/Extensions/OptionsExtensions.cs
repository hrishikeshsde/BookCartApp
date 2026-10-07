using BookCart.Options;

namespace BookCart.Extensions
{
    public static class OptionsExtensions
    {
        /// <summary>Binds the configuration sections to typed options and validates them when the host starts.</summary>
        public static IServiceCollection AddBookCartOptions(this IServiceCollection services)
        {
            services.AddOptions<JwtOptions>().BindConfiguration(JwtOptions.Section).ValidateDataAnnotations().ValidateOnStart();
            services.AddOptions<DatabaseOptions>().BindConfiguration(DatabaseOptions.Section).ValidateDataAnnotations().ValidateOnStart();
            services.AddOptions<StorageOptions>().BindConfiguration(StorageOptions.Section).ValidateDataAnnotations().ValidateOnStart();
            services.AddOptions<RateLimitingOptions>().BindConfiguration(RateLimitingOptions.Section).ValidateDataAnnotations().ValidateOnStart();
            services.AddOptions<SecurityOptions>().BindConfiguration(SecurityOptions.Section).ValidateOnStart();
            return services;
        }
    }
}
