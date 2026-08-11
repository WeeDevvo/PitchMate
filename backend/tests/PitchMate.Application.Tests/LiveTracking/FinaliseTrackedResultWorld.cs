using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using PitchMate.Application.Common;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.LiveTracking;
using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Application.Notifications;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.LiveTracking;
// PitchMate.Domain.Matches, PitchMate.Domain.Rating, PitchMate.Domain.Squads, and
// PitchMate.Domain.LiveTracking each define a Result/Result<T> triad. Import only
// PitchMate.Domain.LiveTracking above so the unqualified Result<FinaliseTrackedResultResult> the
// harness returns binds to the live-tracking triad, and pull in the specific match-lifecycle, rating,
// squad, and notification types by alias.
using Match = PitchMate.Domain.Matches.Match;
using MatchState = PitchMate.Domain.Matches.MatchState;
using MatchResult = PitchMate.Domain.Matches.MatchResult;
using MatchOutcome = PitchMate.Domain.Rating.MatchOutcome;
using ProposedTeam = PitchMate.Domain.Matches.ProposedTeam;
using ResultFidelity = PitchMate.Domain.Matches.ResultFidelity;
using TeamScore = PitchMate.Domain.Matches.TeamScore;
using Squad = PitchMate.Domain.Squads.Squad;
using SquadFeature = PitchMate.Domain.Squads.SquadFeature;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;
using MembershipState = PitchMate.Domain.Squads.MembershipState;
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using SkillTier = PitchMate.Domain.Rating.SkillTier;
using RatingState = PitchMate.Domain.Rating.RatingState;
using RatingMatchOutcome = PitchMate.Domain.Rating.MatchOutcome;
using RatingMatchUpdate = PitchMate.Domain.Rating.MatchUpdate;
using ReplayMatch = PitchMate.Domain.Rating.ReplayMatch;
using MatchPrediction = PitchMate.Domain.Rating.MatchPrediction;
using TeamRoster = PitchMate.Domain.Rating.TeamRoster;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using MembershipRating = PitchMate.Domain.Matches.MembershipRating;
using RatingSnapshot = PitchMate.Domain.Matches.RatingSnapshot;
using NotificationType = PitchMate.Domain.Notifications.NotificationType;
using NotifResult = PitchMate.Domain.Notifications.Result;

namespace PitchMate.Application.Tests.LiveTracking;

/// <summary>
/// A hand-written, in-memory harness for <see cref="FinaliseTrackedResultHandler"/> that assembles the
/// real handler over real fakes — including a real match-lifecycle <see cref="CompleteMatchHandler"/>,
/// so a successful finalise drives the genuine result-recording and completion path. It stages a
/// single squad-scoped match in a chosen <see cref="MatchState"/> with the <c>LiveMatchTracking</c>
/// flag on, walks the match aggregate through its real lifecycle so the kickoff lineup and working
/// teams are genuine, and exposes the working team identities and the acting owner so a test can seed
/// an effective goal log and finalise. No database and no mocking framework.
/// </summary>
internal sealed class FinaliseTrackedResultWorld
{
    private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset MatchDay = Anchor.AddDays(7);

    private readonly FinaliseTrackedResultHandler _handler;
    private readonly Guid _ownerUserId;
    private readonly Guid _squadId;

    private FinaliseTrackedResultWorld(
        FinaliseTrackedResultHandler handler,
        Match match,
        Guid squadId,
        Guid ownerUserId,
        InMemoryMatchEventRepository events,
        CountingRatingEngine engine,
        CountingUnitOfWork unitOfWork,
        Guid teamAId,
        Guid teamBId)
    {
        _handler = handler;
        Match = match;
        _squadId = squadId;
        _ownerUserId = ownerUserId;
        Events = events;
        Engine = engine;
        UnitOfWork = unitOfWork;
        TeamAId = teamAId;
        TeamBId = teamBId;
    }

    public Match Match { get; }

    public Guid SquadId => _squadId;

    public InMemoryMatchEventRepository Events { get; }

    public CountingRatingEngine Engine { get; }

    public CountingUnitOfWork UnitOfWork { get; }

    /// <summary>The working <c>MatchTeam.Id</c> of the first team (empty before teams are rolled).</summary>
    public Guid TeamAId { get; }

    /// <summary>The working <c>MatchTeam.Id</c> of the second team (empty before teams are rolled).</summary>
    public Guid TeamBId { get; }

    /// <summary>
    /// Builds a world with a match in <paramref name="state"/> whose squad has live tracking enabled.
    /// The match carries <paramref name="playerCount"/> participants split into two teams of
    /// <paramref name="teamASize"/> and the remainder, both within the 5..8 lock rule.
    /// </summary>
    public static FinaliseTrackedResultWorld Build(MatchState state, int playerCount, int teamASize)
    {
        Squad squad = Squad.Create("The Squad").Value!;
        squad.SetFeature(SquadFeature.LiveMatchTracking, enabled: true);
        Guid squadId = squad.Id;

        Guid ownerUserId = Guid.NewGuid();
        SquadMembership owner = SquadMembership.CreateOwner(squadId, ownerUserId, "Owner").Value!;

        var members = new List<SquadMembership> { owner };
        var players = new List<SquadMembership>(playerCount);
        for (var i = 0; i < playerCount; i++)
        {
            SquadMembership player = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Player {i + 1}").Value!;
            players.Add(player);
            members.Add(player);
        }

        (Match match, Guid teamAId, Guid teamBId) = BuildMatch(state, squadId, players, teamASize);

        var events = new InMemoryMatchEventRepository();
        var matches = new SingleMatchRepository(match);
        var memberships = new FinaliseMembershipRepository(members);
        var squads = new SingleSquadRepository(squad);
        var ratings = new FinaliseRatingRepository();
        var snapshots = new FinaliseSnapshotRepository();
        var engine = new CountingRatingEngine();
        var unitOfWork = new CountingUnitOfWork();
        var publisher = new FinalisePublisher();
        var clock = new FakeTimeProvider(Anchor);
        var currentUser = new MutableCurrentUserAccessor { CurrentUserId = ownerUserId.ToString() };

        var completeMatch = new CompleteMatchHandler(
            matches, ratings, snapshots, memberships, squads, engine, unitOfWork, clock, publisher,
            NullLogger<CompleteMatchHandler>.Instance);

        var handler = new FinaliseTrackedResultHandler(matches, memberships, events, completeMatch, currentUser);

        return new FinaliseTrackedResultWorld(
            handler, match, squadId, ownerUserId, events, engine, unitOfWork, teamAId, teamBId);
    }

    /// <summary>Walks a fresh match to <paramref name="state"/>, returning it and its two working team ids.</summary>
    private static (Match Match, Guid TeamAId, Guid TeamBId) BuildMatch(
        MatchState state,
        Guid squadId,
        IReadOnlyList<SquadMembership> players,
        int teamASize)
    {
        Match match = Match.CreateDraft(Guid.CreateVersion7(), squadId, "Hackney Marshes", [MatchDay], Anchor).Value!;

        if (state == MatchState.GatheringAvailability)
        {
            return (match, Guid.Empty, Guid.Empty);
        }

        match.Confirm(MatchDay, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);
        foreach (SquadMembership player in players)
        {
            match.AddParticipant(player);
        }

        if (state == MatchState.Confirmed)
        {
            return (match, Guid.Empty, Guid.Empty);
        }

        var participantIds = players.Select(p => p.Id).ToList();
        var proposal = new List<ProposedTeam>
        {
            new("Reds", BibFlag: true, participantIds.Take(teamASize).ToList()),
            new("Blues", BibFlag: false, participantIds.Skip(teamASize).ToList()),
        };
        match.ApplyTeamProposal(proposal);
        match.Lock();

        Guid teamAId = match.Teams.ElementAt(0).Id;
        Guid teamBId = match.Teams.ElementAt(1).Id;

        switch (state)
        {
            case MatchState.TeamsRolled:
                break;

            case MatchState.Cancelled:
                match.Cancel();
                break;

            default:
                match.Start();
                break;
        }

        return (match, teamAId, teamBId);
    }

    /// <summary>Runs the finalise handler as the acting owner and returns the result.</summary>
    public Result<FinaliseTrackedResultResult> FinaliseAsOwner() =>
        _handler.HandleAsync(new FinaliseTrackedResultCommand(Match.Id), CancellationToken.None)
            .GetAwaiter().GetResult();

    /// <summary>Seeds <paramref name="count"/> effective goals for <paramref name="teamId"/> into the log.</summary>
    public void SeedEffectiveGoals(Guid teamId, int count, int startMinute)
    {
        for (var i = 0; i < count; i++)
        {
            int minute = Math.Min(MatchMinute.MaxValue, startMinute + i);
            Events.Seed(new GoalScoredEvent(
                Guid.CreateVersion7(), Match.Id, _squadId, MatchMinute.Create(minute).Value!,
                teamId, scorerMembershipId: null, ownGoal: false));
        }
    }

    /// <summary>
    /// Seeds <paramref name="count"/> goals for <paramref name="teamId"/> that are each immediately
    /// retracted by a matching <see cref="GoalRetractedEvent"/>, so they belong to the log but not the
    /// effective set and must not change the final score.
    /// </summary>
    public void SeedRetractedGoals(Guid teamId, int count, int startMinute)
    {
        for (var i = 0; i < count; i++)
        {
            int minute = Math.Min(MatchMinute.MaxValue, startMinute + i);
            var goal = new GoalScoredEvent(
                Guid.CreateVersion7(), Match.Id, _squadId, MatchMinute.Create(minute).Value!,
                teamId, scorerMembershipId: null, ownGoal: false);
            var retraction = new GoalRetractedEvent(
                Guid.CreateVersion7(), Match.Id, _squadId, MatchMinute.Create(minute).Value!, goal.Id);
            Events.Seed(goal, retraction);
        }
    }

    /// <summary>
    /// Derives the per-kickoff-team outcome rank vector for <see cref="Match"/> from its recorded
    /// result, supplying a uniform rating for every kickoff participant. The ranks are index-aligned to
    /// the kickoff teams (which are one-to-one and in order with the working teams).
    /// </summary>
    public int[] DeriveRankVector() => DeriveRankVector(Match);

    /// <summary>
    /// Builds a standalone in-progress mirror match with the same team sizes as this world's match,
    /// records a <see cref="ResultFidelity.Basic"/> result whose team scores are
    /// <paramref name="scoreA"/> and <paramref name="scoreB"/>, and derives its outcome rank vector —
    /// the outcome "a Basic result with identical scores" yields (Requirement 8.2).
    /// </summary>
    public int[] DeriveBasicMirrorRankVector(int playerCount, int teamASize, int scoreA, int scoreB)
    {
        var players = new List<SquadMembership>(playerCount);
        for (var i = 0; i < playerCount; i++)
        {
            players.Add(SquadMembership.CreateRegistered(_squadId, Guid.NewGuid(), $"Mirror {i + 1}").Value!);
        }

        (Match mirror, Guid teamAId, Guid teamBId) = BuildMatch(MatchState.InProgress, _squadId, players, teamASize);

        var basic = new MatchResult(ResultFidelity.Basic, new[]
        {
            new TeamScore(teamAId, scoreA),
            new TeamScore(teamBId, scoreB),
        });
        mirror.RecordResult(basic, liveTrackingEnabled: false);

        return DeriveRankVector(mirror);
    }

    private static int[] DeriveRankVector(Match match)
    {
        var uniform = new PlayerRating(25.0, 25.0 / 3.0);
        Dictionary<Guid, PlayerRating> ratings = match.KickoffLineup!.Teams
            .SelectMany(t => t.ParticipantMembershipIds)
            .Distinct()
            .ToDictionary(id => id, _ => uniform);

        // match.DeriveOutcome returns the PitchMate.Domain.Matches Result<MatchOutcome>; read its value
        // directly. It succeeds for a match with a captured kickoff lineup and a recorded result.
        MatchOutcome outcome = match.DeriveOutcome(ratings).Value!;
        return outcome.Teams.Select(t => t.Rank).ToArray();
    }
}

/// <summary>
/// In-memory <see cref="ISquadMembershipRepository"/> for the finalise harness. It resolves the acting
/// membership by backing user and squad (the admin gate) and lists the squad's memberships (read by
/// the completion handler to source skill tiers for cold-start seeding). Every other member is unused
/// and throws if called.
/// </summary>
internal sealed class FinaliseMembershipRepository(IReadOnlyList<SquadMembership> memberships) : ISquadMembershipRepository
{
    public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(memberships.FirstOrDefault(m => m.UserId == userId && m.SquadId == squadId));
    }

    public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        IReadOnlyList<SquadMembership> result = memberships
            .Where(m => m.SquadId == squadId && (!activeOnly || m.State == MembershipState.Active))
            .ToList();
        return Task.FromResult(result);
    }

    public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the finalise handler under test.");

    public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the finalise handler under test.");

    public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the finalise handler under test.");

    public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the finalise handler under test.");

    public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the finalise handler under test.");

    public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the finalise handler under test.");

    public void RemovePermanently(SquadMembership membership) =>
        throw new NotSupportedException("Not exercised by the finalise handler under test.");
}

/// <summary>
/// In-memory <see cref="IMembershipRatingRepository"/> for the finalise harness. Participants carry no
/// pre-seeded rating, so the completion handler seeds each from the engine and stages it here; reads
/// return whatever has been stored. It is a real fake, not a mocking-framework stub.
/// </summary>
internal sealed class FinaliseRatingRepository : IMembershipRatingRepository
{
    private readonly Dictionary<Guid, MembershipRating> _byMembership = new();

    public Task<MembershipRating?> GetAsync(Guid squadMembershipId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(_byMembership.GetValueOrDefault(squadMembershipId));
    }

    public Task AddAsync(MembershipRating rating, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(rating);
        _byMembership[rating.SquadMembershipId] = rating;
        return Task.CompletedTask;
    }
}

/// <summary>
/// In-memory <see cref="IRepository{RatingSnapshot}"/> for the finalise harness that captures every
/// staged snapshot. Only <c>AddAsync</c> is exercised; the other members throw if called.
/// </summary>
internal sealed class FinaliseSnapshotRepository : IRepository<RatingSnapshot>
{
    public List<RatingSnapshot> Added { get; } = new();

    public Task AddAsync(RatingSnapshot entity, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(entity);
        Added.Add(entity);
        return Task.CompletedTask;
    }

    public Task<RatingSnapshot?> GetByIdAsync(Guid id, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the finalise handler under test.");

    public Task<IReadOnlyList<RatingSnapshot>> ListAsync(CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the finalise handler under test.");

    public Task<IReadOnlyList<RatingSnapshot>> ListChronologicalAsync(bool includeDeleted, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the finalise handler under test.");

    public void Remove(RatingSnapshot entity) =>
        throw new NotSupportedException("Not exercised by the finalise handler under test.");

    public void Restore(RatingSnapshot entity) =>
        throw new NotSupportedException("Not exercised by the finalise handler under test.");
}

/// <summary>
/// A stub <see cref="IRatingEngine"/> for the finalise harness. It seeds a fixed cold-start rating for
/// each unrated participant and, on <see cref="UpdateRatings"/>, mirrors the outcome's team-and-player
/// shape with a fixed μ shift — enough for completion to succeed — while counting invocations so a
/// test can assert exactly one (or zero) rating update. The remaining operations are never reached and
/// throw if called.
/// </summary>
internal sealed class CountingRatingEngine : IRatingEngine
{
    /// <summary>The number of times <see cref="UpdateRatings"/> was invoked.</summary>
    public int UpdateRatingsCallCount { get; private set; }

    public PitchMate.Domain.Rating.Result<PlayerRating> CreateRating(SkillTier? tier = null) =>
        PitchMate.Domain.Rating.Result<PlayerRating>.Ok(new PlayerRating(25.0, 25.0 / 3.0));

    public PitchMate.Domain.Rating.Result<RatingMatchUpdate> UpdateRatings(RatingMatchOutcome outcome)
    {
        UpdateRatingsCallCount++;

        IReadOnlyList<IReadOnlyList<PlayerRating>> teams = outcome.Teams
            .Select(team => (IReadOnlyList<PlayerRating>)team.Players
                .Select(p => new PlayerRating(p.Rating.Mu + 1.0, p.Rating.Sigma))
                .ToList())
            .ToList();

        return PitchMate.Domain.Rating.Result<RatingMatchUpdate>.Ok(new RatingMatchUpdate(teams));
    }

    public PitchMate.Domain.Rating.Result<RatingState> GetState(PlayerRating rating) =>
        throw new NotSupportedException("Not exercised by the finalise handler under test.");

    public PitchMate.Domain.Rating.Result<IReadOnlyList<PlayerRating>> Replay(
        IReadOnlyList<PlayerRating> initialRatings,
        IReadOnlyList<ReplayMatch> matches) =>
        throw new NotSupportedException("Not exercised by the finalise handler under test.");

    public PitchMate.Domain.Rating.Result<PlayerRating> DecayInactivity(PlayerRating rating, int inactiveDays) =>
        throw new NotSupportedException("Not exercised by the finalise handler under test.");

    public PitchMate.Domain.Rating.Result<MatchPrediction> Predict(IReadOnlyList<TeamRoster> rosters) =>
        throw new NotSupportedException("Not exercised by the finalise handler under test.");
}

/// <summary>A no-op <see cref="INotificationPublisher"/> for the finalise harness that returns success.</summary>
internal sealed class FinalisePublisher : INotificationPublisher
{
    public Task<NotifResult> PublishAsync(
        NotificationType type,
        Guid squadId,
        IReadOnlyCollection<Guid> directedTargetMembershipIds,
        NotificationContext context,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(NotifResult.Ok());
    }
}
