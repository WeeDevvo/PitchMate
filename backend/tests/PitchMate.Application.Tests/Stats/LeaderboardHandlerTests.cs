using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Stats;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;
using PitchMate.Domain.Stats;

namespace PitchMate.Application.Tests.Stats;

/// <summary>
/// Example-based unit tests for <see cref="GetLeaderboardHandler"/> covering its error and identity
/// handling (stats-and-summaries testing strategy). They confirm the requester identity is taken from
/// the command's token subject and a conflicting caller-supplied identity is structurally impossible
/// (Requirement 1.5), an unsupported statistic returns <see cref="StatsErrorCode.UnsupportedStatistic"/>
/// and no leaderboard (Requirement 4.7), and an aggregation failure returns
/// <see cref="StatsErrorCode.ComputationFailed"/> with no partial payload (Requirement 2.6).
/// </summary>
[Trait("Feature", "stats-and-summaries")]
public class LeaderboardHandlerTests
{
    // Validates: Requirement 1.5 — the handler resolves the requester's membership using the command's
    // RequestingUserId (the authenticated token subject) and never any other identity.
    [Fact]
    public async Task Resolves_membership_using_the_token_subject_identity_only()
    {
        Guid squadId = Guid.NewGuid();
        Guid tokenUserId = Guid.NewGuid();
        SquadMembership requester = SquadMembership.CreateRegistered(squadId, tokenUserId, "Requester").Value!;
        var memberships = new RecordingMembershipRepository(requester, squadId);

        var handler = new GetLeaderboardHandler(
            memberships,
            new FakeStatsRepository(rows: []));

        var result = await handler.HandleAsync(
            new GetLeaderboardCommand(tokenUserId, squadId, LeaderboardStatistic.Appearances),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        // The only identity ever used to resolve the requester's membership is the token subject.
        Assert.All(memberships.Queries, q => Assert.Equal(tokenUserId, q.UserId));
        Assert.Contains(memberships.Queries, q => q.UserId == tokenUserId && q.SquadId == squadId);
    }

    // Validates: Requirement 4.7 — a statistic outside the supported set is rejected with
    // UnsupportedStatistic and no leaderboard is returned.
    [Fact]
    public async Task Unsupported_statistic_returns_UnsupportedStatistic_and_no_leaderboard()
    {
        Guid squadId = Guid.NewGuid();
        Guid userId = Guid.NewGuid();
        SquadMembership requester = SquadMembership.CreateRegistered(squadId, userId, "Requester").Value!;

        var handler = new GetLeaderboardHandler(
            new FakeStatsMembershipRepository(requester),
            new FakeStatsRepository(rows: []));

        // A value outside the closed LeaderboardStatistic enum.
        var unsupported = (LeaderboardStatistic)999;

        var result = await handler.HandleAsync(
            new GetLeaderboardCommand(userId, squadId, unsupported),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(StatsErrorCode.UnsupportedStatistic, result.Error!.Code);
        Assert.Null(result.Value);
    }

    // Validates: Requirement 2.6 — an aggregation failure returns ComputationFailed with no partial payload.
    [Fact]
    public async Task Aggregation_failure_returns_ComputationFailed_with_no_payload()
    {
        Guid squadId = Guid.NewGuid();
        Guid userId = Guid.NewGuid();
        SquadMembership requester = SquadMembership.CreateRegistered(squadId, userId, "Requester").Value!;

        var handler = new GetLeaderboardHandler(
            new FakeStatsMembershipRepository(requester),
            new FakeStatsRepository(throwOnAggregate: true));

        var result = await handler.HandleAsync(
            new GetLeaderboardCommand(userId, squadId, LeaderboardStatistic.WinPercentage),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(StatsErrorCode.ComputationFailed, result.Error!.Code);
        Assert.Null(result.Value);
    }

    // A non-active-member requester is rejected with the uniform Unauthorized failure (Requirement 1.1).
    [Fact]
    public async Task Non_member_requester_is_rejected_uniformly()
    {
        Guid squadId = Guid.NewGuid();
        Guid userId = Guid.NewGuid();

        var handler = new GetLeaderboardHandler(
            new FakeStatsMembershipRepository(requester: null),
            new FakeStatsRepository(rows: []));

        var result = await handler.HandleAsync(
            new GetLeaderboardCommand(userId, squadId, LeaderboardStatistic.Appearances),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(StatsErrorCode.Unauthorized, result.Error!.Code);
        Assert.Null(result.Value);
    }

    // A squad in its deletion grace period answers an active member with the same uniform Unauthorized
    // failure as a non-member, so its leaderboard stays hidden until it is restored.
    [Fact]
    public async Task Squad_pending_deletion_is_rejected_uniformly()
    {
        Guid squadId = Guid.NewGuid();
        Guid userId = Guid.NewGuid();
        SquadMembership requester = SquadMembership.CreateRegistered(squadId, userId, "Requester").Value!;

        var handler = new GetLeaderboardHandler(
            new FakeStatsMembershipRepository(requester, squadPendingDeletion: true),
            new FakeStatsRepository(throwOnAggregate: true));

        var result = await handler.HandleAsync(
            new GetLeaderboardCommand(userId, squadId, LeaderboardStatistic.Appearances),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(StatsErrorCode.Unauthorized, result.Error!.Code);
        Assert.Null(result.Value);
    }

    // A streak leaderboard folds each row's ordered result sequence and orders best-first, tie-broken by
    // ascending membership identity (Requirement 4.2, 4.3).
    [Fact]
    public async Task Streak_statistic_folds_results_and_orders_best_first()
    {
        Guid squadId = Guid.NewGuid();
        Guid userId = Guid.NewGuid();
        SquadMembership requester = SquadMembership.CreateRegistered(squadId, userId, "Requester").Value!;

        Guid three = Guid.NewGuid();
        Guid one = Guid.NewGuid();
        var rows = new List<LeaderboardRow>
        {
            new(one, "One", MembershipState.Active, Value: null,
                Results: [PlayerResult.Win, PlayerResult.Loss]),
            new(three, "Three", MembershipState.Active, Value: null,
                Results: [PlayerResult.Win, PlayerResult.Win, PlayerResult.Win]),
        };

        var handler = new GetLeaderboardHandler(
            new FakeStatsMembershipRepository(requester),
            new FakeStatsRepository(rows: rows));

        var result = await handler.HandleAsync(
            new GetLeaderboardCommand(userId, squadId, LeaderboardStatistic.WinStreak),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Leaderboard board = result.Value!;
        Assert.Equal(2, board.Entries.Count);
        // Highest win streak first.
        Assert.Equal(three, board.Entries[0].MembershipId);
        Assert.Equal(3.0, board.Entries[0].Value);
        Assert.Equal(one, board.Entries[1].MembershipId);
        Assert.Equal(1.0, board.Entries[1].Value);
        // Only the display-rating leaderboard reports a rating state.
        Assert.All(board.Entries, entry => Assert.Null(entry.RatingState));
    }

    // The display-rating leaderboard ranks a settling rating on its number like any other and passes
    // each row's rating state through, so a client can show the settling note beside the name.
    [Fact]
    public async Task Display_rating_ranks_settling_players_and_carries_their_state()
    {
        Guid squadId = Guid.NewGuid();
        Guid userId = Guid.NewGuid();
        SquadMembership requester = SquadMembership.CreateRegistered(squadId, userId, "Requester").Value!;

        Guid settled = Guid.NewGuid();
        Guid newcomer = Guid.NewGuid();
        var rows = new List<LeaderboardRow>
        {
            new(settled, "Settled", MembershipState.Active, Value: 1040, Results: null,
                RatingState: RatingState.Established),
            new(newcomer, "Newcomer", MembershipState.Active, Value: 1118, Results: null,
                RatingState: RatingState.Provisional),
        };

        var handler = new GetLeaderboardHandler(
            new FakeStatsMembershipRepository(requester),
            new FakeStatsRepository(rows: rows));

        var result = await handler.HandleAsync(
            new GetLeaderboardCommand(userId, squadId, LeaderboardStatistic.DisplayRating),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Leaderboard board = result.Value!;
        Assert.Equal(2, board.Entries.Count);
        Assert.Equal(newcomer, board.Entries[0].MembershipId);
        Assert.Equal(1118.0, board.Entries[0].Value);
        Assert.Equal(RatingState.Provisional, board.Entries[0].RatingState);
        Assert.Equal(settled, board.Entries[1].MembershipId);
        Assert.Equal(RatingState.Established, board.Entries[1].RatingState);
    }

    /// <summary>
    /// A recording <see cref="ISquadMembershipRepository"/> that captures every
    /// <see cref="GetByUserAndSquadAsync"/> query so a test can assert which identity was used to
    /// resolve the requester, and returns the preconfigured requester when the query matches it.
    /// </summary>
    private sealed class RecordingMembershipRepository(SquadMembership requester, Guid expectedSquadId) : ISquadMembershipRepository
    {
        public List<(Guid UserId, Guid SquadId)> Queries { get; } = [];

        public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken)
        {
            Queries.Add((userId, squadId));
            SquadMembership? match = requester.UserId == userId && expectedSquadId == squadId ? requester : null;
            return Task.FromResult(match);
        }

        public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) =>
            Task.FromResult(false);

        public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public void RemovePermanently(SquadMembership membership) =>
            throw new NotSupportedException();
    }
}
