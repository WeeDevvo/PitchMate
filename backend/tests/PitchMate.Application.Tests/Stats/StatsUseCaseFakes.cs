using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Stats;
using PitchMate.Domain.Squads;
// Both PitchMate.Domain.Rating and PitchMate.Application.Stats define a Result/Result<T>; alias the
// rating types the fake engine's signatures need so its own Result<T> is never confused with the
// stats triad.
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using SkillTier = PitchMate.Domain.Rating.SkillTier;
using RatingState = PitchMate.Domain.Rating.RatingState;
using MatchOutcome = PitchMate.Domain.Rating.MatchOutcome;
using MatchUpdate = PitchMate.Domain.Rating.MatchUpdate;
using ReplayMatch = PitchMate.Domain.Rating.ReplayMatch;
using MatchPrediction = PitchMate.Domain.Rating.MatchPrediction;
using TeamRoster = PitchMate.Domain.Rating.TeamRoster;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using DisplayRatingParameters = PitchMate.Domain.Stats.DisplayRatingParameters;

namespace PitchMate.Application.Tests.Stats;

/// <summary>
/// In-memory <see cref="IStatsRepository"/> for the stats use-case tests. It returns a preconfigured
/// <see cref="MembershipRef"/> and <see cref="MembershipStatsData"/> for the subject and a
/// preconfigured set of <see cref="LeaderboardRow"/>s, or optionally throws to simulate an aggregation
/// failure (Requirement 2.6). It is a real fake, not a mocking-framework stub.
/// </summary>
internal sealed class FakeStatsRepository : IStatsRepository
{
    private readonly MembershipRef? _subject;
    private readonly MembershipStatsData? _data;
    private readonly IReadOnlyList<LeaderboardRow> _rows;
    private readonly bool _throwOnAggregate;

    public FakeStatsRepository(
        MembershipRef? subject = null,
        MembershipStatsData? data = null,
        IReadOnlyList<LeaderboardRow>? rows = null,
        bool throwOnAggregate = false)
    {
        _subject = subject;
        _data = data;
        _rows = rows ?? [];
        _throwOnAggregate = throwOnAggregate;
    }

    public Task<MembershipStatsData?> GetMembershipStatsAsync(Guid squadId, Guid membershipId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if (_throwOnAggregate)
        {
            throw new InvalidOperationException("Simulated aggregation failure.");
        }

        return Task.FromResult(_data);
    }

    public Task<IReadOnlyList<LeaderboardRow>> GetLeaderboardRowsAsync(Guid squadId, LeaderboardStatistic statistic, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if (_throwOnAggregate)
        {
            throw new InvalidOperationException("Simulated aggregation failure.");
        }

        return Task.FromResult(_rows);
    }

    public Task<MembershipRef?> FindMembershipAsync(Guid squadId, Guid membershipId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(_subject);
    }
}

/// <summary>
/// In-memory <see cref="IDisplayRatingParametersSource"/> returning a fixed parameter set (defaulting
/// to the MVP defaults K = 40, C = 1000, Floor = 0).
/// </summary>
internal sealed class FakeDisplayRatingParametersSource(DisplayRatingParameters? parameters = null)
    : IDisplayRatingParametersSource
{
    private readonly DisplayRatingParameters _parameters = parameters ?? DisplayRatingParameters.Default;

    public Task<DisplayRatingParameters> GetAsync(Guid squadId, CancellationToken ct) =>
        Task.FromResult(_parameters);
}

/// <summary>
/// In-memory <see cref="IRichStatsSource"/> returning a fixed rich-stats value (or <see langword="null"/>
/// for "no data") for every membership.
/// </summary>
internal sealed class FakeRichStatsSource(RichStats? rich = null, Guid? topScorer = null) : IRichStatsSource
{
    private readonly RichStats? _rich = rich;
    private readonly Guid? _topScorer = topScorer;

    public Task<RichStats?> GetForMembershipAsync(Guid squadId, Guid membershipId, CancellationToken ct) =>
        Task.FromResult(_rich);

    public Task<Guid?> GetTopScorerAsync(Guid squadId, CancellationToken ct) =>
        Task.FromResult(_topScorer);
}

/// <summary>
/// In-memory <see cref="ISquadMembershipRepository"/> for the stats use-case tests. It resolves the
/// requester's membership by backing user and squad — the only member the stats handlers call — and
/// throws for every other member so a test that accidentally depends on them fails loudly. It is a
/// real fake, not a mocking-framework stub.
/// </summary>
internal sealed class FakeStatsMembershipRepository(SquadMembership? requester) : ISquadMembershipRepository
{
    private readonly SquadMembership? _requester = requester;

    public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        SquadMembership? match = _requester is not null && _requester.UserId == userId && _requester.SquadId == squadId
            ? _requester
            : null;
        return Task.FromResult(match);
    }

    public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");

    public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");

    public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");

    public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");

    public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");

    public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");

    public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");

    public void RemovePermanently(SquadMembership membership) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");
}

/// <summary>
/// In-memory <see cref="ISquadRepository"/> for the stats use-case tests. It returns a single
/// preconfigured squad by identity (the profile handler reads its
/// <see cref="SquadFeature.LiveMatchTracking"/> flag) and throws for every other member. It is a real
/// fake, not a mocking-framework stub.
/// </summary>
internal sealed class FakeStatsSquadRepository(Squad? squad) : ISquadRepository
{
    private readonly Squad? _squad = squad;

    public Task<Squad?> GetByIdAsync(Guid squadId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(_squad is not null && _squad.Id == squadId ? _squad : null);
    }

    public Task AddAsync(Squad squad, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");

    public Task<Squad?> GetByIdIncludingDeletedAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");

    public Task<IReadOnlyList<Squad>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");

    public Task<IReadOnlyList<Squad>> ListPurgeDueAsync(DateTimeOffset now, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");

    public void RemovePermanently(Squad squad) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");
}

/// <summary>
/// A deterministic <see cref="IRatingEngine"/> for the stats use-case tests. Its
/// <see cref="GetState"/> classifies a rating as <see cref="RatingState.Established"/> when σ is at or
/// below a fixed threshold and <see cref="RatingState.Provisional"/> otherwise, matching the
/// rating-engine contract closely enough to drive the summary and progression shaping. Every other
/// operation is unused by the stats handlers and throws if called.
/// </summary>
internal sealed class ThresholdRatingEngine(double provisionalThreshold = 2.0) : IRatingEngine
{
    /// <summary>The σ threshold at or below which a rating is established.</summary>
    public double ProvisionalThreshold { get; } = provisionalThreshold;

    public PitchMate.Domain.Rating.Result<RatingState> GetState(PlayerRating rating) =>
        PitchMate.Domain.Rating.Result<RatingState>.Ok(
            rating.Sigma <= ProvisionalThreshold ? RatingState.Established : RatingState.Provisional);

    public PitchMate.Domain.Rating.Result<PlayerRating> CreateRating(SkillTier? tier = null) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");

    public PitchMate.Domain.Rating.Result<MatchUpdate> UpdateRatings(MatchOutcome outcome) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");

    public PitchMate.Domain.Rating.Result<IReadOnlyList<PlayerRating>> Replay(
        IReadOnlyList<PlayerRating> initialRatings,
        IReadOnlyList<ReplayMatch> matches) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");

    public PitchMate.Domain.Rating.Result<PlayerRating> DecayInactivity(PlayerRating rating, int inactiveDays) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");

    public PitchMate.Domain.Rating.Result<MatchPrediction> Predict(IReadOnlyList<TeamRoster> rosters) =>
        throw new NotSupportedException("Not exercised by the stats handlers under test.");
}
