namespace PitchMate.Domain.Matches;

/// <summary>
/// A candidate day proposed on a match draft, modelled as a single point in time. The wrapped
/// <see cref="Instant"/> is always normalised to UTC, and equality is defined by that instant:
/// two <see cref="CandidateDay"/> values are equal if and only if they represent the same
/// moment, regardless of the offset of the <see cref="DateTimeOffset"/> they were created from.
/// This is the definition of candidate-day distinctness used when validating a draft.
/// </summary>
/// <remarks>
/// Because equality is by instant, <see cref="Equals(CandidateDay)"/> and
/// <see cref="GetHashCode"/> compare and hash on <see cref="DateTimeOffset.UtcDateTime"/>,
/// mirroring <c>ChronologicalOrder</c>'s use of the stored UTC instant so in-memory behaviour
/// matches the order evaluated inside the database.
/// </remarks>
public readonly record struct CandidateDay
{
    /// <summary>The candidate day as a UTC instant.</summary>
    public DateTimeOffset Instant { get; }

    /// <summary>
    /// Creates a candidate day from <paramref name="instant"/>, normalising it to UTC so the
    /// stored <see cref="Instant"/> is offset-independent.
    /// </summary>
    /// <param name="instant">The point in time to wrap; any offset is accepted and normalised to UTC.</param>
    public CandidateDay(DateTimeOffset instant) => Instant = instant.ToUniversalTime();

    /// <summary>
    /// Determines whether this candidate day represents the same instant as
    /// <paramref name="other"/>. Two days with different offsets but the same moment are equal.
    /// </summary>
    /// <param name="other">The candidate day to compare with.</param>
    /// <returns><see langword="true"/> when both represent the same instant; otherwise <see langword="false"/>.</returns>
    public bool Equals(CandidateDay other) => Instant.UtcDateTime.Equals(other.Instant.UtcDateTime);

    /// <summary>Returns a hash code consistent with instant-based equality.</summary>
    /// <returns>The hash code of the underlying UTC instant.</returns>
    public override int GetHashCode() => Instant.UtcDateTime.GetHashCode();
}
