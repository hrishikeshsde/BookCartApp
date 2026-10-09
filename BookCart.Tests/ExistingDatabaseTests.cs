using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace BookCart.Tests;

/// <summary>
/// B4: every database that exists today was created by DBScript/BookDB.txt. The documented upgrade (back up, run
/// DBScript/B4_adopt_migrations.sql, apply the migrations) must leave such a database exactly like a new one.
/// </summary>
public class ExistingDatabaseTests : IAsyncLifetime
{
    readonly string _oldStyle = TestDb.Scratch("OldStyle");
    readonly string _fresh = TestDb.Scratch("FreshMigrations");

    public async Task InitializeAsync()
    {
        await TestDb.DropAsync(_oldStyle);
        await TestDb.DropAsync(_fresh);
    }

    public async Task DisposeAsync()
    {
        await TestDb.DropAsync(_oldStyle);
        await TestDb.DropAsync(_fresh);
    }

    static string Script(string relativePath) => File.ReadAllText(Path.Combine(TestDb.RepositoryRoot(), relativePath));

    /// <summary>The original schema script, as the README told people to run it (its first line is a PowerShell command, not SQL).</summary>
    static string OriginalSchemaScript()
    {
        var text = Script("DBScript/BookDB.txt");
        return text[text.IndexOf("CREATE TABLE", StringComparison.Ordinal)..];
    }

    async Task<List<string>> UpgradedOldStyleDatabaseAsync()
    {
        await TestDb.CreateEmptyAsync(_oldStyle);
        await TestDb.RunScriptAsync(_oldStyle, OriginalSchemaScript());
        await TestDb.RunScriptAsync(_oldStyle, Script("DBScript/B4_adopt_migrations.sql"));

        await using var db = TestDb.Context(_oldStyle);
        await db.Database.MigrateAsync();
        return await SchemaOfAsync(_oldStyle);
    }

    [Fact]
    public async Task An_old_database_that_adopts_the_migrations_ends_up_exactly_like_a_new_one()
    {
        var upgraded = await UpgradedOldStyleDatabaseAsync();

        await using (var db = TestDb.Context(_fresh)) await db.Database.MigrateAsync();
        var fresh = await SchemaOfAsync(_fresh);

        Assert.Equal(fresh, upgraded);
        Assert.True(fresh.Count > 60, "the comparison should cover columns, keys, indexes and checks, not an empty list");
    }

    [Fact]
    public async Task The_adoption_script_changes_no_table_and_can_be_run_twice()
    {
        await TestDb.CreateEmptyAsync(_oldStyle);
        await TestDb.RunScriptAsync(_oldStyle, OriginalSchemaScript());
        var before = await SchemaOfAsync(_oldStyle);

        await TestDb.RunScriptAsync(_oldStyle, Script("DBScript/B4_adopt_migrations.sql"));
        await TestDb.RunScriptAsync(_oldStyle, Script("DBScript/B4_adopt_migrations.sql"));

        Assert.Equal(before, await SchemaOfAsync(_oldStyle));
        await using var db = TestDb.Context(_oldStyle);
        Assert.Equal(["Baseline"], (await db.Database.GetAppliedMigrationsAsync()).Select(m => m[(m.IndexOf('_') + 1)..]));
    }

    [Fact]
    public async Task The_adoption_script_refuses_a_database_that_is_not_at_the_expected_starting_point()
    {
        await TestDb.CreateEmptyAsync(_oldStyle);   // empty: not a BookCart database at all

        var failure = await Assert.ThrowsAsync<SqlException>(() => TestDb.RunScriptAsync(_oldStyle, Script("DBScript/B4_adopt_migrations.sql")));

        Assert.Contains("does not look like a BookCart database", failure.Message);
    }

    // ---- a name-independent description of a database's schema and reference data ------------------------------------

    static async Task<List<string>> SchemaOfAsync(string connectionString)
    {
        const string sql = """
            SELECT 'COLUMN ' + t.name COLLATE DATABASE_DEFAULT + '.' + c.name COLLATE DATABASE_DEFAULT + ' ' + ty.name COLLATE DATABASE_DEFAULT
                 + CASE WHEN ty.name COLLATE DATABASE_DEFAULT IN ('varchar','char','varbinary') THEN '(' + CASE WHEN c.max_length = -1 THEN 'max' ELSE CAST(c.max_length AS varchar) END + ')'
                        WHEN ty.name COLLATE DATABASE_DEFAULT IN ('nvarchar','nchar') THEN '(' + CASE WHEN c.max_length = -1 THEN 'max' ELSE CAST(c.max_length / 2 AS varchar) END + ')'
                        WHEN ty.name COLLATE DATABASE_DEFAULT IN ('decimal','numeric') THEN '(' + CAST(c.precision AS varchar) + ',' + CAST(c.scale AS varchar) + ')'
                        WHEN ty.name COLLATE DATABASE_DEFAULT = 'datetime2' THEN '(' + CAST(c.scale AS varchar) + ')' ELSE '' END
                 + CASE WHEN c.is_nullable = 1 THEN ' NULL' ELSE ' NOT NULL' END
                 + CASE WHEN c.is_identity = 1 THEN ' IDENTITY' ELSE '' END
            FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id JOIN sys.types ty ON ty.user_type_id = c.user_type_id
            WHERE t.name COLLATE DATABASE_DEFAULT <> '__EFMigrationsHistory'
            UNION ALL
            -- Primary keys by their columns, not by name: SQL Server names the old ones PK__Table__<random>.
            SELECT 'PRIMARY KEY ' + t.name COLLATE DATABASE_DEFAULT + ' (' + STRING_AGG(c.name COLLATE DATABASE_DEFAULT, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) + ')'
            FROM sys.indexes i JOIN sys.tables t ON t.object_id = i.object_id
            JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
            JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
            WHERE i.is_primary_key = 1 AND t.name COLLATE DATABASE_DEFAULT <> '__EFMigrationsHistory' GROUP BY t.name COLLATE DATABASE_DEFAULT
            UNION ALL
            SELECT 'INDEX ' + i.name COLLATE DATABASE_DEFAULT + ' ON ' + t.name COLLATE DATABASE_DEFAULT + CASE WHEN i.is_unique = 1 THEN ' UNIQUE' ELSE '' END
                 + ' (' + STRING_AGG(c.name COLLATE DATABASE_DEFAULT, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) + ')'
            FROM sys.indexes i JOIN sys.tables t ON t.object_id = i.object_id
            JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
            JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
            WHERE i.is_primary_key = 0 AND i.name COLLATE DATABASE_DEFAULT IS NOT NULL AND t.name COLLATE DATABASE_DEFAULT <> '__EFMigrationsHistory' GROUP BY t.name COLLATE DATABASE_DEFAULT, i.name COLLATE DATABASE_DEFAULT, i.is_unique
            UNION ALL
            SELECT 'FOREIGN KEY ' + fk.name COLLATE DATABASE_DEFAULT + ' ' + OBJECT_NAME(fk.parent_object_id) + ' -> ' + OBJECT_NAME(fk.referenced_object_id) + ' ' + fk.delete_referential_action_desc
            FROM sys.foreign_keys fk
            UNION ALL
            SELECT 'CHECK ' + ck.name COLLATE DATABASE_DEFAULT + ' ' + ck.definition COLLATE DATABASE_DEFAULT FROM sys.check_constraints ck
            UNION ALL
            SELECT 'DATA UserType ' + CAST(UserTypeID AS varchar) + ' ' + UserTypeName FROM UserType
            UNION ALL
            SELECT 'DATA Category ' + CAST(CategoryID AS varchar) + ' ' + CategoryName FROM Categories
            """;

        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        var lines = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) lines.Add(reader.GetString(0));
        lines.Sort(StringComparer.Ordinal);
        return lines;
    }
}
