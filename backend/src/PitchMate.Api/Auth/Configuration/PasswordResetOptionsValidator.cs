using Microsoft.Extensions.Options;
using PitchMate.Application.Auth.PasswordReset;

namespace PitchMate.Api.Auth.Configuration;

/// <summary>
/// Validates <see cref="PasswordResetOptions"/> at startup. The reset-token lifetime must be a
/// positive duration not exceeding 60 minutes (Requirement 5.1), and the rate-limit window and
/// per-window maximum must be positive so the anti-enumeration throttle is well-defined
/// (Requirement 5.8). Any violation aborts startup naming the offending key under
/// <c>Auth:PasswordReset</c> (Requirement 15.4).
/// </summary>
public sealed class PasswordResetOptionsValidator : IValidateOptions<PasswordResetOptions>
{
    /// <summary>The maximum permitted reset-token lifetime (Requirement 5.1).</summary>
    private static readonly TimeSpan MaxTokenLifetime = TimeSpan.FromMinutes(60);

    /// <inheritdoc />
    public ValidateOptionsResult Validate(string? name, PasswordResetOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var failures = new List<string>();

        if (options.TokenLifetime <= TimeSpan.Zero || options.TokenLifetime > MaxTokenLifetime)
        {
            failures.Add(
                $"'{PasswordResetOptions.SectionName}:TokenLifetime' must be a positive duration " +
                $"no greater than {MaxTokenLifetime}.");
        }

        if (options.RateLimitWindow <= TimeSpan.Zero)
        {
            failures.Add($"'{PasswordResetOptions.SectionName}:RateLimitWindow' must be a positive duration.");
        }

        if (options.MaxRequestsPerWindow < 1)
        {
            failures.Add($"'{PasswordResetOptions.SectionName}:MaxRequestsPerWindow' must be at least 1.");
        }

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }
}
