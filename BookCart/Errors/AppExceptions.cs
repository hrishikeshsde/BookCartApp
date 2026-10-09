namespace BookCart.Errors
{
    // Business-rule failures. ApiExceptionHandler turns them into the matching HTTP status with a ProblemDetails body.

    /// <summary>The thing the request refers to does not exist (404).</summary>
    public class NotFoundException(string message) : Exception(message);

    /// <summary>The request cannot be accepted as sent (400).</summary>
    public class BadRequestException(string message) : Exception(message);

    /// <summary>The request conflicts with the current state, for example a taken username (409).</summary>
    public class ConflictException(string message) : Exception(message);

    /// <summary>A service this API depends on answered with an error or nonsense (502).</summary>
    public class UpstreamException(string message, Exception? inner = null) : Exception(message, inner);

    /// <summary>A feature is switched off or not configured on this server (503).</summary>
    public class ServiceUnavailableException(string message) : Exception(message);
}
