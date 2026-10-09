using System.ComponentModel.DataAnnotations;

namespace BookCart.Dto
{
    /// <summary>One page of results, and how many there are in all (so a client can draw page links).</summary>
    public record PagedResult<T>(List<T> Items, int Total, int Page, int PageSize);

    /// <summary>
    /// Which books to list and which page of them. Every filter is optional and they combine (all must match).
    /// Invalid values are a 400 that names the field.
    /// </summary>
    public class BookQuery : IValidatableObject
    {
        public const int DefaultPageSize = 24;
        public const int MaxPageSize = 100;

        /// <summary>1-based.</summary>
        [Range(1, 1_000_000)]
        public int Page { get; set; } = 1;

        [Range(1, MaxPageSize)]
        public int PageSize { get; set; } = DefaultPageSize;

        /// <summary>Exact category name.</summary>
        [StringLength(20)]
        public string? Category { get; set; }

        /// <summary>Text the title or the author contains. Not case sensitive; wildcard characters are taken literally.</summary>
        [StringLength(100)]
        public string? Search { get; set; }

        [Range(0, 99999999.99)]
        public decimal? MinPrice { get; set; }

        [Range(0, 99999999.99)]
        public decimal? MaxPrice { get; set; }

        public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
        {
            if (MinPrice is { } min && MaxPrice is { } max && min > max)
            {
                yield return new ValidationResult("MinPrice cannot be greater than MaxPrice.", [nameof(MinPrice), nameof(MaxPrice)]);
            }
        }
    }
}
