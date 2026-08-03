using System.Reflection;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Matches;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Property-based tests for match cancellation (match-lifecycle design Property 3).
/// <para>
/// The property is an "iff" over the current state: <see cref="Match.Cancel"/> succeeds and yields
/// <see cref="MatchState.Cancelled"/> exactly when the match is in
/// <see cref="MatchState.GatheringAvailability"/>, <see cref="MatchState.Confirmed"/>, or
/// <see cref="MatchState.TeamsRolled"/>; from <see cref="MatchState.InProgress"/>,
/// <see cref="MatchState.Completed"/>, or <see cref="MatchState.Cancelled"/> it is rejected with an
/// <see cref="MatchErrorCode.InvalidState"/> error naming the current state and leaves the match
/// unchanged. A successful cancellation changes only <see cref="Match.State"/> — it applies no rating
/// update, writes no snapshot, and touches no other match data (the Domain aggregate carries no
/// rating members, so "no rating effect" is asserted by observing that only the state changed).
/// The property is driven by a generator over all six <see cref="MatchState"/> values and runs at
/// least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchCancellationPropertyTests
{
    /// <summary>The private <see cref="Match.State"/> setter, used to place a match into an arbitrary state.</summary>
    private static readonly PropertyInfo StateProperty =
        typeof(Match).GetProperty(nameof(Match.State))
        ?? throw new InvalidOperationException("Match.State property not found.");

    /// <summary>The states from which cancellation is allowed (before play).</summary>
    private static readonly HashSet<MatchState> CancellableStates =
    [
        MatchState.GatheringAvailability,
        MatchState.Confirmed,
        MatchState.TeamsRolled
    ];

    // Feature: match-lifecycle, Property 3: Cancellation is allowed only before play and has no rating effect
    // Validates: Requirements 2.4, 15.1, 15.2, 15.3
    [Property(MaxTest = 100)]
    [Trait("Property", "3")]
    public Property CancellationIsAllowedOnlyBeforePlayAndHasNoRatingEffect() =>
        Prop.ForAll(Arb.From(MatchStateGen()), state =>
        {
            var match = CreateMatchInState(state);

            // Capture all observable data before cancelling to assert the rejection path is a no-op
            // and the success path changes nothing but the state (no rating members exist to change).
            var squadIdBefore = match.SquadId;
            var locationBefore = match.Location;
            var candidateDaysBefore = match.CandidateDays.ToArray();

            var result = match.Cancel();

            if (CancellableStates.Contains(state))
            {
                return result.IsSuccess
                    && match.State == MatchState.Cancelled
                    && DataUnchanged(match, squadIdBefore, locationBefore, candidateDaysBefore);
            }

            return !result.IsSuccess
                && result.Error!.Code == MatchErrorCode.InvalidState
                && result.Error!.Message.Contains(state.ToString(), StringComparison.Ordinal)
                && match.State == state
                && DataUnchanged(match, squadIdBefore, locationBefore, candidateDaysBefore);
        });

    /// <summary>All match data other than <see cref="Match.State"/> is identical to the captured values.</summary>
    private static bool DataUnchanged(
        Match match,
        Guid squadIdBefore,
        string locationBefore,
        IReadOnlyList<CandidateDay> candidateDaysBefore) =>
        match.SquadId == squadIdBefore
        && match.Location == locationBefore
        && match.CandidateDays.SequenceEqual(candidateDaysBefore);

    /// <summary>
    /// Builds a valid draft (which starts in <see cref="MatchState.GatheringAvailability"/>) and then
    /// forces it into <paramref name="state"/> via the private state setter, so the match under test
    /// carries realistic data in every one of the six states.
    /// </summary>
    private static Match CreateMatchInState(MatchState state)
    {
        var now = new DateTimeOffset(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var result = Match.CreateDraft(
            Guid.Empty,
            Guid.NewGuid(),
            "Central Pitch",
            [now.AddDays(1), now.AddDays(2), now.AddDays(3)],
            now);

        var match = result.Value ?? throw new InvalidOperationException("Draft creation failed unexpectedly.");
        StateProperty.SetValue(match, state);
        return match;
    }

    /// <summary>Generates any of the six lifecycle states with equal weight.</summary>
    private static Gen<MatchState> MatchStateGen() =>
        Gen.Elements(
            MatchState.GatheringAvailability,
            MatchState.Confirmed,
            MatchState.TeamsRolled,
            MatchState.InProgress,
            MatchState.Completed,
            MatchState.Cancelled);
}
