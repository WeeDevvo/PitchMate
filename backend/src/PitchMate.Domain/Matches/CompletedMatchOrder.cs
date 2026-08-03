using PitchMate.Domain.Common;

namespace PitchMate.Domain.Matches;

/// <summary>
/// The stable, strict total order over <em>completed</em> matches used by the rating-engine replay:
/// <see cref="Match.CompletedAt"/> ascending first, then <see cref="BaseEntity.Id"/> ascending as the
/// tie-breaker via <see cref="ChronologicalOrder"/> (whose ultimate discriminator is the unique
/// UUID version 7 identity). This is the "definite ordering key with stable tie-breaking" a completed
/// match carries so replay re-derives the rating update in the same order it was first applied
/// (Requirement 12.4).
/// <para>
/// <see cref="ForReplay(System.Collections.Generic.IEnumerable{Match})"/> filters a collection down to
/// exactly the completed matches — excluding cancelled matches, and any match not yet completed — and
/// returns them in replay order (Requirement 15.5). Because every completed match has a distinct
/// <see cref="BaseEntity.Id"/>, the comparer defines a strict total order, so ordering the same set of
/// matches always yields the identical sequence regardless of the input order.
/// </para>
/// <para>
/// The completion instant is compared at its stored UTC value
/// (<see cref="System.DateTimeOffset.UtcDateTime"/>), mirroring <see cref="ChronologicalOrder"/> so the
/// in-memory order matches the order evaluated inside the database.
/// </para>
/// </summary>
public sealed class CompletedMatchOrder : IComparer<Match>
{
    /// <summary>A shared, thread-safe instance of the comparer.</summary>
    public static CompletedMatchOrder Instance { get; } = new();

    private CompletedMatchOrder()
    {
    }

    /// <summary>
    /// Returns the completed matches from <paramref name="matches"/> in rating-engine replay order:
    /// ascending <see cref="Match.CompletedAt"/>, tie-broken by identity. Matches that are cancelled or
    /// not yet completed (and therefore carry no <see cref="Match.CompletedAt"/>) are excluded from the
    /// result (Requirement 12.4, 15.5). The ordering is stable and deterministic: the same set of
    /// matches always produces the identical sequence regardless of the enumeration order supplied.
    /// </summary>
    /// <param name="matches">The candidate matches to filter and order; may contain matches in any state.</param>
    /// <returns>The completed matches in replay order.</returns>
    /// <exception cref="ArgumentNullException">Thrown when <paramref name="matches"/> is <see langword="null"/>.</exception>
    public static IReadOnlyList<Match> ForReplay(IEnumerable<Match> matches)
    {
        ArgumentNullException.ThrowIfNull(matches);

        return matches
            .Where(m => m is not null && m.State == MatchState.Completed && m.CompletedAt.HasValue)
            .OrderBy(m => m, Instance)
            .ToList();
    }

    /// <summary>
    /// Compares two completed matches by completion instant, then by identity. Intended for matches
    /// that carry a <see cref="Match.CompletedAt"/>; <see cref="ForReplay"/> removes those that do not
    /// before ordering. To remain a total order if misused, a match without a completion instant sorts
    /// before one that has it.
    /// </summary>
    /// <param name="x">The first match.</param>
    /// <param name="y">The second match.</param>
    /// <returns>
    /// A negative value when <paramref name="x"/> sorts before <paramref name="y"/>, zero when they are
    /// the same record, and a positive value otherwise.
    /// </returns>
    /// <exception cref="ArgumentNullException">Thrown when <paramref name="x"/> or <paramref name="y"/> is <see langword="null"/>.</exception>
    public int Compare(Match? x, Match? y)
    {
        ArgumentNullException.ThrowIfNull(x);
        ArgumentNullException.ThrowIfNull(y);

        var xCompletedAt = x.CompletedAt;
        var yCompletedAt = y.CompletedAt;

        if (xCompletedAt.HasValue && yCompletedAt.HasValue)
        {
            int byCompletedAt = xCompletedAt.Value.UtcDateTime.CompareTo(yCompletedAt.Value.UtcDateTime);
            if (byCompletedAt != 0)
            {
                return byCompletedAt;
            }
        }
        else if (xCompletedAt.HasValue != yCompletedAt.HasValue)
        {
            // Keep a total order even if a not-yet-completed match reaches the comparer: sort the one
            // without a completion instant first. ForReplay filters these out on the intended path.
            return xCompletedAt.HasValue ? 1 : -1;
        }

        // Stable tie-break by identity, reusing the shared chronological comparer whose ultimate
        // discriminator is the unique GUID v7 Id (Requirement 12.4).
        return ChronologicalOrder.Instance.Compare(x, y);
    }
}
