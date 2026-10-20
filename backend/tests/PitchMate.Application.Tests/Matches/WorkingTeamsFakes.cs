using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Rating;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Tests.Matches;

/// <summary>A working-teams source answering every lookup with one fixed projection (or <see langword="null"/>).</summary>
internal sealed class RecordingWorkingTeamsSource(WorkingTeamsProjection? projection) : IWorkingTeamsSource
{
    private readonly List<Guid> _calls = [];

    public IReadOnlyList<Guid> Calls => _calls;

    public Task<WorkingTeamsProjection?> FindAsync(Guid matchId, CancellationToken cancellationToken)
    {
        _calls.Add(matchId);
        return Task.FromResult(projection);
    }
}

/// <summary>
/// A rating engine that records every <see cref="Predict"/> and <see cref="CreateRating"/> call and
/// answers the prediction it was configured with. Seeds are distinguishable by tier, so a test can see
/// which rating reached the engine. Every other member is outside the working-teams read.
/// </summary>
internal sealed class SpyRatingEngine : IRatingEngine
{
    private readonly Result<MatchPrediction> _prediction;

    public SpyRatingEngine(Result<MatchPrediction>? prediction = null)
    {
        _prediction = prediction ?? Result<MatchPrediction>.Ok(new MatchPrediction([0.6, 0.4], 0.1));
    }

    public List<IReadOnlyList<TeamRoster>> PredictCalls { get; } = [];

    public List<SkillTier?> SeededTiers { get; } = [];

    /// <summary>The rating a seed for <paramref name="tier"/> produces.</summary>
    public static Rating SeedFor(SkillTier? tier) => new(20 + (tier is null ? 0 : (int)tier + 1), 8);

    public Result<Rating> CreateRating(SkillTier? tier = null)
    {
        SeededTiers.Add(tier);
        return Result<Rating>.Ok(SeedFor(tier));
    }

    public Result<MatchPrediction> Predict(IReadOnlyList<TeamRoster> rosters)
    {
        PredictCalls.Add(rosters);
        return _prediction;
    }

    public Result<RatingState> GetState(Rating rating) => throw new NotSupportedException();

    public Result<MatchUpdate> UpdateRatings(MatchOutcome outcome) => throw new NotSupportedException();

    public Result<IReadOnlyList<Rating>> Replay(IReadOnlyList<Rating> initialRatings, IReadOnlyList<ReplayMatch> matches) =>
        throw new NotSupportedException();

    public Result<Rating> DecayInactivity(Rating rating, int inactiveDays) => throw new NotSupportedException();
}

/// <summary>A membership gateway that answers every acting-membership lookup with one fixed membership.</summary>
internal sealed class AnyLookupMembershipRepository(SquadMembership membership) : ISquadMembershipRepository
{
    public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken) =>
        Task.FromResult<SquadMembership?>(membership);

    public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken) => throw new NotSupportedException();

    public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken) => throw new NotSupportedException();

    public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) => throw new NotSupportedException();

    public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) => throw new NotSupportedException();

    public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public void RemovePermanently(SquadMembership membership) => throw new NotSupportedException();
}
