using PitchMate.Application.Squads.Abstractions;

namespace PitchMate.Infrastructure.Squads;

/// <summary>
/// Placeholder implementation of <see cref="IMembershipStandingSource"/> that reports no standing for
/// any membership, so the squad read resolves and degrades to <c>Appearances = 0</c> with no rating
/// state for every member — exactly the shape the read model defines for "no standing to report"
/// (Requirement 10.4).
///
/// <para>
/// <b>Why it exists.</b> The real EF implementation (<c>EfMembershipStandingSource</c>) is the next
/// step of this spec; this registration keeps the host resolvable and the suite green in the meantime,
/// in the same idiom as <see cref="NoMatchHistoryProbe"/> and the stats layer's
/// <c>EmptyRichStatsSource</c>. It is replaced — not supplemented — once the aggregation query lands,
/// at which point appearance counts and μ/σ come from the squad's completed matches.
/// </para>
///
/// <para>Stateless and thread-safe, so a single shared instance is safe as a singleton.</para>
/// </summary>
public sealed class NoMembershipStandingSource : IMembershipStandingSource
{
    private static readonly IReadOnlyDictionary<Guid, MembershipStanding> None =
        new Dictionary<Guid, MembershipStanding>();

    /// <inheritdoc />
    public Task<IReadOnlyDictionary<Guid, MembershipStanding>> ListForSquadAsync(
        Guid squadId,
        CancellationToken cancellationToken)
        => Task.FromResult(None);
}
