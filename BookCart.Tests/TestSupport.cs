using System.Collections.Concurrent;
using BookCart.Errors;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace BookCart.Tests;

/// <summary>
/// Throws on demand so the exception handler can be tested end to end. It lives in the test assembly, so the API
/// never contains it: tests add it to a host with <c>AddApplicationPart(typeof(BoomController).Assembly)</c>.
/// </summary>
[ApiController, AllowAnonymous, Route("api/test-boom")]
public class BoomController : ControllerBase
{
    [HttpGet("unexpected")]
    public IActionResult Unexpected() => throw new InvalidOperationException("secret internal detail: connection string leaked");

    [HttpGet("not-found")]
    public IActionResult NotFoundCase() => throw new NotFoundException("The widget does not exist.");

    [HttpGet("bad-request")]
    public IActionResult BadRequestCase() => throw new BadRequestException("The widget is malformed.");

    [HttpGet("conflict")]
    public IActionResult ConflictCase() => throw new ConflictException("The widget already exists.");
}

/// <summary>Records everything the application logs, so tests can assert that important events are logged.</summary>
public sealed class LogCapture : ILoggerProvider
{
    public record Entry(LogLevel Level, string Category, string Message, Exception? Exception);

    readonly ConcurrentQueue<Entry> _entries = new();

    public IReadOnlyCollection<Entry> Entries => _entries.ToArray();

    public ILogger CreateLogger(string categoryName) => new CaptureLogger(categoryName, _entries);

    public void Dispose() { }

    sealed class CaptureLogger(string category, ConcurrentQueue<Entry> entries) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            entries.Enqueue(new Entry(logLevel, category, formatter(state, exception), exception));
    }
}
