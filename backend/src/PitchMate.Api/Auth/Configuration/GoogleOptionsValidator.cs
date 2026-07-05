using Microsoft.Extensions.Options;
using PitchMate.Infrastructure.Auth;

namespace PitchMate.Api.Auth.Configuration;

/// <summary>
/// Validates <see cref="GoogleOptions"/> at startup. The Google client id is a required provider
/// setting (Requirement 15.1, 15.3): the verifier enforces it as the audience of every Google
/// assertion, so an absent client id would make Google sign-in unverifiable. A missing value
/// aborts startup naming the offending key under <c>Auth:Google</c>.
/// </summary>
public sealed class GoogleOptionsValidator : IValidateOptions<GoogleOptions>
{
    /// <inheritdoc />
    public ValidateOptionsResult Validate(string? name, GoogleOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        if (string.IsNullOrWhiteSpace(options.ClientId))
        {
            return ValidateOptionsResult.Fail(
                $"'{GoogleOptions.SectionName}:ClientId' is required and must not be empty.");
        }

        return ValidateOptionsResult.Success;
    }
}
