using PitchMate.Domain.Common;

namespace PitchMate.Domain.Matches;

/// <summary>
/// The strict total order a squad's matches are listed in: each match's <em>scheduling instant</em>
/// descending, tie-broken by <see cref="BaseEntity.Id"/> descending via <see cref="UuidV7Comparer"/>
/// (Requirement 1.9).
/// <para>
/// A match's scheduling instant is its <see cref="Match.ConfirmedDay"/> where it has one, and
/// otherwise the <em>earliest</em> of its <see cref="Match.CandidateDays"/> — so a confirmed match
/// sits at the day it will be played, and an unconfirmed draft sits at the first day it might be. The
/// candidate days are stored in the order the draft supplied them, which need not be chronological,
/// so the earliest is found by scanning rather than by taking the first.
/// </para>
/// <para>
/// The order is <strong>total</strong>: <see cref="Match.CreateDraft"/> requires 1 to 14 candidate
/// days, so the scheduling instant is never absent, and because every identity is unique no two
/// distinct matches compare equal. Ordering the same set therefore always yields the identical
/// sequence regardless of the input order.
/// </para>
/// <para>
/// Stating the rule once, here, as a pure function is what keeps the in-database
/// <c>ORDER BY</c> of the match-list query provably in step with the specification: this comparer is
/// the oracle that query is validated against. Instants are compared at their stored UTC value
/// (<see cref="DateTimeOffset.UtcDateTime"/>) and identities by their canonical big-endian byte
/// sequence, both mirroring how PostgreSQL evaluates the same order.
/// </para>
/// </summary>
public sealed class MatchSchedulingOrder : IComparer<Match>
{
    /// <summary>A shared, thread-safe instance of the comparer.</summary>
    public static MatchSchedulingOrder Instance { get; } = new();

    private MatchSchedulingOrder()
    {
    }

    /// <summary>
    /// The instant <paramref name="match"/> is ordered by: its <see cref="Match.ConfirmedDay"/> where
    /// it has one, and otherwise the earliest of its <see cref="Match.CandidateDays"/>
    /// (Requirement 1.9).
    /// </summary>
    /// <param name="match">The match to take the scheduling instant of.</param>
    /// <returns>
    /// The scheduling instant, or <see langword="null"/> in the degenerate case of a match carrying
    /// neither a confirmed day nor any candidate day — unreachable through
    /// <see cref="Match.CreateDraft"/>, which requires at least one candidate day, but not enforced by
    /// the database.
    /// </returns>
    /// <exception cref="ArgumentNullException">Thrown when <paramref name="match"/> is <see langword="null"/>.</exception>
    public static DateTimeOffset? SchedulingInstantOf(Match match)
    {
        ArgumentNullException.ThrowIfNull(match);

        if (match.ConfirmedDay is { } confirmed)
        {
            return confirmed.Instant;
        }

        DateTimeOffset? earliest = null;
        foreach (var day in match.CandidateDays)
        {
            if (earliest is null || day.Instant.UtcDateTime < earliest.Value.UtcDateTime)
            {
                earliest = day.Instant;
            }
        }

        return earliest;
    }

    /// <summary>
    /// Returns <paramref name="matches"/> in match-list order — scheduling instant descending, then
    /// identity descending (Requirement 1.9). Applies no filter of its own: every supplied match is
    /// returned.
    /// </summary>
    /// <param name="matches">The matches to order; may be supplied in any sequence.</param>
    /// <returns>The matches in match-list order.</returns>
    /// <exception cref="ArgumentNullException">Thrown when <paramref name="matches"/> is <see langword="null"/>.</exception>
    public static IReadOnlyList<Match> ForMatchList(IEnumerable<Match> matches)
    {
        ArgumentNullException.ThrowIfNull(matches);

        return matches
            .Where(match => match is not null)
            .OrderBy(match => match, Instance)
            .ToList();
    }

    /// <summary>
    /// Compares two matches by scheduling instant descending, then by identity descending.
    /// </summary>
    /// <param name="x">The first match.</param>
    /// <param name="y">The second match.</param>
    /// <returns>
    /// A negative value when <paramref name="x"/> sorts before <paramref name="y"/>, zero when they
    /// are the same record, and a positive value otherwise.
    /// </returns>
    /// <exception cref="ArgumentNullException">Thrown when <paramref name="x"/> or <paramref name="y"/> is <see langword="null"/>.</exception>
    public int Compare(Match? x, Match? y)
    {
        ArgumentNullException.ThrowIfNull(x);
        ArgumentNullException.ThrowIfNull(y);

        DateTimeOffset? xInstant = SchedulingInstantOf(x);
        DateTimeOffset? yInstant = SchedulingInstantOf(y);

        if (xInstant.HasValue && yInstant.HasValue)
        {
            // Descending: the later instant sorts first.
            int byInstant = yInstant.Value.UtcDateTime.CompareTo(xInstant.Value.UtcDateTime);
            if (byInstant != 0)
            {
                return byInstant;
            }
        }
        else if (xInstant.HasValue != yInstant.HasValue)
        {
            // Keep the order total if a match with no scheduling instant ever reaches the comparer:
            // sort it last, mirroring the query's NULLS LAST under the same descending order.
            return xInstant.HasValue ? -1 : 1;
        }

        // Descending identity tie-break: unique GUID v7 ids make the order strict.
        return UuidV7Comparer.Compare(y.Id, x.Id);
    }
}
