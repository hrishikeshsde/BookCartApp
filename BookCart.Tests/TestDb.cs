using System.Text.RegularExpressions;
using BookCart.Models;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace BookCart.Tests;

public static class TestDb
{
    // Override with BOOKCART_TEST_DB to point at another SQL Server (never a real/production database:
    // the fixture drops and recreates the target database on every run).
    public static string ConnectionString { get; } =
        Environment.GetEnvironmentVariable("BOOKCART_TEST_DB")
        ?? @"Server=(localdb)\MSSQLLocalDB;Database=BookDB_Test;Trusted_Connection=True;TrustServerCertificate=True";

    /// <summary>The same server with another database name, for tests that need a database of their own (<c>BookDB_Test_&lt;suffix&gt;</c>).</summary>
    public static string Scratch(string suffix)
    {
        var builder = new SqlConnectionStringBuilder(ConnectionString);
        builder.InitialCatalog = $"{builder.InitialCatalog}_{suffix}";
        return builder.ConnectionString;
    }

    public static BookDBContext Context(string connectionString) =>
        new(new DbContextOptionsBuilder<BookDBContext>().UseSqlServer(connectionString).Options);

    public static async Task DropAsync(string connectionString)
    {
        SqlConnection.ClearAllPools();
        await using var db = Context(connectionString);
        await db.Database.EnsureDeletedAsync();
    }

    /// <summary>Creates the (empty) database if it does not exist yet.</summary>
    public static async Task CreateEmptyAsync(string connectionString)
    {
        var builder = new SqlConnectionStringBuilder(connectionString);
        var name = builder.InitialCatalog;
        builder.InitialCatalog = "master";
        await using var master = new SqlConnection(builder.ConnectionString);
        await master.OpenAsync();
        await using var command = master.CreateCommand();
        command.CommandText = $"IF DB_ID(@name) IS NULL EXEC('CREATE DATABASE [' + @name + ']')";
        command.Parameters.AddWithValue("@name", name);
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>Runs a SQL Server script the way sqlcmd does: batches separated by lines containing only GO.</summary>
    public static async Task RunScriptAsync(string connectionString, string script)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();
        foreach (var batch in Regex.Split(script, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(batch)) continue;
            await using var command = connection.CreateCommand();
            command.CommandText = batch;
            command.CommandTimeout = 120;
            await command.ExecuteNonQueryAsync();
        }
    }

    public static string RepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "BookCart.sln"))) directory = directory.Parent;
        return directory?.FullName ?? throw new InvalidOperationException("BookCart.sln was not found above the test output folder.");
    }
}
