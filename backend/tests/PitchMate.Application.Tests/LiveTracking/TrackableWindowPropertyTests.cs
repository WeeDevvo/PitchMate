using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Domain.LiveTracking;
using MatchState = PitchMate.Domain.Matches.MatchState;

namespace PitchMate.Application.Tests.LiveTracking;

/// <summary>
/// Property-based test for <see cref="RecordEventBatchHandler"/> covering design Property 10 —
/// recording is confined to the trackable window. Across every <see cref="MatchState"/>, recording an
/// event carrying a not-yet-present <c>Event_Id</c> succeeds only while the match is
/// <see cref="MatchState.InProgress"/>; it is rejected as not-started before then and as sealed once
/// completed or cancelled; but an event whose id is already present for a completed or cancelled match
/// is a <c>Duplicate</c> that leaves the log unchanged, so idempotency takes precedence over the
/// sealed rejection.
/// </summary>
[Trait("Feature", "live-tracking")]
public class TrackableWindowPropertyTests
{
    // Feature: live-tracking, Property 10: Recording is confined to the trackable window - recording an
    // event carrying a not-yet-present Event_Id succeeds only while the match is InProgress; in
    // GatheringAvailability, Confirmed, or TeamsRolled it is rejected as not-started; in Completed or
    // Cancelled it is rejected as sealed; but an event whose Event_Id is already present for a Completed
    // or Cancelled match is classified Duplicate and leaves the stored log unchanged.
    // Validates: Requirements 7.1, 7.2, 7.3, 7.4
    [Property(MaxTest = 200)]
    [Trait("Property", "10")]
    public Property RecordingConfinedToTrackableWindow() =>
        Prop.ForAll(Arb.From(Gen.Elements(Enum.GetValues<MatchState>())), state =>
        {
            RecordEventBatchWorld world = RecordEventBatchWorld.Build(state);

            // A goal for team A (a valid submission once InProgress); for pre-team states the team id is
            // empty, but the state gate rejects before validation is ever reached, so it is immaterial.
            Guid scoringTeam = world.TeamAId == Guid.Empty ? Guid.NewGuid() : world.TeamAId;
            EventSubmission newEvent = new(Guid.CreateVersion7(), EventKind.GoalScored, 10, ScoringTeamId: scoringTeam);

            Result<BatchResult> result = world.Record(newEvent);

            switch (state)
            {
                case MatchState.InProgress:
                    if (!result.IsSuccess
                        || result.Value!.Outcomes[0].Outcome != EventOutcome.Applied
                        || world.Events.TotalCount != 1)
                    {
                        return false;
                    }

                    break;

                case MatchState.GatheringAvailability:
                case MatchState.Confirmed:
                case MatchState.TeamsRolled:
                    if (result.IsSuccess
                        || result.Error!.Code != LiveTrackingErrorCode.MatchNotStarted
                        || world.Events.TotalCount != 0)
                    {
                        return false;
                    }

                    break;

                case MatchState.Completed:
                case MatchState.Cancelled:
                    // A new id is rejected as sealed, appending nothing (Req 7.3).
                    if (result.IsSuccess
                        || result.Error!.Code != LiveTrackingErrorCode.LogSealed
                        || world.Events.TotalCount != 0)
                    {
                        return false;
                    }

                    // Idempotency precedence: an already-present id for a sealed match is a Duplicate
                    // that leaves the log unchanged (Req 7.4).
                    var present = new GoalScoredEvent(
                        Guid.CreateVersion7(), world.Match.Id, world.SquadId,
                        MatchMinute.Create(7).Value, scoringTeam, null, ownGoal: false);
                    world.Events.Seed(present);

                    EventSubmission duplicate = new(present.Id, EventKind.GoalScored, 7, ScoringTeamId: scoringTeam);
                    Result<BatchResult> dupeResult = world.Record(duplicate);
                    if (!dupeResult.IsSuccess
                        || dupeResult.Value!.Outcomes[0].Outcome != EventOutcome.Duplicate
                        || world.Events.TotalCount != 1)
                    {
                        return false;
                    }

                    break;

                default:
                    return false;
            }

            return true;
        });
}
