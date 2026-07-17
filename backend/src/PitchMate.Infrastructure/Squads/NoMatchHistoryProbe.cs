using PitchMate.Application.Squads.Abstractions;

namespace PitchMate.Infrastructure.Squads;

/// <summary>
/// Conservative default implementation of <see cref="IMembershipHistoryProbe"/> for use until the
/// match-lifecycle spec introduces the match tables this probe would query. It reports that a
/// membership carries no match history, so erasure always takes the hard-remove branch rather than
/// anonymising (Requirement 18.2).
///
/// <para>
/// <b>Why "false" is the safe default.</b> This spec does not yet own any match entities, so there is
/// no history to preserve; hard-removing a membership with no recorded matches loses nothing and
/// keeps the data model clean. Once the match-lifecycle spec exists, it replaces this registration
/// with an implementation that probes the real match tables, at which point memberships linked to
/// immutable matches will correctly be anonymised instead (Requirement 18.1, 18.2).
/// </para>
/// </summary>
public sealed class NoMatchHistoryProbe : IMembershipHistoryProbe
{
    /// <inheritdoc />
    public Task<bool> HasMatchHistoryAsync(Guid membershipId, CancellationToken cancellationToken)
        => Task.FromResult(false);
}
