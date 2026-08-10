using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Domain.LiveTracking;
using MatchState = PitchMate.Domain.Matches.MatchState;

namespace PitchMate.Application.Tests.LiveTracking;

/// <summary>
/// Property-based test for <see cref="RecordEventBatchHandler"/> covering design Property 11 — every
/// event and derived value is match-associated and squad-scoped. Every appended event carries the
/// match named on the request and that match's squad (never a different match), and a request by a
/// user who holds no membership in the match's squad receives a response identical to that for a match
/// that does not exist, disclosing neither the match's existence nor any of its data.
/// </summary>
[Trait("Feature", "live-tracking")]
public class MatchScopePropertyTests
{
    // Feature: live-tracking, Property 11: Every event and derived value is match-associated and
    // squad-scoped - the event is associated only with the match named on its recording request and is
    // never applied to a different match; and a request for an event by a user who holds no membership
    // in the match's squad receives a response identical to that for a match that does not exist,
    // disclosing neither the match's existence nor any of its data.
    // Validates: Requirements 7.5, 11.3, 11.4
    [Property(MaxTest = 200)]
    [Trait("Property", "11")]
    public Property EventsAreMatchAssociatedAndSquadScoped() =>
        Prop.ForAll(Arb.From(Gen.Choose(1, 6)), goalCount =>
        {
            RecordEventBatchWorld world = RecordEventBatchWorld.Build(MatchState.InProgress);

            // An authorised admin records valid goals; every stored event is bound to this match and
            // its squad, never to a different match (Req 7.5, 11.3).
            EventSubmission[] batch = Enumerable
                .Range(0, goalCount)
                .Select(i => world.ValidGoal(minute: i % (MatchMinute.MaxValue + 1)))
                .ToArray();

            Result<BatchResult> applied = world.Record(ActorRole.Admin, batch);
            if (!applied.IsSuccess
                || applied.Value!.Outcomes.Any(o => o.Outcome != EventOutcome.Applied)
                || world.Events.Stored(world.Match.Id).Any(e => e.MatchId != world.Match.Id || e.SquadId != world.SquadId)
                || world.Events.TotalCount != goalCount)
            {
                return false;
            }

            // A non-member of the match's squad is rejected, and the rejection is byte-identical to the
            // response for a match that does not exist — existence is concealed (Req 11.4).
            Guid nonMemberUser = Guid.NewGuid();
            Result<BatchResult> nonMember = world.RecordAs(nonMemberUser, world.Match.Id, world.ValidGoal());
            Result<BatchResult> missingMatch = world.RecordAs(world.OwnerUserId, Guid.CreateVersion7(), world.ValidGoal());

            bool bothFail = !nonMember.IsSuccess && !missingMatch.IsSuccess;
            bool identical = nonMember.Error!.Code == missingMatch.Error!.Code
                && nonMember.Error!.Message == missingMatch.Error!.Message;
            bool concealed = nonMember.Error!.Code == LiveTrackingErrorCode.Unauthorized;

            // Neither concealment request appended anything beyond the admin's committed goals.
            bool nothingLeaked = world.Events.TotalCount == goalCount;

            return bothFail && identical && concealed && nothingLeaked;
        });
}
