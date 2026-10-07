using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BookCart.Tests;

/// <summary>B0.3: secrets come from configuration, and tests never run against a developer's own database.</summary>
[Collection(ApiCollection.Name)]
public class ConfigurationTests(ApiFactory factory)
{
    readonly ApiFactory _factory = factory;

    [Fact]
    public void Tests_run_against_the_test_database_not_user_secrets()
    {
        _ = _factory.CreateClient();   // force the host to start
        var config = _factory.Services.GetRequiredService<IConfiguration>();

        Assert.Equal(TestDb.ConnectionString, config.GetConnectionString("DefaultConnection"));
        Assert.Equal("test-secret-test-secret-test-secret-123456", config["Jwt:SecretKey"]);
    }

    [Fact]
    public void Committed_appsettings_contain_no_secrets()
    {
        // appsettings.json is copied next to the web project's output; it must hold blanks, never real values.
        var path = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
        var committed = new ConfigurationBuilder().AddJsonFile(path, optional: false).Build();

        Assert.True(string.IsNullOrEmpty(committed["Jwt:SecretKey"]), "Jwt:SecretKey must not be committed.");
        Assert.True(string.IsNullOrEmpty(committed.GetConnectionString("DefaultConnection")),
            "The connection string must not be committed.");
    }
}
