using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;

using RatingState = PitchMate.Domain.Rating.RatingState;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Example/unit tests for the standing decoration <see cref="GetSquadHandler"/> puts on each
/// <see cref="SquadMemberView"/> (api-response-contracts Requirement 10.1–10.9): the standing is joined
/// onto the membership it belongs to, a membership the source does not report reads as zero appearances
/// with no rating state, the rating classification comes from the Domain engine rather than any
/// σ-comparison here, the read makes exactly one squad-scoped standing call whatever the squad's size,
/// and a standing-source failure degrades the decoration without withholding the membership list.
/// </summary>
[Trait("Feature", "api-response-contracts")]
public class GetSquadStandingTests
{
    private const double EstablishedSigma = 1.0;
    private const double ProvisionalSigma = 5.0;

    private sealed class Harness
    {
        public required SquadStore Store { get; init; }
        public required Squad Squad { get; init; }
        public required FakeMembershipStandingSource Standing { get; init; }
        public required SquadThresholdRatingEngine Engine { get; init; }

        public static Harness Create()
        {
            var store = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;
            store.AddCommittedSquad(squad);

            return new Harness
            {
                Store = store,
                Squad = squad,
                Standing = new FakeMembershipStandingSource(),
                Engine = new SquadThresholdRatingEngine(provisionalThreshold: 2.0)
            };
        }

        /// <summary>Seeds an active registered membership and returns it.</summary>
        public SquadMembership SeedMember(string displayName, out Guid userId)
        {
            userId = Guid.NewGuid();
            SquadMembership membership =
                SquadMembership.CreateRegistered(Squad.Id, userId, displayName).Value!;
            Store.AddCommittedMembership(membership);
            return membership;
        }

        public GetSquadHandler Handler() => new(
            new FakeSquadRepository(Store),
            new FakeSquadMembershipRepository(Store),
            Standing,
            Engine);

        public Task<Result<SquadData>> ReadAs(Guid userId) =>
            Handler().HandleAsync(new GetSquadCommand(userId, Squad.Id), CancellationToken.None);
    }

    [Fact]
    public async Task EachMembershipCarriesItsOwnStanding()
    {
        var harness = Harness.Create();
        SquadMembership reader = harness.SeedMember("Reader", out Guid readerUserId);
        SquadMembership other = harness.SeedMember("Other", out _);

        harness.Standing.WithStanding(harness.Squad.Id, new Dictionary<Guid, MembershipStanding>
        {
            [reader.Id] = new(Appearances: 7, Mu: 25.0, Sigma: EstablishedSigma),
            [other.Id] = new(Appearances: 2, Mu: 25.0, Sigma: ProvisionalSigma)
        });

        Result<SquadData> result = await harness.ReadAs(readerUserId);

        Assert.True(result.IsSuccess);
        SquadMemberView readerView = Assert.Single(result.Value!.Members, m => m.MembershipId == reader.Id);
        SquadMemberView otherView = Assert.Single(result.Value!.Members, m => m.MembershipId == other.Id);

        Assert.Equal(7, readerView.Appearances);
        Assert.Equal(RatingState.Established, readerView.RatingState);
        Assert.Equal(2, otherView.Appearances);
        Assert.Equal(RatingState.Provisional, otherView.RatingState);
    }

    [Fact]
    public async Task MembershipAbsentFromTheStandingReportsZeroAppearancesAndNoRatingState()
    {
        var harness = Harness.Create();
        SquadMembership reader = harness.SeedMember("Reader", out Guid readerUserId);
        SquadMembership unreported = harness.SeedMember("NeverPlayed", out _);

        harness.Standing.WithStanding(harness.Squad.Id, new Dictionary<Guid, MembershipStanding>
        {
            [reader.Id] = new(Appearances: 3, Mu: 25.0, Sigma: EstablishedSigma)
        });

        Result<SquadData> result = await harness.ReadAs(readerUserId);

        Assert.True(result.IsSuccess);
        SquadMemberView view = Assert.Single(result.Value!.Members, m => m.MembershipId == unreported.Id);
        Assert.Equal(0, view.Appearances);
        Assert.Null(view.RatingState);
    }

    [Fact]
    public async Task MembershipWithAppearancesButNoRatingReportsNoRatingState()
    {
        var harness = Harness.Create();
        SquadMembership reader = harness.SeedMember("Reader", out Guid readerUserId);

        harness.Standing.WithStanding(harness.Squad.Id, new Dictionary<Guid, MembershipStanding>
        {
            [reader.Id] = new(Appearances: 4, Mu: null, Sigma: null)
        });

        Result<SquadData> result = await harness.ReadAs(readerUserId);

        Assert.True(result.IsSuccess);
        SquadMemberView view = Assert.Single(result.Value!.Members, m => m.MembershipId == reader.Id);
        Assert.Equal(4, view.Appearances);
        Assert.Null(view.RatingState);
    }

    [Fact]
    public async Task RatingStateComesFromTheEngineRatherThanAnyLocalThresholdComparison()
    {
        var harness = Harness.Create();
        SquadMembership reader = harness.SeedMember("Reader", out Guid readerUserId);

        // σ sits above this engine's threshold, so only the engine's own answer can classify it.
        harness.Standing.WithStanding(harness.Squad.Id, new Dictionary<Guid, MembershipStanding>
        {
            [reader.Id] = new(Appearances: 1, Mu: 25.0, Sigma: ProvisionalSigma)
        });

        Result<SquadData> result = await harness.ReadAs(readerUserId);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, harness.Engine.GetStateCallCount);
        Assert.Equal(
            RatingState.Provisional,
            Assert.Single(result.Value!.Members, m => m.MembershipId == reader.Id).RatingState);
    }

    [Fact]
    public async Task StandingIsReadOnceForTheSquadWhateverItsSize()
    {
        var harness = Harness.Create();
        SquadMembership reader = harness.SeedMember("Reader", out Guid readerUserId);
        for (int i = 0; i < 20; i++)
        {
            harness.SeedMember($"Member{i}", out _);
        }

        harness.Standing.WithStanding(harness.Squad.Id, new Dictionary<Guid, MembershipStanding>
        {
            [reader.Id] = new(Appearances: 1, Mu: 25.0, Sigma: EstablishedSigma)
        });

        Result<SquadData> result = await harness.ReadAs(readerUserId);

        Assert.True(result.IsSuccess);
        Assert.Equal(21, result.Value!.Members.Count);
        Assert.Equal(1, harness.Standing.CallCount);
        Assert.Equal(harness.Squad.Id, Assert.Single(harness.Standing.RequestedSquadIds));
    }

    [Fact]
    public async Task StandingFailureDegradesTheDecorationButNeverTheMembershipList()
    {
        var harness = Harness.Create();
        harness.SeedMember("Reader", out Guid readerUserId);
        harness.SeedMember("Second", out _);
        harness.SeedMember("Third", out _);

        harness.Standing.Failure = new InvalidOperationException("the standing query failed");

        Result<SquadData> result = await harness.ReadAs(readerUserId);

        Assert.True(result.IsSuccess);
        Assert.Equal(3, result.Value!.Members.Count);
        Assert.All(result.Value!.Members, m =>
        {
            Assert.Equal(0, m.Appearances);
            Assert.Null(m.RatingState);
        });
    }

    [Fact]
    public async Task AppearanceCountIsNeverNegative()
    {
        var harness = Harness.Create();
        SquadMembership reader = harness.SeedMember("Reader", out Guid readerUserId);

        harness.Standing.WithStanding(harness.Squad.Id, new Dictionary<Guid, MembershipStanding>
        {
            [reader.Id] = new(Appearances: -5, Mu: 25.0, Sigma: EstablishedSigma)
        });

        Result<SquadData> result = await harness.ReadAs(readerUserId);

        Assert.True(result.IsSuccess);
        Assert.All(result.Value!.Members, m => Assert.True(m.Appearances >= 0));
    }

    [Fact]
    public async Task MemberViewCarriesNoRatingArithmeticInputs()
    {
        // The decoration is a classification, never μ, σ, or a display number (Requirement 10.7).
        string[] members = typeof(SquadMemberView)
            .GetProperties()
            .Select(p => p.Name)
            .ToArray();

        Assert.DoesNotContain("Mu", members);
        Assert.DoesNotContain("Sigma", members);
        Assert.DoesNotContain("DisplayRating", members);

        // And the shipped read really does populate the two fields, so the check above is not vacuous.
        var harness = Harness.Create();
        SquadMembership reader = harness.SeedMember("Reader", out Guid readerUserId);
        harness.Standing.WithStanding(harness.Squad.Id, new Dictionary<Guid, MembershipStanding>
        {
            [reader.Id] = new(Appearances: 9, Mu: 25.0, Sigma: EstablishedSigma)
        });

        Result<SquadData> result = await harness.ReadAs(readerUserId);

        SquadMemberView view = Assert.Single(result.Value!.Members, m => m.MembershipId == reader.Id);
        Assert.Equal(9, view.Appearances);
        Assert.NotNull(view.RatingState);
    }
}
