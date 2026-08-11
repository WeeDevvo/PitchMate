using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Domain.LiveTracking;
using MatchState = PitchMate.Domain.Matches.MatchState;

namespace PitchMate.Application.Tests.LiveTracking;

/// <summary>
/// Property-based test for <see cref="RecordEventBatchHandler"/> covering design Property 12 (the
/// recording side) — recording an event or batch succeeds iff the actor holds an active
/// <c>Owner</c>/<c>Admin</c> membership in the match's squad; a plain member, an inactive membership,
/// or a non-member is rejected with a uniform authorisation failure that appends no event and
/// discloses no match data. (Finalising is covered by task 9.)
/// </summary>
[Trait("Feature", "live-tracking")]
public class AdminOnlyRecordingPropertyTests
{
    // Feature: live-tracking, Property 12: Recording and finalising require an active owner or admin -
    // recording an event or batch succeeds iff the actor holds an Active Squad_Membership with role
    // Owner or Admin in the match's squad; a Member, an Inactive membership, a guest, or a non-member
    // is rejected with a uniform authorisation failure that appends no event, records no result, and
    // discloses no match data.
    // Validates: Requirements 11.1, 11.2
    [Property(MaxTest = 200)]
    [Trait("Property", "12")]
    public Property RecordingRequiresActiveOwnerOrAdmin() =>
        Prop.ForAll(Arb.From(Gen.Elements(Enum.GetValues<ActorRole>())), role =>
        {
            RecordEventBatchWorld world = RecordEventBatchWorld.Build(MatchState.InProgress);

            Result<BatchResult> result = world.Record(role, world.ValidGoal());

            bool authorised = role is ActorRole.Owner or ActorRole.Admin;
            if (authorised)
            {
                return result.IsSuccess
                    && result.Value!.Outcomes.Count == 1
                    && result.Value!.Outcomes[0].Outcome == EventOutcome.Applied
                    && world.Events.TotalCount == 1;
            }

            // A member, an inactive membership, or a non-member: uniform Unauthorized, nothing appended.
            return !result.IsSuccess
                && result.Error!.Code == LiveTrackingErrorCode.Unauthorized
                && world.Events.TotalCount == 0;
        });
}
