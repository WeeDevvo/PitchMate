using Microsoft.Extensions.Logging;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;

namespace PitchMate.Infrastructure.Auth.Email;

/// <summary>
/// Local/development <see cref="IEmailSender"/> that "delivers" a message by writing its recipient,
/// subject, and body to the application logger and <em>opens no connection to any external email
/// service</em> (Requirement 11.2). Recipient validation is handled by <see cref="EmailSenderBase"/>
/// before this runs, so a malformed recipient never reaches the log. Delivery to the console always
/// succeeds.
/// </summary>
public sealed class ConsoleEmailSender : EmailSenderBase
{
    private readonly ILogger<ConsoleEmailSender> _logger;

    /// <summary>Creates the console sender writing to <paramref name="logger"/>.</summary>
    public ConsoleEmailSender(ILogger<ConsoleEmailSender> logger)
    {
        ArgumentNullException.ThrowIfNull(logger);
        _logger = logger;
    }

    /// <inheritdoc />
    protected override Task<Result> SendValidatedAsync(
        EmailMessage message, string recipient, CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            "Email (console transport) | To: {Recipient} | Subject: {Subject} | Body: {Body}",
            recipient,
            message.Subject,
            message.Body);

        return Task.FromResult(Result.Ok());
    }
}
