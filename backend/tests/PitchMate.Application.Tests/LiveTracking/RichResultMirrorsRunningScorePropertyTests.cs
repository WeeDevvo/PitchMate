using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Domain.LiveTracking;
using MatchState = PitchMate.Domain.Matches.MatchState;
using MatchResult = PitchMate.Domain.Matches.MatchResult;
using ResultFidelity = PitchMate.Domain.Matches.ResultFidelity;
using TeamScore = PitchMate.Domain.Matches.TeamScore;

namespace PitchMate.Application.Tests.LiveTracking;

/// <summary>
/// Property-based test for <see cref="FinaliseTrackedResultHandler"/> covering design Property 14 — the
/// <c>Rich</c> match result mirrors the running score and the basic outcome. It drives the real
/// handler (over a real match-lifecycle <see cref="CompleteMatchHandler"/>) against the in-memory
/// <see cref="FinaliseTrackedResultWorld"/> per the Application-layer testing strategy (no database).
/// <para>
/// For an <c>InProgress</c> match with an arbitrary effective goal log, finalising records a
/// <c>Rich</c> result whose per-team final score equals that team's running score — including 0 for a
/// team with no effective goals (Requirement 8.1, 8.5) — and whose derived win/loss/draw placement is
/// identical to the outcome of a <c>Basic</c> result with the same scores (Requirement 8.2). For a
/// match that is not <c>InProgress</c>, finalising is rejected with an error naming <c>InProgress</c>
/// as the required state, records no result, and applies no rating update (Requirement 8.4).
/// </para>
/// </summary>
[Trait("Feature", "live-tracking")]
public class RichResultMirrorsRunningScorePropertyTests
{
    // Feature: live-tracking, Property 14: The Rich match result mirrors the running score and the
    // basic outcome - finalising an InProgress live-tracked match derives a Rich MatchResult assigning
    // each team a final score equal to that team's running score (0 when it has no effective goals),
    // and the win/loss/draw placement it yields is identical to a Basic result with the same scores;
    // finalising a match that is not InProgress is rejected naming the required state and records no
    // result.
    // Validates: Requirements 8.1, 8.2, 8.4, 8.5
    [Property(MaxTest = 200)]
    [Trait("Property", "14")]
    public Property RichResultMirrorsRunningScoreAndBasicOutcome() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            FinaliseTrackedResultWorld world =
                FinaliseTrackedResultWorld.Build(scenario.State, scenario.PlayerCount, scenario.TeamASize);

            return scenario.State == MatchState.InProgress
                ? VerifyMirroring(world, scenario)
                : VerifyRejection(world, scenario.State);
        });

    /// <summary>
    /// The InProgress branch (Requirement 8.1, 8.2, 8.5): after seeding the effective (and some
    /// retracted) goals, finalising records a Rich result whose scores equal the running score and
    /// whose outcome matches the basic outcome with the same scores.
    /// </summary>
    private static bool VerifyMirroring(FinaliseTrackedResultWorld world, Scenario scenario)
    {
        // Seed the effective goals (the independent oracle for each team's final score) plus some
        // retracted goals that must not count toward it.
        world.SeedEffectiveGoals(world.TeamAId, scenario.ScoreA, startMinute: 1);
        world.SeedEffectiveGoals(world.TeamBId, scenario.ScoreB, startMinute: 40);
        world.SeedRetractedGoals(world.TeamAId, scenario.RetractA, startMinute: 100);
        world.SeedRetractedGoals(world.TeamBId, scenario.RetractB, startMinute: 130);

        Result<FinaliseTrackedResultResult> result = world.FinaliseAsOwner();
        if (!result.IsSuccess)
        {
            return false;
        }

        // The match completed and recorded exactly one Rich result via a single rating update.
        if (world.Match.State != MatchState.Completed || world.Engine.UpdateRatingsCallCount != 1)
        {
            return false;
        }

        MatchResult? recorded = world.Match.RecordedResult;
        if (recorded is null || recorded.Fidelity != ResultFidelity.Rich)
        {
            return false;
        }

        // Requirement 8.1 / 8.5: each team's recorded final score equals its running score — the count
        // of its effective (non-retracted) goals, which is 0 for a team with none.
        int RecordedFor(Guid teamId) => recorded.TeamScores.Single(s => s.TeamId == teamId).Score;
        if (recorded.TeamScores.Count != 2
            || RecordedFor(world.TeamAId) != scenario.ScoreA
            || RecordedFor(world.TeamBId) != scenario.ScoreB)
        {
            return false;
        }

        // The handler's own returned scores mirror the recorded result.
        int ReturnedFor(Guid teamId) => result.Value!.TeamScores.Single(s => s.TeamId == teamId).Score;
        if (result.Value!.TeamScores.Count != 2
            || ReturnedFor(world.TeamAId) != scenario.ScoreA
            || ReturnedFor(world.TeamBId) != scenario.ScoreB)
        {
            return false;
        }

        // Requirement 8.2: the win/loss/draw placement derived from the Rich result is identical to the
        // placement a Basic result with the same scores yields.
        int[] richRanks = world.DeriveRankVector();
        int[] basicRanks = world.DeriveBasicMirrorRankVector(
            scenario.PlayerCount, scenario.TeamASize, scenario.ScoreA, scenario.ScoreB);
        if (!richRanks.SequenceEqual(basicRanks))
        {
            return false;
        }

        // And that placement is exactly standard competition ranking over the two scores, so a strictly
        // higher score is a strictly better (lower) rank and equal scores tie.
        int[] expectedRanks = StandardCompetitionRanks(scenario.ScoreA, scenario.ScoreB);
        return richRanks.SequenceEqual(expectedRanks);
    }

    /// <summary>
    /// The non-InProgress branch (Requirement 8.4): finalising is rejected with an error naming the
    /// required state, records no result, and applies no rating update.
    /// </summary>
    private static bool VerifyRejection(FinaliseTrackedResultWorld world, MatchState state)
    {
        Result<FinaliseTrackedResultResult> result = world.FinaliseAsOwner();

        LiveTrackingErrorCode expectedCode = state == MatchState.Cancelled
            ? LiveTrackingErrorCode.LogSealed
            : LiveTrackingErrorCode.MatchNotStarted;

        return !result.IsSuccess
            && result.Error!.Code == expectedCode
            && result.Error!.Message.Contains(MatchState.InProgress.ToString(), StringComparison.Ordinal)
            && world.Match.RecordedResult is null
            && world.Match.State == state
            && world.Engine.UpdateRatingsCallCount == 0;
    }

    /// <summary>Standard competition ranking of two team scores: rank = 1 + number of strictly higher scores.</summary>
    private static int[] StandardCompetitionRanks(int scoreA, int scoreB)
    {
        var scores = new[] { scoreA, scoreB };
        return scores.Select(s => 1 + scores.Count(other => other > s)).ToArray();
    }

    /// <summary>
    /// Generates a finalise scenario: a match state (biased toward <c>InProgress</c> so the mirroring
    /// branch is exercised often, with each pre-play state and <c>Cancelled</c> represented for the
    /// rejection branch), a participant count of 10..16 split across two teams that each satisfy the
    /// 5..8 lock rule, an effective goal count (0..12) for each team, and a few extra retracted goals
    /// (0..3) per team.
    /// </summary>
    private static Gen<Scenario> ScenarioGen() =>
        Gen.Elements(
                MatchState.InProgress, MatchState.InProgress, MatchState.InProgress, MatchState.InProgress,
                MatchState.GatheringAvailability, MatchState.Confirmed, MatchState.TeamsRolled, MatchState.Cancelled)
            .SelectMany(state =>
                Gen.Choose(10, 16).SelectMany(count =>
                    Gen.Choose(Math.Max(5, count - 8), Math.Min(8, count - 5)).SelectMany(teamASize =>
                        Gen.Choose(0, 12).SelectMany(scoreA =>
                            Gen.Choose(0, 12).SelectMany(scoreB =>
                                Gen.Choose(0, 3).SelectMany(retractA =>
                                    Gen.Choose(0, 3).Select(retractB =>
                                        new Scenario(state, count, teamASize, scoreA, scoreB, retractA, retractB))))))));

    /// <summary>A generated finalise scenario.</summary>
    /// <param name="State">The match state to stage; <c>InProgress</c> exercises mirroring, others exercise rejection.</param>
    /// <param name="PlayerCount">The number of participants (10..16), all assigned to the kickoff lineup.</param>
    /// <param name="TeamASize">The size of the first team; the second team gets the remainder (both 5..8).</param>
    /// <param name="ScoreA">The number of effective goals for the first team.</param>
    /// <param name="ScoreB">The number of effective goals for the second team.</param>
    /// <param name="RetractA">Extra goals for the first team that are retracted and must not count.</param>
    /// <param name="RetractB">Extra goals for the second team that are retracted and must not count.</param>
    private sealed record Scenario(
        MatchState State,
        int PlayerCount,
        int TeamASize,
        int ScoreA,
        int ScoreB,
        int RetractA,
        int RetractB);
}
