using Microsoft.AspNetCore.Diagnostics;

namespace BookCart.Errors
{
    /// <summary>
    /// The single place unhandled exceptions become HTTP responses: expected failures keep their meaning (404, 400,
    /// 409, an oversized body's 413), everything else is a logged 500 whose body never reveals the exception.
    /// </summary>
    public sealed class ApiExceptionHandler(IProblemDetailsService problemDetails, ILogger<ApiExceptionHandler> logger) : IExceptionHandler
    {
        public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
        {
            // The client went away: nothing to answer and nothing to alarm anyone about.
            if (exception is OperationCanceledException && httpContext.RequestAborted.IsCancellationRequested)
            {
                httpContext.Response.StatusCode = 499;
                return true;
            }

            var (status, title) = exception switch
            {
                NotFoundException => (StatusCodes.Status404NotFound, "Not found"),
                BadRequestException => (StatusCodes.Status400BadRequest, "Bad request"),
                ConflictException => (StatusCodes.Status409Conflict, "Conflict"),
                UpstreamException => (StatusCodes.Status502BadGateway, "A service this request depends on failed"),
                ServiceUnavailableException => (StatusCodes.Status503ServiceUnavailable, "Service unavailable"),
                BadHttpRequestException bad => (bad.StatusCode, "Bad request"),
                _ => (StatusCodes.Status500InternalServerError, "An unexpected error occurred")
            };

            // A 502 is a dependency's fault and a 503 a configuration choice: worth a warning, not an error with a stack.
            if (exception is UpstreamException or ServiceUnavailableException)
            {
                logger.LogWarning(exception, "{Status} for {Method} {Path}", status, httpContext.Request.Method, httpContext.Request.Path);
            }
            else if (status >= StatusCodes.Status500InternalServerError)
            {
                logger.LogError(exception, "Unhandled exception for {Method} {Path}", httpContext.Request.Method, httpContext.Request.Path);
            }

            httpContext.Response.StatusCode = status;
            return await problemDetails.TryWriteAsync(new ProblemDetailsContext
            {
                HttpContext = httpContext,
                Exception = exception,
                ProblemDetails =
                {
                    Status = status,
                    Title = title,
                    // Messages of expected failures are written for the caller; a 500's message is not.
                    Detail = status < StatusCodes.Status500InternalServerError ? exception.Message : null
                }
            });
        }
    }
}
