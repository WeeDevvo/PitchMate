using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
// PitchMate.Domain.Matches, PitchMate.Domain.Squads, and PitchMate.Domain.Rating each define a
// Result/Result<T> triad. Keep PitchMate.Domain.Matches imported (so the unqualified
// Result<RecordResultResult> the handler returns binds to the Matches triad) and alias the specific
// Squads and Rating types this test needs.
using Squad = PitchMate.Domain.Squads.Squad;
using SquadFeature = PitchMate.Domain.Squads.SquadFeature;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;
using PlayerRating = PitchMate.Domain.Rating.Rating;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Property-based test for the <see cref="RecordResultHandler"/> use case (match-lifecycle design
/// Property 15, Requirements 11.4 and 11.5). It drives the real handler against hand-written in-memory
/// fakes for <see cref="IMatchRepository"/>, <see cref="ISquadMembershipRepository"/>,
/// <see cref="ISquadRepository"/>, and a Unit-of-Work fake that models the commit boundary, per the
/// Application-layer testing strategy (no database).
/// <para>
/// Property 15: for any match in <see cref="MatchState.InProgress"/>, recording a
/// <see cref="ResultFidelity.Rich"/> result succeeds <em>iff</em> the match's squad has the
/// <see cref="SquadFeature.LiveMatchTracking"/> feature enabled; when it is disabled a rich result is
/// rejected with a <see cref="MatchErrorCode.LiveTrackingDisabled"/> error while a
/// <see cref="ResultFidelity.Basic"/> result is accepted, and both fidelities produce the same
/// win/loss/draw outcome shape. The acting user is always an active registered owner (so the
/// organiser gate passes), the match is always <see cref="MatchState.InProgress"/> with locked teams,
/// and the supplied scores are always valid — isolating the fidelity/feature-flag behaviour under
/// test.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class FidelityGatingPropertyTests
{
    // Feature: match-lifecycle, Property 15: Result fidelity is gated by the live-tracking feature flag
    // - recording a Rich result succeeds iff the match's squad has LiveMatchTracking enabled; when it
    // is disabled a Rich result is rejected with a live-tracking-disabled error while a Basic result is
    // accepted, and both fidelities produce the same win/loss/draw outcome shape.
    // Validates: Requirements 11.4, 11.5
    [Property(MaxTest = 200)]
    [Trait("Property", "15")]
    public Property ResultFidelityIsGatedByLiveTrackingFlag() =>
        Prop.ForAll(
            Arb.From(ScenarioGen()),
            scenario =>
            {
                var (liveTrackingEnabled, fidelity, scoreA, scoreB) = scenario;

                // A match in InProgress within a squad whose live-tracking flag is the generated value.
                var world = World.Create(liveTrackingEnabled);
                var command = new RecordResultCommand(
                    world.ActingUserId, world.MatchId, fidelity, world.ScoresFor(scoreA, scoreB));

                Result<RecordResultResult> result =
                    world.Handler.HandleAsync(command, CancellationToken.None).GetAwaiter().GetResult();

                // A Basic result is always accepted; a Rich result only where live tracking is enabled.
                bool shouldSucceed = fidelity == ResultFidelity.Basic || liveTrackingEnabled;

                bool gatingHolds;
                if (shouldSucceed)
                {
                    // Accepted: the recorded result is stored at exactly the recorded fidelity.
                    gatingHolds = result.IsSuccess
                        && result.Value!.Fidelity == fidelity
                        && world.Match.RecordedResult is not null
                        && world.Match.RecordedResult.Fidelity == fidelity;
                }
                else
                {
                    // Rich with live tracking off: rejected with the live-tracking-disabled error and
                    // nothing is stored (RecordedResult left unchanged).
                    gatingHolds = !result.IsSuccess
                        && result.Error!.Code == MatchErrorCode.LiveTrackingDisabled
                        && world.Match.RecordedResult is null;
                }

                // Both fidelities produce the same win/loss/draw outcome shape: for identical scores, a
                // Basic result and a Rich result yield identical team ranks (a draw when scores are
                // equal, otherwise the higher score ranks strictly better).
                IReadOnlyList<int> basicRanks = World.RanksForRecordedFidelity(ResultFidelity.Basic, scoreA, scoreB);
                IReadOnlyList<int> richRanks = World.RanksForRecordedFidelity(ResultFidelity.Rich, scoreA, scoreB);
                bool fidelityIndependentOutcome = basicRanks.SequenceEqual(richRanks);

                return (gatingHolds && fidelityIndependentOutcome).ToProperty();
            });

    /// <summary>
    /// Generates a scenario: whether the squad has live tracking enabled, the fidelity to record at,
    /// and the two teams' final scores (each a valid whole number 0..99).
    /// </summary>
    private static Gen<(bool LiveTrackingEnabled, ResultFidelity Fidelity, int ScoreA, int ScoreB)> ScenarioGen() =>
        from liveTrackingEnabled in Gen.Elements(true, false)
        from fidelity in Gen.Elements(ResultFidelity.Basic, ResultFidelity.Rich)
        from scoreA in Gen.Choose(0, MatchResult.MaxScore)
        from scoreB in Gen.Choose(0, MatchResult.MaxScore)
        select (liveTrackingEnabled, fidelity, scoreA, scoreB);

    /// <summary>
    /// Assembles the <see cref="RecordResultHandler"/>, its fakes, and a match staged in
    /// <see cref="MatchState.InProgress"/> with two locked five-a-side teams, together with an active
    /// registered owner (so the organiser gate passes) and a squad whose
    /// <see cref="SquadFeature.LiveMatchTracking"/> flag is set to the requested value.
    /// </summary>
    private sealed class World
    {
        /// <summary>A fixed UTC anchor the match is drafted against; the single confirmed day sits after it.</summary>
        private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

        private static readonly DateTimeOffset ConfirmedDay = Anchor.AddDays(7);

        private const string Location = "Hackney Marshes, Pitch 12";

        /// <summary>The number of participants; ten yields a valid 5v5 lock.</summary>
        private const int ParticipantCount = 10;

        private readonly IReadOnlyDictionary<Guid, PlayerRating> _ratings;
        private readonly IReadOnlyList<Guid> _teamIds;

        private World(
            RecordResultHandler handler,
            Match match,
            Guid actingUserId,
            IReadOnlyList<Guid> teamIds,
            IReadOnlyDictionary<Guid, PlayerRating> ratings)
        {
            Handler = handler;
            Match = match;
            ActingUserId = actingUserId;
            _teamIds = teamIds;
            _ratings = ratings;
        }

        public RecordResultHandler Handler { get; }

        public Match Match { get; }

        public Guid ActingUserId { get; }

        public Guid MatchId => Match.Id;

        /// <summary>Builds a valid per-team score list for this match's two teams.</summary>
        public IReadOnlyList<TeamScore> ScoresFor(int scoreA, int scoreB) =>
            new[] { new TeamScore(_teamIds[0], scoreA), new TeamScore(_teamIds[1], scoreB) };

        /// <summary>
        /// Derives the team ranks from the match's recorded result and captured kickoff lineup, using a
        /// neutral rating per participant. Ranks are score-driven (lower is better; equal scores tie),
        /// so this exposes the win/loss/draw outcome shape.
        /// </summary>
        public IReadOnlyList<int> DeriveRanks() =>
            Match.DeriveOutcome(_ratings).Value!.Teams.Select(t => t.Rank).ToList();

        public static World Create(bool liveTrackingEnabled)
        {
            var squadId = Guid.NewGuid();
            var ownerUserId = Guid.NewGuid();

            // The acting owner: an active registered organiser of the squad, so RequireOrganiser passes.
            SquadMembership owner = SquadMembership.CreateOwner(squadId, ownerUserId, "Owner").Value!;

            // Draft -> Confirm (empty seed, no threshold) -> add participants -> apply teams -> lock -> start.
            Match match = Match.CreateDraft(Guid.CreateVersion7(), squadId, Location, [ConfirmedDay], Anchor).Value!;
            match.Confirm(ConfirmedDay, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);

            var participantIds = new List<Guid>(ParticipantCount);
            for (var i = 0; i < ParticipantCount; i++)
            {
                SquadMembership member =
                    SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Player {i + 1}").Value!;
                match.AddParticipant(member);
                participantIds.Add(member.Id);
            }

            var half = participantIds.Count / 2;
            var teams = new List<ProposedTeam>
            {
                new("Reds", BibFlag: true, participantIds.Take(half).ToList()),
                new("Blues", BibFlag: false, participantIds.Skip(half).ToList()),
            };
            match.ApplyTeamProposal(teams);
            match.Lock();
            match.Start();

            IReadOnlyList<Guid> teamIds = match.Teams.Select(t => t.Id).ToList();
            IReadOnlyDictionary<Guid, PlayerRating> ratings =
                participantIds.ToDictionary(id => id, _ => new PlayerRating(25.0, 3.0));

            // The squad carrying the generated live-tracking flag; the handler reads only the flag.
            Squad squad = Squad.Create("The Squad").Value!;
            squad.SetFeature(SquadFeature.LiveMatchTracking, liveTrackingEnabled);

            var matches = new SingleMatchRepository(match);
            var memberships = new SingleMembershipRepository(ownerUserId, squadId, owner);
            var squads = new SingleSquadRepository(squadId, squad);
            var unitOfWork = new CountingUnitOfWork();

            var handler = new RecordResultHandler(matches, memberships, squads, unitOfWork);

            return new World(handler, match, ownerUserId, teamIds, ratings);
        }

        /// <summary>
        /// Records a result at <paramref name="fidelity"/> against a fresh live-tracking-enabled match
        /// (so both fidelities are accepted) and returns the resulting score-driven team ranks — the
        /// win/loss/draw outcome shape — for the fidelity-independence comparison.
        /// </summary>
        public static IReadOnlyList<int> RanksForRecordedFidelity(ResultFidelity fidelity, int scoreA, int scoreB)
        {
            var world = Create(liveTrackingEnabled: true);
            var command = new RecordResultCommand(
                world.ActingUserId, world.MatchId, fidelity, world.ScoresFor(scoreA, scoreB));

            world.Handler.HandleAsync(command, CancellationToken.None).GetAwaiter().GetResult();
            return world.DeriveRanks();
        }
    }

    /// <summary>In-memory <see cref="IMatchRepository"/> serving a single seeded match by identity.</summary>
    private sealed class SingleMatchRepository : IMatchRepository
    {
        private readonly Match _match;

        public SingleMatchRepository(Match match) => _match = match;

        public Task<Match?> GetByIdAsync(Guid matchId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(_match.Id == matchId ? _match : null);
        }

        public Task AddAsync(Match match, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Result recording does not add matches.");

        public Task<IReadOnlyList<Match>> GetForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Result recording does not list matches.");

        public Task<IReadOnlyList<Match>> ListChronologicalCompletedForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Result recording does not list completed matches.");
    }

    /// <summary>
    /// In-memory <see cref="ISquadMembershipRepository"/> that resolves the single seeded acting
    /// membership when queried for the matching user and squad, and <see langword="null"/> otherwise.
    /// Only the resolution the handler uses is implemented; every other member throws if called.
    /// </summary>
    private sealed class SingleMembershipRepository : ISquadMembershipRepository
    {
        private readonly Guid _userId;
        private readonly Guid _squadId;
        private readonly SquadMembership _acting;

        public SingleMembershipRepository(Guid userId, Guid squadId, SquadMembership acting)
        {
            _userId = userId;
            _squadId = squadId;
            _acting = acting;
        }

        public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            SquadMembership? resolved = userId == _userId && squadId == _squadId ? _acting : null;
            return Task.FromResult(resolved);
        }

        public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the result-recording handler under test.");

        public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the result-recording handler under test.");

        public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the result-recording handler under test.");

        public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the result-recording handler under test.");

        public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the result-recording handler under test.");

        public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the result-recording handler under test.");

        public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the result-recording handler under test.");

        public void RemovePermanently(SquadMembership membership) =>
            throw new NotSupportedException("Not exercised by the result-recording handler under test.");
    }

    /// <summary>
    /// In-memory <see cref="ISquadRepository"/> serving a single seeded squad by identity, from which
    /// the handler reads only the <see cref="SquadFeature.LiveMatchTracking"/> flag. Every other member
    /// throws if called.
    /// </summary>
    private sealed class SingleSquadRepository : ISquadRepository
    {
        private readonly Guid _squadId;
        private readonly Squad _squad;

        public SingleSquadRepository(Guid squadId, Squad squad)
        {
            _squadId = squadId;
            _squad = squad;
        }

        public Task<Squad?> GetByIdAsync(Guid squadId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(squadId == _squadId ? _squad : null);
        }

        public Task AddAsync(Squad squad, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the result-recording handler under test.");

        public Task<Squad?> GetByIdIncludingDeletedAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the result-recording handler under test.");

        public Task<IReadOnlyList<Squad>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the result-recording handler under test.");

        public Task<IReadOnlyList<Squad>> ListPurgeDueAsync(DateTimeOffset now, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not exercised by the result-recording handler under test.");

        public void RemovePermanently(Squad squad) =>
            throw new NotSupportedException("Not exercised by the result-recording handler under test.");
    }

    /// <summary>A minimal <see cref="IUnitOfWork"/> that counts save attempts; recording needs no store interaction.</summary>
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
}
