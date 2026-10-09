using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace BookCart.Models
{
    /// <summary>
    /// Used only by <c>dotnet ef</c> (adding migrations, producing SQL scripts, updating a database), so the tooling
    /// never has to start the web host or find the application's secrets. Point it at a database with the
    /// <c>BOOKCART_EF_CONNECTION</c> environment variable; without it, the local development database is used.
    /// Producing a script (<c>dotnet ef migrations script</c>) does not connect, so the value does not matter then.
    /// </summary>
    public sealed class BookDBContextFactory : IDesignTimeDbContextFactory<BookDBContext>
    {
        const string LocalDevelopmentDatabase = @"Server=(localdb)\MSSQLLocalDB;Database=BookDB_Dev;Trusted_Connection=True;TrustServerCertificate=True";

        public BookDBContext CreateDbContext(string[] args)
        {
            var connection = Environment.GetEnvironmentVariable("BOOKCART_EF_CONNECTION") ?? LocalDevelopmentDatabase;
            var options = new DbContextOptionsBuilder<BookDBContext>().UseSqlServer(connection).Options;
            return new BookDBContext(options);
        }
    }
}
