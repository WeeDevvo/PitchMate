using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Stats;
using PitchMate.Domain.Common;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;
using PitchMate.Domain.Stats;

namespace PitchMate.Application.Tests.Stats;

/// <summary>
/// Property-based tests for <see cref="GetPlayerProfileHandler"/> rating-progression shaping
/// (stats-and-summaries design Property 9: Rating progression). Driven against in-memory fakes. For an
/// arbitrary snapshot sequence, the progression has exactly one point per snapshot ordered by
/// completion instant then match identity, each carrying that snapshot's μ/σ, the state from
/// <see cref="IRatingEngine.GetState"/>, and a display rating iff established; it is empty when there is
/// no snapshot. Each property runs at least 100 iterations.
/// </summary>
[Trait("Feature", "stats-and-summaries")]
public class RatingProgressionPropertyTests
{
    // Feature: stats-and-summaries, Property 9: Rating progression - for an arbitrary snapshot sequence
    // the progression has exactly one point per snapshot in order (by CompletedAt then MatchId), each
    // carrying that snapshot's μ/σ, State from IRatingEngine.GetState, and a DisplayRating iff
    // Established (null when Provisional); the progression is empty when there is no snapshot.
    // Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
    [Property(MaxTest = 200)]
    [Trait("Property", "9")]
    public Property ProgressionMirrorsOrderedSnapshots() =>
        Prop.ForAll(Arb.From(SnapshotsGen()), snapshots =>
        {
            var engine = new ThresholdRatingEngine();
            DisplayRatingParameters parameters = DisplayRatingParameters.Default;

            MembershipStatsData data = new(
                Appearances: 0,
                Wins: 0,
                Draws: 0,
                Losses: 0,
                Results: [],
                Snapshots: snapshots,
                Mu: null,
                Sigma: null,
                BibAppearances: 0,
                CoAppearances: [],
                Partnerships: [],
                BogeyOpponents: []);

            Guid membershipId = Guid.NewGuid();
            var subject = new MembershipRef(membershipId, "Member", MembershipState.Active, IsGuest: false);

            Squad squad = Squad.Create("The Squad").Value!;
            Guid userId = Guid.NewGuid();
            SquadMembership requester = SquadMembership.CreateRegistered(squad.Id, userId, "Requester").Value!;

            var handler = new GetPlayerProfileHandler(
                new FakeStatsMembershipRepository(requester),
                new FakeStatsSquadRepository(squad),
                new FakeStatsRepository(subject: subject, data: data),
                new FakeDisplayRatingParametersSource(parameters),
                new FakeRichStatsSource(),
                engine);

            var result = handler
                .HandleAsync(new GetPlayerProfileCommand(userId, squad.Id, membershipId), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            if (!result.IsSuccess)
            {
                return false.ToProperty();
            }

            IReadOnlyList<RatingProgressionPoint> actual = result.Value!.Progression;

            List<RatingProgressionPoint> expected = snapshots
                .OrderBy(s => s.CompletedAt)
                .ThenBy(s => s.MatchId, UuidV7Comparer.Instance)
                .Select(s =>
                {
                    RatingState state = engine.GetState(new Rating(s.Mu, s.Sigma)).Value;
                    int? display = DisplayRatingCalculator.Compute(state, s.Mu, s.Sigma, parameters);
                    return new RatingProgressionPoint(s.CompletedAt, s.Mu, s.Sigma, state, display);
                })
                .ToList();

            bool orderedAndShaped = actual.SequenceEqual(expected);

            // Each provisional point carries no display rating; each established point carries one.
            bool displayGating = actual.All(p =>
                (p.State == RatingState.Provisional && p.DisplayRating is null)
                || (p.State == RatingState.Established && p.DisplayRating is not null));

            bool emptyWhenNoSnapshot = snapshots.Count != 0 || actual.Count == 0;

            return (orderedAndShaped && displayGating && emptyWhenNoSnapshot).ToProperty();
        });

    private static Gen<IReadOnlyList<MembershipStatsData.RatingSnapshotRow>> SnapshotsGen() =>
        from count in Gen.Choose(0, 15)
        from rows in GenList(count, SnapshotRowGen())
        select rows;

    private static Gen<MembershipStatsData.RatingSnapshotRow> SnapshotRowGen() =>
        // A small set of instants (so ties on CompletedAt occur and exercise the MatchId tie-break),
        // paired with μ and σ spanning both sides of the provisional threshold.
        from minute in Gen.Choose(0, 6)
        from mu in Gen.Choose(150, 350).Select(v => v / 10.0)
        from sigma in Gen.Choose(1, 60).Select(v => v / 10.0)
        select new MembershipStatsData.RatingSnapshotRow(
            DateTimeOffset.UnixEpoch.AddMinutes(minute), Guid.NewGuid(), mu, sigma);

    private static Gen<IReadOnlyList<T>> GenList<T>(int length, Gen<T> element)
    {
        if (length <= 0)
        {
            return Gen.Constant((IReadOnlyList<T>)new List<T>());
        }

        return from head in element
               from tail in GenList(length - 1, element)
               select (IReadOnlyList<T>)Prepend(head, tail);
    }

    private static List<T> Prepend<T>(T head, IReadOnlyList<T> tail)
    {
        var list = new List<T>(tail.Count + 1) { head };
        list.AddRange(tail);
        return list;
    }
}
