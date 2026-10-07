using BookCart.DataAccess;
using BookCart.Interfaces;
using BookCart.Models;
using BookCart.Options;
using BookCart.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace BookCart.Extensions
{
    public static class PersistenceExtensions
    {
        /// <summary>The database context and everything that works with it or with files on disk.</summary>
        public static IServiceCollection AddBookCartPersistence(this IServiceCollection services)
        {
            // Pooled: contexts are reset and reused instead of rebuilt for every request. Retries transient SQL
            // failures; code that opens its own transaction must run inside the execution strategy (see OrderDataAccessLayer).
            services.AddDbContextPool<BookDBContext>((provider, options) =>
                options.UseSqlServer(
                    provider.GetRequiredService<IOptions<DatabaseOptions>>().Value.DefaultConnection,
                    sql => sql.EnableRetryOnFailure()));

            // Scoped, not transient: they share the request's DbContext, so one instance per request is the right lifetime.
            services.AddScoped<IBookService, BookDataAccessLayer>();
            services.AddScoped<ICartService, CartDataAccessLayer>();
            services.AddScoped<IOrderService, OrderDataAccessLayer>();
            services.AddScoped<IUserService, UserDataAccessLayer>();
            services.AddScoped<IWishlistService, WishlistDataAccessLayer>();

            services.AddSingleton<CoverStorage>();
            return services;
        }
    }
}
