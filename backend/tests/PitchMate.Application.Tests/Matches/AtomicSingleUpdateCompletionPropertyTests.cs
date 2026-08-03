using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using MatchErrorCode = PitchMate.Domain.Matches.MatchErrorCode;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using CompletionResult = PitchMate.Domain.Matches.Result<PitchMate.Application.Matches.UseCases.CompleteMatchResult>;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Property-based test for atomic single-update completion (match-lifecycle design Property 17). For
/// any match in <see cref="MatchState.InProgress"/> with a recorded result, <c>Complete</c>
/// transitions the match to <see cref="MatchState.Completed"/>, applies exactly one
/// <see cref="PitchMate.Domain.Rating.IRatingEngine.UpdateRatings"/> over the kickoff-derived outcome,
/// writes exactly one <see cref="RatingSnapshot"/> per kickoff participant carrying the engine's
/// output μ/σ, updates each participating membership's current rating to that output, and commits the
/// lot with a single atomic save. Completing an <see cref="MatchState.InProgress"/> match with no
/// recorded result is rejected as result-required, and that failing step leaves the match in
/// <see cref="MatchState.InProgress"/> with no rating change and no snapshot written
/// (Requirements 12.1, 12.2, 12.5, 10.1).
/// <para>
/// The test drives the already-implemented <see cref="CompleteMatchHandler"/> against hand-written
/// in-memory fakes, a controllable <see cref="FakeTimeProvider"/>, a no-op notification publisher, and
/// a counting stub <see cref="PitchMate.Domain.Rating.IRatingEngine"/>. Each participant is pre-rated
/// with a distinct established rating and the stub engine transforms every input rating by a fixed,
/// order-preserving delta, so the test predicts the exact μ/σ the engine produced for each kickoff
/// participant and confirms it lands on that membership's single snapshot and current rating. The
/// property runs at least 100 iterations, generating both the recorded-result (success) and the
/// no-result (result-required rejection) branches, plus win/loss/draw scores.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class AtomicSingleUpdateCompletionPropertyTests
{
    /// <summary>The instant the fake clock reports; a completed match stamps this as its CompletedAt.</summary>
    private static readonly DateTimeOffset NowUtc = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>The single strictly-future candidate/confirmed day of every generated match.</summary>
    private static readonly DateTimeOffset MatchDay = NowUtc.AddDays(7);

    // Feature: match-lifecycle, Property 17: Completion applies exactly one rating update atomically -
    // for any in-progress match with a recorded result, Complete transitions the match to Completed,
    // applies exactly one IRatingEngine.UpdateRatings over the kickoff-derived outcome, writes exactly
    // one RatingSnapshot per kickoff participant carrying the engine's output μ/σ, and updates each
    // participating membership's rating to that output; completing an in-progress match with no
    // recorded result is rejected as result-required; and if any step fails the match stays InProgress
    // with no rating change and no snapshot written.
    // Validates: Requirements 12.1, 12.2, 12.5, 10.1
    [Property(MaxTest = 200)]
    [Trait("Property", "17")]
    public Property CompletionAppliesExactlyOneRatingUpdateAtomically() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var world = World.Build(scenario);

            var result = new CompleteMatchHandler(
                    world.Matches,
                    world.Ratings,
                    world.Snapshots,
                    world.Memberships,
                    world.Squads,
                    world.Engine,
                    world.UnitOfWork,
                    world.Clock,
                    world.Publisher,
                    NullLogger<CompleteMatchHandler>.Instance)
                .HandleAsync(new CompleteMatchCommand(world.OwnerUserId, world.Match.Id), CancellationToken.None)
                .GetAwaiter().GetResult();

            return scenario.HasResult
                ? VerifyCompleted(world, result)
                : VerifyResultRequired(world, result);
        });

    /// <summary>
    /// Verifies the success branch: the completion succeeds and is not an idempotent no-op; the match
    /// is <see cref="MatchState.Completed"/> stamped at the clock instant; exactly one rating update
    /// ran and the transaction committed exactly once; and exactly one snapshot exists per kickoff
    /// participant, each — like each membership's current rating — carrying the engine's output μ/σ.
    /// </summary>
    private static bool VerifyCompleted(World world, CompletionResult result)
    {
        if (!result.IsSuccess || result.Value!.AlreadyCompleted)
        {
            return false;
        }

        // The aggregate transitioned to Completed and was stamped with the clock's instant (10.1, 12.1).
        if (world.Match.State != MatchState.Completed || world.Match.CompletedAt != NowUtc)
        {
            return false;
        }

        // Exactly one rating update, committed by exactly one atomic save (12.1, 12.2).
        if (world.Engine.UpdateRatingsCallCount != 1 || world.UnitOfWork.SaveCallCount != 1)
        {
            return false;
        }

        // No participant needed seeding (all pre-rated), so no seed insert occurred.
        if (world.Ratings.AddCallCount != 0)
        {
            return false;
        }

        IReadOnlyList<Guid> kickoffMemberships = world.KickoffMembershipIds;

        // Exactly one snapshot per kickoff participant — no more, no fewer, no duplicates (12.1).
        if (world.Snapshots.Added.Count != kickoffMemberships.Count)
        {
            return false;
        }

        var snapshotMemberships = world.Snapshots.Added.Select(s => s.SquadMembershipId).ToHashSet();
        if (snapshotMemberships.Count != kickoffMemberships.Count
            || !kickoffMemberships.All(snapshotMemberships.Contains))
        {
            return false;
        }

        // Each snapshot and each membership's current rating carries the engine's output for that
        // membership — the transform of the pre-completion rating the outcome was derived from (12.1).
        foreach (Guid membershipId in kickoffMemberships)
        {
            PlayerRating expected = CountingRatingEngine.Transform(world.SeedRatings[membershipId]);

            RatingSnapshot snapshot = world.Snapshots.Added.Single(s => s.SquadMembershipId == membershipId);
            if (!RatingEquals(snapshot.Rating, expected))
            {
                return false;
            }

            MembershipRating? current = world.Ratings.Current(membershipId);
            if (current is null || !RatingEquals(current.Rating, expected))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// Verifies the failing branch: an in-progress match with no recorded result is rejected as
    /// result-required, and that failing step changes nothing — no rating update ran, no save
    /// committed, no snapshot was written, the match stays <see cref="MatchState.InProgress"/>, and
    /// every membership's current rating is untouched (Requirement 12.5, and the "any step fails"
    /// clause of Property 17).
    /// </summary>
    private static bool VerifyResultRequired(World world, CompletionResult result)
    {
        if (result.IsSuccess || result.Error!.Code != MatchErrorCode.ResultRequired)
        {
            return false;
        }

        if (world.Match.State != MatchState.InProgress || world.Match.CompletedAt is not null)
        {
            return false;
        }

        if (world.Engine.UpdateRatingsCallCount != 0
            || world.UnitOfWork.SaveCallCount != 0
            || world.Snapshots.Added.Count != 0)
        {
            return false;
        }

        // No membership rating changed: each still equals its untouched pre-completion seed.
        foreach (Guid membershipId in world.KickoffMembershipIds)
        {
            MembershipRating? current = world.Ratings.Current(membershipId);
            if (current is null || !RatingEquals(current.Rating, world.SeedRatings[membershipId]))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>Ratings compare equal when both μ and σ match exactly (they are produced by exact arithmetic).</summary>
    private static bool RatingEquals(PlayerRating left, PlayerRating right) =>
        left.Mu == right.Mu && left.Sigma == right.Sigma;

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>A generated scenario: the two kickoff team sizes, whether a result was recorded, and the per-team scores.</summary>
    private sealed record Scenario(int SizeA, int SizeB, bool HasResult, int ScoreA, int ScoreB);

    /// <summary>
    /// Generates two valid team sizes in 5..8 (so lock always succeeds and uneven splits such as 7v6
    /// occur), whether a result was recorded (exercising both the success and the result-required
    /// branches), and per-team scores in 0..99 (so wins, losses, and draws all arise).
    /// </summary>
    private static Gen<Scenario> ScenarioGen() =>
        from sizeA in Gen.Choose(Match.TeamMinSize, Match.TeamMaxSize)
        from sizeB in Gen.Choose(Match.TeamMinSize, Match.TeamMaxSize)
        from hasResult in Gen.Elements(true, false)
        from scoreA in Gen.Choose(MatchResult.MinScore, MatchResult.MaxScore)
        from scoreB in Gen.Choose(MatchResult.MinScore, MatchResult.MaxScore)
        select new Scenario(sizeA, sizeB, hasResult, scoreA, scoreB);

    /// <summary>
    /// The wired system under test for one scenario: an in-progress (optionally result-recorded) match
    /// in a fresh squad, its pre-rated participants, an active owner as the acting organiser, and the
    /// fakes the completion handler runs against, with the seed ratings and kickoff membership order
    /// retained so the assertions can predict the engine's output per participant.
    /// </summary>
    private sealed class World
    {
        public required Match Match { get; init; }
        public required Guid OwnerUserId { get; init; }
        public required IReadOnlyList<Guid> KickoffMembershipIds { get; init; }
        public required IReadOnlyDictionary<Guid, PlayerRating> SeedRatings { get; init; }
        public required AtomicCompletionMatchRepository Matches { get; init; }
        public required AtomicCompletionMembershipRepository Memberships { get; init; }
        public required AtomicCompletionRatingRepository Ratings { get; init; }
        public required RecordingSnapshotRepository Snapshots { get; init; }
        public required AtomicCompletionSquadRepository Squads { get; init; }
        public required CountingRatingEngine Engine { get; init; }
        public required AtomicCompletionUnitOfWork UnitOfWork { get; init; }
        public required FakeTimeProvider Clock { get; init; }
        public required AtomicCompletionPublisher Publisher { get; init; }

        public static World Build(Scenario scenario)
        {
            var squadId = Guid.NewGuid();

            // The acting organiser: an active registered owner of the match's squad.
            SquadMembership owner = SquadMembership.CreateOwner(squadId, Guid.NewGuid(), "Owner").Value!;

            // Draft -> confirm (empty pool) -> add the exact participant count -> partition into two
            // named teams with a single bib team -> lock -> start, leaving the match InProgress.
            Match match = Match.CreateDraft(Guid.Empty, squadId, "Community Astro Pitch", [MatchDay], NowUtc).Value!;
            match.Confirm(MatchDay, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);

            int total = scenario.SizeA + scenario.SizeB;
            var participants = new List<SquadMembership>(total);
            var participantIds = new List<Guid>(total);
            var ratings = new AtomicCompletionRatingRepository();
            var seedRatings = new Dictionary<Guid, PlayerRating>(total);

            for (var i = 0; i < total; i++)
            {
                SquadMembership member = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Player {i}").Value!;
                match.AddParticipant(member);
                participants.Add(member);
                participantIds.Add(member.Id);

                // A distinct, established (low-σ) rating per participant so the engine's per-player
                // output is distinguishable and predictable.
                var seed = new PlayerRating(20.0 + i, 4.0 + (i * 0.1));
                seedRatings[member.Id] = seed;
                ratings.Seed(member.Id, seed);
            }

            var proposal = new List<ProposedTeam>
            {
                new("Reds", BibFlag: true, participantIds.Take(scenario.SizeA).ToList()),
                new("Blues", BibFlag: false, participantIds.Skip(scenario.SizeA).ToList()),
            };
            match.ApplyTeamProposal(proposal);
            match.Lock();

            // Capture the working-team ids (which the recorded result scores) before starting.
            List<MatchTeam> teams = match.Teams.ToList();
            match.Start();

            if (scenario.HasResult)
            {
                var result = new MatchResult(
                    ResultFidelity.Basic,
                    new[]
                    {
                        new TeamScore(teams[0].Id, scenario.ScoreA),
                        new TeamScore(teams[1].Id, scenario.ScoreB),
                    });
                match.RecordResult(result, liveTrackingEnabled: false);
            }

            // The kickoff participant order the handler maps the engine's output back through.
            IReadOnlyList<Guid> kickoffMembershipIds = match.KickoffLineup!.Teams
                .SelectMany(t => t.ParticipantMembershipIds)
                .ToList();

            var allMemberships = new List<SquadMembership>(participants) { owner };

            return new World
            {
                Match = match,
                OwnerUserId = owner.UserId!.Value,
                KickoffMembershipIds = kickoffMembershipIds,
                SeedRatings = seedRatings,
                Matches = new AtomicCompletionMatchRepository(match),
                Memberships = new AtomicCompletionMembershipRepository(allMemberships.ToArray()),
                Ratings = ratings,
                Snapshots = new RecordingSnapshotRepository(),
                Squads = new AtomicCompletionSquadRepository(),
                Engine = new CountingRatingEngine(),
                UnitOfWork = new AtomicCompletionUnitOfWork(),
                Clock = new FakeTimeProvider(NowUtc),
                Publisher = new AtomicCompletionPublisher(),
            };
        }
    }
}
