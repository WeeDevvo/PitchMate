using PitchMate.Application.Matches.Abstractions;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure;
using PitchMate.Infrastructure.Matches;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// Integration tests for the MVP <see cref="TeamBalancer"/> wired to the <em>real</em>
/// <see cref="PlackettLuceRatingEngine"/> (through a recording spy), exercised over squads with up to
/// 16 participants — the brute-force bound the balancer supports.
/// <para>
/// Two guarantees are asserted:
/// </para>
/// <list type="number">
/// <item>The proposal partitions the participant set exactly — every participant on exactly one team,
/// none unassigned, none duplicated, across even and uneven squad sizes (e.g. 7v6)
/// (Requirement 8.2).</item>
/// <item>The balancer's <em>only</em> source of rating information is
/// <see cref="IRatingEngine.Predict"/>: it invokes no other rating operation
/// (<see cref="IRatingEngine.CreateRating"/>, <see cref="IRatingEngine.UpdateRatings"/>, etc.) and so
/// performs no rating arithmetic of its own (Requirement 8.8).</item>
/// </list>
/// <para>Validates: Requirements 8.2, 8.8.</para>
/// </summary>
public sealed class TeamBalancerIntegrationTests
{
    // Requirement 8.2 — for every squad size from a full 5v5 up to the balancer's brute-force bound of
    // 16 (including the uneven 7v6 at 13), the produced proposal is an exact partition of the offered
    // participants into two balanced teams.
    /// <summary>
    /// The balancer produces two teams that partition the offered participants exactly — the union of
    /// both rosters equals the input set with no participant missing and none duplicated — with the
    /// larger team taking the ceiling and the smaller the floor of the split (an uneven 7v6 at 13).
    /// </summary>
    [Theory]
    [InlineData(10)]
    [InlineData(11)]
    [InlineData(12)]
    [InlineData(13)] // 7v6 — the uneven split product.md explicitly allows.
    [InlineData(14)]
    [InlineData(15)]
    [InlineData(16)]
    public async Task Propose_ProducesAnExactTwoTeamPartition_UpTo16Participants(int participantCount)
    {
        var spy = new RecordingRatingEngine(new PlackettLuceRatingEngine(new RatingEngineConfig()));
        var balancer = new TeamBalancer(spy);

        IReadOnlyList<BalancerParticipant> participants = BuildParticipants(participantCount);
        var request = new TeamBalanceRequest(participants, TeamCount: 2);

        var result = await balancer.ProposeAsync(request, CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Message);
        TeamProposal proposal = result.Value!;

        // Exactly two teams are formed.
        Assert.Equal(2, proposal.Teams.Count);

        // The union of both rosters is an exact partition of the offered participants: same cardinality,
        // no duplicates within or across teams, and the same membership-id set that went in.
        List<Guid> assigned = proposal.Teams
            .SelectMany(t => t.ParticipantMembershipIds)
            .ToList();

        var expectedIds = participants.Select(p => p.SquadMembershipId).ToHashSet();

        Assert.Equal(participantCount, assigned.Count);
        Assert.Equal(participantCount, assigned.Distinct().Count());
        Assert.Equal(expectedIds, assigned.ToHashSet());

        // Balanced sizes: the larger team is the ceiling, the smaller the floor (equal for an even
        // count, off-by-one for an odd count such as 13 → 7v6).
        var sizes = proposal.Teams.Select(t => t.ParticipantMembershipIds.Count).OrderByDescending(n => n).ToList();
        Assert.Equal((participantCount + 1) / 2, sizes[0]);
        Assert.Equal(participantCount / 2, sizes[1]);
    }

    // Requirement 8.8 — the balancer consumes ONLY the rating engine's win/draw prediction primitive
    // and performs no rating arithmetic itself: across the whole search it calls Predict and nothing
    // else (no CreateRating / GetState / UpdateRatings / Replay / DecayInactivity).
    /// <summary>
    /// Balancing a full squad invokes <see cref="IRatingEngine.Predict"/> (at least once) and no other
    /// rating operation, proving the prediction primitive is the balancer's sole source of rating
    /// information.
    /// </summary>
    [Fact]
    public async Task Propose_ConsumesOnlyThePredictPrimitive()
    {
        var spy = new RecordingRatingEngine(new PlackettLuceRatingEngine(new RatingEngineConfig()));
        var balancer = new TeamBalancer(spy);

        var request = new TeamBalanceRequest(BuildParticipants(16), TeamCount: 2);

        var result = await balancer.ProposeAsync(request, CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Message);

        // Predict is the only rating operation the balancer touched, and it was actually exercised.
        Assert.True(spy.PredictCallCount > 0, "The balancer must score candidate splits via Predict.");
        Assert.Equal(new[] { nameof(IRatingEngine.Predict) }, spy.InvokedOperations.OrderBy(n => n).ToArray());

        // Belt and braces: the arithmetic operations that would constitute the balancer doing rating
        // maths itself were never called.
        Assert.DoesNotContain(nameof(IRatingEngine.CreateRating), spy.InvokedOperations);
        Assert.DoesNotContain(nameof(IRatingEngine.UpdateRatings), spy.InvokedOperations);
        Assert.DoesNotContain(nameof(IRatingEngine.Replay), spy.InvokedOperations);
    }

    /// <summary>
    /// Builds <paramref name="count"/> participants with distinct membership ids and a spread of
    /// established ratings (varying μ, fixed low σ) so the engine's predictions differ across candidate
    /// splits and the balancer has a genuine fairness landscape to search.
    /// </summary>
    private static IReadOnlyList<BalancerParticipant> BuildParticipants(int count)
    {
        var participants = new List<BalancerParticipant>(count);
        for (var i = 0; i < count; i++)
        {
            // μ fans out around the default mean; σ is a settled, established uncertainty.
            var rating = new Rating(Mu: 20.0 + i, Sigma: 3.0);
            participants.Add(new BalancerParticipant(Guid.CreateVersion7(), rating));
        }

        return participants;
    }

    /// <summary>
    /// A spy <see cref="IRatingEngine"/> that delegates every operation to a real inner engine (so the
    /// balancer scores splits against genuine PlackettLuce predictions) while recording which rating
    /// operations were invoked. It lets the test assert the balancer consumes <em>only</em>
    /// <see cref="IRatingEngine.Predict"/> (Requirement 8.8) without stubbing the prediction maths.
    /// </summary>
    private sealed class RecordingRatingEngine : IRatingEngine
    {
        private readonly IRatingEngine _inner;
        private readonly HashSet<string> _invoked = new();

        public RecordingRatingEngine(IRatingEngine inner) => _inner = inner;

        /// <summary>The distinct rating operations the balancer invoked during the search.</summary>
        public IReadOnlyCollection<string> InvokedOperations => _invoked;

        /// <summary>The number of times <see cref="Predict"/> was invoked.</summary>
        public int PredictCallCount { get; private set; }

        public Result<Rating> CreateRating(SkillTier? tier = null)
        {
            _invoked.Add(nameof(CreateRating));
            return _inner.CreateRating(tier);
        }

        public Result<RatingState> GetState(Rating rating)
        {
            _invoked.Add(nameof(GetState));
            return _inner.GetState(rating);
        }

        public Result<MatchUpdate> UpdateRatings(MatchOutcome outcome)
        {
            _invoked.Add(nameof(UpdateRatings));
            return _inner.UpdateRatings(outcome);
        }

        public Result<IReadOnlyList<Rating>> Replay(
            IReadOnlyList<Rating> initialRatings,
            IReadOnlyList<ReplayMatch> matches)
        {
            _invoked.Add(nameof(Replay));
            return _inner.Replay(initialRatings, matches);
        }

        public Result<Rating> DecayInactivity(Rating rating, int inactiveDays)
        {
            _invoked.Add(nameof(DecayInactivity));
            return _inner.DecayInactivity(rating, inactiveDays);
        }

        public Result<MatchPrediction> Predict(IReadOnlyList<TeamRoster> rosters)
        {
            _invoked.Add(nameof(Predict));
            PredictCallCount++;
            return _inner.Predict(rosters);
        }
    }
}
