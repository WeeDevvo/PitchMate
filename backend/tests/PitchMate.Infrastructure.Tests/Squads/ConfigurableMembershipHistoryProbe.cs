using PitchMate.Application.Squads.Abstractions;

namespace PitchMate.Infrastructure.Tests.Squads;

/// <summary>
/// A test double for <see cref="IMembershipHistoryProbe"/> whose "has match history" answer is
/// controllable per membership. The production default (<c>NoMatchHistoryProbe</c>) always reports
/// no history, so erasure/purge always hard-remove; this double lets the DB-invariant tests drive
/// the <em>anonymise</em> branch as well by marking specific membership identities as
/// history-bearing. The match-lifecycle spec will later supply the real probe over its own tables.
/// </summary>
public sealed class ConfigurableMembershipHistoryProbe : IMembershipHistoryProbe
{
    private readonly HashSet<Guid> _withHistory = [];

    /// <summary>Marks <paramref name="membershipId"/> as carrying match history, so erasure anonymises it.</summary>
    public void MarkHasHistory(Guid membershipId) => _withHistory.Add(membershipId);

    /// <inheritdoc />
    public Task<bool> HasMatchHistoryAsync(Guid membershipId, CancellationToken cancellationToken)
        => Task.FromResult(_withHistory.Contains(membershipId));
}
