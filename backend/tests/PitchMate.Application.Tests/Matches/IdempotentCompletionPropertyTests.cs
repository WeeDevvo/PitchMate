using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Application.Notifications;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
// PitchMate.Domain.Matches, PitchMate.Domain.Rating, and PitchMate.Domain.Squads each define a
// Result / Result<T> triad. Import only the Matches namespace above so the unqualified Result<T> binds
// to the Matches triad, and pull in the specific rating and squad types by alias (mirroring the
// CompleteMatchHandler and the sibling team-rolling fakes) so nothing is confused with it.
using Squad = PitchMate.Domain.Squads.Squad;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;
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
using CompletionResult = PitchMate.Domain.Matches.Result<PitchMate.Application.Matches.UseCases.CompleteMatchResult>;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Property-based test for <see cref="CompleteMatchHandler"/> (match-lifecycle design Property 18,
/// Requirements 12.7, 13.2, 13.3, 13.5, 10.5). It drives the real handler against hand-written
/// in-memory fakes — a match seeded in <see cref="MatchState.InProgress"/> with a recorded result, a
/// membership-rating repository that stores seeded/updated ratings, a snapshot repository that
/// captures every written <see cref="RatingSnapshot"/>, a counting <see cref="IRatingEngine"/>, a
/// controllable <see cref="FakeTimeProvider"/>, a save-counting unit of work, and a recording
/// notification publisher — per the Application-layer testing strategy (no database).
/// <para>
/// Property 18: for any match completed once, every subsequent completion request is a success that
/// returns the originally recorded result, applies no further rating update, writes no further
/// snapshot, and leaves every participating membership's rating and every snapshot identical to their
/// values after the first completion. The <see cref="CompleteMatchCommand"/> carries no result
/// payload, so a retried request is inherently the same command; the "whether its payload matches or
/// differs" clause is exercised by alternating the acting organiser (owner vs admin) across the repeat
/// completions — both are permitted and both must observe the idempotent no-op.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class IdempotentCompletionPropertyTests
{
    /// <summary>A fixed UTC anchor the fake clock reads from; the confirmed day sits well after it.</summary>
    private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>The single, valid, strictly-future day the match is confirmed on.</summary>
    private static readonly DateTimeOffset ConfirmedDay = Anchor.AddDays(7);

    private const string Location = "Hackney Marshes, Pitch 12";

    // Feature: match-lifecycle, Property 18: Completion is idempotent - for any match completed once,
    // every subsequent completion request (whether its payload matches or differs from the first) is a
    // success that returns the originally recorded result, applies no further rating update, writes no
    // further RatingSnapshot, and leaves every participating membership's rating and every snapshot
    // identical to their values after the first completion.
    // Validates: Requirements 12.7, 13.2, 13.3, 13.5, 10.5
    [Property(MaxTest = 200)]
    [Trait("Property", "18")]
    public Property CompletionIsIdempotent() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            World world = World.Create(scenario);

            // The first completion applies the single rating update, writes one snapshot per
            // participant, and transitions the match to Completed.
            CompletionResult first = world.Complete(world.OwnerUserId);
            if (!first.IsSuccess || first.Value!.AlreadyCompleted)
            {
                return false;
            }

            if (world.Match.State != MatchState.Completed || world.Engine.UpdateRatingsCallCount != 1)
            {
                return false;
            }

            // Capture the state left by the first completion: the returned result, the exact set of
            // snapshots, and each participating membership's current rating.
            var baselineScores = first.Value!.TeamScores
                .Select(s => (s.TeamId, s.Score))
                .ToList();
            ResultFidelity baselineFidelity = first.Value!.Fidelity;
            var baselineSnapshots = world.Snapshots.Captured
                .Select(s => (s.SquadMembershipId, s.Mu, s.Sigma))
                .ToList();
            var baselineRatings = world.Ratings.Snapshot();

            if (baselineSnapshots.Count != scenario.Count)
            {
                return false;
            }

            // Every subsequent completion must be an idempotent success: it returns the originally
            // recorded result and applies no further change. The acting organiser is alternated between
            // the owner and a second admin so a differing (but still authorised) payload is exercised.
            var organisers = new[] { world.OwnerUserId, world.AdminUserId };
            for (var i = 0; i < scenario.ExtraCompletions; i++)
            {
                CompletionResult repeat = world.Complete(organisers[i % organisers.Length]);

                if (!repeat.IsSuccess || !repeat.Value!.AlreadyCompleted)
                {
                    return false;
                }

                if (repeat.Value!.Fidelity != baselineFidelity)
                {
                    return false;
                }

                var repeatScores = repeat.Value!.TeamScores
                    .Select(s => (s.TeamId, s.Score))
                    .ToList();
                if (!repeatScores.SequenceEqual(baselineScores))
                {
                    return false;
                }
            }

            // No further rating update was applied, no further snapshot was written, and every
            // membership rating and snapshot is identical to its value after the first completion.
            if (world.Engine.UpdateRatingsCallCount != 1)
            {
                return false;
            }

            var finalSnapshots = world.Snapshots.Captured
                .Select(s => (s.SquadMembershipId, s.Mu, s.Sigma))
                .ToList();
            if (!finalSnapshots.SequenceEqual(baselineSnapshots))
            {
                return false;
            }

            IReadOnlyDictionary<Guid, (double Mu, double Sigma)> finalRatings = world.Ratings.Snapshot();
            if (finalRatings.Count != baselineRatings.Count)
            {
                return false;
            }

            return baselineRatings.All(kvp =>
                finalRatings.TryGetValue(kvp.Key, out (double Mu, double Sigma) after)
                && after == kvp.Value);
        });

    /// <summary>
    /// Generates a completion scenario: a participant count of 10..16 split across two teams that each
    /// satisfy the 5..8 lock rule, a whole-number final score (0..99) for each team, and 1..4 extra
    /// completion requests to make after the first.
    /// </summary>
    private static Gen<Scenario> ScenarioGen() =>
        Gen.Choose(10, 16).SelectMany(count =>
            Gen.Choose(Math.Max(Match.TeamMinSize, count - Match.TeamMaxSize),
                       Math.Min(Match.TeamMaxSize, count - Match.TeamMinSize)).SelectMany(teamASize =>
                Gen.Choose(0, MatchResult.MaxScore).SelectMany(scoreA =>
                    Gen.Choose(0, MatchResult.MaxScore).SelectMany(scoreB =>
                        Gen.Choose(1, 4).Select(extra =>
                            new Scenario(count, teamASize, scoreA, scoreB, extra))))));

    /// <summary>A generated completion scenario.</summary>
    /// <param name="Count">The number of participants (10..16), all assigned to the kickoff lineup.</param>
    /// <param name="TeamASize">The size of the first team; the second team gets the remainder (both 5..8).</param>
    /// <param name="ScoreA">The first team's recorded final score.</param>
    /// <param name="ScoreB">The second team's recorded final score.</param>
    /// <param name="ExtraCompletions">The number of completion requests to make after the first.</param>
    private sealed record Scenario(int Count, int TeamASize, int ScoreA, int ScoreB, int ExtraCompletions);

    /// <summary>
    /// Assembles the completion handler, its fakes, and a match staged in
    /// <see cref="MatchState.InProgress"/> with a recorded result, together with the acting owner and a
    /// second active admin (both permitted organisers).
    /// </summary>
    private sealed class World
    {
        private readonly CompleteMatchHandler _handler;

        private World(
            CompleteMatchHandler handler,
            Match match,
            Guid ownerUserId,
            Guid adminUserId,
            FakeMembershipRatingRepository ratings,
            CapturingSnapshotRepository snapshots,
            CountingRatingEngine engine)
        {
            _handler = handler;
            Match = match;
            OwnerUserId = ownerUserId;
            AdminUserId = adminUserId;
            Ratings = ratings;
            Snapshots = snapshots;
            Engine = engine;
        }

        public Match Match { get; }

        public Guid OwnerUserId { get; }

        public Guid AdminUserId { get; }

        public FakeMembershipRatingRepository Ratings { get; }

        public CapturingSnapshotRepository Snapshots { get; }

        public CountingRatingEngine Engine { get; }

        /// <summary>Runs the completion handler as <paramref name="actingUserId"/> and returns the result.</summary>
        public CompletionResult Complete(Guid actingUserId) =>
            _handler.HandleAsync(new CompleteMatchCommand(actingUserId, Match.Id), CancellationToken.None)
                .GetAwaiter().GetResult();

        public static World Create(Scenario scenario)
        {
            Squad squad = Squad.Create("The Squad").Value!;
            Guid squadId = squad.Id;

            // Two active registered organisers: the acting owner and a second admin. Both pass the
            // organiser gate, so alternating between them across repeat completions still resolves to an
            // authorised actor observing the idempotent no-op.
            Guid ownerUserId = Guid.NewGuid();
            Guid adminUserId = Guid.NewGuid();
            SquadMembership owner = SquadMembership.CreateOwner(squadId, ownerUserId, "Owner").Value!;
            SquadMembership admin = SquadMembership.CreateRegistered(squadId, adminUserId, "Admin").Value!;
            admin.PromoteToAdmin();

            // A match walked to InProgress with a recorded result: draft -> confirm -> add participants
            // -> apply a two-team proposal -> lock (capturing the kickoff lineup) -> start -> record.
            Match match = Match.CreateDraft(Guid.CreateVersion7(), squadId, Location, [ConfirmedDay], Anchor).Value!;
            match.Confirm(ConfirmedDay, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);

            var members = new List<SquadMembership> { owner, admin };
            var participantIds = new List<Guid>(scenario.Count);
            for (var i = 0; i < scenario.Count; i++)
            {
                SquadMembership member =
                    SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Player {i + 1}").Value!;
                match.AddParticipant(member);
                members.Add(member);
                participantIds.Add(member.Id);
            }

            var teams = new List<ProposedTeam>
            {
                new("Reds", BibFlag: true, participantIds.Take(scenario.TeamASize).ToList()),
                new("Blues", BibFlag: false, participantIds.Skip(scenario.TeamASize).ToList()),
            };
            match.ApplyTeamProposal(teams);
            match.Lock();
            match.Start();

            // Scores reference the match's working teams (index-aligned with the kickoff lineup).
            Guid teamAId = match.Teams.ElementAt(0).Id;
            Guid teamBId = match.Teams.ElementAt(1).Id;
            var result = new MatchResult(ResultFidelity.Basic, new[]
            {
                new TeamScore(teamAId, scenario.ScoreA),
                new TeamScore(teamBId, scenario.ScoreB),
            });
            match.RecordResult(result, liveTrackingEnabled: false);

            var matches = new SingleMatchRepository(match);
            var memberships = new CompletionMembershipRepository(members);
            var squads = new SingleSquadRepository(squad);
            var ratings = new FakeMembershipRatingRepository();
            var snapshots = new CapturingSnapshotRepository();
            var engine = new CountingRatingEngine();
            var unitOfWork = new CountingUnitOfWork();
            var publisher = new RecordingPublisher();
            var clock = new FakeTimeProvider(Anchor);

            var handler = new CompleteMatchHandler(
                matches,
                ratings,
                snapshots,
                memberships,
                squads,
                engine,
                unitOfWork,
                clock,
                publisher,
                NullLogger<CompleteMatchHandler>.Instance);

            return new World(handler, match, ownerUserId, adminUserId, ratings, snapshots, engine);
        }
    }

    /// <summary>
    /// In-memory <see cref="IMatchRepository"/> serving a single seeded match by identity (also on the
    /// concurrency-reload path). The write and listing members are unused by the completion handler and
    /// throw if called.
    /// </summary>
    private sealed class SingleMatchRepository(Match match) : IMatchRepository
    {
        public Task<Match?> GetByIdAsync(Guid matchId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(matchId == match.Id ? match : null);
        }

        public Task AddAsync(Match match, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Completion does not add matches.");

        public Task<IReadOnlyList<Match>> GetForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Completion does not list matches.");

        public Task<IReadOnlyList<Match>> ListChronologicalCompletedForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Completion does not list completed matches.");
    }

    /// <summary>
    /// In-memory <see cref="ISquadMembershipRepository"/> that resolves the acting membership by backing
    /// user and squad and lists the squad's memberships (read to source skill tiers when seeding). Every
    /// other member is unused by the completion handler and throws if called.
    /// </summary>
    private sealed class CompletionMembershipRepository(IReadOnlyList<SquadMembership> memberships) : ISquadMembershipRepository
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
                .Where(m => m.SquadId == squadId && (!activeOnly || m.State == PitchMate.Domain.Squads.MembershipState.Active))
                .ToList();
            return Task.FromResult(result);
        }

        public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Completion does not add memberships.");

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
    /// In-memory <see cref="ISquadRepository"/> serving the single seeded squad by identity, read by the
    /// handler only to render the post-commit notification. Every other member is unused and throws.
    /// </summary>
    private sealed class SingleSquadRepository(Squad squad) : ISquadRepository
    {
        public Task<Squad?> GetByIdAsync(Guid squadId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(squadId == squad.Id ? squad : null);
        }

        public Task AddAsync(Squad squad, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Completion does not add squads.");

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
    /// In-memory <see cref="IMembershipRatingRepository"/> that stores seeded ratings by membership and
    /// returns them on read. Because the handler mutates the returned entities in place during staging,
    /// <see cref="Snapshot"/> reports each membership's current μ/σ so the test can assert they are
    /// unchanged across repeated completions.
    /// </summary>
    private sealed class FakeMembershipRatingRepository : IMembershipRatingRepository
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

        /// <summary>The current μ/σ of every stored membership rating, keyed by membership.</summary>
        public IReadOnlyDictionary<Guid, (double Mu, double Sigma)> Snapshot() =>
            _byMembership.ToDictionary(kvp => kvp.Key, kvp => (kvp.Value.Mu, kvp.Value.Sigma));
    }

    /// <summary>
    /// In-memory <see cref="IRepository{RatingSnapshot}"/> that captures every written snapshot so the
    /// test can assert exactly one snapshot per participant is written by the first completion and that
    /// no further snapshot is written by any subsequent completion. Only <c>AddAsync</c> is exercised;
    /// the other members throw if called.
    /// </summary>
    private sealed class CapturingSnapshotRepository : IRepository<RatingSnapshot>
    {
        private readonly List<RatingSnapshot> _captured = new();

        /// <summary>The snapshots written so far, in write order.</summary>
        public IReadOnlyList<RatingSnapshot> Captured => _captured;

        public Task AddAsync(RatingSnapshot entity, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            ArgumentNullException.ThrowIfNull(entity);
            _captured.Add(entity);
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
    /// A stub <see cref="IRatingEngine"/> that counts its <see cref="UpdateRatings"/> invocations so the
    /// test can assert exactly one rating update across repeated completions, seeds a fixed cold-start
    /// rating, and returns an update that mirrors the outcome's team-and-player ordering with a
    /// deterministic μ shift (so an applied update is observable). Only the two operations the
    /// completion handler uses are implemented; the rest throw if called.
    /// </summary>
    private sealed class CountingRatingEngine : IRatingEngine
    {
        /// <summary>The number of times <see cref="UpdateRatings"/> was invoked.</summary>
        public int UpdateRatingsCallCount { get; private set; }

        public PitchMate.Domain.Rating.Result<PlayerRating> CreateRating(SkillTier? tier = null) =>
            PitchMate.Domain.Rating.Result<PlayerRating>.Ok(new PlayerRating(25.0, 8.333));

        public PitchMate.Domain.Rating.Result<RatingMatchUpdate> UpdateRatings(RatingMatchOutcome outcome)
        {
            UpdateRatingsCallCount++;

            // Mirror the input shape exactly (team and player ordering preserved), shifting μ by a fixed
            // amount so the applied update is distinct from the seed and observable on the memberships.
            IReadOnlyList<IReadOnlyList<PlayerRating>> teams = outcome.Teams
                .Select(team => (IReadOnlyList<PlayerRating>)team.Players
                    .Select(p => new PlayerRating(p.Rating.Mu + 1.0, p.Rating.Sigma))
                    .ToList())
                .ToList();

            return PitchMate.Domain.Rating.Result<RatingMatchUpdate>.Ok(new RatingMatchUpdate(teams));
        }

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

    /// <summary>A minimal <see cref="IUnitOfWork"/> that commits successfully and counts save attempts.</summary>
    private sealed class CountingUnitOfWork : IUnitOfWork
    {
        public int SaveCallCount { get; private set; }

        public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            SaveCallCount++;
            return Task.FromResult(1);
        }
    }

    /// <summary>
    /// A recording <see cref="INotificationPublisher"/> that returns success and counts calls. The
    /// completion handler publishes only after a fresh commit, so a subsequent idempotent no-op never
    /// reaches it.
    /// </summary>
    private sealed class RecordingPublisher : INotificationPublisher
    {
        public int PublishCallCount { get; private set; }

        public Task<NotifResult> PublishAsync(
            NotificationType type,
            Guid squadId,
            IReadOnlyCollection<Guid> directedTargetMembershipIds,
            NotificationContext context,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            PublishCallCount++;
            return Task.FromResult(NotifResult.Ok());
        }
    }
}
