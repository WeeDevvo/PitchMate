using Microsoft.Extensions.Options;
using PitchMate.Application.Auth.EmailVerification;

namespace PitchMate.Api.Auth.Configuration;

/// <summary>
/// Validates <see cref="EmailVerificationOptions"/> at startup. The verification-token lifetime
/// must be a positive duration within the permitted 1-hour-to-7-day range (Requirement 4.1); a
/// non-positive or out-of-range value aborts startup naming the offending key under
/// <c>Auth:EmailVerification</c> (Requirement 15.4).
/// </summary>
public sealed class EmailVerificationOptionsValidator : IValidateOptions<EmailVerificationOptions>
{
    /// <inheritdoc />
    public ValidateOptionsResult Validate(string? name, EmailVerificationOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        if (options.TokenLifetime < EmailVerificationOptions.MinTokenLifetime
            || options.TokenLifetime > EmailVerificationOptions.MaxTokenLifetime)
        {
            return ValidateOptionsResult.Fail(
                $"'{EmailVerificationOptions.SectionName}:TokenLifetime' must be between " +
                $"{EmailVerificationOptions.MinTokenLifetime} and {EmailVerificationOptions.MaxTokenLifetime}.");
        }

        return ValidateOptionsResult.Success;
    }
}
