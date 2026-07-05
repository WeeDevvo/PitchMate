namespace PitchMate.Infrastructure.Auth.Email;

/// <summary>
/// Configuration for transactional email delivery, bound from the <c>Auth:Email</c> configuration
/// section. <see cref="Provider"/> selects which <see cref="Application.Auth.Abstractions.IEmailSender"/>
/// implementation the Api wires up (Requirement 11.7) — <c>Console</c> for local development (logs only,
/// opens no external connection, Requirement 11.2) or a cloud transport (<c>AzureCommunicationServices</c>
/// or <c>SendGrid</c>, Requirement 11.3). Provider secrets (the ACS connection string, the SendGrid API
/// key) come from user-secrets locally and the platform secret store in the cloud, never from source
/// (Requirement 15.5). The DI selection itself lives in the Api (task 14.1); these options only describe it.
/// </summary>
public sealed class EmailOptions
{
    /// <summary>The configuration section these options bind from.</summary>
    public const string SectionName = "Auth:Email";

    /// <summary>The provider value selecting the console transport.</summary>
    public const string ConsoleProvider = "Console";

    /// <summary>The provider value selecting the Azure Communication Services transport.</summary>
    public const string AzureCommunicationServicesProvider = "AzureCommunicationServices";

    /// <summary>The provider value selecting the SendGrid transport.</summary>
    public const string SendGridProvider = "SendGrid";

    /// <summary>
    /// The selected email transport. Defaults to <see cref="ConsoleProvider"/> so an unconfigured
    /// local/dev environment logs messages instead of opening an external connection (Requirement 11.2).
    /// </summary>
    public string Provider { get; init; } = ConsoleProvider;

    /// <summary>
    /// The sender ("from") address stamped on outbound messages. Required by the cloud transports;
    /// the console transport ignores it.
    /// </summary>
    public string FromAddress { get; init; } = "";

    /// <summary>
    /// The Azure Communication Services connection string used by
    /// <see cref="AzureCommunicationEmailSender"/>. Secret; supplied via user-secrets or the platform
    /// secret store, never source (Requirement 15.5). Only required when <see cref="Provider"/> selects
    /// the ACS transport.
    /// </summary>
    public string AcsConnectionString { get; init; } = "";

    /// <summary>
    /// The SendGrid API key used by <see cref="SendGridEmailSender"/>. Secret; supplied via user-secrets
    /// or the platform secret store, never source (Requirement 15.5). Only required when
    /// <see cref="Provider"/> selects the SendGrid transport.
    /// </summary>
    public string SendGridApiKey { get; init; } = "";

    /// <summary>
    /// The transient-retry budget applied by the cloud senders: the maximum number of additional
    /// attempts made after the initial attempt when a delivery fails transiently (e.g. throttling or a
    /// 5xx response). Once exhausted, the delivery failure is surfaced to the caller (Requirement 11.5).
    /// Defaults to 3 (so up to 4 attempts in total). The console transport never retries.
    /// </summary>
    public int MaxTransientRetries { get; init; } = 3;
}
