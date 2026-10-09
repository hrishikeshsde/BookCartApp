using BookCart.Dto;
using BookCart.Errors;
using BookCart.Options;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using System.Text.Json;

namespace BookCart.Services
{
    public interface IBookSummaryService
    {
        /// <summary>A short AI-written summary of the book.</summary>
        /// <exception cref="ServiceUnavailableException">Summaries are not configured on this server.</exception>
        /// <exception cref="UpstreamException">The AI service failed or returned nothing usable.</exception>
        Task<string> GetSummaryAsync(BookDto book, CancellationToken cancellationToken);
    }

    /// <summary>
    /// Asks Google Gemini for a summary. The API key lives only on the server, and the prompt is built here from the
    /// stored title and author, so callers can neither read the key nor send their own prompt through this API.
    /// Results are cached, so each book costs one call per cache period however many people ask.
    /// </summary>
    public class GeminiBookSummaryService(HttpClient http, IMemoryCache cache, IOptions<GeminiOptions> options, ILogger<GeminiBookSummaryService> logger) : IBookSummaryService
    {
        static readonly string[] BlockedCategories =
            ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"];

        readonly GeminiOptions _options = options.Value;

        public async Task<string> GetSummaryAsync(BookDto book, CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(_options.ApiKey))
            {
                throw new ServiceUnavailableException("Book summaries are not configured on this server.");
            }

            // The title and author are part of the key, so editing a book does not keep serving its old summary.
            var cacheKey = $"book-summary:{book.BookId}:{book.Title}:{book.Author}";
            if (cache.TryGetValue(cacheKey, out string? cached) && cached is not null)
            {
                return cached;
            }

            var summary = await RequestSummaryAsync(book, cancellationToken);
            cache.Set(cacheKey, summary, TimeSpan.FromDays(_options.CacheDays));
            return summary;
        }

        async Task<string> RequestSummaryAsync(BookDto book, CancellationToken cancellationToken)
        {
            var prompt = $"Give me a summary of the book \"{book.Title}\" by {book.Author} in 300 words";
            var body = new
            {
                contents = new[] { new { parts = new[] { new { text = prompt } } } },
                generationConfig = new { temperature = 0.8, topP = 0.6, topK = 40 },
                safetySettings = BlockedCategories.Select(c => new { category = c, threshold = "BLOCK_MEDIUM_AND_ABOVE" })
            };

            using var request = new HttpRequestMessage(HttpMethod.Post, $"v1beta/models/{Uri.EscapeDataString(_options.Model)}:generateContent")
            {
                Content = JsonContent.Create(body)
            };
            request.Headers.Add("x-goog-api-key", _options.ApiKey);   // a header, so the key never appears in a URL or a log line

            try
            {
                using var response = await http.SendAsync(request, cancellationToken);
                if (!response.IsSuccessStatusCode)
                {
                    logger.LogWarning("Gemini answered {StatusCode} for book {BookId}", (int)response.StatusCode, book.BookId);
                    throw new UpstreamException($"The summary service answered {(int)response.StatusCode}.");
                }

                var document = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken);
                var text = ExtractText(document);
                if (string.IsNullOrWhiteSpace(text))
                {
                    // Typically the safety filters blocked the answer.
                    throw new UpstreamException("The summary service returned no summary for this book.");
                }
                return text.Trim();
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException && !cancellationToken.IsCancellationRequested)
            {
                throw new UpstreamException("The summary service could not be reached or answered with something unreadable.", ex);
            }
        }

        static string? ExtractText(JsonElement document) =>
            document.TryGetProperty("candidates", out var candidates) && candidates.ValueKind == JsonValueKind.Array && candidates.GetArrayLength() > 0
            && candidates[0].TryGetProperty("content", out var content) && content.TryGetProperty("parts", out var parts)
            && parts.ValueKind == JsonValueKind.Array && parts.GetArrayLength() > 0
            && parts[0].TryGetProperty("text", out var text)
                ? text.GetString()
                : null;
    }
}
