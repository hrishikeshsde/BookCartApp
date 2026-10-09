using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace BookCart.Services
{
    /// <summary>
    /// Telling "another request got there first" and "what you refer to is gone" apart from a real failure. The database
    /// enforces uniqueness and relationships, so these are ordinary outcomes of concurrent requests, not bugs.
    /// </summary>
    internal static class DatabaseErrors
    {
        /// <summary>A unique index or constraint refused a duplicate (SQL Server errors 2601 and 2627).</summary>
        public static bool IsUniqueViolation(DbUpdateException exception) =>
            exception.InnerException is SqlException { Number: 2601 or 2627 };

        /// <summary>A foreign key or check constraint refused the row (SQL Server error 547).</summary>
        public static bool IsConstraintViolation(DbUpdateException exception) =>
            exception.InnerException is SqlException { Number: 547 };
    }
}
