using System.Text;
using Microsoft.Extensions.Options;
using PitchMate.Infrastructure.Auth;

namespace PitchMate.Api.Auth.Configuration;

/// <summary>
/// Validates <see cref="AuthTokenOptions"/> at startup so a misconfigured token setup aborts
/// the host before any request is served and no token is ever issued under a bad configuration
/// (Requirements 15.2, 15.3, 15.4). Every failure message names the offending configuration key
/// under <c>Auth:Token</c> so an operator can fix it directly.
/// </summary>
public sealed class AuthTokenOptionsValidator : IValidateOptions<AuthTokenOptions>
{
    /// <summary>
    /// The smallest signing key HMAC-SHA256 accepts: 256 bits (32 bytes). A shorter key would be
    /// rejected by the token handler at first use, so it is caught here at startup instead.
    /// </summary>
    private const int MinSigningKeyBytes = 32;

    /// <inheritdoc />
    public ValidateOptionsResult Validate(string? name, AuthTokenOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var failures = new List<string>();

        // (15.2) An absent or empty signing key aborts startup naming the signing-key setting.
        if (string.IsNullOrWhiteSpace(options.SigningKey))
        {
            failures.Add($"'{AuthTokenOptions.SectionName}:SigningKey' is required and must not be empty.");
        }
        else if (Encoding.UTF8.GetByteCount(options.SigningKey) < MinSigningKeyBytes)
        {
            failures.Add(
                $"'{AuthTokenOptions.SectionName}:SigningKey' must be at least {MinSigningKeyBytes} bytes " +
                "(256 bits) for HMAC-SHA256 signing.");
        }

        // (15.3) The issuer and audience are required settings.
        if (string.IsNullOrWhiteSpace(options.Issuer))
        {
            failures.Add($"'{AuthTokenOptions.SectionName}:Issuer' is required and must not be empty.");
        }

        if (string.IsNullOrWhiteSpace(options.Audience))
        {
            failures.Add($"'{AuthTokenOptions.SectionName}:Audience' is required and must not be empty.");
        }

        // (15.4) Both lifetimes must be strictly positive durations.
        if (options.AccessTokenLifetime <= TimeSpan.Zero)
        {
            failures.Add($"'{AuthTokenOptions.SectionName}:AccessTokenLifetime' must be a positive duration.");
        }

        if (options.RefreshTokenLifetime <= TimeSpan.Zero)
        {
            failures.Add($"'{AuthTokenOptions.SectionName}:RefreshTokenLifetime' must be a positive duration.");
        }

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }
}
