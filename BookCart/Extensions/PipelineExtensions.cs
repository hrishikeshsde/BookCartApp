using BookCart.Options;
using Microsoft.Extensions.Options;
using Scalar.AspNetCore;

namespace BookCart.Extensions
{
    public static class PipelineExtensions
    {
        // Report-only unless Security:EnforceCsp is true. Violations show up in the browser console, so the policy can
        // be checked against the real built SPA (fonts, icons, the Gemini call) before it blocks anything.
        const string ContentSecurityPolicy =
            "default-src 'self'; script-src 'self'; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://maxcdn.bootstrapcdn.com; " +
            "font-src 'self' https://fonts.gstatic.com https://maxcdn.bootstrapcdn.com; " +
            "img-src 'self' data: https://static1.smartbear.co https://www.gstatic.com; " +
            "connect-src 'self' https://generativelanguage.googleapis.com; " +   // browser-side Gemini call, removed once it moves behind the API
            "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

        /// <summary>The request pipeline, in order. The order matters: see the comment on each step.</summary>
        public static WebApplication UseBookCart(this WebApplication app)
        {
            var enforceCsp = app.Services.GetRequiredService<IOptions<SecurityOptions>>().Value.EnforceCsp;
            var cspHeader = enforceCsp ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

            // Outermost, and set when the response starts: the exception handler clears headers it finds on the
            // response, so headers set up front would be missing from error responses.
            app.Use((context, next) =>
            {
                context.Response.OnStarting(() =>
                {
                    var headers = context.Response.Headers;
                    headers.XContentTypeOptions = "nosniff";
                    headers.XFrameOptions = "DENY";
                    headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
                    // The API reference page needs inline scripts and external assets, so it is exempt.
                    if (!context.Request.Path.StartsWithSegments("/scalar"))
                    {
                        headers[cspHeader] = ContentSecurityPolicy;
                    }
                    return Task.CompletedTask;
                });
                return next(context);
            });

            app.UseExceptionHandler();   // unhandled exceptions -> ProblemDetails (ApiExceptionHandler)
            app.UseStatusCodePages();    // bodiless 401/403/404/429... -> ProblemDetails

            if (!app.Environment.IsDevelopment())
            {
                // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
                app.UseHsts();
            }

            app.UseHttpsRedirection();
            app.UseResponseCompression();
            app.UseStaticFiles();
            app.UseRouting();
            app.UseRateLimiter();        // after routing: [EnableRateLimiting] is endpoint metadata
            app.UseAuthentication();

            // The fallback policy also applies to requests that matched no endpoint (a missing image or script), which
            // would turn a plain 404 into a 401. Nothing would run for those requests anyway, so answer 404 first.
            app.Use(async (context, next) =>
            {
                if (context.GetEndpoint() is null)
                {
                    context.Response.StatusCode = StatusCodes.Status404NotFound;
                    return;
                }
                await next();
            });

            app.UseAuthorization();
            app.UseOutputCache();        // after authorization: requests with an Authorization header are never cached

            app.MapControllers();
            app.MapHealthChecks("/health").AllowAnonymous();

            // API documentation is for development only: it describes every endpoint to anyone who asks.
            if (app.Environment.IsDevelopment())
            {
                app.MapOpenApi().AllowAnonymous();
                app.MapScalarApiReference(options => options.WithTitle("BookCart API")).AllowAnonymous();
            }

            // An unknown API route is a 404, not the SPA shell. Controller routes are more specific, so they win; this
            // only catches what no controller claimed, before the fallback below can.
            app.Map("/api/{**path}", () => Results.NotFound()).AllowAnonymous();

            // The SPA shell must stay public (the fallback policy would otherwise demand a login to load it). It is
            // served for page routes only: a path that names a file (missing-chunk.js) is a 404 instead.
            app.MapFallbackToFile("index.html").AllowAnonymous();

            return app;
        }
    }
}
