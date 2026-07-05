using Microsoft.Extensions.Options;
using PitchMate.Application.Auth.UseCases;

namespace PitchMate.Api.Auth.Configuration;

/// <summary>
/// Validates <see cref="SignInProtectionOptions"/> at startup. Both gates are off by default, so
/// an absent section is valid; when the lockout gate is enabled its parameters must be coherent —
/// a positive failure threshold and a positive window (Requirement 6.7) — otherwise startup aborts
/// naming the offending key under <c>Auth:SignInProtection</c> (Requirement 15.4).
/// </summary>
public sealed class SignInProtectionOptionsValidator : IValidateOptions<SignInProtectionOptions>
{
    /// <inheritdoc />
    public ValidateOptionsResult Validate(string? name, SignInProtectionOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        // The parameters only matter when the lockout gate is on; leave them unconstrained otherwise.
        if (!options.LockoutEnabled)
        {
            return ValidateOptionsResult.Success;
        }

        var failures = new List<string>();

        if (options.MaxFailedAttempts < 1)
        {
            failures.Add(
                $"'{SignInProtectionOptions.SectionName}:MaxFailedAttempts' must be at least 1 " +
                "when lockout is enabled.");
        }

        if (options.LockoutWindow <= TimeSpan.Zero)
        {
            failures.Add(
                $"'{SignInProtectionOptions.SectionName}:LockoutWindow' must be a positive duration " +
                "when lockout is enabled.");
        }

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }
}
