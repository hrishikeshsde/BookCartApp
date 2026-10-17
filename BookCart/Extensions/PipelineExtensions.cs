using BookCart.Options;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using Scalar.AspNetCore;

namespace BookCart.Extensions
{
    public static class PipelineExtensions
    {
        // Report-only unless Security:EnforceCsp is true. Violations show up in the browser console, so the policy can
        // be checked against the real built SPA (fonts, icons) before it blocks anything. The browser only talks to this
        // server (connect-src 'self'): the AI service is called by the API, not by the page.
        const string ContentSecurityPolicy =
            "default-src 'self'; script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +   // inline: the style attributes Angular Material sets at run time
            "font-src 'self'; " +                    // Roboto and the icon font are bundled (@fontsource), nothing comes from a CDN
            "img-src 'self' data:; " +               // data: the cover preview of a file chosen in the admin form
            "connect-src 'self'; " +
            "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

        // The route text MapFallbackToFile uses for page routes (any path that does not name a file).
        const string SpaFallbackPattern = "{*path:nonfile}";

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
            // Covers may live outside the application folder (a mounted volume). They are served from there first; anything
            // not found there, such as the default cover, falls through to the application's own wwwroot.
            if (app.Services.GetRequiredService<IOptions<StorageOptions>>().Value.UploadFolder is { Length: > 0 } uploadFolder)
            {
                Directory.CreateDirectory(uploadFolder);
                app.UseStaticFiles(new StaticFileOptions
                {
                    FileProvider = new PhysicalFileProvider(uploadFolder),
                    RequestPath = "/Upload"
                });
            }
            // Pages the Angular build drew in advance (the home page is index.html, the others login/index.html and so on) are
            // served for their own address. Everything else that is a page route falls through to the fallback below.
            app.Use(async (context, next) =>
            {
                if (HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method))
                {
                    var path = context.Request.Path.Value ?? "/";
                    if (!Path.HasExtension(path))
                    {
                        var page = path.TrimEnd('/') + "/index.html";
                        if (app.Environment.WebRootFileProvider.GetFileInfo(page).Exists)
                        {
                            context.Request.Path = page;
                        }
                    }
                }
                await next();
            });
            app.UseStaticFiles();
            app.UseRouting();
            app.UseRateLimiter();        // after routing: [EnableRateLimiting] is endpoint metadata
            app.UseAuthentication();

            // The fallback policy also applies to requests that matched no endpoint (a missing image or script), which
            // would turn a plain 404 into a 401. Nothing would run for those requests anyway, so answer 404 first.
            // The same goes for the SPA shell asked for under /api: an unknown API route is a 404, not index.html.
            app.Use(async (context, next) =>
            {
                var endpoint = context.GetEndpoint();
                var shellUnderApi = endpoint is RouteEndpoint { RoutePattern.RawText: SpaFallbackPattern }
                                    && context.Request.Path.StartsWithSegments("/api");
                if (endpoint is null || shellUnderApi)
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

            // The SPA shell must stay public (the fallback policy would otherwise demand a login to load it). It is
            // served for page routes only: a path that names a file (missing-chunk.js) is a 404 instead. GET and HEAD
            // only, so that a POST with the wrong content type still gets the framework's 415 and a wrong method its
            // 405, instead of being swallowed by the fallback.
            // The shell is index.csr.html when the build also drew some pages in advance: index.html is then the drawn
            // home page, which the running app can only take over on the home address. A build without drawn pages has
            // just index.html.
            app.MapFallback(SpaFallbackPattern, async context =>
                {
                    var webRoot = context.RequestServices.GetRequiredService<IWebHostEnvironment>().WebRootFileProvider;
                    var shell = webRoot.GetFileInfo("index.csr.html");
                    if (!shell.Exists)
                    {
                        shell = webRoot.GetFileInfo("index.html");
                    }
                    if (!shell.Exists)
                    {
                        context.Response.StatusCode = StatusCodes.Status404NotFound;
                        return;
                    }
                    context.Response.ContentType = "text/html; charset=utf-8";
                    await context.Response.SendFileAsync(shell);
                })
                .WithMetadata(new HttpMethodMetadata(["GET", "HEAD"]))
                .AllowAnonymous();

            return app;
        }
    }
}
