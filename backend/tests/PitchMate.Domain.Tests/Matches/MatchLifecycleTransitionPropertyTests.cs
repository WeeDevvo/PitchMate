using System.Reflection;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Matches;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Property-based tests for match lifecycle transitions (match-lifecycle design Property 2).
/// <para>
/// The property is an "iff" over the forward transition guard: an organising action succeeds
/// exactly when the (state, action) pair is a defined forward transition, and is otherwise
/// rejected with an <see cref="MatchErrorCode.InvalidState"/> error naming both the required and
/// the current state, leaving the match state and all its data unchanged. Only the
/// <see cref="Match.Start"/> transition (TeamsRolled → InProgress) is implemented so far, so it is
/// exercised here as the representative forward transition across every <see cref="MatchState"/>:
/// <see cref="Match.Start"/> succeeds and moves to <see cref="MatchState.InProgress"/> iff the
/// current state is <see cref="MatchState.TeamsRolled"/>; from every other state it is rejected and
/// nothing changes. The remaining transitions (Confirm, Lock, Complete) and the cancellation
/// property are covered by their own tasks. The property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchLifecycleTransitionPropertyTests
{
    /// <summary>The single source state from which <see cref="Match.Start"/> is a defined forward transition.</summary>
    private const MatchState StartRequiredState = MatchState.TeamsRolled;

    // Feature: match-lifecycle, Property 2: Only defined lifecycle transitions are permitted
    // Validates: Requirements 2.3, 2.5, 2.6, 2.7, 4.6, 6.8, 11.1, 11.6, 12.8
    [Property(MaxTest = 100)]
    [Trait("Property", "2")]
    public Property StartSucceedsOnlyFromTeamsRolledAndIsOtherwiseRejectedUnchanged() =>
        Prop.ForAll(Arb.From(MatchInStateGen()), sample =>
        {
            var match = sample.Match;
            var originalState = match.State;

            // Capture all observable data before the action so we can assert it is untouched on rejection.
            var squadId = match.SquadId;
            var location = match.Location;
            var candidateDayCount = match.CandidateDays.Count;

            var result = match.Start();

            if (originalState == StartRequiredState)
            {
                // Defined forward transition: succeeds and advances to InProgress.
                return result.IsSuccess && match.State == MatchState.InProgress;
            }

            // Every other state (including terminal Completed/Cancelled) is rejected with an
            // InvalidState error that names both the required and current state, and nothing changes.
            var message = result.Error?.Message ?? string.Empty;
            return !result.IsSuccess
                && result.Error!.Code == MatchErrorCode.InvalidState
                && message.Contains(StartRequiredState.ToString(), StringComparison.Ordinal)
                && message.Contains(originalState.ToString(), StringComparison.Ordinal)
                && match.State == originalState
                && match.SquadId == squadId
                && match.Location == location
                && match.CandidateDays.Count == candidateDayCount;
        });

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>A match forced into a specific lifecycle state for exercising the transition guard.</summary>
    private sealed record MatchSample(Match Match);

    /// <summary>
    /// Generates a valid draft and forces it into one of the six <see cref="MatchState"/> values,
    /// spanning the whole state space so both the success and rejection directions are covered.
    /// </summary>
    private static Gen<MatchSample> MatchInStateGen() =>
        from state in Gen.Elements(Enum.GetValues<MatchState>())
        select new MatchSample(CreateMatchInState(state));

    /// <summary>
    /// Builds a valid draft (in <see cref="MatchState.GatheringAvailability"/>) and moves it into
    /// <paramref name="state"/> by setting the private <see cref="Match.State"/> setter via
    /// reflection, so the state machine can be exercised in isolation without the not-yet-implemented
    /// forward transitions.
    /// </summary>
    private static Match CreateMatchInState(MatchState state)
    {
        var now = new DateTimeOffset(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var result = Match.CreateDraft(
            Guid.Empty,
            Guid.NewGuid(),
            "Community Astro Pitch",
            [now.AddDays(1), now.AddDays(2)],
            now);

        var match = result.Value!;

        var stateProperty = typeof(Match).GetProperty(
            nameof(Match.State),
            BindingFlags.Instance | BindingFlags.Public)!;
        stateProperty.SetValue(match, state);

        return match;
    }
}
