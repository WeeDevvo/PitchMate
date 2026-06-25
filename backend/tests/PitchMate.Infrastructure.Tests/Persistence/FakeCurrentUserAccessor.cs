using PitchMate.Application.Common;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// A controllable <see cref="ICurrentUserAccessor"/> whose current actor is settable, so
/// audit-stamping properties can drive a known actor (or no actor at all) deterministically.
/// </summary>
public sealed class FakeCurrentUserAccessor : ICurrentUserAccessor
{
    /// <summary>Creates an accessor reporting no current user.</summary>
    public FakeCurrentUserAccessor()
    {
    }

    /// <summary>Creates an accessor reporting the supplied current user.</summary>
    /// <param name="currentUserId">The actor identifier to report, or <see langword="null"/> for a system operation.</param>
    public FakeCurrentUserAccessor(string? currentUserId)
    {
        CurrentUserId = currentUserId;
    }

    /// <inheritdoc />
    public string? CurrentUserId { get; set; }
}
