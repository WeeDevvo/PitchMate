using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Property-based tests for invalid-score rejection when recording a result (match-lifecycle design
/// Property 16).
/// <para>
/// For any proposed result, <see cref="Match.RecordResult(MatchResult, bool)"/> is rejected with a
/// <see cref="MatchErrorCode.ValidationFailed"/> error identifying the offending score <em>iff</em>
/// any team score is negative or greater than 99, or a score is missing for one of the match's teams,
/// or a score is supplied for a team that is not one of the match's teams; on rejection no result is
/// stored (Requirement 11.7). A non-whole score is structurally unrepresentable because
/// <see cref="TeamScore.Score"/> is an <see cref="int"/>, so it is not exercised here.
/// </para>
/// <para>
/// The test drives a match into <see cref="MatchState.InProgress"/> with exactly two locked teams,
/// then proposes a result assembled from an independently generated scenario: each of the two match
/// teams is independently either scored (with a value spanning below-range, in-range, and above-range)
/// or omitted, and an extra score for a non-team may be added. An independent oracle decides the
/// expected outcome — success iff both match teams are scored, no non-team score is present, and both
/// scores are in 0..99 — and the test asserts that a success stores the result and leaves the match
/// <see cref="MatchState.InProgress"/>, while a rejection is a <see cref="MatchErrorCode.ValidationFailed"/>
/// failure that stores nothing (<see cref="Match.RecordedResult"/> remains <see langword="null"/>).
/// Live tracking is enabled throughout so the fidelity gate (design Property 15) never fires and the
/// outcome is decided purely by score validation. The property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchResultScoreValidationPropertyTests
{
    /// <summary>The clock instant the generated match is drafted against; the candidate day is strictly after it.</summary>
    private static readonly DateTimeOffset NowUtc = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);

    /// <summary>The number of players placed on each of the two teams (a valid, even 5v5 lock).</summary>
    private const int TeamSize = 5;

    // Feature: match-lifecycle, Property 16: Invalid result scores are rejected without storing a
    // result - for any proposed result, recording is rejected with a validation error identifying the
    // offending score iff any team score is negative, non-whole, or greater than 99, or a score is
    // missing for one of the match's teams, or a score is supplied for a team that is not one of the
    // match's teams; on rejection no result is stored.
    // Validates: Requirements 11.7
    [Property(MaxTest = 100)]
    [Trait("Property", "16")]
    public Property InvalidResultScoresAreRejectedWithoutStoringAResult() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var squadId = Guid.NewGuid();
            var match = InProgressMatch(squadId, out var teamIds);
            var teamAId = teamIds[0];
            var teamBId = teamIds[1];

            // Assemble the proposed per-team scores from the scenario, referencing each team at most
            // once so the only defects are out-of-range, missing, or non-team scores (Property 16).
            var teamScores = new List<TeamScore>();
            if (scenario.IncludeA)
            {
                teamScores.Add(new TeamScore(teamAId, scenario.ScoreA));
            }

            if (scenario.IncludeB)
            {
                teamScores.Add(new TeamScore(teamBId, scenario.ScoreB));
            }

            if (scenario.IncludeExtra)
            {
                // A score for a team that is not one of the match's teams.
                teamScores.Add(new TeamScore(Guid.NewGuid(), scenario.ExtraScore));
            }

            var proposed = new MatchResult(scenario.Fidelity, teamScores);

            var result = match.RecordResult(proposed, liveTrackingEnabled: true);

            // Oracle: recording succeeds iff both match teams are scored exactly once, no non-team
            // score is supplied, and both supplied scores are whole numbers in 0..99.
            var bothTeamsScored = scenario.IncludeA && scenario.IncludeB;
            var scoresInRange = InRange(scenario.ScoreA) && InRange(scenario.ScoreB);
            var expectedSuccess = bothTeamsScored && !scenario.IncludeExtra && scoresInRange;

            if (expectedSuccess)
            {
                // Success: the result is stored and the match remains InProgress.
                return result.IsSuccess
                    && ReferenceEquals(match.RecordedResult, proposed)
                    && match.State == MatchState.InProgress;
            }

            // Rejection: a validation failure that stores no result (RecordedResult stays null).
            return !result.IsSuccess
                && result.Error!.Code == MatchErrorCode.ValidationFailed
                && match.RecordedResult is null
                && match.State == MatchState.InProgress;
        });

    /// <summary>Whether <paramref name="score"/> is a valid whole-number team score (0..99 inclusive).</summary>
    private static bool InRange(int score) => score >= MatchResult.MinScore && score <= MatchResult.MaxScore;

    /// <summary>
    /// Builds a match drafted and confirmed for <paramref name="squadId"/>, populated with two valid
    /// teams of <see cref="TeamSize"/> players each, locked, and started, leaving it in
    /// <see cref="MatchState.InProgress"/> with a captured kickoff lineup. Exposes the two working
    /// teams' identities via <paramref name="teamIds"/> so scores can be proposed against them.
    /// </summary>
    private static Match InProgressMatch(Guid squadId, out IReadOnlyList<Guid> teamIds)
    {
        var day = NowUtc.AddDays(7);
        var match = Match.CreateDraft(Guid.Empty, squadId, "Community Astro Pitch", [day], NowUtc).Value!;
        match.Confirm(day, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);

        var participantIds = new List<Guid>(TeamSize * 2);
        for (var i = 0; i < TeamSize * 2; i++)
        {
            var membership = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Player {i}").Value!;
            match.AddParticipant(membership);
            participantIds.Add(membership.Id);
        }

        var proposal = new List<ProposedTeam>
        {
            new("Reds", true, participantIds.Take(TeamSize).ToList()),
            new("Blues", false, participantIds.Skip(TeamSize).ToList())
        };

        match.ApplyTeamProposal(proposal);
        match.Lock();
        match.Start();

        teamIds = match.Teams.Select(t => t.Id).ToList();
        return match;
    }

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>
    /// A generated result scenario: whether each of the two match teams is scored and with what value,
    /// whether an extra non-team score is supplied and with what value, and the result fidelity.
    /// </summary>
    private sealed record Scenario(
        bool IncludeA,
        int ScoreA,
        bool IncludeB,
        int ScoreB,
        bool IncludeExtra,
        int ExtraScore,
        ResultFidelity Fidelity);

    /// <summary>
    /// Generates a scenario exercising every branch of Property 16: each team is usually (but not
    /// always) scored, so the missing-score case occurs; scores span below-range, in-range, and
    /// above-range so the out-of-range cases occur alongside the valid case; and a non-team score is
    /// occasionally supplied so the non-team case occurs. Fidelity varies across the closed set.
    /// </summary>
    private static Gen<Scenario> ScenarioGen() =>
        from includeA in IncludeGen()
        from scoreA in ScoreGen()
        from includeB in IncludeGen()
        from scoreB in ScoreGen()
        from includeExtra in ExtraGen()
        from extraScore in Gen.Choose(MatchResult.MinScore, MatchResult.MaxScore)
        from fidelity in Gen.Elements(ResultFidelity.Basic, ResultFidelity.Rich)
        select new Scenario(includeA, scoreA, includeB, scoreB, includeExtra, extraScore, fidelity);

    /// <summary>Generates an inclusion flag biased toward including a team's score (so the success path is well sampled).</summary>
    private static Gen<bool> IncludeGen() =>
        Gen.Frequency(
            (3, Gen.Constant(true)),
            (1, Gen.Constant(false)));

    /// <summary>Generates an extra-non-team flag biased toward absent (so the success path is well sampled).</summary>
    private static Gen<bool> ExtraGen() =>
        Gen.Frequency(
            (1, Gen.Constant(true)),
            (4, Gen.Constant(false)));

    /// <summary>
    /// Generates a score biased toward the valid range 0..99, with below-range (negative) and
    /// above-range (&gt; 99) values sampled so the out-of-range rejection branches are exercised.
    /// </summary>
    private static Gen<int> ScoreGen() =>
        Gen.Frequency(
            (4, Gen.Choose(MatchResult.MinScore, MatchResult.MaxScore)),
            (1, Gen.Choose(-20, -1)),
            (1, Gen.Choose(MatchResult.MaxScore + 1, MatchResult.MaxScore + 40)));
}
