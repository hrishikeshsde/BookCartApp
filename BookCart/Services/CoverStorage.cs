using BookCart.Errors;
using BookCart.Options;
using Microsoft.Extensions.Options;

namespace BookCart.Services
{
    /// <summary>The uploaded file was rejected (wrong type, wrong content, empty or too large). A 400 if nothing handles it first.</summary>
    public sealed class InvalidUploadException(string message) : BadRequestException(message);

    /// <summary>
    /// Stores book cover images under <c>wwwroot/Upload</c>. Nothing the client sends decides where a file goes or
    /// what it is called: the name is generated, the type comes from an allow-list, and the content must match the type.
    /// </summary>
    public class CoverStorage(IWebHostEnvironment environment, IOptions<StorageOptions> options)
    {
        /// <summary>Largest cover accepted. The request size limit on the book endpoints leaves room for the form around it.</summary>
        public const long MaxBytes = 2 * 1024 * 1024;

        // Number of leading bytes needed to recognise every allowed type (WebP: "RIFF" + size + "WEBP").
        const int HeaderLength = 12;

        readonly string _uploadFolder = Path.Combine(
            environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot"), "Upload");

        /// <summary>The cover used when a book has no uploaded image. It is never deleted.</summary>
        public string DefaultFileName { get; } = options.Value.DefaultCoverImageFile;

        /// <returns>The generated file name (not a path) the cover was stored under.</returns>
        /// <exception cref="InvalidUploadException">The file is not an acceptable cover image.</exception>
        public async Task<string> SaveAsync(IFormFile file, CancellationToken cancellationToken)
        {
            if (file.Length is 0 or > MaxBytes)
            {
                throw new InvalidUploadException($"The cover image must be between 1 byte and {MaxBytes / (1024 * 1024)} MB.");
            }

            // Only the extension is taken from the client's file name, and only if it is on the allow-list.
            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (extension is not (".jpg" or ".jpeg" or ".png" or ".webp"))
            {
                throw new InvalidUploadException("The cover image must be a .jpg, .jpeg, .png or .webp file.");
            }

            await using var input = file.OpenReadStream();
            var header = new byte[HeaderLength];
            var read = await input.ReadAtLeastAsync(header, HeaderLength, throwOnEndOfStream: false, cancellationToken);
            if (!ContentMatches(extension, header.AsSpan(0, read)))
            {
                throw new InvalidUploadException("The file content does not match its extension.");
            }
            input.Position = 0;

            var fileName = $"{Guid.NewGuid():N}{extension}";
            Directory.CreateDirectory(_uploadFolder);
            await using var output = new FileStream(Path.Combine(_uploadFolder, fileName), FileMode.CreateNew, FileAccess.Write);
            await input.CopyToAsync(output, cancellationToken);
            return fileName;
        }

        /// <summary>
        /// Deletes a stored cover. Does nothing for the default cover, for a missing file, or for a name that is not a
        /// plain file name: the value comes from the database, which an API caller could have filled with a path.
        /// </summary>
        public void Delete(string? fileName)
        {
            if (string.IsNullOrWhiteSpace(fileName)
                || string.Equals(fileName, DefaultFileName, StringComparison.OrdinalIgnoreCase)
                || fileName != Path.GetFileName(fileName))
            {
                return;
            }

            var path = Path.Combine(_uploadFolder, fileName);
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }

        static bool ContentMatches(string extension, ReadOnlySpan<byte> header) => extension switch
        {
            ".jpg" or ".jpeg" => header.StartsWith(new byte[] { 0xFF, 0xD8, 0xFF }),
            ".png" => header.StartsWith(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }),
            ".webp" => header.Length >= 12 && header[..4].SequenceEqual("RIFF"u8) && header[8..12].SequenceEqual("WEBP"u8),
            _ => false
        };
    }
}
