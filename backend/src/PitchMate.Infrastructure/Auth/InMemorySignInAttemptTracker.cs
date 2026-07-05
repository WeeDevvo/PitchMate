using System.Collections.Concurrent;
using PitchMate.Application.Auth.Abstractions;

namespace PitchMate.Infrastructure.Auth;

/// <summary>
/// In-memory <see cref="ISignInAttemptTracker"/> backing the <em>optional</em> sign-in lockout
/// (Requirement 6.7). Failed attempts are keyed on the normalised email and held as timestamps in a
/// process-local, thread-safe store; a rolling-window count is derived on demand. With the lockout gate
/// disabled — the MVP default — the sign-in handler never consults this seam, so this implementation is
/// only exercised when an operator turns lockout on.
/// </summary>
/// <remarks>
/// The store is deliberately ephemeral and single-process: lockout state is a short-lived hardening
/// signal, not durable Domain state, so it lives outside the auth unit of work. A distributed
/// deployment that needs shared lockout state would substitute a cache-backed implementation without
/// any change to the Application layer. Registered as a singleton so the state survives across request
/// scopes.
/// </remarks>
public sealed class InMemorySignInAttemptTracker : ISignInAttemptTracker
{
    // Keyed on the already-normalised email. Each value is the list of failure instants recorded for
    // that address; access to a given list is guarded by locking the list itself.
    private readonly ConcurrentDictionary<string, List<DateTimeOffset>> _failuresByEmail =
        new(StringComparer.Ordinal);

    /// <inheritdoc />
    public Task<int> CountFailedAttemptsAsync(string normalisedEmail, DateTimeOffset since, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(normalisedEmail);

        if (!_failuresByEmail.TryGetValue(normalisedEmail, out List<DateTimeOffset>? failures))
        {
            return Task.FromResult(0);
        }

        lock (failures)
        {
            // Drop entries that have aged out of the caller's window so the store cannot grow without
            // bound, then count what remains at or after the lower bound.
            failures.RemoveAll(instant => instant < since);
            return Task.FromResult(failures.Count);
        }
    }

    /// <inheritdoc />
    public Task RecordFailedAttemptAsync(string normalisedEmail, DateTimeOffset at, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(normalisedEmail);

        List<DateTimeOffset> failures = _failuresByEmail.GetOrAdd(normalisedEmail, static _ => []);
        lock (failures)
        {
            failures.Add(at);
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task ClearFailedAttemptsAsync(string normalisedEmail, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(normalisedEmail);

        _failuresByEmail.TryRemove(normalisedEmail, out _);
        return Task.CompletedTask;
    }
}
