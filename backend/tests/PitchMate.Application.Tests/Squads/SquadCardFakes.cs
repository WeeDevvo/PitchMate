using PitchMate.Application.Squads.Abstractions;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// A hand-written <see cref="ISquadCardSource"/> for the squad list tests. It answers the facts a test
/// seeds for a squad, or an empty card (no players, no next match, no form) for any other, and records
/// which membership each squad was read for.
/// </summary>
internal sealed class FakeSquadCardSource : ISquadCardSource
{
    private readonly Dictionary<Guid, SquadCardFacts> _bySquad = new();

    /// <summary>The card facts reported for a squad nobody seeded.</summary>
    public static readonly SquadCardFacts EmptyCard = new(0, null, []);

    /// <summary>Each read, in order: the squad and the viewer's membership it was read for.</summary>
    public List<(Guid SquadId, Guid? MembershipId)> Reads { get; } = [];

    /// <summary>Seeds the facts the source reports for <paramref name="squadId"/>.</summary>
    public void Seed(Guid squadId, SquadCardFacts facts) => _bySquad[squadId] = facts;

    public Task<SquadCardFacts> ReadAsync(Guid squadId, Guid? membershipId, CancellationToken cancellationToken)
    {
        Reads.Add((squadId, membershipId));
        return Task.FromResult(_bySquad.TryGetValue(squadId, out SquadCardFacts? facts) ? facts : EmptyCard);
    }
}
