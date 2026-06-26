namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// Tracks consecutive failed sign-in attempts per normalised email address to back the
/// <em>optional</em> sign-in lockout (Requirement 6.7). The handler consults this seam only
/// when lockout is enabled; with lockout disabled — the MVP default — it is never called.
/// <para>
/// Lockout state is deliberately ephemeral (a short rolling window keyed on the normalised
/// email), so it is modelled as a focused Application abstraction rather than a persisted
/// Domain entity: an Infrastructure implementation may back it with an in-memory or
/// distributed cache. Implementations manage their own storage and are not part of the
/// auth unit of work.
/// </para>
/// </summary>
public interface ISignInAttemptTracker
{
    /// <summary>
    /// Returns the number of failed sign-in attempts recorded for
    /// <paramref name="normalisedEmail"/> at or after <paramref name="since"/>.
    /// </summary>
    /// <param name="normalisedEmail">The normalised email the attempts are keyed on.</param>
    /// <param name="since">The inclusive lower bound of the rolling window to count within.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task<int> CountFailedAttemptsAsync(string normalisedEmail, DateTimeOffset since, CancellationToken ct);

    /// <summary>
    /// Records a single failed sign-in attempt for <paramref name="normalisedEmail"/> at
    /// the instant <paramref name="at"/>.
    /// </summary>
    /// <param name="normalisedEmail">The normalised email the attempt is keyed on.</param>
    /// <param name="at">The instant, read from the Clock, at which the failure occurred.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task RecordFailedAttemptAsync(string normalisedEmail, DateTimeOffset at, CancellationToken ct);

    /// <summary>
    /// Clears the recorded failed attempts for <paramref name="normalisedEmail"/> following
    /// a successful sign-in, so the lockout counter resets.
    /// </summary>
    /// <param name="normalisedEmail">The normalised email whose attempts are cleared.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task ClearFailedAttemptsAsync(string normalisedEmail, CancellationToken ct);
}
