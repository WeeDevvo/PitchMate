using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Notifications;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
// Both PitchMate.Domain.Matches and PitchMate.Domain.Rating define a Result/Result<T>; alias the
// specific rating types the counting engine's signatures need and fully-qualify the engine's own
// Result<T> in its signatures so it is never confused with the Matches triad.
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using SkillTier = PitchMate.Domain.Rating.SkillTier;
using RatingState = PitchMate.Domain.Rating.RatingState;
using RatingMatchOutcome = PitchMate.Domain.Rating.MatchOutcome;
using RatingMatchUpdate = PitchMate.Domain.Rating.MatchUpdate;
using ReplayMatch = PitchMate.Domain.Rating.ReplayMatch;
using MatchPrediction = PitchMate.Domain.Rating.MatchPrediction;
using TeamRoster = PitchMate.Domain.Rating.TeamRoster;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using NotificationType = PitchMate.Domain.Notifications.NotificationType;
using NotifResult = PitchMate.Domain.Notifications.Result;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// In-memory <see cref="IMatchRepository"/> for the atomic-completion property test: holds a single
/// in-progress match and returns it by identity (or <see langword="null"/> for any other id). The
/// completion handler loads the aggregate back and mutates it in place, so only
/// <see cref="GetByIdAsync"/> is exercised; the staging/listing members are unused and throw if
/// called so a test that accidentally depends on them fails loudly. It is a real fake, not a
/// mocking-framework stub.
/// </summary>
internal sealed class AtomicCompletionMatchRepository(Match match) : IMatchRepository
{
    private readonly Match _match = match;

    public Task<Match?> GetByIdAsync(Guid matchId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(matchId == _match.Id ? _match : null);
    }

    public Task AddAsync(Match match, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Completion does not add matches.");

    public Task<IReadOnlyList<Match>> GetForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Completion does not list matches.");

    public Task<IReadOnlyList<Match>> ListChronologicalCompletedForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Completion does not list completed matches.");
}

/// <summary>
/// In-memory <see cref="ISquadMembershipRepository"/> for the atomic-completion property test. It
/// resolves the acting membership by backing user and squad (the organiser gate) and lists the
/// squad's memberships (read by the handler to source skill tiers for cold-start seeding). Every
/// other member is unused by the completion handler and throws if called. It is a real fake, not a
/// mocking-framework stub.
/// </summary>
internal sealed class AtomicCompletionMembershipRepository(params SquadMembership[] memberships) : ISquadMembershipRepository
{
    private readonly IReadOnlyList<SquadMembership> _memberships = memberships;

    public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken) =>
        Task.FromResult(_memberships.FirstOrDefault(m => m.UserId == userId && m.SquadId == squadId));

    public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken)
    {
        IReadOnlyList<SquadMembership> result = _memberships
            .Where(m => m.SquadId == squadId && (!activeOnly || m.State == MembershipState.Active))
            .ToList();
        return Task.FromResult(result);
    }

    public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public void RemovePermanently(SquadMembership membership) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");
}

/// <summary>
/// In-memory <see cref="IMembershipRatingRepository"/> for the atomic-completion property test. Each
/// participant is pre-seeded with a distinct established rating so the handler reads an existing
/// rating (never seeding from the engine), and the same <see cref="MembershipRating"/> instance is
/// handed back on every <see cref="GetAsync"/> so the test can inspect the post-completion rating the
/// handler overwrote in place. The staging member records any (unexpected) seed insert. It is a real
/// fake, not a mocking-framework stub.
/// </summary>
internal sealed class AtomicCompletionRatingRepository : IMembershipRatingRepository
{
    private readonly Dictionary<Guid, MembershipRating> _byMembership = new();

    /// <summary>The number of times a rating was staged for insert (seeding); expected to be zero here.</summary>
    public int AddCallCount { get; private set; }

    /// <summary>Pre-seeds the current rating for <paramref name="squadMembershipId"/> with <paramref name="rating"/>.</summary>
    public void Seed(Guid squadMembershipId, PlayerRating rating) =>
        _byMembership[squadMembershipId] = MembershipRating.Create(squadMembershipId, rating);

    /// <summary>Returns the (possibly updated) current rating instance held for <paramref name="squadMembershipId"/>.</summary>
    public MembershipRating? Current(Guid squadMembershipId) =>
        _byMembership.TryGetValue(squadMembershipId, out MembershipRating? rating) ? rating : null;

    public Task<MembershipRating?> GetAsync(Guid squadMembershipId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(Current(squadMembershipId));
    }

    public Task AddAsync(MembershipRating rating, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        AddCallCount++;
        _byMembership[rating.SquadMembershipId] = rating;
        return Task.CompletedTask;
    }
}

/// <summary>
/// In-memory <see cref="IRepository{RatingSnapshot}"/> for the atomic-completion property test. It
/// records every snapshot the completion handler stages so the test can assert exactly one snapshot
/// per kickoff participant carrying the engine's output μ/σ. The read/remove/restore members are
/// unused by the handler and throw if called. It is a real fake, not a mocking-framework stub.
/// </summary>
internal sealed class RecordingSnapshotRepository : IRepository<RatingSnapshot>
{
    /// <summary>The snapshots staged for insert, in the order the handler added them.</summary>
    public List<RatingSnapshot> Added { get; } = new();

    public Task AddAsync(RatingSnapshot entity, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Added.Add(entity);
        return Task.CompletedTask;
    }

    public Task<RatingSnapshot?> GetByIdAsync(Guid id, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public Task<IReadOnlyList<RatingSnapshot>> ListAsync(CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public Task<IReadOnlyList<RatingSnapshot>> ListChronologicalAsync(bool includeDeleted, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public void Remove(RatingSnapshot entity) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public void Restore(RatingSnapshot entity) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");
}

/// <summary>
/// A stub <see cref="IRatingEngine"/> for the atomic-completion property test. It counts every
/// <see cref="UpdateRatings"/> invocation (so the test can assert exactly one update per completion)
/// and returns an output that transforms each input rating by a fixed, invertible delta while
/// preserving the input team-and-player ordering — so the test can predict, for each kickoff
/// participant, the exact μ/σ the engine produced and confirm it lands on that membership's snapshot
/// and current rating. The seeding, prediction, replay, and decay members are never reached because
/// every participant is pre-rated, and throw if called. It is a real fake, not a mocking-framework
/// stub.
/// </summary>
internal sealed class CountingRatingEngine : IRatingEngine
{
    /// <summary>The μ added to each input rating to produce its post-update μ.</summary>
    public const double MuDelta = 10.0;

    /// <summary>The σ subtracted from each input rating to produce its post-update σ.</summary>
    public const double SigmaDelta = 0.5;

    /// <summary>The number of times <see cref="UpdateRatings"/> was invoked.</summary>
    public int UpdateRatingsCallCount { get; private set; }

    /// <summary>The deterministic output rating the engine produces for a given input rating.</summary>
    public static PlayerRating Transform(PlayerRating input) =>
        new(input.Mu + MuDelta, input.Sigma - SigmaDelta);

    public PitchMate.Domain.Rating.Result<RatingMatchUpdate> UpdateRatings(RatingMatchOutcome outcome)
    {
        UpdateRatingsCallCount++;

        var teams = new List<IReadOnlyList<PlayerRating>>(outcome.Teams.Count);
        foreach (PitchMate.Domain.Rating.TeamResult team in outcome.Teams)
        {
            var updated = new List<PlayerRating>(team.Players.Count);
            foreach (PitchMate.Domain.Rating.PlayerInput player in team.Players)
            {
                updated.Add(Transform(player.Rating));
            }

            teams.Add(updated);
        }

        return PitchMate.Domain.Rating.Result<RatingMatchUpdate>.Ok(new RatingMatchUpdate(teams));
    }

    public PitchMate.Domain.Rating.Result<PlayerRating> CreateRating(SkillTier? tier = null) =>
        throw new NotSupportedException("Every participant is pre-rated, so no seeding occurs.");

    public PitchMate.Domain.Rating.Result<RatingState> GetState(PlayerRating rating) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public PitchMate.Domain.Rating.Result<IReadOnlyList<PlayerRating>> Replay(
        IReadOnlyList<PlayerRating> initialRatings,
        IReadOnlyList<ReplayMatch> matches) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public PitchMate.Domain.Rating.Result<PlayerRating> DecayInactivity(PlayerRating rating, int inactiveDays) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public PitchMate.Domain.Rating.Result<MatchPrediction> Predict(IReadOnlyList<TeamRoster> rosters) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");
}

/// <summary>
/// A minimal <see cref="ISquadRepository"/> for the atomic-completion property test. The completion
/// handler reads the squad only to render the post-commit notification, tolerating a
/// <see langword="null"/> squad, so this fake returns <see langword="null"/> and the notification
/// still publishes. Every other member is unused by the handler and throws if called.
/// </summary>
internal sealed class AtomicCompletionSquadRepository : ISquadRepository
{
    public Task<Squad?> GetByIdAsync(Guid squadId, CancellationToken cancellationToken) =>
        Task.FromResult<Squad?>(null);

    public Task AddAsync(Squad squad, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public Task<Squad?> GetByIdIncludingDeletedAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public Task<IReadOnlyList<Squad>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public Task<IReadOnlyList<Squad>> ListPurgeDueAsync(DateTimeOffset now, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");

    public void RemovePermanently(Squad squad) =>
        throw new NotSupportedException("Not exercised by the completion handler under test.");
}

/// <summary>
/// A minimal <see cref="IUnitOfWork"/> for the atomic-completion property test that counts the save
/// attempts. The completion transaction stages the state transition, the rating overwrites, and the
/// snapshots and commits them with a single save, so the count lets the test assert that a successful
/// completion commits exactly once (its atomic boundary) and that a rejected completion commits not at
/// all.
/// </summary>
internal sealed class AtomicCompletionUnitOfWork : IUnitOfWork
{
    /// <summary>The number of times <see cref="SaveChangesAsync"/> has been invoked.</summary>
    public int SaveCallCount { get; private set; }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        SaveCallCount++;
        return Task.FromResult(1);
    }
}

/// <summary>
/// A no-op <see cref="INotificationPublisher"/> for the atomic-completion property test that records
/// each publish call and returns success. Completion raises its <c>ResultPosted</c> event post-commit
/// in an isolated block; the property under test does not assert on notification behaviour, so this
/// fake simply lets that best-effort block run without side effects.
/// </summary>
internal sealed class AtomicCompletionPublisher : INotificationPublisher
{
    /// <summary>The number of publish calls made after a committed completion.</summary>
    public int CallCount { get; private set; }

    public Task<NotifResult> PublishAsync(
        NotificationType type,
        Guid squadId,
        IReadOnlyCollection<Guid> directedTargetMembershipIds,
        NotificationContext context,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        CallCount++;
        return Task.FromResult(NotifResult.Ok());
    }
}
