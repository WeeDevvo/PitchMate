using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;

namespace PitchMate.Infrastructure.Auth.Email;

/// <summary>
/// Shared base for every <see cref="IEmailSender"/> implementation. It enforces the cross-cutting rule
/// that a missing or malformed recipient is rejected with a validation failure <em>before</em> any send
/// attempt, reusing the Domain <see cref="EmailAddress"/> validation rather than re-implementing it, and
/// leaving the related verification/reset request marked not-delivered (Requirement 11.4). Delivery
/// success or failure is surfaced as a <see cref="Result"/>; the base never throws for an expected
/// validation or delivery failure (Requirements 11.5, 11.6). Concrete transports implement
/// <see cref="SendValidatedAsync"/> against an already-validated recipient.
/// </summary>
public abstract class EmailSenderBase : IEmailSender
{
    /// <inheritdoc />
    public async Task<Result> SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);

        // Reuse the single canonical Domain email validation/normalisation rule so the recipient is
        // checked exactly once, the same way everywhere (Requirement 11.4). A malformed recipient never
        // reaches a transport.
        var recipient = EmailAddress.Create(message.Recipient);
        if (!recipient.IsSuccess)
        {
            return Result.Fail(new AuthError(
                AuthErrorCode.InvalidEmail,
                "The email recipient address is missing or malformed; the message was not sent."));
        }

        cancellationToken.ThrowIfCancellationRequested();

        return await SendValidatedAsync(message, recipient.Value!.Value, cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// Delivers <paramref name="message"/> to the already-validated, normalised
    /// <paramref name="recipient"/> using the concrete transport. Implementations return a
    /// <see cref="Result"/> and do not throw for an expected delivery failure.
    /// </summary>
    protected abstract Task<Result> SendValidatedAsync(
        EmailMessage message, string recipient, CancellationToken cancellationToken);

    /// <summary>
    /// Runs <paramref name="attempt"/> until it succeeds, fails permanently, or exhausts the configured
    /// transient-retry budget. The initial attempt is followed by at most
    /// <paramref name="maxTransientRetries"/> further attempts when failures are transient; once the
    /// budget is exhausted (or a failure is permanent) a <see cref="AuthErrorCode.DeliveryFailed"/> result
    /// is returned so the calling use case can leave the request marked not-delivered (Requirement 11.5).
    /// </summary>
    protected static async Task<Result> DeliverWithRetryAsync(
        int maxTransientRetries,
        Func<CancellationToken, Task<EmailDeliveryAttempt>> attempt,
        CancellationToken cancellationToken)
    {
        var retries = Math.Max(0, maxTransientRetries);
        var failures = 0;

        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var outcome = await attempt(cancellationToken).ConfigureAwait(false);
            if (outcome.Succeeded)
            {
                return Result.Ok();
            }

            failures++;
            if (!outcome.IsTransient || failures > retries)
            {
                return Result.Fail(new AuthError(
                    AuthErrorCode.DeliveryFailed,
                    outcome.FailureMessage ?? "The email could not be delivered."));
            }
        }
    }
}
