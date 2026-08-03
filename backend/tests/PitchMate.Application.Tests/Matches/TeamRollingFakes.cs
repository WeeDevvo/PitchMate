using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
// Both PitchMate.Domain.Matches and PitchMate.Domain.Rating define a Result/Result<T>; keep the
// Matches namespace imported (so the unqualified Result<TeamProposal> the balancer returns binds to
// the Matches triad) and alias the specific rating types the stub engine's signatures need. The
// engine's own Result<T> is fully qualified in its signatures for the same reason.
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using SkillTier = PitchMate.Domain.Rating.SkillTier;
using RatingState = PitchMate.Domain.Rating.RatingState;
using MatchOutcome = PitchMate.Domain.Rating.MatchOutcome;
using MatchUpdate = PitchMate.Domain.Rating.MatchUpdate;
using ReplayMatch = PitchMate.Domain.Rating.ReplayMatch;
using MatchPrediction = PitchMate.Domain.Rating.MatchPrediction;
using TeamRoster = PitchMate.Domain.Rating.TeamRoster;
using PlayerRating = PitchMate.Domain.Rating.Rating;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// In-memory <see cref="IMatchRepository"/> for the team-rolling handler tests: holds a single match
/// and returns it by identity (or <see langword="null"/> for any other id). The team-rolling handlers
/// read the aggregate back and mutate it in place, so only <see cref="GetByIdAsync"/> is exercised;
/// the staging/listing members are not used and throw if called, so a test that accidentally depends
/// on them fails loudly. It is a real fake, not a mocking-framework stub.
/// </summary>
internal sealed class TeamRollingMatchRepository(Match match) : IMatchRepository
{
    private readonly Match _match = match;

    public Task<Match?> GetByIdAsync(Guid matchId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(matchId == _match.Id ? _match : null);
    }

    public Task AddAsync(Match match, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Team rolling does not add matches.");

    public Task<IReadOnlyList<Match>> GetForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Team rolling does not list matches.");

    public Task<IReadOnlyList<Match>> ListChronologicalCompletedForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Team rolling does not list completed matches.");
}

/// <summary>
/// In-memory <see cref="ISquadMembershipRepository"/> for the team-rolling handler tests. It resolves
/// the acting membership by backing user and squad (the gate the handlers call) and lists the squad's
/// memberships (read by the balance-request factory to source skill tiers). Every other member is
/// unused by the handlers under test and throws if called. It is a real fake, not a mocking-framework
/// stub.
/// </summary>
internal sealed class TeamRollingMembershipRepository(params SquadMembership[] memberships) : ISquadMembershipRepository
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
        throw new NotSupportedException("Not exercised by the team-rolling handlers under test.");

    public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the team-rolling handlers under test.");

    public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the team-rolling handlers under test.");

    public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the team-rolling handlers under test.");

    public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the team-rolling handlers under test.");

    public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the team-rolling handlers under test.");

    public void RemovePermanently(SquadMembership membership) =>
        throw new NotSupportedException("Not exercised by the team-rolling handlers under test.");
}

/// <summary>
/// In-memory <see cref="IMembershipRatingRepository"/> for the team-rolling handler tests. It returns a
/// fixed established rating for every membership so the balance-request factory reads a current rating
/// and never has to seed one from the rating engine — keeping the tests focused on balancer delegation
/// and silly-name generation. The staging member is unused and throws if called.
/// </summary>
internal sealed class TeamRollingRatingRepository : IMembershipRatingRepository
{
    /// <summary>A neutral, established rating handed out for every participant.</summary>
    private static readonly PlayerRating Neutral = new(25.0, 3.0);

    public Task<MembershipRating?> GetAsync(Guid squadMembershipId, CancellationToken cancellationToken) =>
        Task.FromResult<MembershipRating?>(MembershipRating.Create(squadMembershipId, Neutral));

    public Task AddAsync(MembershipRating rating, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Team rolling does not seed ratings.");
}

/// <summary>
/// A stub <see cref="IRatingEngine"/> for the team-rolling handler tests. The balance-request factory
/// only reaches the engine when a participant has no current rating; because
/// <see cref="TeamRollingRatingRepository"/> always returns one, no engine method is exercised, so each
/// throws to fail loudly if that assumption ever breaks.
/// </summary>
internal sealed class UnusedRatingEngine : IRatingEngine
{
    public PitchMate.Domain.Rating.Result<PlayerRating> CreateRating(SkillTier? tier = null) =>
        throw new NotSupportedException("The team-rolling tests never seed a rating.");

    public PitchMate.Domain.Rating.Result<RatingState> GetState(PlayerRating rating) =>
        throw new NotSupportedException("Not exercised by the team-rolling handlers under test.");

    public PitchMate.Domain.Rating.Result<MatchUpdate> UpdateRatings(MatchOutcome outcome) =>
        throw new NotSupportedException("Not exercised by the team-rolling handlers under test.");

    public PitchMate.Domain.Rating.Result<IReadOnlyList<PlayerRating>> Replay(
        IReadOnlyList<PlayerRating> initialRatings,
        IReadOnlyList<ReplayMatch> matches) =>
        throw new NotSupportedException("Not exercised by the team-rolling handlers under test.");

    public PitchMate.Domain.Rating.Result<PlayerRating> DecayInactivity(PlayerRating rating, int inactiveDays) =>
        throw new NotSupportedException("Not exercised by the team-rolling handlers under test.");

    public PitchMate.Domain.Rating.Result<MatchPrediction> Predict(IReadOnlyList<TeamRoster> rosters) =>
        throw new NotSupportedException("Not exercised by the team-rolling handlers under test.");
}

/// <summary>
/// A recording <see cref="ITeamBalancer"/> for the team-rolling handler tests. It counts every call,
/// captures the last request it was offered, and returns a fixed proposal that splits the offered
/// participants into two teams. The handler under test returns this proposal to the caller without
/// applying it, so the split need only be well-formed enough to observe; correctness of the balancing
/// algorithm itself is the balancer's own concern. It is a real fake, not a mocking-framework stub.
/// </summary>
internal sealed class RecordingTeamBalancer : ITeamBalancer
{
    /// <summary>The number of times <see cref="ProposeAsync"/> was invoked.</summary>
    public int CallCount { get; private set; }

    /// <summary>The most recent request offered to the balancer, or <see langword="null"/> if never called.</summary>
    public TeamBalanceRequest? LastRequest { get; private set; }

    public Task<PitchMate.Domain.Matches.Result<TeamProposal>> ProposeAsync(
        TeamBalanceRequest request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        CallCount++;
        LastRequest = request;

        List<Guid> ids = request.Participants.Select(p => p.SquadMembershipId).ToList();
        int half = ids.Count / 2;

        var teams = new List<ProposedTeamAssignment>
        {
            new(ids.Take(half).ToList(), WinProbability: 0.5),
            new(ids.Skip(half).ToList(), WinProbability: 0.5),
        };

        return Task.FromResult(
            PitchMate.Domain.Matches.Result<TeamProposal>.Ok(new TeamProposal(teams, DrawProbability: 0.0)));
    }
}

/// <summary>
/// A recording <see cref="ISillyNameGenerator"/> for the team-rolling handler tests. It counts every
/// call and returns a distinct, non-empty generated name per call so a test can assert both that the
/// generator was consulted (or not) and that its output is the name the handler applied.
/// </summary>
internal sealed class RecordingSillyNameGenerator : ISillyNameGenerator
{
    /// <summary>The number of times <see cref="Next"/> was invoked.</summary>
    public int CallCount { get; private set; }

    public string Next()
    {
        CallCount++;
        return $"Generated Silly Name {CallCount}";
    }
}

/// <summary>
/// A minimal <see cref="IUnitOfWork"/> for the team-rolling handler tests that counts the save
/// attempts. The team-rolling handlers mutate the aggregate in place, so a commit needs no store
/// interaction; the count lets a test confirm the adjustment path committed.
/// </summary>
internal sealed class TeamRollingUnitOfWork : IUnitOfWork
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
