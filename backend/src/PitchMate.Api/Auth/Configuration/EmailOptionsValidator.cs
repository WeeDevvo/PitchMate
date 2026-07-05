using Microsoft.Extensions.Options;
using PitchMate.Infrastructure.Auth.Email;

namespace PitchMate.Api.Auth.Configuration;

/// <summary>
/// Validates <see cref="EmailOptions"/> at startup so a misconfigured transport aborts the host
/// naming the offending key under <c>Auth:Email</c> (Requirements 11.3, 11.7, 15.3). The
/// <c>Provider</c> must name one of the supported transports; a cloud transport additionally
/// requires a sender address and its own secret (the ACS connection string or the SendGrid API
/// key), while the console transport requires neither.
/// </summary>
public sealed class EmailOptionsValidator : IValidateOptions<EmailOptions>
{
    /// <inheritdoc />
    public ValidateOptionsResult Validate(string? name, EmailOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var failures = new List<string>();

        if (options.MaxTransientRetries < 0)
        {
            failures.Add($"'{EmailOptions.SectionName}:MaxTransientRetries' must not be negative.");
        }

        switch (options.Provider)
        {
            case EmailOptions.ConsoleProvider:
                // The console transport logs only and opens no external connection, so it needs
                // neither a from-address nor a secret (Requirement 11.2).
                break;

            case EmailOptions.AzureCommunicationServicesProvider:
                RequireFromAddress(options, failures);
                if (string.IsNullOrWhiteSpace(options.AcsConnectionString))
                {
                    failures.Add(
                        $"'{EmailOptions.SectionName}:AcsConnectionString' is required when " +
                        $"'{EmailOptions.SectionName}:Provider' is '{EmailOptions.AzureCommunicationServicesProvider}'.");
                }

                break;

            case EmailOptions.SendGridProvider:
                RequireFromAddress(options, failures);
                if (string.IsNullOrWhiteSpace(options.SendGridApiKey))
                {
                    failures.Add(
                        $"'{EmailOptions.SectionName}:SendGridApiKey' is required when " +
                        $"'{EmailOptions.SectionName}:Provider' is '{EmailOptions.SendGridProvider}'.");
                }

                break;

            default:
                failures.Add(
                    $"'{EmailOptions.SectionName}:Provider' must be one of " +
                    $"'{EmailOptions.ConsoleProvider}', '{EmailOptions.AzureCommunicationServicesProvider}', " +
                    $"or '{EmailOptions.SendGridProvider}'.");
                break;
        }

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }

    private static void RequireFromAddress(EmailOptions options, List<string> failures)
    {
        if (string.IsNullOrWhiteSpace(options.FromAddress))
        {
            failures.Add(
                $"'{EmailOptions.SectionName}:FromAddress' is required for the cloud email transports.");
        }
    }
}
