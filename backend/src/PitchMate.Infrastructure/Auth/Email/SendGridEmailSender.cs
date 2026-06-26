using Microsoft.Extensions.Options;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using SendGrid;
using SendGrid.Helpers.Mail;
using SendGridEmailAddress = SendGrid.Helpers.Mail.EmailAddress;

namespace PitchMate.Infrastructure.Auth.Email;

/// <summary>
/// Cloud <see cref="IEmailSender"/> backed by SendGrid (<c>SendGrid</c>). Recipient validation runs first
/// in <see cref="EmailSenderBase"/>; a validated message is sent through the SendGrid client, with
/// transient failures (a 429 or 5xx response) retried up to the configured budget and a definitive
/// delivery failure surfaced as a <see cref="Result"/> (Requirements 11.3, 11.5, 11.6).
/// </summary>
public sealed class SendGridEmailSender : EmailSenderBase
{
    private readonly ISendGridClient _client;
    private readonly EmailOptions _options;

    /// <summary>Creates the sender from the validated <paramref name="options"/>.</summary>
    public SendGridEmailSender(IOptions<EmailOptions> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _options = options.Value;
        _client = new SendGridClient(_options.SendGridApiKey);
    }

    /// <summary>Test/DI seam that accepts a pre-built <paramref name="client"/>.</summary>
    public SendGridEmailSender(ISendGridClient client, IOptions<EmailOptions> options)
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
                var mail = MailHelper.CreateSingleEmail(
                    new SendGridEmailAddress(_options.FromAddress),
                    new SendGridEmailAddress(recipient),
                    message.Subject,
                    plainTextContent: message.Body,
                    htmlContent: message.Body);

                var response = await _client.SendEmailAsync(mail, token).ConfigureAwait(false);
                var status = (int)response.StatusCode;

                if (status is >= 200 and < 300)
                {
                    return EmailDeliveryAttempt.Success();
                }

                var detail = $"SendGrid returned status code {status}.";
                return IsTransient(status)
                    ? EmailDeliveryAttempt.TransientFailure(detail)
                    : EmailDeliveryAttempt.PermanentFailure(detail);
            },
            cancellationToken);

    /// <summary>
    /// Treats throttling (429) and server-side errors (5xx) as transient and therefore retryable; any
    /// other non-2xx status is a permanent rejection.
    /// </summary>
    private static bool IsTransient(int status) => status == 429 || status >= 500;
}
