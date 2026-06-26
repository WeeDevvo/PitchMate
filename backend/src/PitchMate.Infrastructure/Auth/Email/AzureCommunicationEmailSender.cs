using Azure;
using Azure.Communication.Email;
using Microsoft.Extensions.Options;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using EmailMessage = PitchMate.Application.Auth.Abstractions.EmailMessage;

namespace PitchMate.Infrastructure.Auth.Email;

/// <summary>
/// Cloud <see cref="IEmailSender"/> backed by Azure Communication Services (<c>Azure.Communication.Email</c>).
/// Recipient validation runs first in <see cref="EmailSenderBase"/>; a validated message is sent through
/// the ACS <see cref="EmailClient"/>, with transient failures (throttling or 5xx responses) retried up to
/// the configured budget and a definitive delivery failure surfaced as a <see cref="Result"/>
/// (Requirements 11.3, 11.5, 11.6).
/// </summary>
public sealed class AzureCommunicationEmailSender : EmailSenderBase
{
    private readonly EmailClient _client;
    private readonly EmailOptions _options;

    /// <summary>Creates the sender from the validated <paramref name="options"/>.</summary>
    public AzureCommunicationEmailSender(IOptions<EmailOptions> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _options = options.Value;
        _client = new EmailClient(_options.AcsConnectionString);
    }

    /// <summary>Test/DI seam that accepts a pre-built <paramref name="client"/>.</summary>
    public AzureCommunicationEmailSender(EmailClient client, IOptions<EmailOptions> options)
    {
        ArgumentNullException.ThrowIfNull(client);
        ArgumentNullException.ThrowIfNull(options);
        _client = client;
        _options = options.Value;
    }

    /// <inheritdoc />
    protected override Task<Result> SendValidatedAsync(
        EmailMessage message, string recipient, CancellationToken cancellationToken) =>
        DeliverWithRetryAsync(
            _options.MaxTransientRetries,
            async token =>
            {
                try
                {
                    await _client.SendAsync(
                        WaitUntil.Completed,
                        senderAddress: _options.FromAddress,
                        recipientAddress: recipient,
                        subject: message.Subject,
                        htmlContent: message.Body,
                        cancellationToken: token).ConfigureAwait(false);

                    return EmailDeliveryAttempt.Success();
                }
                catch (RequestFailedException ex) when (IsTransient(ex.Status))
                {
                    return EmailDeliveryAttempt.TransientFailure(ex.Message);
                }
                catch (RequestFailedException ex)
                {
                    return EmailDeliveryAttempt.PermanentFailure(ex.Message);
                }
            },
            cancellationToken);

    /// <summary>
    /// Treats throttling (429) and server-side errors (5xx) as transient and therefore retryable; any
    /// other status is a permanent rejection.
    /// </summary>
    private static bool IsTransient(int status) => status == 429 || status >= 500;
}
