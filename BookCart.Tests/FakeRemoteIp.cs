using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;

namespace BookCart.Tests;

/// <summary>
/// TestServer has no real network peer, so every request would share one rate-limit bucket. This test-only
/// middleware reads the address from the <c>X-Test-Remote-Ip</c> header and presents it as the connection's remote IP,
/// which lets <see cref="ApiFactory"/> give each test client its own address, as separate browsers would have.
/// </summary>
public sealed class FakeRemoteIpStartupFilter : IStartupFilter
{
    public const string Header = "X-Test-Remote-Ip";

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use(async (context, nextMiddleware) =>
        {
            if (context.Request.Headers.TryGetValue(Header, out var value) && IPAddress.TryParse(value.ToString(), out var ip))
            {
                context.Connection.RemoteIpAddress = ip;
            }
            await nextMiddleware();
        });
        next(app);
    };
}
