namespace BookCart.Tests;

public static class TestDb
{
    // Override with BOOKCART_TEST_DB to point at another SQL Server (never a real/production database:
    // the fixture drops and recreates the target database on every run).
    public static string ConnectionString { get; } =
        Environment.GetEnvironmentVariable("BOOKCART_TEST_DB")
        ?? @"Server=(localdb)\MSSQLLocalDB;Database=BookDB_Test;Trusted_Connection=True;TrustServerCertificate=True";
}
