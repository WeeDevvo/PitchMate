using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.LiveTracking;
using Result = PitchMate.Domain.LiveTracking.Result;

namespace PitchMate.Domain.Tests.LiveTracking;

/// <summary>
/// Property-based test for goal-event recording validation (live-tracking design Property 4),
/// exercising the pure Domain function <see cref="MatchEventValidation.ValidateForRecording"/>.
/// <para>
/// Property 4 states that a candidate <see cref="GoalScoredEvent"/> recorded for a trackable match is
/// accepted <em>iff</em> it supplies a scoring team and a match minute, the scoring team is one of the
/// match's kickoff teams, the minute is a whole number in [0, 200], and — when a scorer is named — the
/// scorer is a match participant and, unless the goal is an own goal, a member of the scoring team's
/// roster; otherwise it is rejected with a validation error identifying the offending or missing field
/// and nothing is appended. A goal naming no scorer is accepted.
/// </para>
/// <para>
/// The <see cref="MatchMinute"/> value object structurally enforces the inclusive [0, 200] range at
/// construction, so a <see cref="GoalScoredEvent"/> can never carry an out-of-range minute; the
/// generator therefore spans valid minutes across the whole range and the minute is never the offending
/// field (Requirement 3.6 is enforced structurally). The generator instead spans the scoring-team and
/// scorer dimensions — a valid team, the empty (missing) team, and an unknown team; and no scorer, a
/// scorer on the scoring team's roster, a scorer on the opposing team, and a non-participant stranger —
/// against both own-goal settings, so every accept and reject branch of Property 4 is covered.
/// </para>
/// </summary>
[Trait("Feature", "live-tracking")]
public class GoalEventValidationPropertyTests
{
    private static readonly Guid MatchId = Guid.CreateVersion7();
    private static readonly Guid SquadId = Guid.CreateVersion7();

    private static readonly Guid TeamAId = Guid.CreateVersion7();
    private static readonly Guid TeamBId = Guid.CreateVersion7();

    private static readonly Guid PlayerA1 = Guid.CreateVersion7();
    private static readonly Guid PlayerA2 = Guid.CreateVersion7();
    private static readonly Guid PlayerB1 = Guid.CreateVersion7();
    private static readonly Guid PlayerB2 = Guid.CreateVersion7();

    private static readonly IReadOnlyDictionary<Guid, IReadOnlyList<Guid>> TeamRosters =
        new Dictionary<Guid, IReadOnlyList<Guid>>
        {
            [TeamAId] = [PlayerA1, PlayerA2],
            [TeamBId] = [PlayerB1, PlayerB2],
        };

    private static readonly IReadOnlySet<Guid> Participants =
        new HashSet<Guid> { PlayerA1, PlayerA2, PlayerB1, PlayerB2 };

    // Feature: live-tracking, Property 4: Goal-event validation and crediting
    // ValidateForRecording accepts a candidate goal exactly when: the scoring team is present and one
    // of the match's kickoff teams, and (when a scorer is named) the scorer is a participant and —
    // unless an own goal — on the scoring team's roster. Otherwise it fails with a ValidationFailed
    // error and appends nothing. An absent scorer is permitted.
    // Validates: Requirements 1.7, 3.1, 3.2, 3.3, 3.5, 3.6, 3.7
    [Property(MaxTest = 100)]
    [Trait("Property", "4")]
    public Property GoalIsAcceptedExactlyWhenTeamAndScorerAreValid() =>
        Prop.ForAll(Arb.From(GoalCandidateGen()), candidate =>
        {
            var goal = new GoalScoredEvent(
                Guid.CreateVersion7(),
                MatchId,
                SquadId,
                MatchMinute.Create(candidate.Minute).Value,
                candidate.ScoringTeamId,
                candidate.ScorerMembershipId,
                candidate.OwnGoal);

            bool expectedValid = ExpectedValid(candidate);

            Result result = MatchEventValidation.ValidateForRecording(
                goal, TeamRosters, Participants, existingEvents: []);

            if (expectedValid)
            {
                // Accepted: success and no error carried.
                return result.IsSuccess && result.Error is null;
            }

            // Rejected: a validation failure identifying the offending or missing field, nothing appended.
            return !result.IsSuccess
                && result.Error is { Code: LiveTrackingErrorCode.ValidationFailed }
                && !string.IsNullOrWhiteSpace(result.Error.Message);
        });

    /// <summary>
    /// The independent oracle for Property 4's acceptance predicate over the generated candidate space.
    /// A candidate is valid iff the scoring team is present and a match team and (when a scorer is
    /// named) the scorer is a participant and — unless an own goal — on the scoring team's roster.
    /// </summary>
    private static bool ExpectedValid(GoalCandidate candidate)
    {
        if (candidate.ScoringTeamId == Guid.Empty)
        {
            return false;
        }

        if (!TeamRosters.TryGetValue(candidate.ScoringTeamId, out var scoringRoster))
        {
            return false;
        }

        if (candidate.ScorerMembershipId is Guid scorer)
        {
            if (!Participants.Contains(scorer))
            {
                return false;
            }

            if (!candidate.OwnGoal && !scoringRoster.Contains(scorer))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// Generates a candidate goal spanning the scoring-team dimension (a valid team, the empty/missing
    /// team, or an unknown team), the scorer dimension (no scorer, a scorer on the scoring team, a
    /// scorer on the opposing team, or a non-participant stranger), the own-goal flag, and a valid
    /// minute across the inclusive [0, 200] range.
    /// </summary>
    private static Gen<GoalCandidate> GoalCandidateGen() =>
        from scoringTeamId in ScoringTeamGen()
        from scorer in ScorerGen()
        from ownGoal in Gen.Elements(false, true)
        from minute in Gen.Choose(MatchMinute.MinValue, MatchMinute.MaxValue)
        select new GoalCandidate(scoringTeamId, scorer, ownGoal, minute);

    private static Gen<Guid> ScoringTeamGen() =>
        Gen.OneOf(
            Gen.Elements(TeamAId, TeamBId),
            Gen.Constant(Guid.Empty),
            Gen.Constant(0).Select(_ => Guid.CreateVersion7()));

    private static Gen<Guid?> ScorerGen() =>
        Gen.OneOf(
            Gen.Constant<Guid?>(null),
            Gen.Elements<Guid?>(PlayerA1, PlayerA2, PlayerB1, PlayerB2),
            Gen.Constant(0).Select(_ => (Guid?)Guid.CreateVersion7()));

    /// <summary>A generated candidate goal's varying fields.</summary>
    private sealed record GoalCandidate(Guid ScoringTeamId, Guid? ScorerMembershipId, bool OwnGoal, int Minute);
}
