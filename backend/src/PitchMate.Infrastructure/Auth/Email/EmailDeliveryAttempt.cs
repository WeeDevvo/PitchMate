namespace PitchMate.Infrastructure.Auth.Email;

/// <summary>
/// The outcome of a single delivery attempt made by a cloud email sender, used by
/// <see cref="EmailSenderBase.DeliverWithRetryAsync"/> to decide whether to retry. A <em>transient</em>
/// failure (throttling, a 5xx response, a transport hiccup) is eligible for retry within the configured
/// budget; a <em>permanent</em> failure (a rejected request) is not and is surfaced immediately
/// (Requirement 11.5).
/// </summary>
public readonly record struct EmailDeliveryAttempt
{
    /// <summary>True when the attempt delivered the message.</summary>
    public bool Succeeded { get; }

    /// <summary>True when a failed attempt may be retried within the budget.</summary>
    public bool IsTransient { get; }

    /// <summary>Diagnostic detail for a failed attempt; null on success.</summary>
    public string? FailureMessage { get; }

    private EmailDeliveryAttempt(bool succeeded, bool isTransient, string? failureMessage)
    {
        Succeeded = succeeded;
        IsTransient = isTransient;
        FailureMessage = failureMessage;
    }

    /// <summary>A successful delivery attempt.</summary>
    public static EmailDeliveryAttempt Success() => new(true, false, null);

    /// <summary>A failed attempt that is eligible for retry within the configured budget.</summary>
    public static EmailDeliveryAttempt TransientFailure(string message) => new(false, true, message);

    /// <summary>A failed attempt that must not be retried and is surfaced immediately.</summary>
    public static EmailDeliveryAttempt PermanentFailure(string message) => new(false, false, message);
}
